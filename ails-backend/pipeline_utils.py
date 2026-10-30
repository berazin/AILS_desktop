import contextlib
import math
import threading
import urllib.request
import wave
from urllib.parse import urlparse
from local_inference import GPU_SCHEDULER, GpuPriority
from edition_manifest import (
    canonical_edition_id,
    load_edition_manifest,
    require_faster_whisper_model,
    require_local_stt_provider,
    require_whisper_cpp_model,
)
from model_manager import ModelUnavailableError, get_model_manager
from language_support import (
    language_display_name,
    language_output_directive,
    normalize_app_language,
)

from common import (
    BASE_PROMPT_TEMPLATE,
    BASE_EXE_DIR,
    CHUNK_SIZE,
    CREATE_NO_WINDOW,
    DEFAULT_GEMINI_IMAGE_MODEL,
    DEFAULT_RATE_LIMIT_WAIT_SCHEDULE,
    FFMPEG_EXE,
    FFPROBE_EXE,
    GROQ_DEFAULT_IMAGE_MODEL,
    GROQ_DEFAULT_MODELS_ENDPOINT,
    GROQ_DEFAULT_STT_MODEL,
    GROQ_DEFAULT_SUMMARY_MODEL,
    HTTP_ERROR_PREVIEW_LIMIT,
    Image,
    LIVE_CODING_RULE_BLOCK,
    LMSTUDIO_DEFAULT_BASE_URL,
    LMSTUDIO_DEFAULT_MODELS_ENDPOINT,
    MASTERY_CHALLENGE_RULE_BLOCK,
    OPENAI_COMPAT_MAX_RETRIES,
    PROVIDER_DEEPSEEK,
    PROVIDER_GEMINI,
    PROVIDER_GROQ,
    PROVIDER_LMSTUDIO,
    SEGMENT_GAP_SPLIT_SECONDS,
    SEGMENT_MAX_CHARS,
    SEGMENT_MIN_CHARS,
    SEGMENT_TARGET_CHARS,
    SUMMARY_BOUNDARY_RULE_BLOCK,
    SUMMARY_PRIORITY_LIST,
    SequenceMatcher,
    VISUAL_CAPTION_SIMILARITY_THRESHOLD,
    VISUAL_CONTEXT_MAX_ITEMS,
    VISUAL_CONTEXT_PER_SEGMENT,
    VISUAL_MERGE_GAP_SECONDS,
    VISUAL_SEGMENT_PADDING_SECONDS,
    WhisperModel,
    WHISPER_CPP_MODEL_DIR,
    WHISPER_CPP_TOOL_DIR,
    append_status_log,
    base64,
    build_openai_chat_endpoint,
    build_openai_compat_headers,
    build_openai_models_endpoint,
    contains_rate_limit_marker,
    emit_debug_trace,
    endpoint_supports_stream_usage,
    estimate_token_count,
    extract_openai_compat_usage,
    extract_usage_metadata,
    get_effective_feature_model_name,
    get_gemini_image_api_key_candidates,
    get_retry_wait_seconds,
    hashlib,
    importlib,
    install_faster_whisper_dependencies,
    is_custom_model_option,
    is_debug_trace_enabled,
    is_openai_compat_rate_limit_error,
    json,
    load_faster_whisper_model_class,
    messagebox,
    os,
    re,
    requests,
    resolve_faster_whisper_model_source,
    should_retry_openai_compat_request,
    shutil,
    subprocess,
    time,
    zipfile,
)

from ai_request_limits import AI_REQUEST_MAX_INPUT_TOKENS, estimate_request_tokens, request_working_limit

SUMMARY_ONE_SHOT_MAX_INPUT_TOKENS = request_working_limit()
VIDEO_REQUEST_HARD_INPUT_TOKENS = AI_REQUEST_MAX_INPUT_TOKENS
DEEPSEEK_FLASH_VIDEO_MODELS = frozenset({
    "deepseek-v4.1-flash", "deepseek-flash",
    "deepseek-v4-flash", "deepseek-v4-flash-vision-exp",
})


def video_request_working_limit(model_id: str = "", context_tokens: int | None = None) -> int:
    """Keep video text requests below the price boundary and model context.

    Unknown routes use the application ceiling. This limit includes prompt and tool
    history; image callers must add their own conservative image estimate.
    """
    return request_working_limit(model_id, context_tokens)


def build_summary_resume_identity(
    *, transcript, image_captions, prompt_template, content_instruction,
    provider, model_name, language, verification_enabled, source_contract="",
):
    payload = {
        "transcript": str(transcript or ""),
        "image_captions": image_captions or {},
        "prompt_template": str(prompt_template or ""),
        "content_instruction": str(content_instruction or ""),
        "provider": str(provider or ""),
        "model_name": str(model_name or ""),
        "language": str(language or ""),
        "verification_enabled": bool(verification_enabled),
    }
    if source_contract:
        payload["source_contract"] = source_contract
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def build_summary_resume_progress(
    identity, *, next_chunk_index, total_chunks, full_markdown, bookmark,
    used_images, usage_events, last_model, summary_body="", claims=None,
    source_records=None, image_records=None, chunks=None, source_payload=None,
):
    progress = {
        "identity": str(identity or ""),
        "next_chunk_index": int(next_chunk_index),
        "total_chunks": int(total_chunks),
        "full_markdown": str(full_markdown or ""),
        "bookmark": str(bookmark or ""),
        "used_images": sorted(str(item) for item in (used_images or set()) if str(item)),
        "usage_events": [dict(item) for item in (usage_events or []) if isinstance(item, dict)],
        "last_model": str(last_model or ""),
        "summary_body": str(summary_body or ""),
        "claims": [dict(item) for item in (claims or []) if isinstance(item, dict)],
        "source_records": [dict(item) for item in (source_records or []) if isinstance(item, dict)],
        "image_records": [dict(item) for item in (image_records or []) if isinstance(item, dict)],
        "chunks": [dict(item) for item in (chunks or []) if isinstance(item, dict)],
    }
    if isinstance(source_payload, dict):
        progress["source_payload"] = dict(source_payload)
    return progress


def load_summary_resume_progress(resume_state, identity, *, total_chunks):
    progress = (resume_state or {}).get("summary")
    if not isinstance(progress, dict) or str(progress.get("identity") or "") != str(identity or ""):
        return None
    try:
        next_chunk_index = int(progress.get("next_chunk_index", -1))
        saved_total_chunks = int(progress.get("total_chunks", -1))
    except (TypeError, ValueError):
        return None
    saved_chunks = [dict(item) for item in (progress.get("chunks") or []) if isinstance(item, dict)]
    if saved_chunks and len(saved_chunks) != saved_total_chunks:
        return None
    if not saved_chunks and saved_total_chunks != int(total_chunks):
        return None
    if not 0 <= next_chunk_index <= saved_total_chunks:
        return None
    full_markdown = str(progress.get("full_markdown") or "")
    if next_chunk_index and not full_markdown.strip():
        return None
    return {
        **progress,
        "next_chunk_index": next_chunk_index,
        "total_chunks": saved_total_chunks,
        "full_markdown": full_markdown,
        "bookmark": str(progress.get("bookmark") or ""),
        "used_images": [str(item) for item in (progress.get("used_images") or []) if str(item)],
        "usage_events": [dict(item) for item in (progress.get("usage_events") or []) if isinstance(item, dict)],
        "last_model": str(progress.get("last_model") or ""),
        "summary_body": str(progress.get("summary_body") or ""),
        "claims": [dict(item) for item in (progress.get("claims") or []) if isinstance(item, dict)],
        "source_records": [dict(item) for item in (progress.get("source_records") or []) if isinstance(item, dict)],
        "image_records": [dict(item) for item in (progress.get("image_records") or []) if isinstance(item, dict)],
        "chunks": saved_chunks,
    }


def summary_prompt_exceeds_input_budget(prompt, max_input_tokens=SUMMARY_ONE_SHOT_MAX_INPUT_TOKENS):
    return estimate_request_tokens({"messages": [{"role": "user", "content": prompt}]}) > max(1, int(max_input_tokens))


def should_generate_summary_supplement(task):
    return bool((task or {}).get("include_learning_extras"))

_FW_WHISPER_MODEL = None
_CURRENT_FW_SIZE = None
_CURRENT_FW_DEVICE = None
_CURRENT_FW_COMPUTE_TYPE = None
_CURRENT_FW_BACKEND_LABEL = None
_CURRENT_FW_INIT_NOTE = None

