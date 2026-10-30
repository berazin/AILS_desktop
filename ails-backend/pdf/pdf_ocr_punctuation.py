"""Whitespace around prose punctuation and document references, never spelling."""

from __future__ import annotations

import re
from .pdf_ocr_spacing_protection import quoted_ranges

_ENUMERATION = re.compile(r"\(\s*\d{1,3}\s*\)")
_REFERENCE = re.compile(r"\[[^\[\]\n]{1,180}\]")
_LABEL_NUMBER = re.compile(r"(?<![가-힣A-Za-z])(?:그림|표|수식|식)\s*(?=\d)")
_AUTHOR_YEAR = re.compile(r"[A-Za-z][A-Za-z.-]+(?=\s*(?:19|20)\d{2}[a-z]?(?:\W|$))")
_RFC_NUMBER = re.compile(r"\bRFC(?=\s*\d)")
_CODE_CALL = re.compile(r"(?<![A-Za-z0-9_])[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*\s*\(")
_CODE_POSTFIX = re.compile(
    r"\b[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\s*(?:\+\+|--)\s*;?"
)
_CODE_LITERAL = re.compile(
    r"\b[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\s*\[[^\]\n]*\]"
    r"|\b[A-Za-z_][A-Za-z0-9_]*\s*(?:==|!=|<=|>=|=|[+*/^])\s*[+−-]?[A-Za-z0-9_.α-ωΑ-Ω₀-₉⁰¹²³⁴⁵⁶⁷⁸⁹]+"
    r"|(?<![A-Za-z0-9_])[A-Za-z_][A-Za-z0-9_]*_[A-Za-z0-9_]+"
    r"|\b[\w-]+\.(?:py|java|js|ts|txt|pdf|csv|json|html|com|org|net)\b",
    re.IGNORECASE,
)


def is_enumeration(text: str, position: int) -> bool:
    return _ENUMERATION.match(text, position) is not None


def reference_number_boundaries(text: str) -> set[int]:
    """Recognized citation separators, distinct from code identifiers."""
    return {reference.start() + 1 + author.end()
            for reference in _REFERENCE.finditer(text)
            for pattern in (_AUTHOR_YEAR, _RFC_NUMBER)
            for author in pattern.finditer(reference.group()[1:-1])}


def parallel_label_boundaries(text: str) -> set[int]:
    """Repeated word + single-letter labels distinguish list dots from names."""
    return {match.start(2) for match in re.finditer(
        r'\b([A-Za-z][A-Za-z0-9_]*)\s+[A-Z]\.([A-Za-z][A-Za-z0-9_]*)\s+[A-Z](?=[\s.,;]|$)', text)
        if match.group(1) == match.group(2)}


def protected_code_ranges(text: str) -> list[tuple[int, int]]:
    """Protect inline calls (including nested arguments), arrays and operators."""
    ranges = [(match.start(), match.end()) for match in _CODE_LITERAL.finditer(text)]
    # Expressions may consume the operand of a postfix operator (a/b ++).
    # Read the existing postfix pattern independently to retain its range.
    ranges.extend((match.start(), match.end()) for match in _CODE_POSTFIX.finditer(text))
    for match in _CODE_CALL.finditer(text):
        if re.fullmatch(r"[A-Z][A-Z0-9]*", text[match.start():match.end() - 1].strip()):
            # Acronym(expansion) in prose is not an inline function call.
            continue
        depth = 1
        end = match.end()
        while end < len(text) and depth and text[end] != "\n":
            depth += (text[end] == "(") - (text[end] == ")")
            end += 1
        ranges.append((match.start(), end))
    merged = []
    for start, end in sorted(ranges):
        if merged and (start <= merged[-1][1]
                       or text[merged[-1][1]:start].strip() in {",", ";"}):
            merged[-1] = (merged[-1][0], max(end, merged[-1][1]))
        else:
            merged.append((start, end))
    return merged


