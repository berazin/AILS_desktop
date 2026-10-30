from __future__ import annotations

import base64
import math
import hashlib
import json
import mimetypes
import os
import re
import threading
from contextlib import contextmanager
from pathlib import Path

from language_support import language_korean_name


DETAILED_TASK = "video_detailed"
SUMMARY_TASK = "video_summary"
_TRANSCRIPT_LOCKS: dict[str, threading.Lock] = {}
_TRANSCRIPT_LOCKS_GUARD = threading.Lock()
VIDEO_VISUAL_EVENT_CACHE_VERSION = 2

# Shared by segment and individual-frame analysis; keep variable evidence out
# of this prefix so providers can reuse it across scene requests.
VIDEO_VISUAL_DETAIL_INSTRUCTION = """화면 정보 보존 지침:
- 코드: 보이는 함수·변수·파일 이름, 핵심 구문, 들여쓰기·연산자·분기 조건, 입력·출력·오류 메시지를 정확히 남기세요. 여러 프레임에서 코드가 바뀌면 변경 전후와 실행 결과를 구분하고, 화면 밖 코드를 채워 넣지 마세요.
- 수식: 식과 기호, 부호, 첨자·지수, 등호·부등호(<, ≤, >, ≥), 경계값·성립 조건을 보존하세요. 변수의 의미나 유도 과정은 실제 화면 또는 STT에 있는 만큼만 설명하고, 화면에서 확인한 식과 발화 설명을 구분하세요.
- 표: 제목, 행·열 이름, 단위, 핵심 셀 값과 행·열의 대응 관계를 남기세요. 강의에서 비교한 값·조건·차이를 유지하고, 숫자를 옮길 때 다른 행이나 열에 연결하지 마세요.
- UI 버튼: 표시된 버튼·메뉴 이름, 위치, 선택·활성·비활성 상태와 조작 전후 화면 변화를 남기세요. 클릭이나 동작 결과는 프레임 또는 발화에서 확인된 경우만 기록하고 근거를 구분하세요. 정지 화면만으로 클릭·성공을 단정하지 마세요.
- 실제로 등장한 항목만 기존 JSON 필드에 기록하세요. 읽을 수 있는 원문은 visible_text에, 관찰·의미·변화는 해당 필드에 담고, 흐릿한 글자·기호·값은 불명확하다고 표시하세요. 보이지 않는 내용을 추측하거나 같은 정보를 반복하지 마세요."""


VIDEO_VISUAL_EVENT_RESPONSE_FORMAT = {
    "type": "json_schema",
    "json_schema": {
        "name": "ails_video_visual_event",
        "strict": True,
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "timestamp", "content_type", "visual_observation", "speech_context",
                "integrated_meaning", "importance", "needs_original_image", "confidence",
                "same_semantic_content", "change_type", "changes",
            ],
            "properties": {
                "timestamp": {"type": "number"},
                "content_type": {"type": "string"},
                "visual_observation": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["summary", "visible_text", "facts"],
                    "properties": {
                        "summary": {"type": "string"},
                        "visible_text": {"type": "array", "items": {"type": "string"}},
                        "facts": {"type": "array", "items": {"type": "string"}},
                    },
                },
                "speech_context": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["summary"],
                    "properties": {"summary": {"type": "string"}},
                },
                "integrated_meaning": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["summary"],
                    "properties": {"summary": {"type": "string"}},
                },
                "importance": {"type": "number", "minimum": 0, "maximum": 1},
                "needs_original_image": {"type": "boolean"},
                "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                "same_semantic_content": {"type": "boolean"},
                "change_type": {"type": "string"},
                "changes": {"type": "array", "items": {"type": "string"}},
            },
        },
    },
}


def _timed_speech_item(item) -> dict | None:
    if not isinstance(item, dict):
        return None
    text = str(item.get("text") or "").strip()
    if not text:
        return None
    try:
        start = max(0.0, float(item.get("start") or 0.0))
        end = max(start, float(item.get("end") if item.get("end") is not None else start))
    except (TypeError, ValueError):
        return None
    return {"start": start, "end": end, "text": text}