LMS_BROWSER_PROFILE_ROOT = os.path.join(BASE_EXE_DIR, "browser_profiles", "eclass")
def build_image_caption_instruction(batch, allow_duplicate_detection=True, language="korean"):
    language = normalize_app_language(language)
    language_name = language_display_name(language)
    duplicate_policy = (
        "For each filename, the value must use exactly one of these two schemas: "
        "non-duplicate: {{\"caption\": \"{lang} caption text\"}}; "
        "duplicate: {{\"duplicate_of\": \"earlier filename in the same batch\"}}. "
        "Do not mix caption and duplicate_of in the same object. "
        "Mark duplicates only when the learning content is materially the same and the page changed only by tiny scroll, cursor, or highlight differences. "
        "If meaningful content was added or the explanation structure changed, do not mark it as duplicate. "
        "For duplicate items, do not include caption text; only include duplicate_of. "
    ) if allow_duplicate_detection else (
        "For each filename, the value must use exactly this schema: {{\"caption\": \"{lang} caption text\"}}. "
        "Never return {{\"duplicate_of\": \"...\"}}, {{\"duplicate\": \"...\"}}, or {{\"is_duplicate\": true}}. "
        "Even if pages look similar, treat every page as an independent page and caption each one separately. "
    )
    return (
        "Look at all provided lecture slide images in time order and return strict JSON only. "
        "Keys must exactly match the filenames. "
        "The top-level output must be one JSON object and nothing else. "
        "Every provided filename must appear exactly once as a top-level key. "
        "Do not add filenames that were not provided. "
        "Do not wrap the JSON in markdown fences. "
        "Use double quotes for all JSON keys and string values. "
        f"Write {language_name} text as actual UTF-8 characters; do not use JSON Unicode escape sequences like \\uAC00. "
        "Do not output any backslash escapes except valid JSON escapes that are strictly necessary. "
        "Do not use trailing commas, comments, arrays, null, booleans, or nested objects other than the per-file value object. "
        "Allowed per-file keys are only caption or duplicate_of. "
        f"{duplicate_policy}"
        f"Each caption must be written in {language_name} in 2 to 4 sentences and include the slide's main topic, notable visible text or terms, what any table, diagram, circuit, graph, or formula is explaining, and the screen state. "
        "If code is visible, explain the code's purpose, key variables, and execution result or error state. "
        "If possible, mention what is newly added compared with the previous page. "
        "If the slide is not worth inserting into the summary, make that reason visible in the caption. "
        "Output example for non-duplicate pages: {{\"slide_000.jpg\": {{\"caption\": \"...\"}}, \"slide_001.jpg\": {{\"caption\": \"...\"}}}}. "
        "Output example with a duplicate page: {{\"slide_000.jpg\": {{\"caption\": \"...\"}}, \"slide_001.jpg\": {{\"duplicate_of\": \"slide_000.jpg\"}}}}. "
        "Do not output markdown, backticks, or any extra explanation outside the JSON object. "
        "Files: {filenames}"
    ).format(
        filenames=", ".join(str(name) for name in (batch or [])),
        lang=language_name,
    )

from settings.prompt_template import upgrade_prompt_template



from json_repair_utils import (
    drop_last_mapping_entry,
    insert_missing_commas_between_json_entries,
    merge_concatenated_json_objects,
    parse_image_caption_json_response,
    repair_json_like_text,
    trim_incomplete_json_tail,
    _next_json_token,
)
from markdown_latex_utils import (
    IMAGE_LINK_DISPLAY_SIZE,
    build_context_bookmark,
    extract_outline,
    extract_used_heading_keys,
    extract_used_section_titles,
    format_markdown_image_link,
    has_fun_fact_section,
    has_mastery_or_quiz_section,
    has_more_marker,
    normalize_heading_key,
    normalize_image_link_alt_text,
    normalize_latex_math_syntax,
    normalize_markdown_image_link_sizes,
    normalize_markdown_separators,
    normalize_markdown_tables,
    split_markdown_sections,
    strip_secondary_sections_for_llm,
    strip_more_markers,
    strip_prompt_control_artifacts,
    strip_summary_restart_artifacts,
    trim_chunk_boundary_overlap,
)
from audio_processing import (
    build_audio_cleanup_filter,
    create_mp3_file,
    get_media_duration_seconds,
    split_audio_for_gemini_stt,
    split_audio_for_groq_stt,
    _split_pcm16_mono_wav,
)

class TaskCancelledError(Exception):
    pass

def sleep_with_cancel(seconds, cancel_check=None, interval=0.2):
    remaining = max(float(seconds), 0.0)
    while remaining > 0:
        if cancel_check is not None:
            cancel_check()
        wait_seconds = min(interval, remaining)
        time.sleep(wait_seconds)
        remaining -= wait_seconds

def run_subprocess_with_cancel(
    cmd,
    *,
    cancel_event=None,
    check=True,
    capture_output=False,
    text=False,
    encoding=None,
    errors=None,
    creationflags=CREATE_NO_WINDOW,
):
    popen_kwargs = {"creationflags": creationflags}
    if capture_output:
        popen_kwargs["stdout"] = subprocess.PIPE
        popen_kwargs["stderr"] = subprocess.PIPE
        popen_kwargs["text"] = text
        # Windows locale (cp949) decoding of UTF-8 child output crashes the
        # pipe reader thread, so callers can force utf-8 with replacement.
        if encoding is not None:
            popen_kwargs["encoding"] = encoding
            popen_kwargs["errors"] = errors or "replace"
    process = subprocess.Popen(cmd, **popen_kwargs)
    stdout = None
    stderr = None
    try:
        if capture_output:
            while True:
                if cancel_event is not None and cancel_event.is_set():
                    process.terminate()
                    try:
                        stdout, stderr = process.communicate(timeout=3)
                    except Exception:
                        process.kill()
                        stdout, stderr = process.communicate()
                    raise TaskCancelledError("사용자 요청으로 현재 작업이 취소되었습니다.")
                try:
                    stdout, stderr = process.communicate(timeout=0.2)
                    break
                except subprocess.TimeoutExpired:
                    continue
        else:
            while process.poll() is None:
                if cancel_event is not None and cancel_event.is_set():
                    process.terminate()
                    try:
                        process.wait(timeout=3)
                    except Exception:
                        process.kill()
                        process.wait()
                    raise TaskCancelledError("사용자 요청으로 현재 작업이 취소되었습니다.")
                time.sleep(0.2)
        completed = subprocess.CompletedProcess(cmd, process.returncode, stdout, stderr)
        if check and completed.returncode != 0:
            raise subprocess.CalledProcessError(completed.returncode, cmd, output=stdout, stderr=stderr)
        return completed
    finally:
        try:
            if process.poll() is None:
                process.kill()
                process.wait()
        except Exception:
            pass


def resolve_whisper_cpp_model_filename(model_name):
    normalized = str(model_name or "large-v3-turbo-q5_0").strip()
    if not normalized:
        normalized = "large-v3-turbo-q5_0"
    if normalized.startswith("ggml-") and normalized.endswith(".bin"):
        return normalized
    if normalized in ("large-v3-fp16", "large-v3"):
        return "ggml-large-v3.bin"
    if normalized in ("large-v3-turbo-fp16", "large-v3-turbo"):
        return "ggml-large-v3-turbo.bin"
    if normalized == "large-v3-turbo-q8_0":
        return "ggml-large-v3-turbo-q8_0.bin"
    return f"ggml-{normalized}.bin"

def whisper_cpp_managed_model_id(model_name):
    require_whisper_cpp_model(model_name)
    return f"whispercpp-{str(model_name).strip()}"

def whisper_cpp_model_status(model_name):
    require_local_stt_provider("Local (whisper.cpp Vulkan)")
    require_whisper_cpp_model(model_name)
    policy = str(load_edition_manifest()["packaging"].get("local_stt_policy", "excluded"))
    if policy == "downloadable-whisper-cpp-vulkan-models":
        return {"bundled": False, **get_model_manager().status(whisper_cpp_managed_model_id(model_name))}
    model_filename = resolve_whisper_cpp_model_filename(model_name)
    model_path = os.path.join(WHISPER_CPP_MODEL_DIR, model_filename)
    ready = os.path.isfile(model_path) and os.path.getsize(model_path) > 0
    bundled_status = {
        "bundled": True,
        "model_id": str(model_name),
        "ready": ready,
        "installed": ready,
        "download_required": False,
        "file_size": os.path.getsize(model_path) if ready else 0,
        "install_path": WHISPER_CPP_MODEL_DIR if ready else "",
    }
    if ready or policy != "audited-whisper-cpp-vulkan-bundle-required":
        return bundled_status
    # Commercial bundles remain the primary source. If a user removes a
    # bundled model after installation, use the same pinned manifest store as
    # the downloadable editions to repair that one model without rebuilding.
    return {"bundled": False, **get_model_manager().status(whisper_cpp_managed_model_id(model_name))}

def install_whisper_cpp_model(model_name, confirmed=False, emit=None, cancel_check=None):
    require_local_stt_provider("Local (whisper.cpp Vulkan)")
    require_whisper_cpp_model(model_name)
    if confirmed is not True:
        raise ValueError("Whisper 모델 다운로드는 사용자 확인 후에만 실행할 수 있습니다.")
    policy = str(load_edition_manifest()["packaging"].get("local_stt_policy", "excluded"))
    if policy not in {
        "downloadable-whisper-cpp-vulkan-models",
        "audited-whisper-cpp-vulkan-bundle-required",
    }:
        raise RuntimeError("이 배포판은 Whisper 모델을 패키지에 포함하므로 다운로드하지 않습니다.")
    return {
        "bundled": False,
        **get_model_manager().install(
            whisper_cpp_managed_model_id(model_name),
            progress=emit,
            cancel_check=cancel_check,
        ),
    }

