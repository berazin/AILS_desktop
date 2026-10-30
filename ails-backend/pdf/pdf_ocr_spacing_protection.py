"""Local protection derived from physical OCR lines, never book identities."""
import re

_PATH = re.compile(r'(?:[A-Za-z]:\\|\\\\|https?://)[^\n"\'<>]*?\.[A-Za-z0-9]{1,8}(?=[가-힣\s,;.!?]|$)')
_WINDOWS_PATH = re.compile(
    r'(?:[A-Za-z]:\\|\\\\)'
    r'(?:[^\\\n"\'<>|:*?,;]+\\(?:[ \t]*\n[ \t]*)?)*'
    r'[^\s\\"\'<>|:*?,;]*'
)
_AUTHOR = re.compile(r'(?:지은이|저자(?:\s*소개)?|글쓴이)\s*[:：]?\s*([가-힣]{2,4}(?:\s*[,·]\s*[가-힣]{2,4})*)(?=$|\s|[.!?])')


def quoted_ranges(text):
    """Pair OCR quote variants; an interrupted literal protects one token only."""
    ranges = []
    for marks in ('"“”', "'‘’", '`'):
        opening = None
        for position, char in enumerate(text):
            if char not in marks:
                continue
            # Apostrophes inside English words are not delimiters.
            if (char in "'’" and position and position + 1 < len(text)
                    and text[position - 1].isascii() and text[position - 1].isalpha()
                    and text[position + 1].isascii() and text[position + 1].isalpha()
                    and (opening is None or re.match(r"[A-Za-z]+['’]", text[position + 1:]))):
                continue
            # A Korean literal followed by an English word still has a real
            # closing quote. Only an interrupted ASCII token + particle,
            # followed by a separately closed ASCII literal, suggests a new
            # opening in the same quote family.
            interrupted = (opening is not None and marks == "'‘’"
                           and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*\s*(?:와|과|은|는|이|가|을|를|도)\s*',
                                            text[opening + 1:position])
                           and re.match(r"[A-Za-z_][A-Za-z0-9_]*['’](?=[가-힣\s.,;:]|$)", text[position + 1:]))
            new_opening = char in '“‘' or interrupted
            if opening is not None and not new_opening:
                ranges.append((opening, position + 1))
                opening = None
                continue
            if opening is not None:
                token = re.match(r"[^\s\"'‘’“”`]+", text[opening + 1:])
                ranges.append((opening, opening + 1 + (len(token.group()) if token else 0)))
            opening = position
        if opening is not None:
            token = re.match(r"[^\s\"'‘’“”`]+", text[opening + 1:])
            ranges.append((opening, opening + 1 + (len(token.group()) if token else 0)))
    return ranges

def local_ranges(text):
    ranges = [(m.start(), m.end()) for m in _PATH.finditer(text)]
    ranges.extend((m.start(), m.end()) for m in re.finditer(
        r'<[A-Za-z][A-Za-z0-9_]*(?:[ \t]*,[ \t]*[A-Za-z][A-Za-z0-9_]*)+>', text))
    ranges.extend((m.start(), m.end()) for m in re.finditer(r'\{[^{}\n]*\}', text))
    for match in _WINDOWS_PATH.finditer(text):
        # An extension is an explicit end even before an attached particle.
        # Otherwise stop at the first unmarked gap. Spaces before another
        # path separator and a wrap after it have structural path evidence;
        # ambiguous final-component spaces require quotes, handled by caller.
        if not any(start == match.start() for start, _ in ranges):
            ranges.append((match.start(), match.end()))
    for line in re.finditer(r'[^\n]+', text):
        value=line.group()
        # Index/glossary rows identify a term with an English gloss and page
        # number. Preserve the source token's interior, rather than applying
        # a short-noun homograph analysis to a label without sentence context.
        if item_row(value):
            for m in re.finditer(r'[가-힣]{3,}(?=\([A-Za-z][^\n)]*\))', value):
                ranges.append((line.start() + m.start(), line.start() + m.end()))
        # Wide gaps are potential column separators. Detached particles and
        # gaps following sentence predicates are ordinary OCR prose errors.
        # Protect only a structural boundary; cell interiors stay editable.
        for gap in re.finditer(r"(?<=\S)[ \t]{2,}(?=\S)", value):
            left, right = value[:gap.start()], value[gap.end():]
            if (re.match(r"(?:에서|에게|으로|까지|부터|처럼|보다)(?=\s|$)", right)
                    or re.search(r"(?:[습합]니다|한다|된다|이다|있다|없다|[.!?。])$", left)):
                continue
            ranges.append((line.start() + gap.start() - 1,
                           line.start() + gap.end() + 1))
        for m in _AUTHOR.finditer(value):
            for name in re.finditer(r'[가-힣]{2,4}', m.group(1)):
                ranges.append((line.start()+m.start(1)+name.start(),line.start()+m.start(1)+name.end()))
        # Existing connective + auxiliary spelling is valid; uncertain Kiwi
        # homonym analyses must not erase this source boundary.
        for m in re.finditer(r'(?:[가-힣](?:게|도록)|^도록)([ \t]+)[하한할합해했][가-힣]*|\d+(?:가|는|를|에|로)(?=[ \t\d]|$)|\d+[ \t]*가지(?=[ \t]|$)|\d+[ \t]+중(?=[ \t가-힣]|$)', value):
            # Only the connective/auxiliary gap has source evidence. A
            # missing separator after the auxiliary must remain editable.
            end = m.end(1) + 1 if m.group(1) is not None else m.end()
            ranges.append((line.start()+m.start(),line.start()+end))
    return ranges

def item_row(text):
    """Page-number entries and aligned columns are separate layout items."""
    return bool(re.search(r'\S[ \t]{2,}\S.+[ \t]{2,}\S|[가-힣A-Za-z)][ \t]+\d+(?:[ ,]+\d+)*\s*$', text))