def select_video_speech_context(utterances, timestamp_seconds: float, fallback_seconds: float = 10.0) -> dict:
    items = sorted(
        (normalized for normalized in (_timed_speech_item(item) for item in utterances or []) if normalized),
        key=lambda item: (item["start"], item["end"]),
    )
    timestamp = max(0.0, float(timestamp_seconds))
    current_index = next(
        (index for index, item in enumerate(items) if item["start"] <= timestamp <= item["end"]),
        None,
    )
    if current_index is None and items:
        nearest_index = min(
            range(len(items)),
            key=lambda index: min(abs(timestamp - items[index]["start"]), abs(timestamp - items[index]["end"])),
        )
        nearest = items[nearest_index]
        distance = min(abs(timestamp - nearest["start"]), abs(timestamp - nearest["end"]))
        current_index = nearest_index if distance <= max(0.0, float(fallback_seconds)) else None
    if current_index is None:
        previous = next((item for item in reversed(items) if item["end"] < timestamp), None)
        following = next((item for item in items if item["start"] > timestamp), None)
        return {"previous": previous, "current": None, "next": following}
    return {
        "previous": items[current_index - 1] if current_index > 0 else None,
        "current": items[current_index],
        "next": items[current_index + 1] if current_index + 1 < len(items) else None,
    }


def _format_speech_context(context: dict) -> str:
    lines = []
    for key, label in (("previous", "Previous Speech"), ("current", "Current Speech"), ("next", "Next Speech")):
        item = context.get(key) if isinstance(context, dict) else None
        if item:
            lines.append(
                f"[{label}] {format_video_timestamp(item['start'])}~{format_video_timestamp(item['end'])}\n{item['text']}"
            )
        else:
            lines.append(f"[{label}] 없음")
    return "\n\n".join(lines)


def build_video_visual_event_messages(image_path, *, timestamp_seconds: float, speech_context: dict,
                                      language: str = "korean", ordered_frames: list[dict] | None = None,
                                      speech_items: list[dict] | None = None):
    image_path = Path(image_path)
    mime_type = mimetypes.guess_type(image_path.name)[0] or "image/jpeg"
    frames = [{"path": str(image_path), "timestamp_seconds": timestamp_seconds}]
    frames.extend(frame for frame in (ordered_frames or [])
                  if Path(frame["path"]).resolve() != image_path.resolve())
    frames.sort(key=lambda frame: float(frame["timestamp_seconds"]))
    timestamp = format_video_timestamp(timestamp_seconds)
    output_language = language_korean_name(language)
    speech_text = (_format_speech_context(speech_context) if speech_items is None else
                   "\n".join(f"[{format_video_timestamp(float(item['start']))}~"
                             f"{format_video_timestamp(float(item['end']))}] {item['text']}"
                             for item in speech_items))
    motion_note = ("\n입력 프레임 시각(순서대로): "
                   + ", ".join(format_video_timestamp(float(frame["timestamp_seconds"])) for frame in frames)
                   + "\n여러 프레임에서 실제 보이는 상태 변화만 시간순으로 설명하고, 한 장만으로 움직임을 단정하지 마세요."
                   if ordered_frames else "")
    instructions = f"""영상 대표 프레임과 같은 시점의 STT 문맥을 분석해 구조화된 이벤트를 만드세요.

규칙:
- visual_observation에는 이미지에서 실제 확인한 정보만 씁니다. 발화에서만 얻은 정보는 절대 넣지 않습니다.
- speech_context에는 STT에서 전달된 의미만 씁니다.
- integrated_meaning에는 화면과 발화를 함께 보아 이 시점이 전달하는 의미를 씁니다.
- 코드, 수식, 표, 그래프, 설정값처럼 설명만으로 손실될 수 있으면 needs_original_image=true로 둡니다.
- visible_text에는 정리에 필요한 식별자, 코드, 수식, 숫자만 정확히 보존합니다.
- 같은 의미 여부를 확신할 근거가 없으면 same_semantic_content=false로 둡니다.
- {output_language}로 쓰고 스키마를 만족하는 결과 JSON 객체 하나만 반환합니다.

{VIDEO_VISUAL_DETAIL_INSTRUCTION}

출력 계약: 아래 스키마를 만족하세요. 스키마 자체를 출력하지 마세요.
{json.dumps(VIDEO_VISUAL_EVENT_RESPONSE_FORMAT['json_schema']['schema'], ensure_ascii=False, indent=2)}"""
    prompt = f"프레임 시각: {timestamp} ({float(timestamp_seconds):.3f}초)\n\n{speech_text}{motion_note}"
    content = [{"type": "text", "text": prompt}]
    for frame in frames:
        path = Path(frame["path"])
        frame_mime = mimetypes.guess_type(path.name)[0] or mime_type
        encoded = base64.b64encode(path.read_bytes()).decode("ascii")
        content.append({"type": "image_url", "image_url": {"url": f"data:{frame_mime};base64,{encoded}"}})
    messages = [{"role": "system", "content": [{"type": "text", "text": instructions}]}, {
        "role": "user",
        "content": content,
    }]
    return messages, VIDEO_VISUAL_EVENT_RESPONSE_FORMAT