def _restore_or_download_whisper_cpp_vulkan(target_dir=None, log_list=None, cancel_check=None):
    if target_dir is None:
        target_dir = WHISPER_CPP_TOOL_DIR
    exe_path = os.path.join(target_dir, "whisper-cli.exe")
    if os.path.exists(exe_path):
        return exe_path

    os.makedirs(target_dir, exist_ok=True)

    # 1. 로컬에 이미 설치된 AILS 또는 dist 빌드 결과물에서 복원 시도
    local_candidates = []
    local_app_data = os.environ.get("LOCALAPPDATA", "")
    if local_app_data:
        local_candidates.append(
            os.path.join(local_app_data, "Programs", "AILS", "resources", "backend", "AILSBackend", "tools", "whispercpp-vulkan")
        )
    dist_dir = os.path.join(BASE_EXE_DIR, "dist")
    if os.path.isdir(dist_dir):
        try:
            for entry in os.listdir(dist_dir):
                candidate = os.path.join(dist_dir, entry, "win-unpacked", "resources", "backend", "AILSBackend", "tools", "whispercpp-vulkan")
                local_candidates.append(candidate)
        except Exception:
            pass

    for candidate in local_candidates:
        candidate_exe = os.path.join(candidate, "whisper-cli.exe")
        if os.path.isfile(candidate_exe):
            append_status_log(log_list, "로컬 AILS 설치본에서 whisper.cpp Vulkan 런타임을 동기화합니다.")
            import shutil
            try:
                for item in os.listdir(candidate):
                    s = os.path.join(candidate, item)
                    d = os.path.join(target_dir, item)
                    if os.path.isfile(s):
                        shutil.copy2(s, d)
                if os.path.exists(exe_path):
                    append_status_log(log_list, "whisper.cpp Vulkan 런타임 로컬 동기화 완료")
                    return exe_path
            except Exception as copy_err:
                append_status_log(log_list, f"로컬 동기화 시도 중 오류: {copy_err}")

    # 2. 원격 다운로드 시도 (Hugging Face / 환경변수 지정 URL)
    download_urls = []
    custom_url = os.environ.get("AILS_WHISPER_CPP_VULKAN_URL", "").strip()
    if custom_url:
        download_urls.append(custom_url)

    download_urls.extend([
        "https://huggingface.co/beraCompany/AILS-tools/resolve/main/whispercpp-vulkan.zip",
        "https://huggingface.co/datasets/beraCompany/AILS-tools/resolve/main/whispercpp-vulkan.zip",
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/whisper-bin-vulkan-x64.zip",
    ])

    import zipfile
    import tempfile
    for url in download_urls:
        try:
            append_status_log(log_list, f"whisper.cpp Vulkan 런타임 다운로드 시도: {url}")
            with tempfile.TemporaryDirectory() as tmp_dir:
                zip_path = os.path.join(tmp_dir, "whispercpp-vulkan.zip")
                download_file_with_progress(
                    url,
                    zip_path,
                    log_list=log_list,
                    label="whisper.cpp Vulkan 런타임",
                    cancel_check=cancel_check,
                )
                if os.path.isfile(zip_path) and os.path.getsize(zip_path) > 0:
                    with zipfile.ZipFile(zip_path, "r") as archive:
                        archive.extractall(target_dir)
                    if os.path.exists(exe_path):
                        append_status_log(log_list, "whisper.cpp Vulkan 런타임 다운로드 및 설치 완료")
                        return exe_path
        except Exception as e:
            append_status_log(log_list, f"다운로드 실패 ({url}): {e}")
            continue

    if not os.path.exists(exe_path):
        raise RuntimeError(
            "패키지에 whisper.cpp Vulkan 실행 파일이 없습니다. AILS를 다시 설치하거나 업데이트해 주세요."
        )
    return exe_path


def ensure_whisper_cpp_vulkan_runtime(model_name="large-v3-turbo-q5_0", log_list=None, cancel_check=None):
    require_local_stt_provider("Local (whisper.cpp Vulkan)")
    require_whisper_cpp_model(model_name)
    exe_path = os.path.join(WHISPER_CPP_TOOL_DIR, "whisper-cli.exe")
    if not os.path.exists(exe_path):
        exe_path = _restore_or_download_whisper_cpp_vulkan(
            target_dir=WHISPER_CPP_TOOL_DIR,
            log_list=log_list,
            cancel_check=cancel_check,
        )

    model_filename = resolve_whisper_cpp_model_filename(model_name)
    policy = str(load_edition_manifest()["packaging"].get("local_stt_policy", "excluded"))
    if policy == "downloadable-whisper-cpp-vulkan-models":
        try:
            model_root = get_model_manager().resolve(whisper_cpp_managed_model_id(model_name))
        except ModelUnavailableError:
            install_whisper_cpp_model(model_name, confirmed=True, cancel_check=cancel_check)
            model_root = get_model_manager().resolve(whisper_cpp_managed_model_id(model_name))
        model_path = str(model_root / model_filename)
    else:
        model_path = os.path.join(WHISPER_CPP_MODEL_DIR, model_filename)
        if not os.path.exists(model_path) or os.path.getsize(model_path) == 0:
            try:
                model_root = get_model_manager().resolve(whisper_cpp_managed_model_id(model_name))
            except ModelUnavailableError:
                pass
            else:
                model_path = str(model_root / model_filename)
    if not os.path.exists(model_path) or os.path.getsize(model_path) == 0:
        raise RuntimeError(
            f"whisper.cpp 모델이 없습니다: {model_filename}."
        )

    return exe_path, model_path, model_filename


def validate_whisper_cpp_vulkan_runtime(model_name="large-v3-turbo-q5_0"):
    exe_path, model_path, model_filename = ensure_whisper_cpp_vulkan_runtime(model_name)
    return {
        "provider": "Local (whisper.cpp Vulkan)",
        "model_id": str(model_name),
        "model_file": model_filename,
        "executable": exe_path,
        "model_path": model_path,
        "execution_provider": "Vulkan preferred",
        "cpu_fallback": True,
    }

def ensure_faster_whisper_runtime():
    require_local_stt_provider("Local (faster-whisper)")
    global WhisperModel
    if WhisperModel is None:
        if canonical_edition_id() == "commercial":
            raise RuntimeError(
                "The approved packaged faster-whisper runtime is missing or failed to load. "
                "Commercial runtime installation is disabled."
            )
        if messagebox.askyesno("라이브러리 설치", "로컬 faster-whisper STT를 위해 필수 라이브러리가 필요합니다. 설치할까요?"):
            try:
                install_faster_whisper_dependencies()
                WhisperModel = load_faster_whisper_model_class()
                messagebox.showinfo("성공", "faster-whisper 설치가 완료되었습니다. 현재 작업을 계속 진행합니다.")
            except Exception as error:
                messagebox.showerror("오류", f"설치 실패: {error}")
                raise RuntimeError(f"faster-whisper 라이브러리를 찾을 수 없습니다: {error}") from error
        else:
            raise RuntimeError("faster-whisper 라이브러리를 찾을 수 없습니다.")
    return True

def get_faster_whisper_runtime_label():
    if not _CURRENT_FW_BACKEND_LABEL:
        return "UNKNOWN"
    return f"{_CURRENT_FW_BACKEND_LABEL} (device={_CURRENT_FW_DEVICE}, compute_type={_CURRENT_FW_COMPUTE_TYPE})"

def get_faster_whisper_runtime_device():
    return _CURRENT_FW_DEVICE

def get_faster_whisper_init_note():
    return _CURRENT_FW_INIT_NOTE

def get_faster_whisper_model(model_size="base"):
    global _FW_WHISPER_MODEL, _CURRENT_FW_SIZE, _CURRENT_FW_DEVICE, _CURRENT_FW_COMPUTE_TYPE, _CURRENT_FW_BACKEND_LABEL, _CURRENT_FW_INIT_NOTE
    ensure_faster_whisper_runtime()
    if canonical_edition_id() == "commercial":
        require_faster_whisper_model(model_size)

    if _FW_WHISPER_MODEL is not None and _CURRENT_FW_SIZE == model_size:
        return _FW_WHISPER_MODEL

    acceleration = str(
        load_edition_manifest()["packaging"].get("faster_whisper_acceleration", "developer-auto")
    )
    init_attempts = (
        [("cpu", "int8", "CPU (approved commercial runtime)")]
        if acceleration == "cpu-only"
        else [("auto", "float16", "AUTO"), ("cpu", "int8", "CPU")]
    )
    last_error = None
    auto_error = None
    for device, compute_type, backend_label in init_attempts:
        try:
            model_source = resolve_faster_whisper_model_source(model_size)
            model = WhisperModel(model_source, device=device, compute_type=compute_type)
            _FW_WHISPER_MODEL = model
            _CURRENT_FW_SIZE = model_size
            _CURRENT_FW_DEVICE = device
            _CURRENT_FW_COMPUTE_TYPE = compute_type
            _CURRENT_FW_BACKEND_LABEL = backend_label
            if device == "cpu" and auto_error is not None:
                _CURRENT_FW_INIT_NOTE = f"auto 백엔드 사용 불가로 CPU로 폴백: {auto_error}"
            else:
                _CURRENT_FW_INIT_NOTE = None
            return model
        except Exception as error:
            last_error = error
            if device == "auto":
                auto_error = error
    raise RuntimeError(f"faster-whisper 모델 초기화 실패: {last_error}") from last_error

