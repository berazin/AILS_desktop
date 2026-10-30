from __future__ import annotations

"""Parse Deepgram prerecorded responses without duplicating transcript views."""

import re
from typing import Any, Iterable


def _compact_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(default)


def _comparison_key(value: Any) -> str:
    return re.sub(r"[\W_]+", "", str(value or "").casefold(), flags=re.UNICODE)


def _utterance_text(utterances: Iterable[dict]) -> str:
    return _compact_text(
        " ".join(
            str(item.get("text") or "")
            for item in utterances or []
            if isinstance(item, dict)
        )
    )


def collapse_deepgram_repeated_views(
    transcript: str,
    utterances: Iterable[dict],
    *,
    max_repetitions: int = 8,
    min_key_chars: int = 1,
) -> tuple[str, int]:
    """Repair legacy responses that concatenated equivalent Deepgram views.

    Deepgram can expose the same recognition as a transcript, paragraph text,
    sentence text, and words. Older AILS versions concatenated those views. The
    timestamped utterance list is a single-view reference, so punctuation and
    whitespace can be ignored while checking whether the full transcript is
    exactly that reference repeated several times.
    """

    compact_transcript = _compact_text(transcript)
    compact_utterances = _utterance_text(utterances)
    transcript_key = _comparison_key(compact_transcript)
    utterance_key = _comparison_key(compact_utterances)
    if (
        not compact_transcript
        or not compact_utterances
        or len(utterance_key) < max(1, int(min_key_chars))
    ):
        return compact_transcript, 1

    for repetitions in range(2, max(2, int(max_repetitions)) + 1):
        if transcript_key == utterance_key * repetitions:
            return compact_utterances, repetitions
    return compact_transcript, 1


def _add_timed_utterance(
    target: list[dict],
    start: Any,
    end: Any,
    text: Any,
    speaker: Any = "",
) -> None:
    normalized_text = _compact_text(text)
    if not normalized_text:
        return
    start_seconds = max(0.0, _safe_float(start, 0.0))
    end_seconds = max(start_seconds, _safe_float(end, start_seconds))
    speaker_label = "" if speaker in (None, "") else f"Speaker {speaker}"
    target.append(
        {
            "start": start_seconds,
            "end": end_seconds,
            "text": normalized_text,
            "speaker": speaker_label,
        }
    )


def _extract_sentence_records(paragraph_payload: Any) -> list[dict]:
    if not isinstance(paragraph_payload, dict):
        return []
    records: list[dict] = []
    for paragraph in paragraph_payload.get("paragraphs") or []:
        if not isinstance(paragraph, dict):
            continue
        for sentence in paragraph.get("sentences") or []:
            if isinstance(sentence, dict):
                text = _compact_text(sentence.get("text") or sentence.get("transcript"))
                if text:
                    records.append(
                        {
                            "start": sentence.get("start", 0.0),
                            "end": sentence.get("end", sentence.get("start", 0.0)),
                            "text": text,
                            "speaker": sentence.get("speaker", ""),
                        }
                    )
            elif isinstance(sentence, str):
                text = _compact_text(sentence)
                if text:
                    records.append({"start": 0.0, "end": 0.0, "text": text, "speaker": ""})
    return records


def _extract_word_records(alternative: dict) -> list[dict]:
    records: list[dict] = []
    for item in alternative.get("words") or []:
        if not isinstance(item, dict):
            continue
        text = _compact_text(item.get("punctuated_word") or item.get("word") or item.get("text"))
        if not text:
            continue
        records.append(
            {
                "start": _safe_float(item.get("start", 0.0), 0.0),
                "end": _safe_float(item.get("end", item.get("start", 0.0)), 0.0),
                "text": text,
            }
        )
    return records