def parse_video_visual_event(raw_content, timestamp_seconds: float, file_name: str) -> dict:
    text = str(raw_content or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.IGNORECASE).strip()
    try:
        payload = json.loads(text)
    except (TypeError, ValueError) as error:
        raise RuntimeError(f"영상 장면 응답 JSON 파싱 실패: {error}") from error
    if not isinstance(payload, dict):
        raise RuntimeError("영상 장면 응답이 JSON 객체가 아닙니다.")
    required_objects = {
        "visual_observation": ("summary", "visible_text", "facts"),
        "speech_context": ("summary",),
        "integrated_meaning": ("summary",),
    }
    for key, required_keys in required_objects.items():
        value = payload.get(key)
        if not isinstance(value, dict) or any(required not in value for required in required_keys):
            raise RuntimeError(f"영상 장면 응답의 {key} 구조가 올바르지 않습니다.")
    for key in ("visible_text", "facts"):
        if not isinstance(payload["visual_observation"].get(key), list):
            raise RuntimeError(f"영상 장면 응답의 visual_observation.{key}가 배열이 아닙니다.")
    if not isinstance(payload.get("changes"), list):
        raise RuntimeError("영상 장면 응답의 changes가 배열이 아닙니다.")
    for key in ("importance", "confidence"):
        try:
            value = float(payload.get(key))
        except (TypeError, ValueError) as error:
            raise RuntimeError(f"영상 장면 응답의 {key}가 숫자가 아닙니다.") from error
        if not 0 <= value <= 1:
            raise RuntimeError(f"영상 장면 응답의 {key}가 0~1 범위를 벗어났습니다.")
        payload[key] = value
    for key in ("needs_original_image", "same_semantic_content"):
        if not isinstance(payload.get(key), bool):
            raise RuntimeError(f"영상 장면 응답의 {key}가 boolean이 아닙니다.")
    for key in ("content_type", "change_type"):
        payload[key] = str(payload.get(key) or "").strip()
    payload["timestamp"] = max(0.0, float(timestamp_seconds))
    payload["file_name"] = str(file_name or "").strip()
    payload["duplicate_of"] = ""
    return payload


def deduplicate_visual_events(events: list[dict]) -> list[dict]:
    kept = []
    result = []
    for original in sorted(events or [], key=lambda item: float(item.get("timestamp") or 0.0)):
        event = dict(original)
        previous = kept[-1] if kept else None
        summary = str((event.get("integrated_meaning") or {}).get("summary") or "").strip().casefold()
        previous_summary = str((previous.get("integrated_meaning") or {}).get("summary") or "").strip().casefold() if previous else ""
        no_new_change = not [str(item or "").strip() for item in event.get("changes") or [] if str(item or "").strip()]
        if previous and no_new_change and (event.get("same_semantic_content") is True or (summary and summary == previous_summary)):
            event["duplicate_of"] = str(previous.get("file_name") or "")
        else:
            event["duplicate_of"] = ""
            kept.append(event)
        result.append(event)
    return result


def _render_visual_event(event: dict) -> str:
    if event.get("segment_index") is not None:
        return _render_segment_event(event)
    timestamp = format_video_timestamp(float(event.get("timestamp") or 0.0))
    visual = event.get("visual_observation") or {}
    visible_text = [str(item).strip() for item in visual.get("visible_text") or [] if str(item).strip()]
    facts = [str(item).strip() for item in visual.get("facts") or [] if str(item).strip()]
    changes = [str(item).strip() for item in event.get("changes") or [] if str(item).strip()]
    lines = [
        f"[Visual Event @{timestamp}] file={event.get('file_name', '')}",
        f"Visual observation: {str(visual.get('summary') or '').strip()}",
        f"Speech context: {str((event.get('speech_context') or {}).get('summary') or '').strip()}",
        f"Integrated meaning: {str((event.get('integrated_meaning') or {}).get('summary') or '').strip()}",
    ]
    if visible_text:
        lines.append("Visible text: " + " | ".join(visible_text))
    if facts:
        lines.append("Visual facts: " + " | ".join(facts))
    if changes:
        lines.append("Changes: " + " | ".join(changes))
    lines.append(
        f"Importance={float(event.get('importance') or 0.0):.2f}; "
        f"confidence={float(event.get('confidence') or 0.0):.2f}; "
        f"needs_original_image={'true' if event.get('needs_original_image') else 'false'}"
    )
    return "\n".join(lines)