def fetch_available_groq_models(api_key, base_url):
    if not api_key:
        raise RuntimeError("Groq API Key가 필요합니다.")
    endpoint = build_openai_models_endpoint(base_url, GROQ_DEFAULT_MODELS_ENDPOINT)
    response = requests.get(
        endpoint,
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=30,
    )
    response.raise_for_status()
    payload = response.json()
    models = []
    for item in payload.get("data", []):
        model_id = item.get("id")
        if model_id:
            models.append(model_id)
    return sorted(set(models))

def fetch_available_groq_text_models(api_key, base_url):
    models = fetch_available_groq_models(api_key, base_url)
    filtered = [
        model_id for model_id in models
        if "whisper" not in model_id.lower()
    ]
    return filtered or [GROQ_DEFAULT_SUMMARY_MODEL]

def fetch_available_groq_vision_models(api_key, base_url):
    models = fetch_available_groq_models(api_key, base_url)
    filtered = [
        model_id for model_id in models
        if any(token in model_id.lower() for token in ("vision", "vl", "scout", "maverick"))
    ]
    return filtered or [GROQ_DEFAULT_IMAGE_MODEL]

def fetch_available_groq_stt_models(api_key, base_url):
    models = fetch_available_groq_models(api_key, base_url)
    filtered = [
        model_id for model_id in models
        if "whisper" in model_id.lower()
    ]
    return filtered or [GROQ_DEFAULT_STT_MODEL]

def fetch_available_lmstudio_models(api_key, base_url, default_models=None):
    endpoint = build_openai_models_endpoint(base_url or LMSTUDIO_DEFAULT_BASE_URL, LMSTUDIO_DEFAULT_MODELS_ENDPOINT)
    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    response = requests.get(endpoint, headers=headers, timeout=30)
    response.raise_for_status()
    payload = response.json()
    models = []
    for item in payload.get("data", []):
        model_id = str(item.get("id", "")).strip()
        if model_id:
            models.append(model_id)
    unique_models = sorted(set(models))
    if unique_models:
        return unique_models
    if default_models:
        return list(default_models)
    raise RuntimeError("LM Studio에서 사용 가능한 모델을 찾지 못했습니다.")

def build_image_data_url(image_path):
    extension = os.path.splitext(image_path)[1].lower()
    mime_type = "image/png" if extension == ".png" else "image/jpeg"
    with open(image_path, "rb") as image_file:
        encoded = base64.b64encode(image_file.read()).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"

from chat.openai_chat_client import (
    _strip_surrogates,
    _sanitize_messages,
    _debug_trace_messages,
    extract_response_body_preview,
    log_openai_compat_response_diagnostics,
    describe_openai_compat_retry_reason,
    call_openai_compatible_chat,
)

def safe_remove(file_path):
    if os.path.exists(file_path):
        for _ in range(5):
            try:
                os.remove(file_path)
                return True
            except Exception: time.sleep(1)
    return False

def safe_rmtree(path):
    if os.path.exists(path):
        for _ in range(3):
            try:
                shutil.rmtree(path, ignore_errors=True)
                if not os.path.exists(path): return
                time.sleep(0.5)
            except Exception: pass

def reset_generated_dir(path):
    safe_rmtree(path)
    os.makedirs(path, exist_ok=True)

def download_segment(url, path, cancel_event=None):
    try:
        res = requests.get(url, stream=True, timeout=15)
        if res.status_code == 200:
            with open(path, 'wb') as f:
                for chunk in res.iter_content(1024 * 1024):
                    if cancel_event is not None and cancel_event.is_set():
                        safe_remove(path)
                        return None
                    if chunk:
                        f.write(chunk)
            return path
    except Exception: pass
    return None

def split_text(text, limit=CHUNK_SIZE):
    sentences = re.split(r'(?<=[.?!])\s+', text)
    chunks = []
    curr = ""
    for s in sentences:
        s = s.strip()
        if not s:
            continue
        if len(s) > limit:
            if curr:
                chunks.append(curr.strip())
                curr = ""
            for start in range(0, len(s), limit):
                piece = s[start:start + limit].strip()
                if piece:
                    chunks.append(piece)
            continue
        next_len = len(curr) + len(s) + (1 if curr else 0)
        if curr and next_len > limit:
            chunks.append(curr.strip())
            curr = s
        else:
            curr = f"{curr} {s}".strip() if curr else s
    if curr:
        chunks.append(curr.strip())
    return chunks

def safe_float(value, default=0.0):
    try:
        return float(value)
    except Exception:
        return default

def normalize_compact_text(text):
    return re.sub(r"\s+", " ", str(text or "")).strip()

def split_chunk_into_source_units(text, max_chars=220):
    raw_text = str(text or "").strip()
    if not raw_text:
        return []

    seed_parts = re.split(r'(?<=[.!?。！？])\s+|\n+', raw_text)
    normalized_parts = [normalize_compact_text(part) for part in seed_parts if normalize_compact_text(part)]
    if not normalized_parts:
        normalized_parts = [normalize_compact_text(raw_text)]

    units = []
    current = ""

    def flush_current():
        nonlocal current
        if current:
            units.append(current)
            current = ""

    def append_with_fallback(segment_text):
        segment_text = normalize_compact_text(segment_text)
        if not segment_text:
            return
        if len(segment_text) <= max_chars:
            units.append(segment_text)
            return

        words = segment_text.split(" ")
        chunk = ""
        for word in words:
            projected = f"{chunk} {word}".strip() if chunk else word
            if chunk and len(projected) > max_chars:
                units.append(chunk)
                chunk = word
            else:
                chunk = projected
        if chunk:
            if len(chunk) <= max_chars:
                units.append(chunk)
            else:
                for start in range(0, len(chunk), max_chars):
                    piece = chunk[start:start + max_chars].strip()
                    if piece:
                        units.append(piece)

    for part in normalized_parts:
        projected = f"{current} {part}".strip() if current else part
        if current and len(projected) > max_chars:
            flush_current()
            if len(part) > max_chars:
                append_with_fallback(part)
            else:
                current = part
        else:
            current = projected

    flush_current()
    return units

def format_source_units_block(source_units, start_index=1):
    lines = []
    for offset, unit in enumerate(source_units or [], start=start_index):
        lines.append(f"[S{offset:03d}] {normalize_compact_text(unit)}")
    return "\n".join(lines).strip()

def strip_source_progress_markers(text):
    cleaned_lines = []
    for raw_line in str(text or "").splitlines():
        if re.match(r'^\s*LAST_SOURCE_ID\s*=\s*S\d+\s*(?:\[MORE\])?\s*$', raw_line.strip(), flags=re.IGNORECASE):
            continue
        cleaned_lines.append(raw_line)
    return "\n".join(cleaned_lines).strip()

def extract_last_source_id(text):
    matches = re.findall(r'LAST_SOURCE_ID\s*=\s*(S\d+)', str(text or ""), flags=re.IGNORECASE)
    if not matches:
        return ""
    return matches[-1].upper()

def get_next_source_start_index(last_source_id, total_units):
    if not last_source_id:
        return None
    match = re.search(r'S(\d+)', str(last_source_id or ""), flags=re.IGNORECASE)
    if not match:
        return None
    consumed_index = int(match.group(1))
    if consumed_index < 1:
        return None
    next_index = consumed_index + 1
    if next_index > max(int(total_units or 0), 0):
        return max(int(total_units or 0), 0) + 1
    return next_index

def format_timestamp_hms(seconds):
    total_seconds = max(0, int(round(safe_float(seconds, 0.0))))
    hours, remainder = divmod(total_seconds, 3600)
    minutes, secs = divmod(remainder, 60)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"

def format_timestamp_range(start_seconds, end_seconds):
    start_value = max(0.0, safe_float(start_seconds, 0.0))
    end_value = max(start_value, safe_float(end_seconds, start_value))
    if abs(end_value - start_value) < 1.0:
        return format_timestamp_hms(start_value)
    return f"{format_timestamp_hms(start_value)}~{format_timestamp_hms(end_value)}"

