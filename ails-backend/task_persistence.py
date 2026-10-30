from __future__ import annotations

def _common():
    import common
    return common

import datetime
import hashlib
import json
import os
import shutil
import tempfile
import threading
import time
from system_storage import resolve_system_path


_retry_registry_lock = threading.RLock()


def iter_resume_dir_candidates(base_dir):
    candidates = [os.path.join(parent, name)
                  for parent in (os.path.dirname(build_retry_registry_path(base_dir)), _common().BASE_EXE_DIR)
                  for name in (".resume", "_resume")]
    candidates.extend(os.path.join(tempfile.gettempdir(), name) for name in (".AILS.resume", "AILS_resume"))
    normalized_base_dir = str(base_dir or "").strip()
    if normalized_base_dir:
        candidates.extend(os.path.join(_common().resolve_app_path(normalized_base_dir), name) for name in (".resume", "_resume"))

    seen = set()
    normalized = []
    for candidate in candidates:
        normalized_candidate = os.path.normpath(str(candidate or "").strip())
        if not normalized_candidate or normalized_candidate in seen:
            continue
        seen.add(normalized_candidate)
        normalized.append(normalized_candidate)
    return normalized

def build_resume_dir(base_dir):
    for normalized_candidate in iter_resume_dir_candidates(base_dir):
        if not os.path.basename(normalized_candidate).startswith("."):
            continue
        try:
            os.makedirs(normalized_candidate, exist_ok=True)
            return normalized_candidate
        except Exception:
            continue

    fallback = os.path.join(tempfile.gettempdir(), ".AILS.resume")
    os.makedirs(fallback, exist_ok=True)
    return fallback

def build_file_resume_fingerprint(file_path):
    normalized = str(file_path or "").strip()
    if not normalized:
        return None
    fingerprint = {"path": os.path.abspath(normalized)}
    try:
        stat = os.stat(normalized)
        fingerprint["size"] = int(stat.st_size)
        fingerprint["mtime"] = int(stat.st_mtime)
    except Exception:
        pass
    return fingerprint