def _render_segment_event(event: dict) -> str:
    start = format_video_timestamp(float(event.get("start_seconds") or 0.0))
    end = format_video_timestamp(float(event.get("end_seconds") or 0.0))
    lines = [
        f"[Video Segment {int(event.get('segment_index') or 0)} @{start}~{end}] strategy={event.get('strategy', '')}",
        f"Segment summary: {str(event.get('segment_summary') or '').strip()}",
        f"Speech context: {str(event.get('spoken_context') or '').strip()}",
        f"Integrated meaning: {str(event.get('integrated_meaning') or '').strip()}",
    ]
    label_map = (
        ("visual_observations", "Visual observations"),
        ("visible_text", "Visible text"),
        ("persisted_information", "Persisted information"),
        ("new_information", "New information"),
        ("removed_information", "Removed information"),
        ("changed_values", "Changed values"),
        ("steps_or_changes", "Steps or changes"),
        ("important_facts", "Important facts"),
    )
    for key, label in label_map:
        values = [str(item).strip() for item in event.get(key) or [] if str(item or "").strip()]
        if values:
            lines.append(f"{label}: " + " | ".join(values))
    lines.append(
        f"Importance={float(event.get('importance') or 0.0):.2f}; "
        f"confidence={float(event.get('confidence') or 0.0):.2f}; "
        f"visual_information_value={float(event.get('visual_information_value') or 0.0):.2f}; "
        f"needs_original_image={'true' if event.get('needs_original_image') else 'false'}"
    )
    return "\n".join(lines)


def assign_visual_events_to_chunks(chunks, events):
    """Use the same time assignment for writer input and legacy chunk text."""
    prepared = [chunk if isinstance(chunk, dict) else {"text": str(chunk or "")}
                for chunk in chunks or []]
    included = [event for event in events or [] if not str(event.get("duplicate_of") or "").strip()]
    assignments = [[] for _ in prepared]
    if not prepared:
        return assignments
    for event in included:
        timestamp = float(event.get("timestamp") or 0.0)
        target = next(
            (
                index for index, chunk in enumerate(prepared)
                if chunk.get("timed") and float(chunk.get("start") or 0.0) <= timestamp <= float(chunk.get("end") or 0.0)
            ),
            0,
        )
        assignments[target].append(event)
    return assignments


def video_writer_source_contract(timed_stt, scene_events):
    """Invalidate authored checkpoints when either writer evidence source changes."""
    payload = {"stt": timed_stt, "scenes": scene_events}
    digest = hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True,
                                       default=str).encode("utf-8")).hexdigest()
    return f"video-writer-scenes-v3:{digest}"


def attach_visual_events_to_chunks(chunks, events):
    copied = [dict(chunk) if isinstance(chunk, dict) else {"text": str(chunk or "")}
              for chunk in chunks or []]
    assignments = assign_visual_events_to_chunks(copied, events)
    for index, assigned in enumerate(assignments):
        if assigned:
            context = "\n\n".join(_render_visual_event(event) for event in assigned)
            copied[index]["text"] = f"{str(copied[index].get('text') or '').rstrip()}\n\n[영상 시각 이벤트]\n{context}".strip()
    return copied