def slide_sort_key(image_name):
    match = re.search(r"(\d+)", str(image_name or ""))
    return int(match.group(1)) if match else 10**9

def normalize_timed_utterances(utterances, transcript_text="", total_duration_seconds=0.0):
    normalized = []
    for raw_item in utterances or []:
        if isinstance(raw_item, str):
            text = normalize_compact_text(raw_item)
            item = {}
        else:
            item = dict(raw_item or {})
            text = normalize_compact_text(item.get("text", ""))
        if not text:
            continue
        start_time = max(0.0, safe_float(item.get("start"), 0.0))
        end_time = max(start_time, safe_float(item.get("end"), start_time))
        normalized_item = {
            "start": start_time,
            "end": end_time,
            "text": text,
            "speaker": normalize_compact_text(item.get("speaker", "")),
        }
        if item.get("source_id"):
            normalized_item["source_id"] = str(item["source_id"])
        normalized.append(normalized_item)

    if not normalized:
        return []

    normalized.sort(key=lambda item: (item["start"], item["end"], item["text"]))
    if not normalized:
        return []

    default_span = max(1.0, max(0.0, safe_float(total_duration_seconds, 0.0)) / max(len(normalized), 1))
    for index, item in enumerate(normalized):
        next_start = normalized[index + 1]["start"] if index + 1 < len(normalized) else max(
            item["end"],
            safe_float(total_duration_seconds, item["end"])
        )
        if item["end"] <= item["start"] and not item.get("source_id"):
            item["end"] = next_start if next_start > item["start"] else item["start"] + default_span

    if total_duration_seconds and not normalized[-1].get("source_id") and normalized[-1]["end"] < total_duration_seconds:
        normalized[-1]["end"] = safe_float(total_duration_seconds, normalized[-1]["end"])
    return normalized


def build_timed_source_records(utterances, total_duration_seconds=0.0):
    """Normalize valid STT timing once, then assign one stable ID per utterance."""
    valid = []
    for item in utterances or []:
        if not isinstance(item, dict):
            continue
        start, end = item.get("start"), item.get("end")
        text = normalize_compact_text(item.get("text"))
        if (not text or isinstance(start, bool) or isinstance(end, bool)
                or not isinstance(start, (int, float)) or not isinstance(end, (int, float))
                or not math.isfinite(start) or not math.isfinite(end)
                or start < 0 or end < start):
            continue
        valid.append({"start": start, "end": end, "text": text,
                      "speaker": normalize_compact_text(item.get("speaker", ""))})
    return [{"source_id": f"T{index:04d}", **item}
            for index, item in enumerate(
                normalize_timed_utterances(valid, total_duration_seconds=total_duration_seconds), start=1
            )]

def strip_leading_timestamp_text(text):
    cleaned = normalize_compact_text(text)
    if not cleaned:
        return ""
    patterns = [
        r"^\[\s*\d{1,2}:\d{2}(?::\d{2})?\s*[-~]\s*\d{1,2}:\d{2}(?::\d{2})?\s*\]\s*[:\-]?\s*",
        r"^\d{1,2}:\d{2}(?::\d{2})?\s*[-~]\s*\d{1,2}:\d{2}(?::\d{2})?\s*[:\-]?\s*",
        r"^\[\s*\d{1,2}:\d{2}(?::\d{2})?\s*\]\s*[:\-]?\s*",
        r"^\d{1,2}:\d{2}(?::\d{2})?\s*[:\-]?\s*",
    ]
    previous = None
    while cleaned and cleaned != previous:
        previous = cleaned
        for pattern in patterns:
            cleaned = re.sub(pattern, "", cleaned).strip()
    return normalize_compact_text(cleaned)


def collapse_exact_repeated_whole_text(text, max_repetitions=8, min_block_chars=500):
    compact = normalize_compact_text(text)
    if not compact:
        return "", 1

    for repetitions in range(max(2, int(max_repetitions)), 1, -1):
        payload_chars = len(compact) - (repetitions - 1)
        if payload_chars <= 0 or payload_chars % repetitions:
            continue
        block_chars = payload_chars // repetitions
        if block_chars < max(1, int(min_block_chars)):
            continue
        block = compact[:block_chars]
        if " ".join([block] * repetitions) == compact:
            return block, repetitions
    return compact, 1


def collapse_exact_repeated_utterance_blocks(utterances, max_repetitions=8, min_block_chars=500):
    source_items = list(utterances or [])
    if not source_items:
        return source_items, 1
    normalized_texts = [
        normalize_compact_text(
            item.get("text", "") if isinstance(item, dict) else item
        )
        for item in source_items
    ]
    if any(not text for text in normalized_texts):
        return source_items, 1

    for repetitions in range(max(2, int(max_repetitions)), 1, -1):
        if len(source_items) % repetitions:
            continue
        block_size = len(source_items) // repetitions
        first_block = normalized_texts[:block_size]
        if len(" ".join(first_block)) < max(1, int(min_block_chars)):
            continue
        # A run of identical utterances can be legitimate speech. Collapse only
        # a repeated multi-utterance view, such as a provider returning the same
        # timestamped transcript representation more than once.
        if len(set(first_block)) < 2:
            continue
        if first_block * repetitions == normalized_texts:
            return source_items[:block_size], repetitions
    return source_items, 1


def build_summary_transcript_text(
    transcript_text="",
    utterances=None,
    total_duration_seconds=0.0,
    collapse_repetitions=True,
):
    fallback_units = []
    for raw_line in re.split(r"[\r\n]+", str(transcript_text or "")):
        cleaned = strip_leading_timestamp_text(raw_line)
        if cleaned:
            fallback_units.append(cleaned)
    compact = normalize_compact_text(" ".join(fallback_units))
    if not collapse_repetitions:
        return compact
    collapsed, _repetitions = collapse_exact_repeated_whole_text(compact)
    return collapsed

def render_timed_transcript_for_prompt(utterances):
    lines = []
    for item in utterances or []:
        prefix = format_timestamp_hms(item.get("start", 0.0))
        speaker = normalize_compact_text(item.get("speaker", ""))
        body = item.get("text", "")
        if speaker:
            lines.append(f"[{prefix}] {speaker}: {body}")
        else:
            lines.append(f"[{prefix}] {body}")
    return "\n".join(lines).strip()

def build_segment_record(utterances):
    normalized_items = normalize_timed_utterances(utterances)
    if not normalized_items:
        return {
            "utterances": [],
            "start": 0.0,
            "end": 0.0,
            "plain_text": "",
            "prompt_text": "",
        }
    return {
        "utterances": normalized_items,
        "start": normalized_items[0]["start"],
        "end": normalized_items[-1]["end"],
        "plain_text": "\n\n".join(item["text"] for item in normalized_items).strip(),
        "prompt_text": render_timed_transcript_for_prompt(normalized_items),
    }

def looks_like_topic_transition(text):
    compact = normalize_compact_text(text)
    if not compact:
        return False
    transition_markers = (
        "이제 ",
        "다음",
        "그 다음",
        "넘어가",
        "정리하",
        "마지막으로",
        "첫 번째",
        "두 번째",
        "세 번째",
        "네 번째",
    )
    return any(marker in compact for marker in transition_markers)

def build_semantic_segments(utterances):
    normalized = normalize_timed_utterances(utterances)
    if not normalized:
        return []

    segments = []
    current_items = []
    current_chars = 0

    for item in normalized:
        item_chars = len(item["text"])
        gap_seconds = item["start"] - current_items[-1]["end"] if current_items else 0.0
        projected_chars = current_chars + item_chars + (2 if current_items else 0)
        should_split = False

        if current_items:
            if gap_seconds >= SEGMENT_GAP_SPLIT_SECONDS and current_chars >= SEGMENT_MIN_CHARS:
                should_split = True
            elif projected_chars >= SEGMENT_MAX_CHARS:
                should_split = True
            elif projected_chars >= SEGMENT_TARGET_CHARS and looks_like_topic_transition(item["text"]):
                should_split = True

        if should_split:
            segments.append(build_segment_record(current_items))
            current_items = []
            current_chars = 0

        current_items.append(item)
        current_chars += item_chars + (2 if current_items else 0)

    if current_items:
        segments.append(build_segment_record(current_items))

    merged_segments = []
    for segment in segments:
        if merged_segments and len(segment["prompt_text"]) < SEGMENT_MIN_CHARS // 2:
            previous = merged_segments.pop()
            merged_segments.append(build_segment_record(previous["utterances"] + segment["utterances"]))
        else:
            merged_segments.append(segment)

    while len(merged_segments) >= 2 and len(merged_segments[-1]["prompt_text"]) < SEGMENT_MIN_CHARS // 2:
        tail = merged_segments.pop()
        merged_segments[-1] = build_segment_record(merged_segments[-1]["utterances"] + tail["utterances"])

    return merged_segments