def correct_punctuation(text: str, kiwi, protected: set[int]) -> str:
    """Add missing prose separators; keep particles and protected content exact.

    Protected positions use non-whitespace character offsets, as the spacing
    projection does. No general word/verb boundary is proposed here.
    """
    # Reanalyse only a misplaced Latin/particle gap in its complete context.
    # Both the attached particle and following word break must be proposed;
    # ordinary Latin + Korean labels therefore keep their existing separator.
    latin_particle = re.compile(r'([A-Za-z][A-Za-z0-9_]*)([ \t]+)(에서|에게|으로|에|은|는|을|를|과|와)(?=[가-힣])')
    matches = list(latin_particle.finditer(text))
    space = getattr(kiwi, 'space', None)
    if matches and callable(space):
        joined = latin_particle.sub(lambda m: m.group(1) + m.group(3), text)
        proposal = space(joined)
        compact = lambda value: re.sub(r'\s+', '', value)
        if compact(proposal) == compact(text):
            cursor, proposal_spaces = 0, set()
            for char in proposal:
                if char.isspace():
                    proposal_spaces.add(cursor)
                else:
                    cursor += 1
            for match in reversed(matches):
                start = len(compact(text[:match.start(2)]))
                end = start + len(match.group(3))
                if (start not in protected and end not in protected
                        and start not in proposal_spaces and end in proposal_spaces):
                    text = (text[:match.start(2)] + match.group(3)
                            + ' ' + text[match.end():])
    tokenize = getattr(kiwi, "tokenize", None)
    first_tokens = {}
    all_tokens = []
    if tokenize is not None:
        for token in tokenize(text):
            all_tokens.append(token)
            first_tokens.setdefault(token.start, token)
    offsets = [0]
    for char in text:
        offsets.append(offsets[-1] + (not char.isspace()))
    insertions = set()

    def add_space(position: int) -> None:
        if (0 < position < len(text) and not text[position - 1].isspace()
                and not text[position].isspace()
                and offsets[position] not in protected):
            insertions.add(position)

    for position, char in enumerate(text):
        following = position + 1
        if following >= len(text):
            continue
        after = text[following]
        if char in ".!?。" and position and "가" <= text[position - 1] <= "힣":
            if after.isalnum():
                add_space(following)
        elif char == "," and position and after.isalnum():
            if not (text[position - 1].isdigit() and after.isdigit()):
                add_space(following)
        elif char in ")]" and after.isalnum():
            token = first_tokens.get(following)
            if token is not None and token.tag in {
                "NNG", "NNP", "NNB", "NP", "NR", "MM", "MAG", "MAJ",
                "SN", "SL",
            }:
                add_space(following)
        if char == "(" and is_enumeration(text, position):
            add_space(position)

    for first, last in quoted_ranges(text):
        if first and '가' <= text[first - 1] <= '힣':
            add_space(first)
        token = first_tokens.get(last)
        if (last < len(text) and not re.match(r'(?:은|는|이|가|을|를|의|에|와|과|도|로|으로)(?:\s|$)', text[last:])
                and token is not None
                and token.tag in {'NNG', 'NNP', 'NP', 'MM', 'MAG'}):
            add_space(last)
    for boundary in parallel_label_boundaries(text):
        add_space(boundary)
    # Explicit angle references and dotted section labels are prose units.
    # Require a reference shape, so comparison operators stay untouched.
    for match in re.finditer(r'<(?:표|그림|식)\s*\d[^<>\n]*>|<F\d{1,2}>|<[A-Za-z]\s*,\s*[A-Za-z]>|\d+(?:\.\d+)+절', text):
        if match.start() and (text[match.start() - 1] in '.!?。'
                              or '가' <= text[match.start() - 1] <= '힣'):
            add_space(match.start())
        if match.group().startswith('<'):
            for label in _LABEL_NUMBER.finditer(match.group()[1:-1]):
                add_space(match.start() + 1 + label.end())
    for match in re.finditer(r'(?<=[.!?。])\([a-z]\)', text):
        add_space(match.start())
    for match in re.finditer(r'\[(?:그림|표|식)\s*\d|\{[^{}\n]*\}', text):
        previous = [t for t in all_tokens if t.start + t.len == match.start()]
        if any(t.tag.startswith('J') or (t.tag == 'ETM' and any(
                p.tag == 'VCP' and p.start <= t.start <= p.start + p.len
                for p in all_tokens)) for t in previous):
            add_space(match.start())
        if match.group().startswith('['):
            label = _LABEL_NUMBER.search(match.group()[1:])
            if label:
                add_space(match.start() + 1 + label.end())
    # An isolated symbol after a Korean noun denotes a named object. Longer
    # identifiers and attached Latin-to-Korean particles are not split here.
    if tokenize is not None:
        for match in re.finditer(r'([가-힣]+)([A-Z])(?=[가-힣\s,.;:]|$)', text):
            left_tokens = tokenize(match.group(1))
            if left_tokens and left_tokens[-1].tag in {'NNG', 'NNP'}:
                add_space(match.start(2))
        for token in first_tokens.values():
            if token.tag == 'SL' and any(previous.tag.startswith('J')
                    and previous.start + previous.len == token.start
                    for previous in first_tokens.values()):
                add_space(token.start)

    for reference in _REFERENCE.finditer(text):
        content = reference.group()[1:-1]
        preceding = [token for token in first_tokens.values()
                     if token.start + token.len == reference.start()]
        if (any(token.tag.startswith('J')
                or (token.tag == 'EC' and getattr(token, 'form', '') in {'어', '아', '여', '어서', '아서'})
                for token in preceding)
                or (reference.start() and text[reference.start() - 1] in '.!?。')):
            add_space(reference.start())
        boundaries = []
        for pattern in (_LABEL_NUMBER, _AUTHOR_YEAR, _RFC_NUMBER):
            boundaries.extend(reference.start() + 1 + match.end()
                              for match in pattern.finditer(content))
        if not boundaries:
            continue
        for boundary in boundaries:
            add_space(boundary)
        # A reference following a particle is a separate citation/figure phrase.
        # Keep an annotation immediately following a connective ending in place.
        preceding = next((token for token in first_tokens.values()
                          if token.start + token.len == reference.start()
                          and token.tag.startswith("J")), None)
        if preceding is not None:
            add_space(reference.start())

    return "".join((" " if position in insertions else "") + char
                   for position, char in enumerate(text))