def video_summary_instruction(task_type: str) -> str:
    professional_rules = (
        "발화에서 확인한 내용과 화면에서 확인한 사실, 이를 바탕으로 한 추론을 구분하세요. "
        "근거 ID와 타임스탬프는 내부 분석에만 사용하고 정리본 본문에는 표시하지 마세요. "
        "고유명사·수치·코드를 추측으로 확정하지 마세요. "
        "정제 STT와 영상 장면 분석을 함께 사용하고, 강의에 실제 있는 개념별 학습 순서로 구성하세요. "
        "이해에 필요한 핵심 원본 화면을 관련 개념 가까이에 연결하세요. "
        "강의에서 확인된 개념에 맞는 복습 문제·정답·해설을 분량에 맞춰 작성하고 문제 수를 고정하지 마세요. "
        "복습 문제는 끝의 '## 복습 문제' 절에 두고 각 문항은 '### 문제 N' 다음에 질문을 씁니다. "
        "복습 문제는 모두 객관식으로만 출제하세요. 주관식·서술형·단답형·빈칸 채우기 문제는 만들지 마세요. "
        "모든 문항에 '(1) 보기'처럼 번호가 붙은 보기를 한 줄씩 쓰고 정답 보기는 정확히 하나만 포함하세요. "
        "'**정답:** 2'처럼 정답 번호 하나만 적고 모든 문항에 '**해설:** 설명'을 붙이세요. "
        "다른 작성 구간의 내용을 예측하거나 강의 전체에 대해 아직/끝났다고 단정하지 마세요. "
    )
    if task_type == DETAILED_TASK:
        return (
            "이 결과는 상세 정리입니다. 개념별 학습 순서 안에서 강사의 논리 전개를 보존하고 "
            "핵심 주장, 근거, 절차, "
            "수치, 조건, 예외와 강조 내용을 보존해 결론에 이르는 중간 논증까지 재구성하세요. "
            "원인→과정→결과가 나오는 대목에서는 각 단계와 단계 사이의 이유를 적으세요. "
            "서로 다른 구체적 예시와 각 예시의 역할을 각각 남기고, 비교가 있다면 "
            "비교 대상·기준·차이·의미를 적으세요. 수식이 나오면 확인 가능한 식, "
            "기호의 의미, 값과 식 사이의 관계와 판단을 설명하세요. "
            "같은 설명이나 예시가 단순 반복되면 합치되 반복 중 추가된 정보는 모두 남기세요. "
            "STT 또는 화면이 불명확해 예시·수식·설명의 일부를 확정할 수 없으면 확인된 부분만 "
            "적고 해당 문장 가까이에 무엇이 불명확한지 짧게 표시하세요. "
            "강의에 없는 항목의 가짜 절이나 내용을 만들지 마세요. "
            "다시 영상을 보지 않아도 강사의 설명을 재구성할 수 있는 전문 기록으로 작성하세요. "
            "AI 개념 검토 메모를 정리본에 넣지 마세요. "
            + professional_rules
        )
    if task_type == SUMMARY_TASK:
        return (
            "이 결과는 빠르게 복습하는 요약 정리입니다. 핵심 개념·결론과 이를 이해하는 데 "
            "꼭 필요한 근거·조건만 골라 짧은 항목이나 비교표로 압축하세요. "
            "한 개념은 원칙적으로 한두 문장으로 설명하고, 같은 개념의 정의·예시·결론을 여러 절에서 반복하지 마세요. "
            "본문을 다시 나열하는 별도의 '핵심 정리' 절은 만들지 마세요. "
            "개념을 구별하는 수치·수식·성립 조건·예외는 남기되, 세부 유도 과정과 진행 발언은 생략하세요. "
            "이해에 꼭 필요한 대표 예시만 짧게 남기고, 같은 개념의 여러 비유와 표현 방식별 예시는 합치세요. "
            "알고리즘은 입력 전제·핵심 동작·결과를 압축하고, 코드 자체가 학습 핵심일 때만 짧은 코드를 넣으세요. "
            "이미지는 글만으로 이해하기 어려운 핵심 도식·수식·화면만 선택하고 모든 절에 넣지 마세요. "
            "복습 문제는 핵심 구분과 적용을 확인하는 문항만 고르고 서로 겹치는 문항은 합치세요. "
            "문제 수는 핵심 개념의 수와 난도에 맞추되 모든 소제목마다 만들지 말고, 해설은 짧은 한 문장으로 쓰세요. "
            + professional_rules
        )
    return ""


def video_task_mode(task: dict) -> str | None:
    """Resolve every video source to the shared detailed or summary mode."""
    task_type = str(task.get("type") or "")
    if task_type in {DETAILED_TASK, SUMMARY_TASK}:
        return task_type
    if task_type in {"eclass_vod", "youtube", "url"}:
        return DETAILED_TASK if task.get("detail_mode") == "detailed" else SUMMARY_TASK
    return None


def video_mode_label(task_type: str) -> str:
    return "상세 정리" if task_type == DETAILED_TASK else "요약 정리"