def build_timed_summary_chunks(
    transcript_text="",
    utterances=None,
    total_duration_seconds=0.0,
    limit=CHUNK_SIZE,
    one_shot_max_input_tokens=SUMMARY_ONE_SHOT_MAX_INPUT_TOKENS,
):
    collapsed_utterances, _utterance_repetitions = (
        (list(utterances), 1) if utterances and all(
            isinstance(item, dict) and item.get("source_id") for item in utterances
        ) else collapse_exact_repeated_utterance_blocks(utterances)
    )
    normalized_utterances = normalize_timed_utterances(
        collapsed_utterances,
        transcript_text,
        total_duration_seconds,
    )
    if normalized_utterances:
        one_shot_record = build_segment_record(normalized_utterances)
        one_shot_text = str(one_shot_record.get("prompt_text") or "").strip()
        if (
            one_shot_max_input_tokens > 0
            and one_shot_text
            and not summary_prompt_exceeds_input_budget(one_shot_text, one_shot_max_input_tokens)
        ):
            return [{
                "text": one_shot_text,
                "plain_text": str(one_shot_record.get("plain_text") or one_shot_text).strip(),
                "start": safe_float(one_shot_record.get("start"), 0.0),
                "end": safe_float(one_shot_record.get("end"), safe_float(one_shot_record.get("start"), 0.0)),
                "timed": True,
                "utterances": list(one_shot_record.get("utterances") or []),
                "one_shot": True,
                "estimated_input_tokens": estimate_token_count(one_shot_text),
            }]
        if one_shot_max_input_tokens > 0 and len(normalized_utterances) > 1:
            midpoint = len(normalized_utterances) // 2
            return [chunk for part in (normalized_utterances[:midpoint], normalized_utterances[midpoint:])
                    for chunk in build_timed_summary_chunks(utterances=part,
                        total_duration_seconds=total_duration_seconds,
                        one_shot_max_input_tokens=one_shot_max_input_tokens)]

    fallback_text = build_summary_transcript_text(
        transcript_text,
        collapsed_utterances,
        total_duration_seconds,
        collapse_repetitions=one_shot_max_input_tokens > 0,
    )
    if (
        not normalized_utterances
        and one_shot_max_input_tokens > 0
        and fallback_text
        and not summary_prompt_exceeds_input_budget(fallback_text, one_shot_max_input_tokens)
    ):
        return [{
            "text": fallback_text,
            "plain_text": fallback_text,
            "start": None,
            "end": None,
            "timed": False,
            "one_shot": True,
            "estimated_input_tokens": estimate_token_count(fallback_text),
        }]

    segments = build_semantic_segments(normalized_utterances)
    if segments:
        chunks = []
        for segment in segments:
            prompt_text = str(segment.get("prompt_text") or segment.get("plain_text") or "").strip()
            if not prompt_text:
                continue
            chunks.append({
                "text": prompt_text,
                "plain_text": str(segment.get("plain_text") or prompt_text).strip(),
                "start": safe_float(segment.get("start"), 0.0),
                "end": safe_float(segment.get("end"), safe_float(segment.get("start"), 0.0)),
                "timed": True,
                "utterances": list(segment.get("utterances") or []),
            })
        if chunks:
            return chunks

    return [
        {
            "text": chunk,
            "plain_text": chunk,
            "start": None,
            "end": None,
            "timed": False,
        }
        for chunk in split_text(fallback_text, limit=limit)
    ]

def summarize_timed_chunk_range(chunk):
    if not isinstance(chunk, dict) or not chunk.get("timed"):
        return ""
    return format_timestamp_range(chunk.get("start", 0.0), chunk.get("end", 0.0))

