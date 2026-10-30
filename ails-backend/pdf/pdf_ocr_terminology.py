"""Dictionary/Kiwi agreement with raw-layout preservation for ambiguous terms."""

from __future__ import annotations

import re
import sqlite3

from .pdf_term_dictionary import get_term_dictionary, MIN_TERM_LENGTH, MAX_TERM_LENGTH
from .pdf_grammar_refinement_metadata import GRAMMAR_REFINEMENT_ENGINE

_NOUNS = {"NNG", "NNP", "XSN"}


def _positions(text):
    return [i for i, char in enumerate(text) if not char.isspace()]


def _fragment(text, positions, start, end):
    return text[positions[start]:positions[end - 1] + 1]


def _normalized(text):
    return " ".join(text.split())


def _identifier_char(char):
    return not "가" <= char <= "힣" and (char.isalnum() or char == "_")


def _ranges(raw, baseline, kiwi, dictionary, protected):
    compact = "".join(baseline.split())
    raw_positions, positions = _positions(raw), _positions(baseline)
    if "".join(raw.split()) != compact or not compact:
        return []
    offsets = [0]
    for char in baseline:
        offsets.append(offsets[-1] + (not char.isspace()))
    # Candidates start/end on whole noun morphemes, never inside a particle or verb.
    starts, ends = set(), set()
    tokenize = getattr(kiwi, "tokenize", None)
    if tokenize is None:
        return []
    baseline_tokens = tokenize(baseline)
    verbal_noun_ends = {offsets[t.start] for t in baseline_tokens if t.tag == 'XSV'}
    for token in baseline_tokens:
        if token.tag in _NOUNS or token.tag in {'XR', 'XPN'}:
            starts.add(offsets[token.start])
            ends.add(offsets[token.start + token.len])
    joined_raw = raw.replace("\n", "")
    raw_offsets = [0]
    for char in joined_raw:
        raw_offsets.append(raw_offsets[-1] + (not char.isspace()))
    particle_spans = [(raw_offsets[token.start], raw_offsets[token.start + token.len])
                      for token in tokenize(joined_raw) if token.tag.startswith("J")]
    spans = []
    for run in re.finditer(r"[가-힣]+", compact):
        for start in sorted(s for s in starts if run.start() <= s < run.end()):
            # A seam before a particle can make Kiwi's spaced baseline read it
            # as a noun. The raw grammatical boundary still protects it, e.g.
            # 255\n가 변수 must not become the dictionary term 가변수.
            if any(first <= start < last for first, last in particle_spans):
                continue
            lengths = dictionary.lengths_for(compact[start:start + 2])
            if not lengths:
                continue
            for length in range(MIN_TERM_LENGTH, min(MAX_TERM_LENGTH, run.end() - start) + 1):
                end = start + length
                if not (lengths & (1 << length)) or end not in ends:
                    continue
                if any(boundary in protected for boundary in range(start + 1, end)):
                    continue
                original = _fragment(raw, raw_positions, start, end)
                spaced = _fragment(baseline, positions, start, end)
                # Paragraph/list boundaries selected by layout are never crossed.
                if "\n" in spaced:
                    continue
                if (start and _identifier_char(compact[start - 1])
                        and raw_positions[start] == raw_positions[start - 1] + 1):
                    continue
                if (end < len(compact) and _identifier_char(compact[end])
                        and raw_positions[end] == raw_positions[end - 1] + 1):
                    continue
                spans.append((start, end, original, spaced, compact[start:end]))
    forms = dictionary.lookup_many(span[4] for span in spans)
    found = []
    for start, end, original, spaced, key in spans:
        options = forms[key]
        if not options:
            continue
        normalized, kiwi_form = _normalized(original), _normalized(spaced)
        if normalized == kiwi_form and normalized in options:
            continue
        pieces = original.split()
        wrapped = "\n" in original
        # Short solid words have many unrelated homographs (e.g. a dictionary
        # entry about syllables versus a section reference). With no OCR seam
        # or fragmentation, retain Kiwi's contextual reading instead of letting
        # a dictionary homograph veto a normal phrase boundary.
        derivational_tail = key[-1:] in {'자', '문', '법'} or any(
            t.tag == 'XR' and offsets[t.start] == start for t in baseline_tokens)
        if len(key) == MIN_TERM_LENGTH and len(pieces) == 1 and not wrapped and end not in verbal_noun_ends and not derivational_tail:
            continue
        if len(key) == MIN_TERM_LENGTH and kiwi_form not in options and (wrapped or len(pieces) <= 2) and not derivational_tail and end not in verbal_noun_ends:
            # A short dictionary homograph cannot veto a contextual phrase such
            # as 다음 절 / 추가 선. Strong syllable fragmentation (신 경 망)
            # can still request a contextual decision; Kiwi agreement also works.
            continue
        # Avoid querying normal dictionary nouns unchanged by Kiwi. A word may
        # legitimately be written solid even when the dictionary lists spaces.
        if normalized == kiwi_form and len(pieces) < 2 and not wrapped:
            continue
        wrap_form = _normalized(kiwi.glue(original.splitlines())) if wrapped else None
        if len(options) == 1 and wrap_form == options[0]:
            if " " not in kiwi_form and " " in wrap_form:
                # Do not split a solid term already joined by the layout stage
                # merely because glue and a dictionary share a spaced variant.
                continue
            found.append({"start": start, "end": end, "original": original,
                          "text": wrap_form, "method": "dictionary_kiwi_wrap_agreement"})
        elif len(options) == 1 and kiwi_form == options[0]:
            found.append({"start": start, "end": end, "original": original,
                          "text": spaced, "method": "dictionary_kiwi_agreement"})
        else:
            choices = list(dict.fromkeys([original, spaced, *options]))
            if len(choices) < 2:
                continue
            found.append({"start": start, "end": end, "original": original,
                          "options": choices[:6], "dictionary_forms": list(options),
                          "kiwi": spaced, "method": "ambiguous"})
    # Longer terms win over their nested dictionary nouns; never apply overlaps.
    selected = []
    for candidate in sorted(found, key=lambda c: (-(c["end"] - c["start"]), c["start"])):
        if not any(candidate["start"] < prev["end"] and prev["start"] < candidate["end"] for prev in selected):
            selected.append(candidate)
    return sorted(selected, key=lambda c: c["start"])