def _append_word_chunks(target: list[dict], words: list[dict]) -> None:
    chunk_words: list[str] = []
    chunk_start: float | None = None
    chunk_end = 0.0
    for word in words:
        if chunk_start is None:
            chunk_start = word["start"]
        chunk_words.append(word["text"])
        chunk_end = max(chunk_end, word["end"])
        chunk_text = " ".join(chunk_words)
        should_flush = (
            chunk_text.endswith((".", "?", "!", "。", "다.", "요."))
            or (chunk_end - chunk_start) >= 12.0
            or len(chunk_text) >= 180
        )
        if should_flush:
            _add_timed_utterance(target, chunk_start, chunk_end, chunk_text)
            chunk_words = []
            chunk_start = None
            chunk_end = 0.0
    if chunk_words and chunk_start is not None:
        _add_timed_utterance(target, chunk_start, chunk_end, " ".join(chunk_words))


def _alternative_views(alternative: dict) -> dict:
    paragraph_payload = alternative.get("paragraphs") or {}
    sentence_records = _extract_sentence_records(paragraph_payload)
    word_records = _extract_word_records(alternative)
    views = {
        "alternative": _compact_text(alternative.get("transcript")),
        "paragraphs": _compact_text(
            paragraph_payload.get("transcript") if isinstance(paragraph_payload, dict) else ""
        ),
        "sentences": _compact_text(" ".join(item["text"] for item in sentence_records)),
        "words": _compact_text(" ".join(item["text"] for item in word_records)),
    }
    source = next((name for name, text in views.items() if text), "")
    return {
        "text": views.get(source, ""),
        "source": source,
        "sentences": sentence_records,
        "words": word_records,
    }


def parse_deepgram_transcript_payload(payload: Any) -> tuple[str, list[dict], dict]:
    payload_object = payload if isinstance(payload, dict) else {}
    results = payload_object.get("results")
    results = results if isinstance(results, dict) else {}
    channels = results.get("channels")
    channels = channels if isinstance(channels, list) else []
    raw_utterances = results.get("utterances")
    raw_utterances = raw_utterances if isinstance(raw_utterances, list) else []

    timed_utterances: list[dict] = []
    for utterance in raw_utterances:
        if not isinstance(utterance, dict):
            continue
        _add_timed_utterance(
            timed_utterances,
            utterance.get("start", 0.0),
            utterance.get("end", utterance.get("start", 0.0)),
            utterance.get("transcript") or utterance.get("text"),
            utterance.get("speaker", ""),
        )
    has_provider_utterances = bool(timed_utterances)

    channel_texts: list[str] = []
    selected_sources: list[str] = []
    alternative_count = 0
    selected_alternative_count = 0
    for channel in channels:
        if not isinstance(channel, dict):
            continue
        alternatives = [item for item in (channel.get("alternatives") or []) if isinstance(item, dict)]
        alternative_count += len(alternatives)
        selected = None
        for alternative in alternatives:
            candidate = _alternative_views(alternative)
            if candidate["text"]:
                selected = candidate
                break
        if selected is None:
            continue
        selected_alternative_count += 1
        channel_texts.append(selected["text"])
        selected_sources.append(selected["source"])
        if has_provider_utterances:
            continue
        if selected["sentences"]:
            for sentence in selected["sentences"]:
                _add_timed_utterance(
                    timed_utterances,
                    sentence["start"],
                    sentence["end"],
                    sentence["text"],
                    sentence["speaker"],
                )
        elif selected["words"]:
            _append_word_chunks(timed_utterances, selected["words"])

    transcript = _compact_text(" ".join(channel_texts))
    if not transcript:
        transcript = _utterance_text(timed_utterances)
    transcript, repeated_views = collapse_deepgram_repeated_views(transcript, timed_utterances)
    return transcript, timed_utterances, {
        "channels": len(channels),
        "alternatives": alternative_count,
        "provider_utterances": len(raw_utterances),
        "selected_alternatives": selected_alternative_count,
        "selected_sources": selected_sources,
        "collapsed_views": repeated_views,
    }