def select_video_scenes(scenes: list, task_type: str) -> list:
    """Keep every detailed scene; choose a score-ranked, chronological summary set."""
    ordered = sorted(scenes or [], key=lambda item: float(item.timestamp_seconds))
    if task_type != SUMMARY_TASK or len(ordered) <= 2:
        return ordered
    target = max(2, math.ceil(math.sqrt(len(ordered))))
    ranked = sorted(
        ordered,
        key=lambda item: (
            float(item.mean_absolute_difference) * float(item.changed_pixel_ratio),
            -float(item.timestamp_seconds),
        ),
        reverse=True,
    )
    selected = {id(ordered[0]): ordered[0], id(ordered[-1]): ordered[-1]}
    for scene in ranked:
        selected[id(scene)] = scene
        if len(selected) >= target:
            break
    return sorted(selected.values(), key=lambda item: float(item.timestamp_seconds))


def format_video_timestamp(seconds: float) -> str:
    total = max(0, int(round(float(seconds))))
    hours, remainder = divmod(total, 3600)
    minutes, seconds = divmod(remainder, 60)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}"


def video_transcript_cache_path(cache_dir: str, identity: str) -> Path:
    key = hashlib.sha256(str(identity).encode("utf-8")).hexdigest()[:24]
    return Path(cache_dir) / f"transcript-{key}.json"


def video_visual_event_identity(model_identity: str, utterances, *, language="korean", prompt_version=None) -> str:
    transcript_digest = hashlib.sha256(
        json.dumps(utterances or [], ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()
    version = VIDEO_VISUAL_EVENT_CACHE_VERSION if prompt_version is None else prompt_version
    return f"{version}\0{model_identity}\0{language}\0{transcript_digest}"


def video_visual_event_cache_path(cache_dir: str, identity: str) -> Path:
    key = hashlib.sha256(str(identity).encode("utf-8")).hexdigest()[:24]
    return Path(cache_dir) / f"visual-events-{key}.json"


def load_video_visual_events(cache_dir: str, identity: str) -> dict[str, dict]:
    try:
        payload = json.loads(video_visual_event_cache_path(cache_dir, identity).read_text(encoding="utf-8"))
        events = payload.get("events") if isinstance(payload, dict) else None
        return {
            str(name): event for name, event in (events or {}).items()
            if isinstance(event, dict) and str(name).strip()
        }
    except (OSError, ValueError, TypeError):
        return {}


def save_video_visual_events(cache_dir: str, identity: str, events: dict[str, dict]) -> None:
    destination = video_visual_event_cache_path(cache_dir, identity)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(f"{destination.suffix}.{os.getpid()}.{threading.get_ident()}.tmp")
    try:
        temporary.write_text(
            json.dumps({"version": VIDEO_VISUAL_EVENT_CACHE_VERSION, "events": events}, ensure_ascii=False),
            encoding="utf-8",
        )
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def video_transcript_lock(cache_dir: str, identity: str) -> threading.Lock:
    key = str(video_transcript_cache_path(cache_dir, identity))
    with _TRANSCRIPT_LOCKS_GUARD:
        return _TRANSCRIPT_LOCKS.setdefault(key, threading.Lock())


@contextmanager
def hold_video_transcript_lock(cache_dir: str, identity: str, cancel_check):
    lock = video_transcript_lock(cache_dir, identity)
    while not lock.acquire(timeout=0.2):
        cancel_check()
    try:
        yield
    finally:
        lock.release()


def load_video_transcript(cache_dir: str, identity: str, *, fallback: bool = False) -> dict | None:
    try:
        exact_path = video_transcript_cache_path(cache_dir, identity)
        if exact_path.is_file():
            payload = json.loads(exact_path.read_text(encoding="utf-8"))
            if isinstance(payload, dict) and str(payload.get("transcript") or "").strip():
                return payload
    except (OSError, ValueError, TypeError):
        pass

    if not fallback:
        return None

    # 공통 영상 전사 재사용: 3개월 보관 기간 동안 동일 영상에 대해 이미 완료된 STT 결과가 있으면 재사용
    try:
        cache_path = Path(cache_dir)
        if cache_path.is_dir():
            for transcript_file in sorted(cache_path.glob("transcript-*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
                try:
                    payload = json.loads(transcript_file.read_text(encoding="utf-8"))
                    if isinstance(payload, dict) and str(payload.get("transcript") or "").strip():
                        return payload
                except (OSError, ValueError, TypeError):
                    continue
    except OSError:
        pass
    return None


def save_video_transcript(cache_dir: str, identity: str, payload: dict) -> None:
    destination = video_transcript_cache_path(cache_dir, identity)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(f"{destination.suffix}.{os.getpid()}.{threading.get_ident()}.tmp")
    try:
        temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)