def split_timed_summary_chunk(chunk):
    if not isinstance(chunk, dict) or not chunk.get("timed"):
        return []
    utterances = list(chunk.get("utterances") or [])
    if len(utterances) < 2:
        return []
    midpoint = max(1, min(len(utterances) - 1, len(utterances) // 2))
    left = build_segment_record(utterances[:midpoint])
    right = build_segment_record(utterances[midpoint:])
    pieces = []
    for segment in (left, right):
        prompt_text = str(segment.get("prompt_text") or segment.get("plain_text") or "").strip()
        if not prompt_text:
            continue
        pieces.append({
            "text": prompt_text,
            "plain_text": str(segment.get("plain_text") or prompt_text).strip(),
            "start": safe_float(segment.get("start"), 0.0),
            "end": safe_float(segment.get("end"), safe_float(segment.get("start"), 0.0)),
            "timed": True,
            "utterances": list(segment.get("utterances") or []),
        })
    return pieces if len(pieces) == 2 else []


def _load_slide_compare_array(image_path, size):
    import numpy as np
    resampling = getattr(getattr(Image, "Resampling", Image), "BILINEAR")
    with Image.open(image_path) as image_obj:
        resized = image_obj.convert("L").resize(size, resample=resampling)
        return np.asarray(resized, dtype=np.float32)

def is_meaningful_slide_change(previous_image_path, current_image_path, mse_threshold):
    import numpy as np
    try:
        fine_prev = _load_slide_compare_array(previous_image_path, (160, 90))
        fine_curr = _load_slide_compare_array(current_image_path, (160, 90))
        fine_diff = np.abs(fine_prev - fine_curr)
        fine_mse = float(np.mean((fine_prev - fine_curr) ** 2))
        changed_ratio = float(np.mean(fine_diff >= 20.0))

        coarse_prev = _load_slide_compare_array(previous_image_path, (32, 18))
        coarse_curr = _load_slide_compare_array(current_image_path, (32, 18))
        coarse_mse = float(np.mean((coarse_prev - coarse_curr) ** 2))

        if fine_mse <= mse_threshold:
            return False

        if coarse_mse <= max(12.0, mse_threshold * 0.06) and changed_ratio <= 0.30:
            return False

        return True
    except Exception:
        return True


def build_runtime_summary_config(base_config, provider=None, model_name=None):
    cfg = dict(base_config or {})
    selected_provider = provider or cfg.get("summary_provider", PROVIDER_GEMINI)
    selected_model = model_name or cfg.get("summary_model_name", SUMMARY_PRIORITY_LIST[0])
    cfg["summary_provider"] = selected_provider
    cfg["summary_model_name"] = selected_model
    cfg["model_name"] = get_effective_feature_model_name(cfg, "summary", selected_model) or selected_model
    if is_custom_model_option(selected_model):
        return cfg
    if selected_provider == PROVIDER_GROQ:
        cfg["groq_summary_model_name"] = selected_model
    elif selected_provider == PROVIDER_DEEPSEEK:
        cfg["deepseek_summary_model_name"] = selected_model
    elif selected_provider == PROVIDER_LMSTUDIO:
        cfg["lmstudio_summary_model_name"] = selected_model
    return cfg


def strip_secondary_sections_for_llm(content):
    text = str(content or "").strip()
    if not text:
        return ""
    for pattern in (r"\n## 🧠 복습 퀴즈\b", r"\n### Mastery Challenge\b", r"\n## STT 원문\b"):
        parts = re.split(pattern, text, maxsplit=1)
        if len(parts) > 1:
            text = parts[0].rstrip()
    return text



def build_quiz_source_text(content, max_chars=12000):
    sections = split_markdown_sections(content)
    base_text = strip_secondary_sections_for_llm(content)
    if not sections:
        return base_text[:max_chars]

    picked = []
    total_chars = 0
    for section in sections:
        body = section["body"]
        if not body.strip():
            continue
        lines = [line.strip() for line in body.splitlines() if line.strip()]
        priority_lines = []
        fallback_lines = []
        for line in lines:
            if line.startswith("![") or line.startswith("```"):
                continue
            if any(marker in line for marker in ("💡 시험 포인트", "**", "$", "- ", "1)", "2)", "3)", "4)")):
                priority_lines.append(line)
            else:
                fallback_lines.append(line)

        selected_lines = []
        for source in (priority_lines, fallback_lines):
            for line in source:
                if line not in selected_lines:
                    selected_lines.append(line)
                if len(selected_lines) >= 8:
                    break
            if len(selected_lines) >= 8:
                break

        piece = f"{section['title']}\n" + "\n".join(selected_lines[:8])
        piece = piece.strip()
        if not piece:
            continue
        if total_chars and total_chars + len(piece) > max_chars:
            break
        picked.append(piece)
        total_chars += len(piece)

    return "\n\n".join(picked).strip() or base_text[:max_chars]


def build_quiz_generation_prompt(total_count, quiz_source, language="korean", topic_hints=None):
    language = normalize_app_language(language)
    language_name = language_display_name(language)
    language_rule = (
        "모든 문제·보기·정답·해설 텍스트는 한국어로 작성하세요."
        if language == "korean"
        else f"Write every question, option, answer, and explanation text in {language_name}."
    )
    topic_section = ""
    if topic_hints:
        labels = [str(label).strip() for label in topic_hints if str(label).strip()][:100]
        topic_section = (
            "\n[출제 비중 힌트: 사실 근거가 아님]\n"
            + "\n".join(f"- {label}" for label in labels)
            + "\n이 표지는 헷갈린 개념과 관심 주제의 출제 비중에만 사용하세요. "
              "질문, 보기, 정답, 해설의 사실 근거는 아래 핵심 노트에만 두세요.\n"
        )
    return f"""{topic_section}[퀴즈 생성용 핵심 노트]
{quiz_source}

[생성 요청]
위 핵심 노트를 바탕으로 대학생 기말고사 수준의 객관식 퀴즈 {total_count}개를 만들어주세요.
핵심 노트에 없는 세부사항은 추측하지 말고, 핵심 개념과 비교 포인트를 바탕으로 문제를 만드세요.
각 문항에 핵심 노트에서 한 줄을 글자 그대로 발췌한 source_excerpt를 넣으세요.
정답 텍스트는 해당 source_excerpt에 실제로 등장하는 구절이어야 합니다.
정답은 보기 네 개 중 정확히 하나와 글자 그대로 같아야 합니다. 보기와 근거가 불명확한 문항은 만들지 마세요.
{language_rule}
반드시 다음 JSON 배열 형식으로만 응답하세요. (마크다운 백틱 없이 순수 JSON)
[
    {{
        "question": "문제 내용",
        "options": ["보기1", "보기2", "보기3", "보기4"],
        "answer": "정답 텍스트 (번호가 아닌 내용)",
        "explanation": "정답에 대한 해설",
        "source_excerpt": "핵심 노트에서 그대로 복사한 한 줄의 근거 (정답 텍스트 포함)"
    }}
]
"""


def is_gemini_image_key_fallback_error(error):
    message = str(error or "").lower()
    markers = [
        "quota",
        "resource_exhausted",
        "rate limit",
        "rate_limit",
        "too many requests",
        "429",
        "rpm",
        "tpm",
        "retry-after",
        "exceeded your current quota",
    ]
    return any(marker in message for marker in markers) or contains_rate_limit_marker(message)

def call_gemini_image_caption_batch_with_cache(batch, image_dir, config, log_list=None):
    raise ValueError("Personal Gemini API connections are no longer supported.")


def build_missing_final_sections_prompt(chunk, full_md, include_fun_fact, include_mastery):
    raw_chunk = str(chunk or "").strip()
    source_block = ""
    if raw_chunk:
        source_block = format_source_units_block(split_chunk_into_source_units(raw_chunk))
    chunk_reference = raw_chunk
    if source_block:
        chunk_reference = "[하단 SOURCE BLOCK의 SOURCE ID 원문을 참고하세요.]"

    section_order = []
    if include_fun_fact:
        section_order.append("`### 흥미 포인트`")
    if include_mastery:
        section_order.append("`### Mastery Challenge`")
    requested = "와 ".join(section_order) if section_order else "`### Mastery Challenge`"

    instructions = [
        "이미 강의 본문 요약은 작성 완료되었습니다.",
        f"지금부터는 빠진 마지막 섹션인 {requested}만 추가로 작성하세요.",
        "기존 본문을 반복하지 말고, 새 요약 섹션이나 서론을 다시 쓰지 마세요.",
    ]
    if include_fun_fact:
        instructions.append(
            "`### 흥미 포인트`에는 강의 개념과 직접 연결되는 실제 사례, 흑역사, 버그, 현실 비유 중 가장 웃기게 만들 수 있는 포인트 1개를 골라 "
            "쉬는 시간에 피식할 정도로 노골적으로 웃기게, 본문 반복 없이 200자 이내로 작성하세요."
        )
    if include_mastery:
        instructions.append(
            "`### Mastery Challenge`는 최소 5개, 최대 12개의 문제로 작성하세요. "
            "시험에 출제될 가능성이 높은 핵심 개념, 공식, 비교 포인트, 함정이 많을수록 문제 수를 늘리세요. "
            "모든 문제는 객관식으로만 출제하고 주관식·서술형·단답형·빈칸 채우기 문제는 만들지 마세요. "
            "각 문제는 문제 본문과 '(1) 보기' 형식의 번호 보기를 먼저 일반 마크다운으로 쓰고, "
            "정답 보기는 정확히 하나만 포함하세요. 정답 번호 하나와 해설을 각 문제의 바로 밑에 `>[!정답확인]-` 콜아웃으로 숨기세요."
        )
    instructions.extend([
        "출력은 요청된 마지막 섹션만 순서대로 작성하세요.",
        "",
        "[현재 파트 원본 텍스트]",
        chunk_reference,
        "",
        "[이미 작성된 요약 목차]",
        extract_outline(full_md),
        "",
        "[이미 작성된 문서 끝부분]",
        full_md[-3000:],
    ])
    if source_block:
        instructions.extend([
            "",
            "[SOURCE BLOCK BEGIN]",
            source_block,
            "[SOURCE BLOCK END]",
            "",
            "[SOURCE ID 규칙]",
            "- SOURCE BLOCK의 각 줄 `[S###]`는 현재 청크 원문의 SOURCE ID입니다.",
            "- 마지막 줄에 반드시 `LAST_SOURCE_ID=S###` 또는 `LAST_SOURCE_ID=S### [MORE]`를 출력하세요.",
            "- `LAST_SOURCE_ID=...` 줄은 제어용 표시이므로 문서 본문에는 포함하지 말고 마지막 줄에만 두세요.",
        ])
    return "\n".join(instructions).strip()


def normalize_image_links(text, image_dir_name, used_images_set=None, image_link_dir=None):
    current = str(text or "")
    if not current.strip():
        return current

    if image_link_dir:
        normalized_link_dir = str(image_link_dir).replace("\\", "/").rstrip("/")
        correct_prefix = f"{normalized_link_dir}/"
    else:
        correct_prefix = f".images/{image_dir_name}/"
    local_seen = set()

    def mark_used(img_name):
        if used_images_set is not None:
            used_images_set.add(img_name)
        local_seen.add(str(img_name).lower())

    def is_already_used(img_name):
        key = str(img_name).lower()
        if key in local_seen:
            return True
        if used_images_set is None:
            return False
        return key in {str(item).lower() for item in used_images_set}

    def replace_markdown_link(match):
        img_num = match.group(1) or match.group(2)
        img_name = f"slide_{int(img_num):03d}.jpg"
        if is_already_used(img_name):
            return ""
        mark_used(img_name)
        return format_markdown_image_link(f"{correct_prefix}{img_name}")

    markdown_image_pattern = re.compile(
        r"!\[[^\]]*\]\(\s*(?:<[^>\n]*?slide_(\d+)\.jpg>|[^)\n]*?slide_(\d+)\.jpg)\s*\)",
        flags=re.IGNORECASE,
    )

    lines = current.splitlines()
    normalized_lines = []
    in_code_block = False
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("```"):
            in_code_block = not in_code_block
            normalized_lines.append(line)
            continue
        if in_code_block:
            normalized_lines.append(line)
            continue

        replaced, markdown_replacements = markdown_image_pattern.subn(replace_markdown_link, line)
        if markdown_replacements:
            if replaced.strip():
                normalized_lines.append(replaced)
            continue

        malformed_image_match = re.search(r"slide_(\d+)\.jpg", replaced, flags=re.IGNORECASE)
        if stripped.startswith("![") and malformed_image_match:
            img_name = f"slide_{int(malformed_image_match.group(1)):03d}.jpg"
            if is_already_used(img_name):
                continue
            mark_used(img_name)
            normalized_lines.append(format_markdown_image_link(f"{correct_prefix}{img_name}"))
            continue

        plain_match = re.match(
            r"^(\s*)(?:[-*]\s*)?(?:이미지|관련 이미지|슬라이드 이미지)?\s*[:：-]?\s*(slide_(\d+)\.jpg)\s*$",
            replaced,
            flags=re.IGNORECASE,
        )
        if plain_match:
            img_name = plain_match.group(2)
            img_num = plain_match.group(3)
            if is_already_used(img_name):
                continue
            mark_used(img_name)
            replaced = format_markdown_image_link(f"{correct_prefix}slide_{int(img_num):03d}.jpg")
            normalized_lines.append(replaced)
            continue

        image_only_match = re.match(
            r"^\s*!\[[^\]]*\]\(\s*<?(?:[^)>]+/)?(slide_(\d+)\.jpg)>?\s*\)\s*$",
            replaced,
            flags=re.IGNORECASE,
        )
        if image_only_match:
            img_name = image_only_match.group(1)
            img_num = image_only_match.group(2)
            if is_already_used(img_name):
                continue
            mark_used(img_name)
            replaced = format_markdown_image_link(f"{correct_prefix}slide_{int(img_num):03d}.jpg")

        normalized_lines.append(replaced)

    return "\n".join(normalized_lines)


def build_chunk_image_prompt_context(
    image_caps,
    image_link_dir,
    _chunk_index,
    _chunk_count,
    max_images=4,
    summary_provider=None,
    summary_model_name=None,
    excluded_image_names=None,
    return_selected_names=False,
    image_meta=None,
    chunk_start_time=None,
    chunk_end_time=None,
    padding_seconds=0.0,
):
    excluded = {str(name).lower() for name in (excluded_image_names or set())}
    items = [
        (image_name, caption)
        for image_name, caption in (image_caps or {}).items()
        if str(image_name).lower() not in excluded
    ]
    if image_meta and chunk_start_time is not None and chunk_end_time is not None:
        padding_value = max(0.0, safe_float(padding_seconds, 0.0))
        chunk_start = max(0.0, safe_float(chunk_start_time, 0.0) - padding_value)
        chunk_end = max(chunk_start, safe_float(chunk_end_time, chunk_start_time) + padding_value)
        allowed_names = set()
        order_index = {}
        for index, meta in enumerate(image_meta or []):
            if not isinstance(meta, dict):
                continue
            image_name = str(meta.get("image_name", "") or "").strip()
            if not image_name:
                continue
            image_key = image_name.lower()
            order_index[image_key] = index
            meta_start = meta.get("start_time")
            meta_end = meta.get("end_time")
            if meta_start is None and meta_end is None:
                continue
            start_value = safe_float(meta_start, safe_float(meta_end, 0.0))
            end_value = safe_float(meta_end, start_value)
            meta_min = min(start_value, end_value)
            meta_max = max(start_value, end_value)
            if meta_max >= chunk_start and meta_min <= chunk_end:
                allowed_names.add(image_key)
        items = [
            item
            for item in items
            if str(item[0]).lower() in allowed_names
        ]
        items.sort(key=lambda item: order_index.get(str(item[0]).lower(), slide_sort_key(item[0])))
    if not items:
        return ("없음", []) if return_selected_names else "없음"

    if max_images is None:
        selected = items
    else:
        selected = items[: max(0, int(max_images))]

    lines = []
    for image_name, caption in selected:
        lines.append(f"- 파일: {image_name}")
        lines.append(f"  설명: {caption}")
        lines.append(f"  삽입 링크: {format_markdown_image_link(f'{image_link_dir}/{image_name}')}")
    context = "\n".join(lines).strip()
    selected_names = [image_name for image_name, _caption in selected]
    return (context, selected_names) if return_selected_names else context


def _extract_source_units_from_prompt(prompt):
    text = str(prompt or "")
    marker_match = re.search(
        r"\[SOURCE BLOCK BEGIN\]\n(.*?)\n\[SOURCE BLOCK END\]",
        text,
        flags=re.DOTALL,
    )
    source_block = marker_match.group(1).strip() if marker_match else ""
    if not source_block:
        return []

    source_units = []
    for raw_line in source_block.splitlines():
        match = re.match(r"^\[S(\d+)\]\s+(.*)$", raw_line.strip())
        if not match:
            continue
        source_units.append(normalize_compact_text(match.group(2)))
    return source_units

def _replace_source_block_in_prompt(prompt, remaining_source_block):
    replacement = (
        "[SOURCE BLOCK BEGIN]\n"
        f"{remaining_source_block}\n"
        "[SOURCE BLOCK END]"
    )
    return re.sub(
        r"\[SOURCE BLOCK BEGIN\]\n.*?\n\[SOURCE BLOCK END\]",
        replacement,
        str(prompt or ""),
        count=1,
        flags=re.DOTALL,
    )

def strip_mastery_challenge_prompt_rules(prompt):
    current = str(prompt or "")
    if "Mastery Challenge" not in current and "{mastery_instruction}" not in current:
        return current

    filtered_lines = []
    skipping_indented_tail = False
    for line in current.splitlines():
        stripped = line.strip()
        lower = stripped.lower()
        if "mastery challenge" in lower or "{mastery_instruction}" in stripped:
            skipping_indented_tail = True
            continue
        if skipping_indented_tail and (line.startswith(" ") or line.startswith("\t")):
            continue
        skipping_indented_tail = False
        filtered_lines.append(line)
    return "\n".join(filtered_lines)

def build_summary_prompt(template, *, chunk, image_list_str, image_dir, part_info, current_outline, used_section_titles, rolling_summary, bookmark, mastery_instruction, summary_provider=None, summary_model_name=None, content_instruction="", language="korean"):
    prompt_template = str(upgrade_prompt_template(template or BASE_PROMPT_TEMPLATE))
    if not str(mastery_instruction or "").strip():
        prompt_template = prompt_template.replace(MASTERY_CHALLENGE_RULE_BLOCK, "")
        prompt_template = re.sub(
            r"\n?\s*\d+\.\s*[^\n]*\n\{mastery_instruction\}",
            "",
            prompt_template,
        )
        prompt_template = re.sub(
            r"\n?\[[^\]\n]*\]\n\{mastery_instruction\}",
            "",
            prompt_template,
        )
    image_context_value = image_list_str
    has_image_context_for_insertion = bool(str(image_list_str or "").strip()) and str(image_list_str).strip() != "없음"

    raw_chunk = str(chunk or "").strip()
    if re.search(r'^\[S\d+\]\s+', raw_chunk, flags=re.MULTILINE):
        source_block = raw_chunk
    else:
        source_block = format_source_units_block(split_chunk_into_source_units(raw_chunk))
    chunk_value = raw_chunk
    if source_block:
        chunk_value = "[하단 SOURCE BLOCK의 SOURCE ID 원문을 참고하세요.]"
        if has_image_context_for_insertion:
            image_context_value = (
                "아래 캡션 목록은 링크 선택용 참고자료입니다. "
                "캡션만 근거로 새 내용을 만들지 말고, 현재 파트 원문과 직접 관련 있는 이미지 후보가 있을 때만 사용하세요.\n"
                f"{image_context_value}"
            )

    prompt = (
        prompt_template
        .replace("{chunk}", chunk_value)
        .replace("{image_list_str}", image_context_value)
        .replace("{image_dir}", image_dir)
        .replace("{part_info}", part_info)
        .replace("{current_outline}", current_outline)
        .replace("{used_section_titles}", used_section_titles)
        .replace("{rolling_summary}", rolling_summary)
        .replace("{bookmark}", bookmark)
        .replace("{mastery_instruction}", mastery_instruction)
    )
    if not str(mastery_instruction or "").strip():
        prompt = strip_mastery_challenge_prompt_rules(prompt)
    if source_block:
        prompt += (
            "\n\n[SOURCE BLOCK BEGIN]\n"
            f"{source_block}\n"
            "[SOURCE BLOCK END]"
        )
        if has_image_context_for_insertion:
            prompt += (
                "\n\n[이미지 링크 제어]\n"
                "- 상단 이미지 캡션 목록을 참고해, SOURCE BLOCK과 직접 대응되는 이미지가 있을 때만 후보의 `삽입 링크` 한 줄을 관련 문단 바로 아래에 넣으세요.\n"
                "- 캡션 설명 문장은 요약 본문으로 쓰지 마세요.\n"
                "- 대응 관계가 불확실하면 이미지를 넣지 마세요."
            )
        prompt += (
            "\n\n[진행 제어]\n"
            "- SOURCE ID 순서대로 끝까지 확인하고, 새 정보가 있는 SOURCE는 누락 없이 반영하세요.\n"
            "- 본문에는 `SOURCE BLOCK`, `SOURCE ID`, `LAST_SOURCE_ID` 같은 제어 표현을 쓰지 마세요.\n"
            "- 마지막 줄에는 제어용으로만 `LAST_SOURCE_ID=S###`를 출력하세요.\n"
            "- 출력이 길어 끊겨야 할 때만 마지막 줄을 `LAST_SOURCE_ID=S### [MORE]`로 출력하세요."
        )
    if str(content_instruction or "").strip():
        prompt = f"[정리 방식]\n{str(content_instruction).strip()}\n\n{prompt}"
    # The user-editable template stays untouched; the output-language rule is
    # injected at assembly time so existing Korean configs are unaffected.
    directive = language_output_directive(language)
    if directive:
        prompt = f"{prompt}\n\n{directive}"
    return prompt


from web_media_downloader import (
    LMS_BROWSER_CDP_PORT,
    LMS_MEDIA_DISCOVERY_LOCK,
    get_stealth_user_agent,
    get_stealth_headers,
    _extract_browser_executable_from_command,
    _classify_browser_executable,
    _read_windows_default_https_command,
    get_default_browser_info,
    get_lms_browser_info,
    get_lms_browser_profile_dir,
    get_lms_browser_cdp_url,
    get_lms_browser_cdp_ws_url,
    extract_youtube_sources,
    download_youtube_media,
    _collect_media_from_playwright_context,
    _discover_media_with_lms_browser,
    _discover_media_with_lms_browser_unlocked,
    _cookie_header_from_jar,
    _comet_user_data_dir,
    _comet_cookie_paths,
    _load_browser_cookie_attempts,
    browser_cookie_session_available,
    _extract_media_and_page_urls,
    _download_with_ytdlp_options,
    download_authenticated_web_media,
    download_file_with_progress,
)