def build_task_resume_signature(task):
    from pipeline_utils import safe_float

    normalized_task = {
        "type": str(task.get("type", "") or "").strip(),
        "title": str(task.get("title", "") or "").strip(),
    }
    if normalized_task["type"] == "audio":
        normalized_task["audio"] = build_file_resume_fingerprint(
            task.get("source_audio_path") or task.get("file_path")
        )
        normalized_task["pdf"] = build_file_resume_fingerprint(
            task.get("source_pdf_path") or task.get("pdf_path")
        )
    elif normalized_task["type"] in {"video_detailed", "video_summary"}:
        normalized_task["video"] = build_file_resume_fingerprint(
            task.get("source_video_path") or task.get("video_path")
        )
        normalized_task["local_stt"] = bool(task.get("local_stt"))
        normalized_task["local_stt_model"] = str(task.get("local_stt_model", "") or "").strip()
    else:
        normalized_task.update({
            "url": str(task.get("url") or task.get("vod_url") or task.get("youtube_url") or "").strip(),
            "start": int(task.get("start", 0) or 0),
            "end": int(task.get("end", 0) or 0),
            "interval": safe_float(task.get("interval", task.get("frame_interval", 0.0)), 0.0),
            "mse_threshold": safe_float(task.get("mse_threshold", 0), 0.0),
            "skip_images": bool(task.get("skip_images")),
        })
        if task.get("detail_mode") == "detailed":
            normalized_task["detail_mode"] = "detailed"
    normalized_task = _common().make_json_safe(normalized_task)
    raw = json.dumps(normalized_task, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha1(raw.encode("utf-8")).hexdigest(), normalized_task


def build_resume_state_path(base_dir, task):
    signature, _ = build_task_resume_signature(task)
    safe_title = _common().sanitize_title(task.get("title", "resume"))
    return os.path.join(build_resume_dir(base_dir), f"{safe_title}_{signature[:12]}.json"), signature

def iter_resume_state_paths(base_dir, task, include_tmp=False):
    signature, _ = build_task_resume_signature(task)
    safe_title = _common().sanitize_title(task.get("title", "resume"))
    file_name = f"{safe_title}_{signature[:12]}.json"
    paths = []
    seen = set()
    for resume_dir in iter_resume_dir_candidates(base_dir):
        for candidate in ([os.path.join(resume_dir, file_name), os.path.join(resume_dir, f"{file_name}.tmp")] if include_tmp else [os.path.join(resume_dir, file_name)]):
            normalized_candidate = os.path.normpath(candidate)
            if normalized_candidate in seen:
                continue
            seen.add(normalized_candidate)
            paths.append(normalized_candidate)
    return paths, signature

def load_resume_state(base_dir, task):
    preferred_state_path, _ = build_resume_state_path(base_dir, task)
    candidate_paths, signature = iter_resume_state_paths(base_dir, task, include_tmp=True)
    for candidate_path in candidate_paths:
        if not os.path.exists(candidate_path):
            continue
        try:
            with open(candidate_path, "r", encoding="utf-8") as handle:
                payload = json.load(handle)
        except Exception:
            continue
        if str(payload.get("signature", "") or "").strip() != signature:
            continue
        return payload, preferred_state_path, signature
    return None, preferred_state_path, signature


def save_resume_media(state_path, source_path):
    """Move a completed download into the checkpoint's owned media directory."""
    media_dir = state_path + ".media"
    os.makedirs(media_dir, exist_ok=True)
    target = os.path.join(media_dir, "source" + os.path.splitext(source_path)[1])
    if os.path.abspath(source_path) != os.path.abspath(target):
        shutil.move(source_path, target)
    return build_file_resume_fingerprint(target)


def load_resume_media(resume_state):
    media = (resume_state or {}).get("media")
    if not isinstance(media, dict):
        return None
    path = resolve_system_path(media.get("path") or "")
    if not path or not os.path.isfile(path):
        return None
    return path if build_file_resume_fingerprint(path) == {**media, "path": os.path.abspath(path)} else None

def save_resume_state(state_path, signature, payload):
    if not state_path or not signature:
        return
    try:
        os.makedirs(os.path.dirname(state_path), exist_ok=True)
    except Exception:
        fallback_dir = build_resume_dir(_common().BASE_EXE_DIR)
        state_path = os.path.join(fallback_dir, os.path.basename(state_path))
    serialized = _common().make_json_safe(dict(payload or {}))
    serialized["signature"] = signature
    serialized["saved_at"] = int(time.time())
    tmp_path = f"{state_path}.tmp"
    with open(tmp_path, "w", encoding="utf-8", errors="replace") as handle:
        json.dump(serialized, handle, ensure_ascii=False, indent=2)
    for attempt in range(4):
        try:
            os.replace(tmp_path, state_path)
            break
        except PermissionError as error:
            # Windows can briefly hold the destination after a prior atomic
            # write. Keep the completed temporary checkpoint and retry only
            # sharing/access violations; persistent permission errors escape.
            if os.name != "nt" or getattr(error, "winerror", None) not in {5, 32} or attempt == 3:
                raise
            time.sleep(0.05 * (attempt + 1))

def clear_resume_state(state_path, base_dir=None, task=None):
    from pipeline_utils import safe_remove

    candidates = []
    if task:
        state_paths, _signature = iter_resume_state_paths(base_dir, task, include_tmp=True)
        candidates.extend(state_paths)
        title = str((task or {}).get("title", "") or "").strip()
        if title:
            safe_title = _common().sanitize_title(title)
            for resume_dir in iter_resume_dir_candidates(base_dir):
                if not os.path.isdir(resume_dir):
                    continue
                try:
                    file_names = os.listdir(resume_dir)
                except Exception:
                    continue
                for file_name in file_names:
                    lower_name = file_name.lower()
                    if not (lower_name.endswith(".json") or lower_name.endswith(".json.tmp")):
                        continue
                    if file_name == os.path.basename(build_retry_registry_path(base_dir)):
                        continue
                    if file_name.startswith(f"{safe_title}_"):
                        candidates.append(os.path.join(resume_dir, file_name))
    if state_path:
        candidates.append(state_path)
        candidates.append(f"{state_path}.tmp")

    seen = set()
    for candidate in candidates:
        normalized_candidate = os.path.normpath(str(candidate or "").strip())
        if not normalized_candidate or normalized_candidate in seen:
            continue
        seen.add(normalized_candidate)
        safe_remove(normalized_candidate)
        if normalized_candidate.endswith(".json"):
            # Derived sibling directory only; never delete a path from checkpoint JSON.
            shutil.rmtree(normalized_candidate + ".media", ignore_errors=True)

def has_valid_image_resume_payload(base_dir, title, image_payload, require_full_coverage=False, *, grade=None, semester=None):
    if not isinstance(image_payload, dict):
        return False
    image_dir_name = str(image_payload.get("image_dir_name") or _common().build_image_dir_name(title) or "").strip()
    if not image_dir_name:
        return False
    root = _common().resolve_app_path(base_dir)
    lecture_name = title.split("_")[0] if "_" in title else title
    if grade is not None and semester is not None:
        image_dir_path = os.path.join(
            root, f"{grade}학년 {semester}학기", _common().sanitize_title(lecture_name), ".images", image_dir_name,
        )
    else:
        image_dir_path = os.path.join(root, _common().sanitize_title(lecture_name), ".images", image_dir_name)
    image_dir_path = resolve_system_path(image_dir_path)
    if not os.path.isdir(image_dir_path):
        image_dir_path = os.path.join(root, ".images", image_dir_name)
        image_dir_path = resolve_system_path(image_dir_path)
    if not os.path.isdir(image_dir_path):
        return False
    captions = image_payload.get("captions") or {}
    image_meta = image_payload.get("image_meta") or []
    referenced_names = set()
    referenced_names.update(str(name) for name in captions.keys() if str(name).strip())
    referenced_names.update(
        str((item or {}).get("image_name", "")).strip()
        for item in image_meta
        if str((item or {}).get("image_name", "")).strip()
    )
    actual_image_names = {
        str(name).strip()
        for name in os.listdir(image_dir_path)
        if str(name).strip()
        and os.path.isfile(os.path.join(image_dir_path, str(name).strip()))
        and str(name).strip().lower().startswith("slide_")
    }
    if referenced_names:
        has_existing_reference = any(os.path.exists(os.path.join(image_dir_path, name)) for name in referenced_names)
        if not has_existing_reference:
            return False
        if require_full_coverage and actual_image_names and not actual_image_names.issubset(referenced_names):
            return False
        return True
    if require_full_coverage and actual_image_names:
        return False
    return True

def build_retry_task_payload(task):
    from pipeline_utils import safe_float

    if not isinstance(task, dict):
        return None

    task_type = str(task.get("type", "") or "").strip()
    title = str(task.get("title", "") or "").strip()
    if not task_type or not title:
        return None

    payload = {
        "type": task_type,
        "title": title,
        "prompt_template": task.get("prompt_template", _common().BASE_PROMPT_TEMPLATE),
        "stt_only": bool(task.get("stt_only")),
        "mp3_only": bool(task.get("mp3_only")),
    }

    if task_type == "audio":
        source_audio_path = str(task.get("source_audio_path") or task.get("file_path") or "").strip()
        if not source_audio_path:
            return None
        payload["source_audio_path"] = source_audio_path
        payload["skip_images"] = bool(task.get("skip_images", True))
        source_pdf_path = str(task.get("source_pdf_path") or task.get("pdf_path") or "").strip()
        if source_pdf_path:
            payload["source_pdf_path"] = source_pdf_path
            payload["pdf_password"] = str(task.get("pdf_password", "") or "")
            payload["skip_images"] = False
        return payload

    if task_type in {"video_detailed", "video_summary"}:
        source_video_path = str(task.get("source_video_path") or task.get("video_path") or "").strip()
        if not source_video_path:
            return None
        payload["source_video_path"] = source_video_path
        payload["base_title"] = str(task.get("base_title", "") or "").strip()
        payload["local_stt"] = bool(task.get("local_stt"))
        payload["local_stt_model"] = str(task.get("local_stt_model", "") or "").strip()
        return payload

    if task_type == "url":
        payload.update({
            "url": str(task.get("url", "") or "").strip(),
            "start": int(task.get("start", 0) or 0),
            "end": int(task.get("end", 0) or 0),
            "detail_mode": "detailed" if task.get("detail_mode") == "detailed" else "summary",
            "skip_images": bool(task.get("skip_images")),
            "interval": safe_float(task.get("interval", 3), 3.0),
            "mse_threshold": safe_float(task.get("mse_threshold", 500), 500.0),
            "local_stt": bool(task.get("local_stt")),
            "local_stt_model": str(task.get("local_stt_model") or ""),
        })
        if not payload["url"] or payload["start"] <= 0 or payload["end"] < payload["start"]:
            return None
        return payload

    if task_type == "youtube":
        payload.update({
            "youtube_url": str(task.get("youtube_url", "") or "").strip(),
            "detail_mode": "detailed" if task.get("detail_mode") == "detailed" else "summary",
            "skip_images": bool(task.get("skip_images")),
            "frame_interval": safe_float(task.get("interval", task.get("frame_interval", 3)), 3.0),
            "mse_threshold": safe_float(task.get("mse_threshold", 500), 500.0),
            "local_stt": bool(task.get("local_stt")),
            "local_stt_model": str(task.get("local_stt_model") or ""),
        })
        if not payload["youtube_url"]:
            return None
        return payload

    if task_type == "eclass_vod":
        payload.update({
            "vod_url": str(task.get("vod_url") or task.get("url") or "").strip(),
            "detail_mode": "detailed" if task.get("detail_mode") == "detailed" else "summary",
            "skip_images": bool(task.get("skip_images")),
            "local_stt": bool(task.get("local_stt")),
            "local_stt_model": str(task.get("local_stt_model") or ""),
            "frame_interval": safe_float(task.get("interval", task.get("frame_interval", 3)), 3.0),
            "mse_threshold": safe_float(task.get("mse_threshold", 500), 500.0),
        })
        if task.get("lms_batch") is True:
            payload.update(lms_batch=True, grade=task.get("grade"), semester=task.get("semester"))
        if not payload["vod_url"]:
            return None
        return payload

    return None

def build_retry_registry_path(base_dir):
    runtime_dir = str(os.environ.get("AILS_RUNTIME_DATA_DIR", "") or "").strip()
    if runtime_dir:
        directory = os.path.abspath(os.path.expandvars(os.path.expanduser(runtime_dir)))
    else:
        appdata = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA")
        directory = os.path.join(appdata or os.path.join(os.path.expanduser("~"), ".local", "share"), "AILS")
    return os.path.join(directory, "retry_registry.json")


def _read_retry_registry(path):
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    return {
        str(key).strip(): value
        for key, value in payload.items()
        if str(key).strip() and isinstance(value, dict)
    }

def load_retry_registry(base_dir):
    registry_path = build_retry_registry_path(base_dir)
    with _retry_registry_lock:
        registry = _read_retry_registry(registry_path) or {}
        migrated_paths = []
        for resume_dir in iter_resume_dir_candidates(base_dir):
            legacy_path = os.path.join(resume_dir, "retry_registry.json")
            if os.path.normcase(legacy_path) == os.path.normcase(registry_path):
                continue
            legacy = _read_retry_registry(legacy_path)
            if legacy is None:
                continue
            for title, entry in legacy.items():
                registry.setdefault(title, entry)
            migrated_paths.append(legacy_path)
        if migrated_paths:
            save_retry_registry(base_dir, registry)
            from pipeline_utils import safe_remove

            for legacy_path in migrated_paths:
                safe_remove(legacy_path)
        return registry

def save_retry_registry(base_dir, entries):
    registry_path = build_retry_registry_path(base_dir)
    os.makedirs(os.path.dirname(registry_path), exist_ok=True)
    tmp_path = f"{registry_path}.tmp"
    with _retry_registry_lock:
        with open(tmp_path, "w", encoding="utf-8", errors="replace") as handle:
            json.dump(_common().make_json_safe(entries or {}), handle, ensure_ascii=False, indent=2)
        os.replace(tmp_path, registry_path)

def upsert_retry_registry_entry(base_dir, title, entry):
    normalized_title = str(title or "").strip()
    if not normalized_title or not isinstance(entry, dict):
        return
    with _retry_registry_lock:
        registry = load_retry_registry(base_dir)
        registry[normalized_title] = dict(entry)
        save_retry_registry(base_dir, registry)

def remove_retry_registry_entry(base_dir, title):
    from pipeline_utils import safe_remove

    normalized_title = str(title or "").strip()
    if not normalized_title:
        return
    with _retry_registry_lock:
        registry = load_retry_registry(base_dir)
        if normalized_title not in registry:
            return
        registry.pop(normalized_title, None)
        if registry:
            save_retry_registry(base_dir, registry)
        else:
            safe_remove(build_retry_registry_path(base_dir))

def build_retry_result_content(title, entry):
    normalized_title = str(title or "이름 없는 작업").strip() or "이름 없는 작업"
    retry_task = entry.get("retry_task") or {}
    type_labels = {
        "audio": "오디오 & PDF",
        "url": "URL 패턴",
        "youtube": "YouTube",
        "eclass_vod": "e-class VOD",
    }
    task_type = type_labels.get(str(retry_task.get("type", "")).strip(), "알 수 없음")
    last_error = str(entry.get("last_error", "") or "이전 실행에서 실패한 작업입니다.").strip()
    last_logs = entry.get("last_logs") or []
    if not isinstance(last_logs, list):
        last_logs = []
    logs_block = "\n".join(f"- {str(log)}" for log in last_logs)
    if not logs_block:
        logs_block = "- 저장된 로그가 없습니다."
    lines = [
        f"# ❌ {normalized_title} 재시도 대기",
        "",
        "> **상태:** 이전 실행 실패로 재시도 가능",
        f"> **유형:** {task_type}",
        f"> **오류:** {last_error}",
    ]
    if isinstance(entry.get("saved_at"), (int, float)):
        saved_dt = datetime.datetime.fromtimestamp(float(entry["saved_at"]))
        lines.append(f"> **저장 시각:** {saved_dt.strftime('%Y-%m-%d %H:%M:%S')}")
    lines.extend(["", "## 이전 로그", "", logs_block])
    return "\n".join(lines).strip()

def collect_retry_entries_from_disk(base_dir):
    collected = {}
    registry = load_retry_registry(base_dir)
    for title, entry in list(registry.items()):
        retry_task = entry.get("retry_task")
        if not isinstance(retry_task, dict):
            continue
        normalized_entry = dict(entry)
        normalized_entry["title"] = title
        normalized_entry.setdefault("status", "failed")
        normalized_entry.setdefault("content", build_retry_result_content(title, normalized_entry))
        collected[title] = normalized_entry

    resume_files = []
    for resume_dir in iter_resume_dir_candidates(base_dir):
        try:
            resume_files.extend(os.path.join(resume_dir, name) for name in os.listdir(resume_dir))
        except OSError:
            continue
    for file_path in resume_files:
        file_name = os.path.basename(file_path)
        if not file_name.lower().endswith(".json"):
            continue
        if file_name == os.path.basename(build_retry_registry_path(base_dir)):
            continue
        try:
            with open(file_path, "r", encoding="utf-8") as handle:
                payload = json.load(handle)
        except Exception:
            continue
        if not isinstance(payload, dict):
            continue
        title = str(payload.get("title", "") or "").strip()
        if not title:
            continue
        retry_task = payload.get("retry_task")
        if not isinstance(retry_task, dict) or title in collected:
            continue
        inferred_entry = {
            "title": title,
            "status": "failed",
            "retry_task": retry_task,
            "saved_at": payload.get("saved_at"),
            "last_error": "이전 실행의 부분 결과가 남아 있어 재시도할 수 있습니다.",
            "content": build_retry_result_content(title, {
                "retry_task": retry_task,
                "saved_at": payload.get("saved_at"),
                "last_error": "이전 실행의 부분 결과가 남아 있어 재시도할 수 있습니다.",
            }),
        }
        collected[title] = inferred_entry

    return collected

