"""세그먼트 단위 영상 멀티모달 분석.

기존 프레임 단위 visual event 분석을 세그먼트 단위로 확장한 모듈이다. 구간
transcript와 1~N개의 시간 순서 프레임을 VLM에 함께 전달해 구조화된 segment
note(JSON)를 만들고, 구간별 캐시와 함께 결과를 기존 visual event 구조와 호환되는
형태로 반환한다. 프레임 예산과 VLM 호출 여부는 video_segmentation의 전략이 결정한다.
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import mimetypes
import os
import re
import shutil
import threading
from pathlib import Path

from common import append_status_log, build_usage_event
from ai_request_limits import estimate_request_tokens, request_working_limit
from language_support import language_korean_name
from pipeline_utils import safe_float
from summary_generation.video_modes import VIDEO_VISUAL_DETAIL_INSTRUCTION, format_video_timestamp
from .video_segmentation import VideoSegment, VideoSegmentation
from .managed_costs import merge_settlements, prior_settlements
from .visual_cache_scheduling import iter_visual_analysis


VIDEO_SEGMENT_EVENT_CACHE_VERSION = 5
_EVENT_CACHE_LOCK = threading.Lock()
VISUAL_FRAME_MAX_EDGE = 1280
SEGMENT_TRANSCRIPT_MAX_CHARS = None  # Split actual requests by tokens, not speech characters.
SEGMENT_PREVIOUS_CONTEXT_CHARS = 400


VIDEO_SEGMENT_RESPONSE_FORMAT = {
    "type": "json_schema",
    "json_schema": {
        "name": "ails_video_segment_event",
        "strict": True,
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "segment_summary", "visual_observations", "visible_text", "spoken_context",
                "integrated_meaning", "persisted_information", "new_information",
                "removed_information", "changed_values", "steps_or_changes",
                "important_facts", "importance", "confidence", "visual_information_value",
                "needs_original_image",
            ],
            "properties": {
                "segment_summary": {"type": "string"},
                "visual_observations": {"type": "array", "items": {"type": "string"}},
                "visible_text": {"type": "array", "items": {"type": "string"}},
                "spoken_context": {"type": "string"},
                "integrated_meaning": {"type": "string"},
                "persisted_information": {"type": "array", "items": {"type": "string"}},
                "new_information": {"type": "array", "items": {"type": "string"}},
                "removed_information": {"type": "array", "items": {"type": "string"}},
                "changed_values": {"type": "array", "items": {"type": "string"}},
                "steps_or_changes": {"type": "array", "items": {"type": "string"}},
                "important_facts": {"type": "array", "items": {"type": "string"}},
                "importance": {"type": "number", "minimum": 0, "maximum": 1},
                "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                "visual_information_value": {"type": "number", "minimum": 0, "maximum": 1},
                "needs_original_image": {"type": "boolean"},
            },
        },
    },
}


STRATEGY_ANALYSIS_HINTS = {
    "speech_heavy": "발화 중심 구간입니다. 화면에 특별한 정보가 없다면 visual_observations를 짧게 유지하세요.",
    "slide_heavy": "슬라이드/문서 중심 구간입니다. 화면 텍스트와 구조를 정확히 보존하세요.",
    "coding_tutorial": "코딩·소프트웨어 작업 구간으로 보입니다. 프레임 시간 순서대로 비교해 코드·UI의 변화 과정과 결과를 중심으로 분석하세요.",
    "motion_heavy": "움직임이 많은 구간입니다. 정적 한 장보다 동작의 변화와 결과를 시간 순서로 분석하세요.",
    "mixed": "여러 성격이 섞인 구간입니다. 발화와 화면 변화를 균형 있게 결합하세요.",
}


def segment_event_key(segment: VideoSegment) -> str:
    return f"segment-{segment.index:03d}"


def _segment_input_digest(segment: VideoSegment, utterances) -> str:
    payload = {
        "strategy": segment.strategy.name,
        "frames": [(frame.image_name, frame.timestamp_seconds)
                   for frame in segment.frames],
        "transcript": build_segment_transcript_text(
            utterances, segment.start_seconds, segment.end_seconds),
    }
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def video_segment_event_identity(
    segmentation_identity: str,
    model_identity: str,
    *,
    language="korean",
    prompt_version=None,
) -> str:
    version = VIDEO_SEGMENT_EVENT_CACHE_VERSION if prompt_version is None else prompt_version
    return f"{version}\0{segmentation_identity}\0{model_identity}\0{language}"


def video_segment_event_cache_path(cache_dir: str, identity: str) -> Path:
    key = hashlib.sha256(str(identity).encode("utf-8")).hexdigest()[:24]
    return Path(cache_dir) / f"segment-events-{key}.json"


def load_video_segment_events(cache_dir: str, identity: str) -> dict[str, dict]:
    try:
        with _EVENT_CACHE_LOCK:
            payload = json.loads(video_segment_event_cache_path(cache_dir, identity).read_text(encoding="utf-8"))
        events = payload.get("events") if isinstance(payload, dict) else None
        return {
            str(key): event
            for key, event in (events or {}).items()
            if isinstance(event, dict) and str(key).strip()
        }
    except (OSError, ValueError, TypeError):
        return {}


def save_video_segment_events(cache_dir: str, identity: str, events: dict[str, dict]) -> None:
    destination = video_segment_event_cache_path(cache_dir, identity)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(f"{destination.suffix}.{os.getpid()}.{threading.get_ident()}.tmp")
    try:
        temporary.write_text(
            json.dumps({"version": VIDEO_SEGMENT_EVENT_CACHE_VERSION, "events": events}, ensure_ascii=False),
            encoding="utf-8",
        )
        # Windows cannot replace the destination while a cache reader has it
        # open. Only synchronize this brief file operation, never an AI call.
        with _EVENT_CACHE_LOCK:
            os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def build_segment_transcript_parts(utterances, start: float, end: float,
                                   max_chars: int = SEGMENT_TRANSCRIPT_MAX_CHARS) -> list[str]:
    """Cover every overlapping utterance without cutting the beginning away."""
    if max_chars is not None and max_chars < 2:
        raise ValueError("Segment transcript limit is too small.")
    lines = []
    for item in utterances or []:
        if not isinstance(item, dict):
            continue
        utterance_start = safe_float(item.get("start"), 0.0)
        utterance_end = safe_float(item.get("end"), utterance_start)
        if utterance_end < start or utterance_start > end:
            continue
        text = str(item.get("text") or "").strip()
        if text:
            prefix = f"[{format_video_timestamp(utterance_start)}] "
            if max_chars is None:
                lines.append(prefix + text)
                continue
            if len(prefix) >= max_chars:
                raise ValueError("Segment transcript limit cannot hold a timestamp.")
            width = max_chars - len(prefix)
            lines.extend(prefix + text[index:index + width]
                         for index in range(0, len(text), width))
    parts: list[str] = []
    current: list[str] = []
    length = 0
    for line in lines:
        addition = len(line) + (1 if current else 0)
        if current and max_chars is not None and length + addition > max_chars:
            parts.append("\n".join(current))
            current, length = [], 0
            addition = len(line)
        current.append(line)
        length += addition
    if current:
        parts.append("\n".join(current))
    return parts


def build_segment_transcript_text(utterances, start: float, end: float,
                                  max_chars: int = SEGMENT_TRANSCRIPT_MAX_CHARS) -> str:
    return "\n".join(build_segment_transcript_parts(utterances, start, end, max_chars))


def build_previous_context_text(utterances, start: float, max_chars: int = SEGMENT_PREVIOUS_CONTEXT_CHARS) -> str:
    tails = []
    for item in utterances or []:
        if not isinstance(item, dict):
            continue
        if safe_float(item.get("end"), 0.0) <= start:
            text = str(item.get("text") or "").strip()
            if text:
                tails.append(text)
    if not tails:
        return ""
    return " ".join(tails)[-max_chars:].lstrip()


def build_video_segment_messages(
    segment: VideoSegment,
    frame_images: list[tuple[Path, float]],
    *,
    transcript_text: str,
    previous_context: str = "",
    language: str = "korean",
    transcript_part: tuple[int, int] | None = None,
):
    output_language = language_korean_name(language)
    start = format_video_timestamp(segment.start_seconds)
    end = format_video_timestamp(segment.end_seconds)
    frame_lines = "\n".join(
        f"- 프레임 {index + 1}: {format_video_timestamp(timestamp)}"
        for index, (_path, timestamp) in enumerate(frame_images)
    )
    instructions = [
        "영상 구간의 대표 프레임들과 같은 구간의 STT 발화를 함께 분석해 구조화된 세그먼트 노트를 만드세요.",
        "",
        "규칙:",
        "- 출력 JSON에는 segment_summary, spoken_context, integrated_meaning 문자열을 모두 포함하세요.",
        "- visual_observations, visible_text, persisted_information, new_information, removed_information, changed_values, steps_or_changes, important_facts는 각각 문자열 배열입니다. 값이 없으면 []를 쓰세요. 문자열·객체·null로 대신하지 마세요.",
        "- importance, confidence, visual_information_value는 각각 0부터 1까지의 JSON 숫자이고, needs_original_image는 JSON boolean(true/false)입니다. 모든 필드를 반드시 포함하세요.",
        "- visual_observations에는 프레임에서 실제 확인한 내용만 쓰고, 발화에서만 얻은 정보는 넣지 않습니다.",
        "- visible_text에는 코드, 수식, 메뉴 이름, 숫자처럼 정리에 필요한 텍스트를 정확히 보존합니다.",
        "- 프레임이 여러 개면 시간 순서대로 비교해 계속 유지된 정보(persisted_information), 새로 등장한 정보(new_information), 사라진 정보(removed_information), 변경된 값(changed_values)을 구분하세요.",
        "- steps_or_changes에는 화면에서 수행된 작업과 변화의 순서를 적습니다.",
        "- 근접 프레임이 동적 장면 후보라면 관찰된 이전 상태, 순서대로 보이는 변화, 이후 상태를 구분하세요. 프레임 사이의 보이지 않는 움직임은 추측하지 마세요.",
        "- 한 장만 있거나 변화의 전후가 보이지 않으면 움직임을 단정하지 말고 확인 가능한 상태만 기록하세요.",
        "- spoken_context에는 구간 발화의 요지만 씁니다.",
        "- integrated_meaning에는 화면과 발화를 결합해 이 구간이 전달하는 의미를 씁니다.",
        "- visual_information_value는 이 구간의 화면이 발화만으로는 알 수 없는 정보를 얼마나 제공하는지 0~1로 평가합니다.",
        f"- {output_language}로 쓰고 스키마를 만족하는 결과 JSON 객체 하나만 반환합니다.",
    ]
    # The old instructions alone were ~441 o200k tokens, below OpenAI's 1024
    # visible-token cache minimum. Keep the existing schema and strategy guide
    # in this reusable prefix instead of adding padding or lecture material.
    instructions.extend([
        "",
        VIDEO_VISUAL_DETAIL_INSTRUCTION,
        "",
        "출력 계약: 아래 스키마를 만족하는 결과 JSON 객체 하나를 반환하세요. 스키마 자체를 출력하지 마세요.",
        json.dumps(VIDEO_SEGMENT_RESPONSE_FORMAT["json_schema"]["schema"], ensure_ascii=False, indent=2),
        "",
        "분석 유형별 지침: 요청에 지정된 유형의 설명을 적용하세요.",
        *[f"- {name}: {hint}" for name, hint in STRATEGY_ANALYSIS_HINTS.items()],
    ])
    messages = [{"role": "system", "content": [
        {"type": "text", "text": "\n".join(instructions)},
    ]}]
    frame_prompt = [
        f"구간: {start} ~ {end} ({segment.duration_seconds:.0f}초, 구간 {segment.index})",
        f"분석 유형: {segment.strategy.name if segment.strategy.name in STRATEGY_ANALYSIS_HINTS else 'mixed'}",
    ]
    if frame_lines:
        frame_prompt.extend(["프레임(시간 순서):", frame_lines])
    content: list[dict] = [{"type": "text", "text": "\n".join(frame_prompt)}]
    for image_path, _timestamp in frame_images:
        mime_type = mimetypes.guess_type(image_path.name)[0] or "image/jpeg"
        data = image_path.read_bytes()
        # Keep full originals for the document. High-resolution motion extracts
        # should use the same analysis scale as representative slide frames.
        from PIL import Image
        with Image.open(io.BytesIO(data)) as frame:
            if max(frame.size) > VISUAL_FRAME_MAX_EDGE:
                frame.thumbnail((VISUAL_FRAME_MAX_EDGE, VISUAL_FRAME_MAX_EDGE), Image.Resampling.LANCZOS)
                resized = io.BytesIO()
                frame.convert("RGB").save(resized, format="JPEG", quality=92)
                data, mime_type = resized.getvalue(), "image/jpeg"
        encoded = base64.b64encode(data).decode("ascii")
        content.append({"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{encoded}"}})
    # The same images precede changing speech parts, allowing their prefix to
    # be reused as well. Only multi-part segments get this additional boundary.
    if transcript_part is not None and transcript_part[1] > 1:
        messages.append({"role": "user", "content": content})
        content = []
    speech_prompt = []
    if previous_context:
        speech_prompt.extend(["[직전 구간 발화 끝부분]", previous_context, ""])
    if transcript_part is not None:
        speech_prompt.extend([
            f"구간 발화 분할 {transcript_part[0]}/{transcript_part[1]}입니다. 이 분할의 발화만 기록하고 다른 분할의 내용을 추측하지 마세요.",
            "",
        ])
    speech_prompt.extend(["[구간 발화 (STT)]", transcript_text or "(이 구간의 발화 없음)"])
    content.append({"type": "text", "text": "\n".join(speech_prompt)})
    messages.append({"role": "user", "content": content})
    return messages, VIDEO_SEGMENT_RESPONSE_FORMAT


def parse_video_segment_event(raw_content, segment: VideoSegment) -> dict:
    text = str(raw_content or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.IGNORECASE).strip()
    try:
        payload = json.loads(text)
    except (TypeError, ValueError) as error:
        raise RuntimeError(f"영상 구간 응답 JSON 파싱 실패: {error}") from error
    if not isinstance(payload, dict):
        raise RuntimeError("영상 구간 응답이 JSON 객체가 아닙니다.")
    for key in (
        "segment_summary",
        "spoken_context",
        "integrated_meaning",
    ):
        payload[key] = str(payload.get(key) or "").strip()
    for key in (
        "visual_observations",
        "visible_text",
        "persisted_information",
        "new_information",
        "removed_information",
        "changed_values",
        "steps_or_changes",
        "important_facts",
    ):
        value = payload.get(key)
        if isinstance(value, str):
            value = [value] if value.strip() else []
        if not isinstance(value, list):
            raise RuntimeError(f"영상 구간 응답의 {key}가 배열이 아닙니다. (type={type(value).__name__})")
        if any(not isinstance(item, str) for item in value):
            raise RuntimeError(f"영상 구간 응답의 {key}에 문자열이 아닌 항목이 있습니다.")
        payload[key] = [str(item).strip() for item in value if str(item or "").strip()]
    for key in ("importance", "confidence", "visual_information_value"):
        try:
            value = float(payload.get(key))
        except (TypeError, ValueError) as error:
            raise RuntimeError(f"영상 구간 응답의 {key}가 숫자가 아닙니다. (type={type(payload.get(key)).__name__})") from error
        if not 0 <= value <= 1:
            raise RuntimeError(f"영상 구간 응답의 {key}가 0~1 범위를 벗어났습니다.")
        payload[key] = value
    if not isinstance(payload.get("needs_original_image"), bool):
        raise RuntimeError("영상 구간 응답의 needs_original_image가 boolean이 아닙니다.")
    payload["segment_index"] = segment.index
    payload["start_seconds"] = segment.start_seconds
    payload["end_seconds"] = segment.end_seconds
    payload["strategy"] = segment.strategy.name
    payload["frame_names"] = [frame.image_name for frame in segment.frames]
    payload["timestamp"] = segment.start_seconds
    payload["file_name"] = segment.frames[0].image_name if segment.frames else f"segment-{segment.index:03d}"
    payload["duplicate_of"] = ""
    return payload


def prepare_segment_frame_images(segmentation: VideoSegmentation, image_dir_path: str) -> tuple[dict, list[dict]]:
    """분석 대상 구간의 선택 프레임을 이미지 디렉터리로 복사하고 캡션/메타를 만든다."""
    image_caps: dict = {}
    image_meta: list[dict] = []
    used_names: set[str] = set()
    for segment in segmentation.segments:
        if not segment.strategy.analyze or not segment.frames:
            continue
        for frame in segment.frames:
            if not frame.image_path or frame.image_name in used_names:
                continue
            if not Path(frame.image_path).is_file():
                continue
            target = os.path.join(image_dir_path, frame.image_name)
            shutil.copy2(frame.image_path, target)
            used_names.add(frame.image_name)
            timestamp = format_video_timestamp(frame.timestamp_seconds)
            image_caps[frame.image_name] = f"영상 구간 {segment.index} {timestamp} 프레임"
            image_meta.append({
                "file_name": frame.image_name,
                "start_time": frame.timestamp_seconds,
                "end_time": frame.timestamp_seconds,
                "timestamp": timestamp,
            })
    return image_caps, image_meta


def _merge_segment_events(events: list[dict]) -> dict:
    if len(events) == 1:
        return events[0]
    merged = dict(events[0])
    for key in ("segment_summary", "spoken_context", "integrated_meaning"):
        merged[key] = "\n".join(event[key] for event in events if event[key])
    for key in ("visual_observations", "visible_text", "persisted_information",
                "new_information", "removed_information", "changed_values",
                "steps_or_changes", "important_facts"):
        merged[key] = list(dict.fromkeys(item for event in events for item in event[key]))
    merged["importance"] = max(event["importance"] for event in events)
    merged["confidence"] = min(event["confidence"] for event in events)
    merged["visual_information_value"] = max(event["visual_information_value"] for event in events)
    merged["needs_original_image"] = any(event["needs_original_image"] for event in events)
    return merged


def _analyze_segment(
    segment: VideoSegment,
    *,
    analysis_cache_dir: str,
    image_dir_path: str,
    utterances,
    visual_call,
    cfg,
    log_list,
    check_cancel,
) -> tuple[dict, str, list[dict]]:
    frame_images = []
    for frame in segment.frames:
        image_path = Path(image_dir_path) / frame.image_name
        if image_path.is_file():
            frame_images.append((image_path, frame.timestamp_seconds))
    if not frame_images:
        raise RuntimeError(f"구간 {segment.index}에 사용할 수 있는 프레임 이미지가 없습니다.")
    transcript_parts = build_segment_transcript_parts(
        utterances, segment.start_seconds, segment.end_seconds,
    ) or [""]
    selected_model = str(cfg.get("_video_vision_identity") or cfg.get("video_vision_model_name") or "")
    limit = request_working_limit(selected_model)
    def fit_part(text):
        messages, schema = build_video_segment_messages(segment, frame_images,
            transcript_text=text, previous_context=build_previous_context_text(utterances, segment.start_seconds),
            language=cfg.get("language") or "korean")
        if estimate_request_tokens({"model": selected_model, "messages": messages, "response_format": schema}) <= limit:
            return [text]
        lines = text.splitlines()
        if len(lines) < 2:
            raise RuntimeError("영상 구간의 프레임·발화 한 개가 안전 입력 예산을 넘습니다.")
        midpoint = len(lines) // 2
        return fit_part("\n".join(lines[:midpoint])) + fit_part("\n".join(lines[midpoint:]))
    transcript_parts = [part for text in transcript_parts for part in fit_part(text)]
    events = []
    usage_records = []
    model_name = ""
    for part_index, transcript_text in enumerate(transcript_parts):
        messages, response_format = build_video_segment_messages(
            segment, frame_images, transcript_text=transcript_text,
            previous_context=(build_previous_context_text(utterances, segment.start_seconds)
                              if part_index == 0 else ""),
            language=cfg.get("language") or "korean",
            transcript_part=((part_index + 1, len(transcript_parts))
                             if len(transcript_parts) > 1 else None),
        )
        checkpoint = None
        saved = {}
        if analysis_cache_dir:
            identity = hashlib.sha256(json.dumps({
                "version": VIDEO_SEGMENT_EVENT_CACHE_VERSION,
                "input": _segment_input_digest(segment, utterances),
                "model": cfg.get("_video_vision_identity") or cfg.get("video_vision_model_name"),
                "language": cfg.get("language") or "korean", "part": part_index,
                "transcript_part": transcript_text,
            }, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:24]
            checkpoint = Path(analysis_cache_dir) / f"segment-{segment.index:03d}-part-{identity}.json"
            try:
                saved = json.loads(checkpoint.read_text(encoding="utf-8"))
                if not isinstance(saved, dict):
                    saved = {}
                if (isinstance(saved, dict) and isinstance(saved.get("event"), dict)
                        and isinstance(saved.get("usage"), dict)):
                    events.append(saved["event"])
                    model_name = str(saved.get("model") or model_name)
                    usage_records.extend({**record, "attempt": "prior"} for record in
                        (saved.get("calls") or [{"model": model_name, "usage": saved["usage"]}]))
                    continue
            except (OSError, ValueError, TypeError):
                saved = {}
        part_usage = [{**record, "attempt": "prior"} for record in saved.get("calls", [])]

        def save_part(payload):
            if checkpoint is None:
                return
            checkpoint.parent.mkdir(parents=True, exist_ok=True)
            temporary = checkpoint.with_suffix(f".json.{os.getpid()}.{threading.get_ident()}.tmp")
            try:
                temporary.write_text(json.dumps({**payload, "calls": part_usage}, ensure_ascii=False),
                                     encoding="utf-8")
                os.replace(temporary, checkpoint)
            finally:
                temporary.unlink(missing_ok=True)

        last_error = None
        retry_messages = messages
        for attempt in range(1, 4):
            check_cancel()
            raw_content = None
            try:
                if attempt == 1 and isinstance(saved.get("raw_content"), str):
                    raw_content = saved["raw_content"]
                    model_name = saved["model"]
                    call_usage = saved["usage"]
                elif len(part_usage) >= 3:
                    raise RuntimeError("영상 구간의 형식 교정 한도를 소진했습니다.")
                else:
                    raw_content, model_name, call_usage = visual_call(
                        retry_messages, cfg, log_list, response_format=response_format)
                if not (attempt == 1 and isinstance(saved.get("raw_content"), str)):
                    part_usage.append({"model": str(model_name or ""), "usage": call_usage or {},
                                       "attempt": "current"})
                    save_part({"raw_content": raw_content, "model": model_name, "usage": call_usage or {}})
                event = parse_video_segment_event(raw_content, segment)
                event["model"] = str(model_name or "")
                break
            except Exception as error:
                last_error = error
                if raw_content is None or isinstance(error, OSError):
                    # A transport or disk failure may have consumed a paid call.
                    # Only retry a received answer whose format can be repaired.
                    raise
                if isinstance(raw_content, str) and raw_content.strip() and str(error).startswith("영상 구간 응답"):
                    retry_messages = messages + [
                        {"role": "assistant", "content": raw_content},
                        {"role": "user", "content": (
                            f"앞선 JSON 응답 오류: {error}. 원래 화면·발화 근거를 유지하면서 "
                            "모든 필드를 요청한 JSON Schema의 정확한 자료형으로 고쳐 전체 객체를 다시 출력하세요. "
                            "정보를 추측하거나 생략하지 마세요."
                        )},
                    ]
                if (getattr(error, "code", "") == "license_or_device_denied"
                        or "device is not active" in str(error).casefold()):
                    raise
                if attempt < 3:
                    append_status_log(log_list,
                        f"영상 구간 형식/응답 재시도 {attempt + 1}/3: 구간 {segment.index}")
        else:
            raise RuntimeError(f"영상 구간 분석 실패(구간 {segment.index}): {last_error}") from last_error
        events.append(event)
        usage_records.extend(part_usage)
        save_part({"event": event, "model": model_name, "usage": call_usage or {}})
    return _merge_segment_events(events), str(model_name or ""), usage_records


def run_video_segment_analysis(
    analysis_result,
    segmentation: VideoSegmentation,
    *,
    utterances,
    image_dir_path: str,
    visual_call,
    cfg,
    log_list,
    check_cancel,
) -> tuple[list[dict], str, list[dict]]:
    """캐시된 구간 분석을 재사용하고 누락된 구간만 병렬로 VLM 분석한다."""
    model_identity = str(cfg.get("_video_vision_identity") or cfg.get("video_vision_model_name") or "")
    identity = video_segment_event_identity(
        segmentation.identity,
        model_identity,
        language=cfg.get("language") or "korean",
    )
    cache_dir = str(getattr(analysis_result, "cache_dir", "") or "")
    cached_events = load_video_segment_events(cache_dir, identity) if cache_dir else {}

    targets = []
    skipped_segments = 0
    for segment in segmentation.segments:
        if not segment.strategy.analyze or not segment.frames:
            continue
        # 캐시 정리 등으로 프레임 파일이 사라진 구간은 오류 대신 건너뛴다.
        if not any((Path(image_dir_path) / frame.image_name).is_file() for frame in segment.frames):
            skipped_segments += 1
            continue
        targets.append(segment)
    if skipped_segments:
        append_status_log(
            log_list,
            f"프레임 파일이 없어 건너뛴 구간: {skipped_segments}개",
        )
    events_by_key: dict[str, dict] = {}
    for segment in targets:
        key = segment_event_key(segment)
        cached_event = cached_events.get(key)
        if (isinstance(cached_event, dict) and cached_event.get("segment_index") == segment.index
                and cached_event.get("input_digest") == _segment_input_digest(segment, utterances)):
            events_by_key[key] = cached_event
    missing = [segment for segment in targets if segment_event_key(segment) not in events_by_key]
    if targets and len(events_by_key):
        append_status_log(
            log_list,
            f"영상 구간 멀티모달 캐시 재사용: {len(events_by_key)}개",
        )

    usage_events: list[dict] = []
    for cached_event in events_by_key.values():
        for event in cached_event.get("_usage_events", []):
            usage_events.append({**event, "attempt": "prior"})
        cfg["_managed_previous_settlements"] = merge_settlements(
            cfg.get("_managed_previous_settlements"),
            prior_settlements(cached_event.get("_managed_sessions")))
    video_visual_model = next(
        (str(event.get("model")) for event in events_by_key.values() if event.get("model")),
        "",
    )
    if missing:
        concurrency = max(1, min(8, int(cfg.get("video_vision_concurrency") or 4)))
        completed_count = 0
        cache_reads = 0
        cache_input = 0
        cache_unreported = 0

        def analyze(segment):
            return _analyze_segment(
                segment, analysis_cache_dir=cache_dir,
                image_dir_path=image_dir_path, utterances=utterances,
                visual_call=visual_call, cfg=cfg, log_list=log_list,
                check_cancel=check_cancel,
            )

        def record_result(segment, result):
            nonlocal completed_count, video_visual_model, cache_reads, cache_input, cache_unreported
            event, model_name, call_usage = result
            event["input_digest"] = _segment_input_digest(segment, utterances)
            event["_usage_events"] = []
            event["_managed_sessions"] = merge_settlements([], [record for record in
                cfg.get("_managed_session_records", []) if record.get("phase") == "video_visual"])
            events_by_key[segment_event_key(segment)] = event
            for usage_record in (call_usage if isinstance(call_usage, list)
                                 else [{"model": model_name, "usage": call_usage,
                                        "attempt": "current"}]):
                raw_usage = usage_record.get("usage") or {}
                if usage_record.get("attempt") != "prior":
                    cache_input += int(raw_usage.get("input_tokens") or 0)
                    if raw_usage.get("prompt_cache_hit_tokens") is None:
                        cache_unreported += 1
                    else:
                        cache_reads += int(raw_usage["prompt_cache_hit_tokens"])
                usage_event = build_usage_event(
                    "video_visual", usage_record.get("model") or model_name,
                    raw_usage, input_type="image")
                if usage_event:
                    usage_event["attempt"] = usage_record.get("attempt") or "current"
                    usage_events.append(usage_event)
                    event["_usage_events"].append(usage_event)
            if model_name:
                video_visual_model = model_name
            completed_count += 1
            if cache_dir:
                save_video_segment_events(cache_dir, identity, events_by_key)
            append_status_log(log_list,
                f"영상 구간 멀티모달 분석 진행: {completed_count}/{len(missing)}")

        append_status_log(
            log_list,
            f"영상 구간 멀티모달 분석 시작: {len(missing)}개, 동시 {concurrency}개",
        )
        for segment, result in iter_visual_analysis(
            missing, analyze, model_identity=model_identity, concurrency=concurrency,
            check_cancel=check_cancel, log_list=log_list,
        ):
            record_result(segment, result)
        append_status_log(log_list,
            f"영상 분석 공급자 확인된 캐시 읽기: {cache_reads:,} 토큰 / 이번 입력 {cache_input:,} 토큰"
            + (f" (캐시 사용량 미보고 {cache_unreported}건)" if cache_unreported else ""))

    events = [{key: value for key, value in events_by_key[segment_event_key(segment)].items()
               if key not in {"input_digest", "_usage_events", "_managed_sessions"}}
              for segment in targets if segment_event_key(segment) in events_by_key]
    return events, video_visual_model, usage_events


__all__ = [
    "VIDEO_SEGMENT_EVENT_CACHE_VERSION",
    "VIDEO_SEGMENT_RESPONSE_FORMAT",
    "build_previous_context_text",
    "build_segment_transcript_text",
    "build_video_segment_messages",
    "load_video_segment_events",
    "parse_video_segment_event",
    "prepare_segment_frame_images",
    "run_video_segment_analysis",
    "save_video_segment_events",
    "segment_event_key",
    "video_segment_event_cache_path",
    "video_segment_event_identity",
]
