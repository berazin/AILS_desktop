"""Immutable, bounded lexical evidence from physical raw OCR lines only.

Callers construct RawBlock from _lines(words, indexes), never corrected text.
Dictionary/extractor votes discover candidates; only raw standalone occurrences
count as evidence. Thresholds are conservative policy, not confidence scores.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import asdict, dataclass
import hashlib
import json
import re
import sqlite3


@dataclass(frozen=True)
class RawBlock:
    page: int
    block_id: str
    lines: tuple[str, ...]

    @property
    def text(self):
        return "\n".join(self.lines)


@dataclass(frozen=True)
class Policy:
    min_length: int = 3
    max_length: int = 32
    min_joined: int = 3
    min_pages: int = 2
    min_joined_ratio: float = .9
    max_chars: int = 1_000_000
    max_blocks: int = 10_000
    max_candidates: int = 65536
    max_extraction_results: int = 4096
    extraction_chars: int = 1_000_000
    extraction_min_count: int = 3
    extraction_max_word_len: int = 16


@dataclass(frozen=True)
class Term:
    key: str
    form: str
    joined: int
    horizontal_space: int
    physical_wrap: int
    pages: tuple[int, ...]


@dataclass(frozen=True)
class Evidence:
    status: str
    reason: str | None
    revision: str | None
    raw_blocks: tuple[RawBlock, ...] = ()
    terms: tuple[Term, ...] = ()

    @property
    def candidate_count(self):
        return len(self.terms)

    def diagnostics(self):
        return dict(status=self.status, reason=self.reason, revision=self.revision,
                    candidate_count=self.candidate_count)


@dataclass(frozen=True)
class Change:
    compact_start: int
    compact_end: int
    before: str
    after: str
    method: str


@dataclass(frozen=True)
class Application:
    text: str
    changes: tuple[Change, ...]
    protected_invariant: bool = True
    status: str = "ready"
    reason: str | None = None

    @property
    def applied_count(self):
        return len(self.changes)

    def diagnostics(self):
        return dict(status=self.status, reason=self.reason, applied_count=self.applied_count)


def _compact(text):
    return "".join(text.split())


def _check(cancel):
    if cancel:
        cancel()  # InterruptedError deliberately propagates.


def _occurrences(text, form):
    # Standalone Korean tokens only. Attached particles are conservatively absent;
    # substring counts are not independent semantic occurrences.
    pieces = r"(?:[ \t]+|[ \t]*\n[ \t]*)?".join(map(re.escape, form))
    return re.finditer(r"(?<![\w])" + pieces + r"(?![\w])", text)


def _offsets(text):
    offsets = [0]
    for c in text:
        offsets.append(offsets[-1] + (not c.isspace()))
    return offsets


def _allowed(text, start, end, protected, kiwi, offsets=None):
    offsets = offsets if offsets is not None else _offsets(text)
    first, last = offsets[start], offsets[end]
    if any(i in protected for i in range(first + 1, last)):
        return False
    # Reject contextual grammar conflicts, even for frequent dictionary homographs.
    context_start, context_end = max(0, start - 80), min(len(text), end + 80)
    context = text[context_start:context_end].replace("\n", "")
    context_offsets = _offsets(context)
    target_start = offsets[start] - offsets[context_start]
    target_end = offsets[end] - offsets[context_start]
    tokens = kiwi.tokenize(context)
    relevant = [t for t in tokens if context_offsets[t.start] < target_end
                and target_start < context_offsets[t.start + t.len]]
    return bool(relevant) and all(t.tag in {"NNG", "NNP", "XSN", "XR", "XPN"}
                                 and context_offsets[t.start] >= target_start
                                 and context_offsets[t.start + t.len] <= target_end for t in relevant)


def build_evidence(blocks, dictionary, kiwi, *, protected_boundaries, policy=Policy(),
                   extraction_revision="kiwi-default", cancel_check=None):
    try:
        return _build_evidence(blocks, dictionary, kiwi, protected_boundaries=protected_boundaries,
                               policy=policy, extraction_revision=extraction_revision,
                               cancel_check=cancel_check)
    except (OSError, UnicodeError, sqlite3.Error) as error:
        if isinstance(error, InterruptedError):
            raise
        return Evidence("unavailable", type(error).__name__, None)


def _build_evidence(blocks, dictionary, kiwi, *, protected_boundaries, policy,
                    extraction_revision, cancel_check):
    """Snapshot raw blocks once. dictionary exposes revision and lookup_many(keys).

    Kiwi extract_words receives a reiterable tuple with fixed bounded options.
    Missing resources return unavailable; programming errors are not swallowed.
    """
    snapshot, chars = [], 0
    for block in blocks:
        _check(cancel_check)
        if not isinstance(block, RawBlock) or not isinstance(block.lines, tuple):
            raise TypeError("RawBlock with immutable physical lines required")
        chars += len(block.text)
        if chars > policy.max_chars or len(snapshot) >= policy.max_blocks:
            return Evidence("skipped", "raw_input_limit", None)
        snapshot.append(block)
    snapshot = tuple(snapshot)
    if dictionary is None or kiwi is None:
        return Evidence("unavailable", "missing_dictionary_or_extractor", None)
    identity = dict(raw=[asdict(b) for b in snapshot], dictionary=dictionary.revision,
                    policy=asdict(policy), extraction_revision=extraction_revision, version=1)
    revision = hashlib.sha256(json.dumps(identity, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    texts = tuple(b.text for b in snapshot)
    protected_by_block = [protected_boundaries(text) for text in texts]
    extraction = []
    for text, protected in zip(texts, protected_by_block):
        _check(cancel_check)
        offset, segment = 0, []
        for char in text:
            # Exclude both endpoints of protected interior boundaries. Separate
            # items prevent words on either side from becoming synthetic seams.
            excluded = offset in protected or offset + (not char.isspace()) in protected
            if excluded:
                if segment:
                    extraction.append("".join(segment))
                    segment = []
            else:
                segment.append(char)
            offset += not char.isspace()
        if segment:
            extraction.append("".join(segment))
    extraction = tuple(text for text in extraction if text.strip())
    if not extraction:
        return Evidence("empty", None, revision, snapshot)
    candidates = set()
    for text in extraction:
        _check(cancel_check)
        for m in re.finditer(r"(?<!\w)[가-힣]+(?!\w)", text):
            if policy.min_length <= len(m.group()) <= policy.max_length:
                candidates.add(m.group())
                if len(candidates) > policy.max_candidates:
                    return Evidence("skipped", "candidate_limit", None)
    if chars > policy.extraction_chars:
        return Evidence("skipped", "extraction_input_limit", None)
    try:
        _check(cancel_check)
        found = kiwi.extract_words(extraction, min_cnt=policy.extraction_min_count,
                                   max_word_len=policy.extraction_max_word_len)
        for result_index, item in enumerate(found):
            _check(cancel_check)
            if result_index >= policy.max_extraction_results:
                return Evidence("skipped", "extraction_result_limit", None)
            form = item[0]
            if re.fullmatch(r"[가-힣]+", form) and policy.min_length <= len(form) <= policy.max_length:
                candidates.add(form)
            if len(candidates) > policy.max_candidates:
                return Evidence("skipped", "candidate_limit", None)
        forms = dictionary.lookup_many(sorted(candidates))
    except (OSError, UnicodeError, sqlite3.Error) as error:
        if isinstance(error, InterruptedError):
            raise
        return Evidence("unavailable", type(error).__name__, None)
    # Index whole-token windows once, rather than scanning the full document for
    # each extracted candidate. The length bound caps windows per source token.
    occurrences = defaultdict(list)
    for number, block in enumerate(snapshot):
        _check(cancel_check)
        tokens = list(re.finditer(r"(?<!\w)[가-힣]+(?!\w)", block.text))
        for i, token in enumerate(tokens):
            key = ""
            for following in tokens[i:i + policy.max_length]:
                if key and not re.fullmatch(r"[ \t]+|[ \t]*\n[ \t]*", block.text[end:following.start()]):
                    break
                key += following.group()
                end = following.end()
                if len(key) > policy.max_length:
                    break
                if key in candidates:
                    occurrences[key].append((number, token.start(), end))
    offsets_by_block = [_offsets(b.text) for b in snapshot]
    terms = []
    for key in sorted(candidates):
        _check(cancel_check)
        if key not in forms.get(key, ()):
            continue  # Compact-only dictionary lookup never authorizes a join.
        counts = defaultdict(int)
        pages = set()
        for number, start, end in occurrences[key]:
            _check(cancel_check)
            block = snapshot[number]
            value = block.text[start:end]
            if not _allowed(block.text, start, end, protected_by_block[number], kiwi, offsets_by_block[number]):
                continue
            category = "physical_wrap" if "\n" in value else "horizontal_space" if any(c.isspace() for c in value) else "joined"
            counts[category] += 1
            if category == "joined":
                pages.add(block.page)
        total = sum(counts.values())
        if (counts["joined"] >= policy.min_joined and len(pages) >= policy.min_pages
                and counts["joined"] / total >= policy.min_joined_ratio):
            terms.append(Term(key, key, counts["joined"], counts["horizontal_space"],
                              counts["physical_wrap"], tuple(sorted(pages))))
    return Evidence("ready" if terms else "empty", None, revision, snapshot, tuple(terms))


def apply_evidence(evidence, block, baseline, kiwi, *, protected_boundaries, cancel_check=None):
    """Restore approved raw solid words or internal physical wraps in one block."""
    try:
        return _apply_evidence(evidence, block, baseline, kiwi,
                               protected_boundaries=protected_boundaries, cancel_check=cancel_check)
    except (OSError, UnicodeError, sqlite3.Error) as error:
        if isinstance(error, InterruptedError):
            raise
        return Application(baseline, (), status="unavailable", reason=type(error).__name__)


def _apply_evidence(evidence, block, baseline, kiwi, *, protected_boundaries, cancel_check):
    raw = block.text
    if _compact(raw) != _compact(baseline):
        raise ValueError("non-whitespace character invariant violated")
    if evidence.status not in {"ready", "empty"}:
        return Application(baseline, (), status=evidence.status, reason=evidence.reason)
    if not any(block is item for item in evidence.raw_blocks):
        raise ValueError("block does not belong to this document evidence")
    protected = protected_boundaries(raw) | protected_boundaries(baseline)
    offsets = _offsets(raw)
    positions = [i for i, c in enumerate(baseline) if not c.isspace()]
    plans = []
    for term in evidence.terms:
        _check(cancel_check)
        for match in _occurrences(raw, term.form):
            original = match.group()
            if any(c.isspace() for c in original) and "\n" not in original:
                continue
            if "\n" in original and any(re.search(r"\s", line.strip()) for line in original.splitlines()):
                continue  # Never erase preexisting spaces within physical lines.
            if not _allowed(raw, match.start(), match.end(), protected, kiwi, offsets):
                continue
            first = offsets[match.start()]
            last = first + len(term.key)
            start, end = positions[first], positions[last - 1] + 1
            before = baseline[start:end]
            if "\n" in before:
                continue  # Layout-retained paragraph/list boundaries survive.
            if not _allowed(baseline, start, end, protected, kiwi):
                continue
            if before != term.form:
                plans.append((first, last, start, end, before, term.form))
    selected = []
    for plan in sorted(plans, key=lambda p: (-(p[1] - p[0]), p[0])):
        if not any(plan[0] < p[1] and p[0] < plan[1] for p in selected):
            selected.append(plan)
    result, cursor, changes = [], 0, []
    for first, last, start, end, before, after in sorted(selected):
        result.extend((baseline[cursor:start], after))
        cursor = end
        changes.append(Change(first, last, before, after, "document_raw_term"))
    result.append(baseline[cursor:])
    output = "".join(result)
    if _compact(output) != _compact(raw):
        raise ValueError("non-whitespace character invariant violated")
    return Application(output, tuple(changes))
