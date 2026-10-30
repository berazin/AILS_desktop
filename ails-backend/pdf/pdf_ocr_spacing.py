"""Korean OCR prose spacing, separate from the recognizer's word boxes.

Only whitespace is derived; the OCR words, coordinates and protected blocks
remain the source of truth for highlights and the embedded PDF text layer.
"""

from __future__ import annotations

import logging
import re
import statistics
import threading
from concurrent.futures import Future, ThreadPoolExecutor
from contextlib import contextmanager
from contextvars import ContextVar

from .pdf_ocr_spacing_protection import local_ranges, item_row, quoted_ranges
from .pdf_ocr_line_wrap_rules import joins_grammatical_wrap, joins_period_ending
from .pdf_ocr_punctuation import correct_punctuation, is_enumeration, protected_code_ranges, reference_number_boundaries, parallel_label_boundaries
from .pdf_grammar_refinement_metadata import GRAMMAR_REFINEMENT_VERSION, KIWI_VERSION

_logger = logging.getLogger(__name__)
SPACING_VERSION = GRAMMAR_REFINEMENT_VERSION
SPACING_ENABLED = ContextVar("ocr_spacing_enabled", default=True)


@contextmanager
def spacing_scope(enabled: bool | None):
    token = SPACING_ENABLED.set(SPACING_ENABLED.get() if enabled is None else enabled)
    try:
        yield
    finally:
        SPACING_ENABLED.reset(token)


_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ails-ocr-spacing")
_init_lock = threading.Lock()
_kiwi_future: Future | None = None
_reported_error: str | None = None
_LIST = re.compile(r"^\s*(?:[•●▪*①-⑳-]|\d+(?:\.(?!\d)|\))|[A-Za-z][.)]|[Pp]\d+[.])")
_MATH_ATOM = r"(?:[A-Za-z_α-ωΑ-Ω][A-Za-z0-9_α-ωΑ-Ω₀-₉⁰¹²³⁴⁵⁶⁷⁸⁹]*|\d+(?:[.,]\d+)?)"
_INLINE_PROTECTED = re.compile(
    r'https?://[^\s]+'
    r'|\$\$[\s\S]*?\$\$|\$[^$\n]*\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]'
    rf'|{_MATH_ATOM}(?:[ \t]*[=+*/^<>≤≥×÷−—–-][ \t]*{_MATH_ATOM})+'
    r'|\d+(?:[.,]\d+)+'
)
_INLINE_IDENTIFIER = re.compile(
    r'[A-Za-z_α-ωΑ-Ω][A-Za-z0-9_α-ωΑ-Ω₀-₉⁰¹²³⁴⁵⁶⁷⁸⁹]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*(?:\+\+|#)?'
)


def _load_kiwi():
    import kiwipiepy

    if kiwipiepy.__version__ != KIWI_VERSION:
        raise RuntimeError(f"문법정제에는 kiwipiepy=={KIWI_VERSION}이 필요합니다.")
    kiwi = kiwipiepy.Kiwi(num_workers=1, model_type="cong-global")
    kiwi.space("초기 분석을 준비합니다.")
    return kiwi


def prepare_spacing() -> Future:
    """Start/reuse initialization without importing/loading Kiwi on the caller."""
    global _kiwi_future
    with _init_lock:
        if (_kiwi_future is None or (_kiwi_future.done()
                and (_kiwi_future.cancelled() or _kiwi_future.exception() is not None))):
            _kiwi_future = _executor.submit(_load_kiwi)
        return _kiwi_future


def _compact(text: str) -> str:
    return re.sub(r"\s+", "", text)


def _space_boundaries(text: str) -> set[int]:
    cursor = 0
    result = set()
    for char in text:
        if char.isspace():
            result.add(cursor)
        else:
            cursor += 1
    return result