def refine_page_terms(blocks, restored, kiwi, protected_boundaries, *, cancel_check=None):
    if not callable(getattr(kiwi, "tokenize", None)):
        return
    if not any(block.get("type") == "text" and block.get("text_source") != "native" for block in blocks):
        return
    try:
        dictionary = get_term_dictionary()
    except (OSError, UnicodeError, RuntimeError, sqlite3.Error):
        dictionary = None
    if dictionary is None:
        return
    plans = []
    for block, spacing in zip(blocks, restored):
        if cancel_check:
            cancel_check()
        if block.get("type") != "text" or block.get("text_source") == "native":
            plans.append(None)
            continue
        raw, baseline = spacing["raw_text"], spacing["text"]
        protected = protected_boundaries(raw)
        candidates = _ranges(raw, baseline, kiwi, dictionary, protected)
        plans.append(candidates)
    count_keys = ("selected_original", "selected_change", "abstained", "invalid", "unavailable", "not_selected")
    for spacing, candidates in zip(restored, plans):
        if cancel_check:
            cancel_check()
        counts = dict.fromkeys(count_keys, 0)
        if candidates is None:
            continue
        if not candidates:
            spacing["terminology"] = {"dictionary_sha256": dictionary.revision, "candidates": 0,
                                     "unresolved": 0, "llm_status": "not_needed", "edits": [], "decision_counts": counts}
            continue
        baseline = spacing["text"]
        positions = _positions(baseline)
        output, cursor, edits, pending = [], 0, [], 0
        for candidate in candidates:
            first, last = positions[candidate["start"]], positions[candidate["end"] - 1] + 1
            replacement = candidate.get("text")
            method = candidate["method"]
            if candidate["method"] == "ambiguous":
                # Keep verified physical joins, without reusing old corrected text.
                layout = spacing.get("layout_text", spacing["raw_text"])
                if "".join(layout.split()) != "".join(spacing["raw_text"].split()):
                    layout = spacing["raw_text"]
                replacement = _fragment(layout, _positions(layout), candidate["start"], candidate["end"])
                method = "raw_layout_preserved"
                counts["not_selected"] += 1
                pending += 1
            # Only spacing changes can reach storage.
            if "".join(replacement.split()) != "".join(candidate["original"].split()):
                replacement = candidate["original"]
            output.extend((baseline[cursor:first], replacement))
            cursor = last
            if replacement != candidate["original"]:
                edits.append({"compact_start": candidate["start"], "compact_end": candidate["end"],
                              "before": candidate["original"], "after": replacement, "method": method})
        output.append(baseline[cursor:])
        result = "".join(output)
        if "".join(result.split()) != "".join(spacing["raw_text"].split()):
            continue
        spacing["text"] = result
        spacing["status"] = "corrected" if result != spacing["raw_text"] else "preserved"
        spacing["engine"] = GRAMMAR_REFINEMENT_ENGINE
        spacing["terminology"] = {"dictionary_sha256": dictionary.revision,
                                 "candidates": len(candidates), "unresolved": pending,
                                 "llm_status": "disabled" if pending else "not_needed",
                                 "edits": edits, "decision_counts": counts}
        # Kiwi's group offsets precede the term stage. Replace stale output offsets
        # with a whole-block range while keeping the same source-word linkage.
        spacing["edits"] = ([{"source_word_indexes": spacing["source_word_indexes"],
                             "output_start": 0, "output_end": len(result)}]
                            if result != spacing["raw_text"] else [])