def _protected_boundaries(text: str) -> set[int]:
    """Protect literal/URL contents without shielding surrounding explanation."""
    paths = local_ranges(text)
    # Offset-preserving view pairs OCR mixed curly/straight quotes correctly.
    # Only protection parsing sees this view; stored source characters stay exact.
    quote_view = text.translate(str.maketrans({'‘': "'", '’': "'", '“': '"', '”': '"'}))
    matches = [(match.start(), match.end()) for match in _INLINE_PROTECTED.finditer(quote_view)
               if not (match.group().startswith(("http://", "https://"))
                       and any(start == match.start() for start, _ in paths))]
    # Expressions may end inside an identifier suffix (C/C++ or x + y#).
    # Collect identifiers independently so the earlier expression cannot
    # consume their start and hide their remaining interior boundaries.
    matches.extend((match.start(), match.end())
                   for match in _INLINE_IDENTIFIER.finditer(quote_view))
    for start, end in protected_code_ranges(text):
        enclosing = next(((a, b) for a, b in paths if a <= start < b), None)
        matches.append((start, min(end, enclosing[1]) if enclosing else end))
    matches.extend(paths)
    quotes = quoted_ranges(text)
    matches.extend(quotes)
    for line in re.finditer(r"[^\n]+", text):
        if _LIST.match(line.group()):
            matches.append((line.start(), line.start() + _LIST.match(line.group()).end()))
    protected = set()
    for first, last in quotes:
        mark = quote_view[first:first + 1]
        if mark in {'"', "'", '`'} and (last == first + 1 or quote_view[last - 1:last] != mark):
            if mark == "'":
                # The range parser can emit a closing quote as an empty
                # interrupted range after an English contraction. Such a
                # delimiter must not protect the following prose seam.
                prefix = re.sub(r"(?<=[A-Za-z])'(?=[A-Za-z])", "", quote_view[:first])
                if prefix.count(mark) % 2:
                    continue
            # Interrupted quotes protect only their first token, so `last`
            # usually precedes the line end. Preserve that physical seam
            # without extending literal protection into following prose.
            newline = text.find("\n", first)
            if newline >= 0:
                protected.add(len(_compact(text[:newline])))
    citation_years = reference_number_boundaries(text)
    label_boundaries = parallel_label_boundaries(text)
    for first, last in matches:
        start = len(_compact(text[:first]))
        end = start + len(_compact(text[first:last]))
        allowed = ({len(_compact(text[:position])) for position in citation_years
                    if first < position < last}
                   if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", text[first:last]) else set())
        if re.fullmatch(r'[A-Za-z_][A-Za-z0-9_.]*', text[first:last]):
            allowed.update(len(_compact(text[:position])) for position in label_boundaries
                           if first < position < last)
        # A citation such as [Gude2008] needs the existing author/year rule.
        # Other identifier interiors remain exact. Quotes, formulas and code
        # arrays still contribute enclosing protected ranges independently.
        protected.update(set(range(start + 1, end)) - allowed)
        if (last < len(text) and text[last] == "\n"
                and (text[first:last].count(chr(34)) % 2
                     or text[first:last].startswith(("http://", "https://")))):
            protected.add(end)
    return protected


def _glue_wraps(text: str, kiwi, proposal: str) -> str:
    """Apply glue's separator decision only at approved physical line wraps.

    The caller selects consecutive prose lines by layout. Every within-line
    character and gap stays exact, even if Kiwi proposes other spacing edits.
    """
    if "\n" not in text:
        return text
    # Read wrapped literals as one span so their line seams stay protected too.
    protected = _protected_boundaries(text)
    proposal_boundaries = _space_boundaries(proposal)
    positions = [i for i, char in enumerate(text) if not char.isspace()]
    pieces = [text[:positions[0]], text[positions[0]]]
    for offset, (left, right) in enumerate(zip(positions, positions[1:]), 1):
        gap = text[left + 1:right]
        if ("\n" in gap and offset not in protected
                and (text[right] == "(" or re.search(r"[가-힣]", text[left] + text[right]))):
            gap = (" " if text[right] == "(" and is_enumeration(text, right)
                   else "" if (text[right] == "(" or joins_period_ending(text, left, right)
                          or joins_grammatical_wrap(text, left, right, kiwi))
                   else " " if offset in proposal_boundaries else "")
        pieces.extend((gap, text[right]))
    pieces.append(text[positions[-1] + 1:])
    return "".join(pieces)


def _correct_spacing(text: str, kiwi, *, layout_text: str | None = None) -> str:
    """Glue physical wraps, space prose, then repair punctuation whitespace."""
    if layout_text is not None:
        glued = layout_text
    elif "\n" in text:
        proposal = kiwi.glue(text.split("\n"))
        if _compact(proposal) != _compact(text):
            return text
        glued = _glue_wraps(text, kiwi, proposal)
    else:
        glued = text
    if not re.search(r"[가-힣]", glued):
        return glued
    proposal = kiwi.space(glued)
    if _compact(proposal) != _compact(glued):
        return text
    protected = _protected_boundaries(text)
    # Layout-approved number/particle seams must survive Kiwi's homonym
    # analysis. This does not join counters/units or alter same-line gaps.
    for match in re.finditer(r"\d+(?:가|는|를|에|로)(?=[ \t\d]|$)|\d+(?:\.\d+)*[장절쪽항권]", glued):
        first = len(_compact(glued[:match.start()]))
        last = len(_compact(glued[:match.end()]))
        protected.update(range(first + 1, last))
    proposed_spaces = _space_boundaries(proposal)
    tokenize = getattr(kiwi, 'tokenize', None)
    if callable(tokenize):
        raw_tokens = tokenize(glued)
        def registered_lexeme(token, literal):
            morpheme = getattr(kiwi, 'morpheme', None)
            token_id = getattr(token, 'id', None)
            return callable(morpheme) and token_id is not None and morpheme(token_id).form == literal
        # Subject + numeric copula + noun: 값이 3인 스레드. The source
        # numeral is attached; require a subject particle and an exact known
        # following noun to distinguish this from a person-count compound.
        for match in re.finditer(r'\d+인([가-힣]+)', glued):
            preceding = [t for t in raw_tokens if t.tag == 'JKS'
                         and t.start + t.len <= match.start()
                         and not glued[t.start + t.len:match.start()].strip()]
            if not preceding:
                continue
            local = tokenize(match.group(1))
            if (local and local[0].tag in {'NNG', 'NNP', 'NP'}
                    and registered_lexeme(local[0], match.group(1)[:local[0].len])):
                digit_end = match.start(1) - 1
                boundary = len(_compact(glued[:digit_end]))
                proposed_spaces.discard(boundary)
                protected.add(boundary)
                proposed_spaces.add(boundary + 1)
        # SI prefixes qualify the following unit inside one written unit name.
        # Preserve an existing attached name; existing separated source text
        # and general noun compounds are outside this rule.
        si_prefixes = {'피코', '나노', '마이크로', '밀리', '센티', '데시',
                       '데카', '헥토', '킬로', '메가', '기가', '테라'}
        si_units = {'초', '미터', '그램', '몰', '헤르츠', '와트', '볼트',
                    '암페어', '파스칼', '줄', '뉴턴', '켈빈'}
        for left, right in zip(raw_tokens, raw_tokens[1:]):
            if (getattr(left, 'form', None) in si_prefixes and getattr(right, 'form', None) in si_units
                    and left.start + left.len == right.start
                    and registered_lexeme(left, glued[left.start:left.start + left.len])
                    and registered_lexeme(right, glued[right.start:right.start + right.len])):
                boundary = len(_compact(glued[:right.start]))
                proposed_spaces.discard(boundary)
                protected.add(boundary)
        for token in raw_tokens:
            if token.tag.startswith('J') and any(t.tag in {'NNG', 'NNP', 'NP'} and
                    t.start + t.len == token.start for t in raw_tokens):
                boundary = len(_compact(glued[:token.start]))
                proposed_spaces.discard(boundary)
                protected.add(boundary)
        # A source Korean word following an isolated Latin identifier is a
        # nominal label, not an invitation to move its separator into the
        # word. Local morphology excludes verbal explanations/particles.
        for match in re.finditer(r'(?<![A-Za-z0-9_])[A-Za-z][A-Za-z0-9_]*([ \t]*)([가-힣]+)', glued):
            run = match.group(2)
            local_tokens = tokenize(run)
            full_particle = any(t.tag.startswith('J') and t.start <= match.start(2) < t.start + t.len
                                and t.start + t.len >= match.end(2)
                                and registered_lexeme(t, glued[t.start:t.start + t.len]) for t in raw_tokens)
            if not full_particle and local_tokens and local_tokens[0].len >= 2 and local_tokens[0].tag in {'NNG', 'NNP', 'NP'} and registered_lexeme(local_tokens[0], run[:local_tokens[0].len]) and all(t.tag.startswith('J') for t in local_tokens[1:]):
                first = len(_compact(glued[:match.start(2)]))
                proposed_spaces.add(first)
                for boundary in range(first + 1, first + len(run)):
                    proposed_spaces.discard(boundary)
                    protected.add(boundary)
        # The bound 피- prefix and multiplicity suffix -중 already attached
        # in the source are not standalone noun/number phrases.
        for match in re.finditer(r'(?<![가-힣])피(?=[가-힣]{2,})|\d+중(?=[ \t]|$)', glued):
            first = len(_compact(glued[:match.start()]))
            last = first + len(_compact(match.group()))
            boundary = first + 1 if match.group() == '피' else last - 1
            proposed_spaces.discard(boundary)
            protected.add(boundary)
        # Recheck newly split adjacent nominal pieces in a local lexical
        # reading. A long noisy OCR sentence can hide a known short word or
        # suffix from the full-context analysis. Require an exact intact raw
        # span and a single lexical noun or noun+derivational suffix locally.
        compact = _compact(glued)
        raw_positions = [i for i, c in enumerate(glued) if not c.isspace()]
        proposed_tokens = tokenize(proposal)
        for left_token, right_token in zip(proposed_tokens, proposed_tokens[1:]):
            if left_token.tag not in {'NNG', 'NNP', 'XR', 'MM'} or right_token.tag not in {'NNG', 'NNP', 'XSN'}:
                continue
            first = len(_compact(proposal[:left_token.start]))
            middle = len(_compact(proposal[:right_token.start]))
            last = len(_compact(proposal[:right_token.start + right_token.len]))
            if not (first < middle < last <= len(raw_positions)) or middle not in proposed_spaces:
                continue
            original = glued[raw_positions[first]:raw_positions[last - 1] + 1]
            if re.search(r'\s', original):
                continue
            local = tokenize(original)
            lexical = len(local) == 1 and local[0].tag in {'NNG', 'NNP', 'NP'} and registered_lexeme(local[0], original)
            derived = (len(local) == 2 and local[0].tag in {'NNG', 'NNP', 'XR'} and local[1].tag == 'XSN'
                       and registered_lexeme(local[0], original[:local[0].len]))
            if lexical or derived:
                proposed_spaces.discard(middle)
                protected.add(middle)
        for token in raw_tokens:
            literal = glued[token.start:token.start + token.len]
            # A single exact lexical token is stronger evidence than a new
            # split invented by space(). This protects its interior only;
            # phrase separators, fragmented OCR and noun/verb boundaries
            # remain editable. Normalized morpheme spellings are never copied.
            if token.tag in {'NNG', 'NNP', 'NP'} and token.len > 1 and registered_lexeme(token, literal) and not re.search(r'\s', literal):
                first = len(_compact(glued[:token.start]))
                for boundary in range(first + 1, first + token.len):
                    proposed_spaces.discard(boundary)
                    protected.add(boundary)
        for previous, token in zip(raw_tokens, raw_tokens[1:]):
            left = previous.start + previous.len
            right = token.start
            boundary = len(_compact(glued[:right]))
            # Preserve noun+particle and derivational suffix interiors that
            # the raw morphological reading recognizes, without flattening
            # unrelated noun phrases.
            if left == right and previous.tag in {'NNG', 'NNP', 'XR', 'SN', 'XPN'} and (
                    token.tag.startswith('J') or token.tag == 'XSN'
                    or (previous.tag in {'XR', 'XPN'} and token.tag == 'NNG')):
                proposed_spaces.discard(boundary)
                protected.add(boundary)
            # Auxiliary 하다 after these connective endings is a distinct
            # word, even when OCR lost its source separator.
            if boundary not in protected and previous.tag == 'EC' and getattr(previous, 'form', None) in {'게', '고자', '어야', '아야', '여야'} and token.tag == 'VX' and getattr(token, 'form', None) == '하':
                proposed_spaces.add(boundary)
    positions = [i for i, char in enumerate(glued) if not char.isspace()]
    pieces = [glued[:positions[0]], glued[positions[0]]]
    for offset, (left, right) in enumerate(zip(positions, positions[1:]), 1):
        gap = glued[left + 1:right]
        if offset not in protected and "\n" not in gap:
            gap = " " if offset in proposed_spaces else ""
        pieces.extend((gap, glued[right]))
    pieces.append(glued[positions[-1] + 1:])
    spaced = "".join(pieces)
    return correct_punctuation(spaced, kiwi, protected)


def _lines(words, indexes: list[int]) -> list[dict]:
    selected = [(i, words[i]) for i in indexes if 0 <= i < len(words)]
    height = statistics.median([max(1e-6, w.bottom - w.top) for _, w in selected] or [1])
    lines: list[list[tuple]] = []
    for item in sorted(selected, key=lambda v: ((v[1].top + v[1].bottom) / 2, v[1].left)):
        center = (item[1].top + item[1].bottom) / 2
        if not lines or abs(center - statistics.mean((w.top + w.bottom) / 2 for _, w in lines[-1])) > height * .65:
            lines.append([item])
        else:
            lines[-1].append(item)
    result = []
    for line in lines:
        line.sort(key=lambda item: item[1].left)
        result.append({
            "text": " ".join(w.text for _, w in line),
            "word_indexes": [i for i, _ in line],
            "bbox": [min(w.left for _, w in line), min(w.top for _, w in line),
                     max(w.right for _, w in line), max(w.bottom for _, w in line)],
        })
    return result


def _can_join(left: dict, right: dict, block_width: float, kiwi=None) -> bool:
    a, b = left["text"].rstrip(), right["text"].lstrip()
    if not a or not b or not (b.startswith("(") or re.search(r"[가-힣]$", a) or re.match(r"^[가-힣]", b)):
        return False
    marked_left = _LIST.match(a)
    split_inflection = False
    if marked_left and kiwi is not None:
        tail = re.search(r'[가-힣]+$', a)
        head = re.match(r'[가-힣]+', b)
        if tail and head and callable(getattr(kiwi, 'morpheme', None)):
            joined = tail.group() + head.group()
            seam = len(tail.group())
            split_inflection = any(t.tag in {'EC', 'EF', 'ETM', 'EP'}
                and t.start < seam < t.start + t.len
                and kiwi.morpheme(t.id).form == joined[t.start:t.start + t.len]
                for t in kiwi.tokenize(joined))
    if re.search(r"[.!?。]$", a) or _LIST.match(b) or (marked_left and not re.match(r'^[•●▪]|^[Pp]\d+[.]', a) and not split_inflection) or (item_row(a) and item_row(b)) or re.match(r"^[가-힣]+\.(?:pdf|java|py|txt)\b", b):
        return False
    x1, y1, x2, y2 = left["bbox"]
    rx1, ry1, _, ry2 = right["bbox"]
    height = max(1e-6, (y2-y1 + ry2-ry1) / 2)
    return (-.2 * height <= ry1-y2 <= height * 1.2
            and x2-x1 >= block_width * .85)


def _restore_block(block: dict, words, kiwi) -> dict:
    lines = _lines(words, block.get("words") or [])
    raw = "\n".join(line["text"] for line in lines)
    result = {"version": SPACING_VERSION, "engine": "Kiwi",
              "raw_text": raw, "layout_text": raw, "text": raw,
              "source_word_indexes": [i for line in lines for i in line["word_indexes"]],
              "edits": [], "status": "preserved"}
    if block.get("type") != "text" or block.get("text_source") == "native":
        return result
    groups: list[list[dict]] = []
    width = max(1e-6, block["bbox"][2] - block["bbox"][0])
    for line in lines:
        if groups and _can_join(groups[-1][-1], line, width, kiwi):
            groups[-1].append(line)
        else:
            groups.append([line])
    output = []
    layout_output = []
    for group in groups:
        original = "\n".join(line["text"] for line in group)
        layout = original
        if "\n" in original:
            proposal = kiwi.glue(original.split("\n"))
            if _compact(proposal) == _compact(original):
                layout = _glue_wraps(original, kiwi, proposal)
        layout_output.append(layout)
        corrected = _correct_spacing(original, kiwi, layout_text=layout)
        if _compact(corrected) != _compact(original):
            corrected = original
        start = sum(len(piece) + 1 for piece in output)
        output.append(corrected)
        if corrected != original:
            result["edits"].append({"source_word_indexes": [i for line in group for i in line["word_indexes"]],
                                    "output_start": start, "output_end": start + len(corrected)})
    result["layout_text"] = "\n".join(layout_output)
    result["text"] = "\n".join(output)
    if result["text"] != raw:
        result["status"] = "corrected"
    return result


def _restore_page(analysis: dict, words, kiwi_future: Future, cancel_check=None, document_context=None) -> None:
    kiwi = kiwi_future.result()
    if cancel_check:
        cancel_check()
    blocks = analysis.get("blocks") or []
    restored = [_restore_block(block, words, kiwi) for block in blocks]
    from .pdf_ocr_terminology import refine_page_terms
    refine_page_terms(blocks, restored, kiwi, _protected_boundaries, cancel_check=cancel_check)
    for block, spacing in zip(blocks, restored):
        if block.get("type") != "text" or block.get("text_source") == "native":
            continue
        if document_context is None:
            continue
        from .pdf_ocr_document_terms_integration import apply_document_context, finalize_document_spacing
        apply_document_context(document_context, block, spacing, kiwi, cancel_check=cancel_check)
        # External punctuation/reference rules outrank raw term fallback.
        # Never rerun whole-block space() after the final selection.
        finalize_document_spacing(spacing, kiwi)
    if cancel_check:
        cancel_check()
    for block, spacing in zip(blocks, restored):
        block["spacing"] = spacing


def restore_analysis_spacing(analysis: dict, words, *, cancel_check=None, document_context=None) -> None:
    """OCR worker waits for the CPU task; HTTP/UI threads never run Kiwi.

    Missing dependencies/errors preserve the recognizer output and expose the
    reason in metadata instead of silently claiming that spacing completed.
    """
    global _reported_error
    if not SPACING_ENABLED.get():
        analysis["spacing_status"] = "disabled"
        return
    kiwi_future = document_context.kiwi_future if document_context is not None and document_context.kiwi_future is not None else prepare_spacing()
    try:
        _executor.submit(_restore_page, analysis, words, kiwi_future, cancel_check, document_context).result()
        analysis["spacing_status"] = "complete"
    except InterruptedError:
        raise
    except (OSError, UnicodeError, RuntimeError, ImportError) as error:
        if cancel_check:
            cancel_check()
        analysis["spacing_status"] = "unavailable"
        analysis["spacing_error"] = str(error)
        if _reported_error != str(error):
            _logger.warning("OCR spacing preserved original text: %s", error)
            _reported_error = str(error)
