import contextlib
from concurrent.futures import ThreadPoolExecutor, as_completed

from ai_compliance import compliance_metadata, require_external_provider_consent

from common import (
    CREATE_NO_WINDOW,
    DEEPGRAM_DEFAULT_MODEL,
    DEEPSEEK_DEFAULT_BASE_URL,
    DEEPSEEK_DEFAULT_MODEL,
    DEFAULT_RATE_LIMIT_WAIT_SCHEDULE,
    DUAL_IMAGE_PROVIDER_OPTIONS,
    FFMPEG_EXE,
    GROQ_DEFAULT_BASE_URL,
    GROQ_DEFAULT_IMAGE_MODEL,
    GROQ_DEFAULT_STT_ENDPOINT,
    GROQ_DEFAULT_STT_MODEL,
    GROQ_DEFAULT_SUMMARY_MODEL,
    GROQ_IMAGE_RATE_LIMIT_WAIT_SCHEDULE,
    IMAGE_PROVIDER_OPTIONS,
    LMSTUDIO_DEFAULT_BASE_URL,
    LMSTUDIO_DEFAULT_IMAGE_MODEL,
    LMSTUDIO_DEFAULT_SUMMARY_MODEL,
    LOCAL_FASTER_WHISPER_ENGINE,
    LOCAL_DIRECTML_ENGINE,
    LOCAL_OPENVINO_ENGINE,
    LOCAL_WHISPER_CPP_VULKAN_ENGINE,
    OPENAI_COMPAT_MAX_RETRIES,
    PROVIDER_CUSTOM,
    PROVIDER_DEEPGRAM,
    PROVIDER_DEEPSEEK,
    PROVIDER_DISABLED,
    PROVIDER_GEMINI,
    PROVIDER_GROQ,
    PROVIDER_LMSTUDIO,
    SUMMARY_PRIORITY_LIST,
    TEMP_DIR_NAME,
    append_status_log,
    build_audio_transcriptions_endpoint,
    build_image_provider_config,
    build_usage_event,
    contains_rate_limit_marker,
    emit_debug_trace,
    ensure_openvino_whisper,
    extract_usage_metadata,
    get_custom_feature_values,
    get_openai_compat_rate_limit_kind,
    get_openvino_pipeline,
    get_retry_wait_seconds,
    infer_image_model_name,
    infer_image_provider,
    infer_stt_model_name,
    infer_stt_provider,
    infer_summary_model_name,
    infer_summary_provider,
    is_custom_model_option,
    is_debug_trace_enabled,
    json,
    math,
    normalize_secondary_image_provider,
    os,
    re,
    requests,
    should_retry_openai_compat_request,
    subprocess,
    threading,
    time,
)
from pipeline_utils import (
    build_image_caption_instruction,
    build_image_data_url,
    call_gemini_image_caption_batch_with_cache,
    call_openai_compatible_chat,
    ensure_whisper_cpp_vulkan_runtime,
    extract_last_source_id,
    extract_used_heading_keys,
    format_source_units_block,
    get_faster_whisper_init_note,
    get_faster_whisper_model,
    get_faster_whisper_runtime_device,
    get_faster_whisper_runtime_label,
    get_media_duration_seconds,
    get_next_source_start_index,
    has_more_marker,
    is_meaningful_slide_change,
    normalize_compact_text,
    normalize_timed_utterances,
    parse_image_caption_json_response,
    repair_json_like_text,
    reset_generated_dir,
    run_subprocess_with_cancel,
    safe_float,
    safe_remove,
    safe_rmtree,
    sleep_with_cancel,
    split_audio_for_gemini_stt,
    split_audio_for_groq_stt,
    strip_more_markers,
    strip_source_progress_markers,
    strip_summary_restart_artifacts,
    trim_chunk_boundary_overlap,
)
from pipeline_utils import _extract_source_units_from_prompt, _replace_source_block_in_prompt
from voice.deepgram_transcript import parse_deepgram_transcript_payload
from edition_manifest import load_edition_manifest, require_faster_whisper_model, require_local_stt_provider
from language_support import language_display_name, language_korean_name, stt_language_code
from voice.local_stt_audio import decoded_audio_float32
from local_inference import GPU_SCHEDULER, GpuPriority


LOCAL_STT_PROVIDERS = frozenset(
    {
        LOCAL_OPENVINO_ENGINE,
        LOCAL_FASTER_WHISPER_ENGINE,
        LOCAL_WHISPER_CPP_VULKAN_ENGINE,
        LOCAL_DIRECTML_ENGINE,
    }
)


from providers import (
    call_custom_summary,
    call_deepseek_summary,
    call_groq_summary,
    call_lmstudio_summary,
    is_quota_exceeded_error,
)

def gemini_stt_timed_json_prompt(language: str = "korean") -> str:
    lecture_language = language_korean_name(language)
    return f"""다음 오디오를 {lecture_language} 강의 STT 원문으로 받아쓰기하세요.

반드시 JSON 배열만 출력하세요. 마크다운 코드블록, 설명, 요약, 번역은 출력하지 마세요.

규칙:
1. 이 오디오는 전체 강의 중 하나의 청크입니다. start/end는 청크 시작을 0초로 한 초 단위 시각입니다.
2. 화자가 바뀌거나 주제가 바뀌거나 약 10~25초 분량의 의미 단위가 끝날 때마다 새 구간으로 나누세요.
3. start는 해당 구간의 발화 시작 시각, end는 해당 구간의 종료 시각입니다.
4. text에는 들리는 {lecture_language} 발화만 적으세요.
5. 들리지 않는 내용은 추측하지 말고 생략하세요.

형식:
[
  {{"start": 0.0, "end": 14.2, "text": "..."}},
  {{"start": 14.2, "end": 29.8, "text": "..."}}
]
"""



def transcribe_with_faster_whisper(audio_path, config, log_list=None):
    require_local_stt_provider(LOCAL_FASTER_WHISPER_ENGINE)
    model_size = config.get("whisper_model_size", "base")
    require_faster_whisper_model(model_size)
    cancel_check = config.get("_cancel_check")
    append_status_log(log_list, f"faster-whisper 모델 로드 준비: size={model_size}")
    model = get_faster_whisper_model(model_size)
    runtime_label = get_faster_whisper_runtime_label()
    append_status_log(log_list, f"faster-whisper 실행 백엔드: {runtime_label}")
    init_note = get_faster_whisper_init_note()
    if init_note:
        append_status_log(log_list, init_note)
    if get_faster_whisper_runtime_device() == "cpu":
        append_status_log(log_list, "faster-whisper GPU 가속을 사용하지 못해 CPU로 실행합니다.")
    append_status_log(log_list, "faster-whisper 음성 인식 실행 중...")
    if cancel_check is not None:
        cancel_check()
    text_parts = []
    utterances = []
    with decoded_audio_float32(
        audio_path,
        ffmpeg_exe=FFMPEG_EXE,
        temp_dir=TEMP_DIR_NAME,
        creationflags=CREATE_NO_WINDOW,
        cancel_check=cancel_check,
    ) as audio_samples:
        segments, _info = model.transcribe(audio_samples, language=stt_language_code(config.get("language")))
        for segment in segments:
            if cancel_check is not None:
                cancel_check()
            if segment.text:
                segment_text = segment.text.strip()
                text_parts.append(segment_text)
                utterances.append({
                    "start": safe_float(getattr(segment, "start", 0.0), 0.0),
                    "end": safe_float(getattr(segment, "end", 0.0), 0.0),
                    "text": segment_text,
                    "speaker": "",
                })
    text = " ".join(text_parts).strip()
    append_status_log(log_list, f"faster-whisper 음성 인식 완료: {len(text):,}자")
    return text, f"faster-whisper ({model_size}, {runtime_label})", None, utterances

def _whisper_cpp_timestamp_to_seconds(value):
    if isinstance(value, (int, float)):
        numeric = float(value)
        return numeric / 1000.0 if numeric > 10000 else numeric
    text = str(value or "").strip().replace(",", ".")
    if not text:
        return 0.0
    parts = text.split(":")
    try:
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
        if len(parts) == 2:
            return int(parts[0]) * 60 + float(parts[1])
        return float(text)
    except Exception:
        return 0.0

def _extract_whisper_cpp_json_segments(payload):
    if not isinstance(payload, dict):
        return []
    candidates = payload.get("transcription")
    if candidates is None:
        candidates = payload.get("segments")
    if not isinstance(candidates, list):
        return []
    utterances = []
    for item in candidates:
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        timestamps = item.get("timestamps") if isinstance(item.get("timestamps"), dict) else {}
        start = item.get("start", timestamps.get("from", 0.0))
        end = item.get("end", timestamps.get("to", start))
        utterances.append({
            "start": _whisper_cpp_timestamp_to_seconds(start),
            "end": _whisper_cpp_timestamp_to_seconds(end),
            "text": text,
            "speaker": "",
        })
    return utterances

def transcribe_with_whisper_cpp_vulkan(audio_path, config, log_list=None):
    started_at = time.perf_counter()
    require_local_stt_provider(LOCAL_WHISPER_CPP_VULKAN_ENGINE)
    model_name = config.get("whisper_cpp_model_name") or config.get("stt_model_name") or "large-v3-turbo-q5_0"
    cancel_check = config.get("_cancel_check")
    cancel_event = config.get("_cancel_event")
    append_status_log(log_list, f"whisper.cpp Vulkan 준비: model={model_name}")
    exe_path, model_path, model_filename = ensure_whisper_cpp_vulkan_runtime(
        model_name,
        log_list=log_list,
        cancel_check=cancel_check,
    )
    if cancel_check is not None:
        cancel_check()
    os.makedirs(TEMP_DIR_NAME, exist_ok=True)
    allow_cpu_fallback = config.get("whisper_cpp_cpu_fallback", True) is not False
    use_vulkan = config.get("whisper_cpp_use_vulkan", True) is not False

    def run_attempt(use_vulkan):
        backend = "Vulkan" if use_vulkan else "CPU"
        output_prefix = os.path.join(
            TEMP_DIR_NAME,
            f"whispercpp_{int(time.time() * 1000)}_{backend.lower()}",
        )
        command = [
            exe_path,
            "-m", model_path,
            "-f", audio_path,
            "-l", stt_language_code(config.get("language")),
            "-oj",
            "-ojf",
            "-of", output_prefix,
            "-sns",
        ]
        if not use_vulkan:
            command.append("--no-gpu")
        append_status_log(log_list, f"[STT] whisper.cpp {backend} 음성 인식 실행 중...")
        try:
            scheduler = (
                GPU_SCHEDULER.acquire("whisper", priority=GpuPriority.HIGH, cancel_check=cancel_check)
                if use_vulkan
                else contextlib.nullcontext()
            )
            with scheduler:
                result = run_subprocess_with_cancel(
                    command,
                    cancel_event=cancel_event,
                    check=True,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    creationflags=CREATE_NO_WINDOW,
                )
            stdout_text = str(result.stdout or "").strip()
            stderr_text = str(result.stderr or "").strip()
            if stdout_text:
                append_status_log(log_list, f"whisper.cpp {backend} 출력: {stdout_text[-500:]}")
            if stderr_text:
                append_status_log(log_list, f"whisper.cpp {backend} 로그: {stderr_text[-500:]}")
            if use_vulkan:
                runtime_log = f"{stdout_text}\n{stderr_text}".lower()
                found_devices = re.search(
                    r"ggml_vulkan:\s*found\s+([1-9]\d*)\s+vulkan device",
                    runtime_log,
                )
                used_vulkan = re.search(
                    r"whisper_backend_init_gpu:\s*using\s+vulkan\d*\s+backend",
                    runtime_log,
                )
                if not found_devices or not used_vulkan:
                    raise RuntimeError("Vulkan backend 사용을 확인하지 못했습니다.")

            json_path = f"{output_prefix}.json"
            utterances = []
            transcript = ""
            try:
                with open(json_path, "r", encoding="utf-8", errors="replace") as handle:
                    payload = json.load(handle)
                utterances = _extract_whisper_cpp_json_segments(payload)
                transcript = " ".join(item["text"] for item in utterances).strip()
                if not transcript:
                    transcript = str(payload.get("text") or payload.get("result") or "").strip()
            except Exception as error:
                append_status_log(log_list, f"whisper.cpp JSON 파싱 실패: {error}")
            if not transcript and os.path.exists(f"{output_prefix}.txt"):
                with open(f"{output_prefix}.txt", "r", encoding="utf-8", errors="replace") as handle:
                    transcript = handle.read().strip()
            if not transcript:
                raise RuntimeError(f"whisper.cpp {backend}가 빈 transcript를 반환했습니다.")
            return transcript, utterances, backend
        finally:
            safe_remove(f"{output_prefix}.json")
            safe_remove(f"{output_prefix}.txt")

    if not use_vulkan:
        transcript, utterances, backend = run_attempt(False)
    else:
        try:
            transcript, utterances, backend = run_attempt(True)
        except Exception as error:
            if cancel_event is not None and cancel_event.is_set():
                raise
            if cancel_check is not None:
                cancel_check()
            if not allow_cpu_fallback:
                raise
            append_status_log(log_list, f"[STT] Vulkan 초기화/실행 실패: {error}")
            append_status_log(log_list, "[STT] whisper.cpp CPU로 전환합니다.")
            transcript, utterances, backend = run_attempt(False)

    processing_seconds = max(0.0, time.perf_counter() - started_at)
    audio_seconds = max(0.0, get_media_duration_seconds(audio_path))
    append_status_log(log_list, f"[STT] whisper.cpp {backend} 완료: {len(transcript):,}자, 구간 {len(utterances)}개")
    usage = {
        "audio_seconds": audio_seconds,
        "processing_seconds": processing_seconds,
        "realtime_factor": processing_seconds / audio_seconds if audio_seconds else None,
        "pricing_model": model_filename,
        "display_model": f"whisper.cpp {backend} ({model_name})",
        "source": "local",
        "execution_provider": backend,
    }
    return transcript, f"whisper.cpp {backend} ({model_name})", usage, utterances

def transcribe_with_groq(audio_path, config, log_list=None):
    raise ValueError("Personal cloud API connections are no longer supported. Use an account-backed workflow.")

def transcribe_with_custom_openai_compat(audio_path, config, log_list=None):
    raise ValueError("Personal cloud API connections are no longer supported. Use an account-backed workflow.")


def transcribe_with_deepgram(audio_path, config, log_list=None):
    raise ValueError("Personal cloud API connections are no longer supported. Use an account-backed workflow.")

def _parse_gemini_timestamp_seconds(value):
    if isinstance(value, (int, float)):
        numeric = float(value)
        return numeric / 1000.0 if numeric > 10000 else numeric
    text = str(value or "").strip().strip("[]()")
    if not text:
        return 0.0
    text = text.replace(",", ".")
    parts = text.split(":")
    try:
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
        if len(parts) == 2:
            return int(parts[0]) * 60 + float(parts[1])
        return float(text)
    except Exception:
        return 0.0


def _extract_gemini_stt_json_payload(response_text):
    cleaned = re.sub(r"```(?:json)?|```", "", str(response_text or ""), flags=re.IGNORECASE).strip()
    start = cleaned.find("[")
    end = cleaned.rfind("]")
    if start != -1 and end != -1 and end > start:
        cleaned = cleaned[start:end + 1]
    try:
        payload = json.loads(cleaned)
    except Exception:
        payload = json.loads(repair_json_like_text(cleaned))
    if isinstance(payload, dict):
        for key in ("segments", "utterances", "items", "transcript"):
            value = payload.get(key)
            if isinstance(value, list):
                return value
    return payload if isinstance(payload, list) else []


def parse_gemini_stt_response(response_text, chunk_offset_seconds=0.0, chunk_duration_seconds=0.0):
    timed_utterances = []
    try:
        raw_items = _extract_gemini_stt_json_payload(response_text)
    except Exception as error:
        raise RuntimeError(f"Gemini STT JSON timestamp response parse failed: {error}") from error
    if not raw_items:
        raise RuntimeError("Gemini STT returned no JSON timestamp segments.")

    previous_start = -1.0
    for item in raw_items:
        if not isinstance(item, dict):
            raise RuntimeError("Gemini STT returned a non-object segment.")
        text = normalize_compact_text(item.get("text") or item.get("transcript") or item.get("content") or "")
        if not text:
            raise RuntimeError("Gemini STT returned a segment without text.")
        if not any(key in item for key in ("start", "start_time", "timestamp")):
            raise RuntimeError("Gemini STT returned a segment without start timestamp.")
        if not any(key in item for key in ("end", "end_time")):
            raise RuntimeError("Gemini STT returned a segment without end timestamp.")
        start = _parse_gemini_timestamp_seconds(item.get("start", item.get("start_time", item.get("timestamp"))))
        end = _parse_gemini_timestamp_seconds(item.get("end", item.get("end_time")))
        if start < 0 or end <= start:
            raise RuntimeError("Gemini STT returned an invalid timestamp range.")
        if previous_start > start:
            raise RuntimeError("Gemini STT returned timestamps out of order.")
        if chunk_duration_seconds > 0 and start > chunk_duration_seconds + 2.0:
            raise RuntimeError("Gemini STT returned a timestamp outside the audio chunk.")
        if chunk_duration_seconds > 0 and end > chunk_duration_seconds + 5.0:
            raise RuntimeError("Gemini STT returned an end timestamp outside the audio chunk.")
        timed_utterances.append({
            "start": chunk_offset_seconds + start,
            "end": chunk_offset_seconds + min(end, chunk_duration_seconds) if chunk_duration_seconds > 0 else chunk_offset_seconds + end,
            "text": text,
            "speaker": normalize_compact_text(item.get("speaker", "")),
        })
        previous_start = start

    transcript = normalize_compact_text(" ".join(item["text"] for item in timed_utterances))
    if not transcript:
        raise RuntimeError("Gemini STT returned timestamp segments but no transcript text.")
    return transcript, timed_utterances


def merge_usage_payloads(usages):
    merged = {}
    for usage in usages or []:
        if not isinstance(usage, dict):
            continue
        for key, value in usage.items():
            if isinstance(value, (int, float)):
                merged[key] = merged.get(key, 0) + value
            elif key not in merged and value not in (None, ""):
                merged[key] = value
    return merged


def transcribe_with_gemini_chunked(audio_path, model_name, config, log_list=None):
    raise ValueError("Personal Gemini API connections are no longer supported.")


def call_stt_with_fallback_silent(audio_path, config, log_list=None):
    stt_provider = config.get("stt_provider", infer_stt_provider(config))
    require_external_provider_consent(
        stt_provider,
        config,
        compliance_metadata(load_edition_manifest()),
    )
    stt_engine = config.get('stt_model_name', infer_stt_model_name(config))
    if stt_provider in LOCAL_STT_PROVIDERS:
        require_local_stt_provider(stt_provider)
    fallback_on_quota = config.get("summary_fallback_on_quota", True)
    try_list = []
    last_error = None
    audio_seconds = max(0.0, safe_float(get_media_duration_seconds(audio_path), 0.0))

    def finalize_stt_result(transcript_text, model_label, usage, utterances):
        had_provider_timestamps = bool(utterances)
        normalized_utterances = normalize_timed_utterances(utterances, transcript_text, audio_seconds)
        final_transcript = str(transcript_text or "").strip()
        if not final_transcript and normalized_utterances:
            final_transcript = "\n\n".join(item["text"] for item in normalized_utterances).strip()
        if log_list is not None:
            if had_provider_timestamps:
                append_status_log(log_list, f"STT 타임스탬프 수신: {len(normalized_utterances)}개 구간")
            elif normalized_utterances:
                basis = f"오디오 길이 {audio_seconds:.1f}초" if audio_seconds > 0 else "텍스트 길이"
                append_status_log(
                    log_list,
                    f"STT 타임스탬프 미제공: {basis} 기준 의사 타임라인 {len(normalized_utterances)}개 생성"
                )
        return final_transcript, model_label, usage, normalized_utterances, audio_seconds

    if is_custom_model_option(stt_engine):
        transcript, model_label, usage, utterances = transcribe_with_custom_openai_compat(audio_path, config, log_list=log_list)
        return finalize_stt_result(transcript, model_label, usage, utterances)

    if stt_provider == LOCAL_OPENVINO_ENGINE:
        try:
            if not ensure_openvino_whisper():
                raise ImportError("OpenVINO 라이브러리가 없습니다.")
            cancel_check = config.get("_cancel_check")
            if cancel_check is not None:
                cancel_check()
            model_size = config.get('whisper_model_size', stt_engine or 'base')
            if log_list is not None:
                log_list.append(f"OpenVINO 로컬 STT 시작: {model_size}")
            pipe = get_openvino_pipeline(model_size)
            result = pipe(
                audio_path,
                generate_kwargs={
                    "language": language_display_name(config.get("language")).lower()
                },
            )
            return finalize_stt_result(result["text"], f"OpenVINO ({model_size})", None, [])
        except Exception as e:
            if log_list is not None:
                log_list.append(f"OpenVINO STT 오류: {e}")
            raise RuntimeError(f"로컬 STT 실패: {e}") from e

    if stt_provider == LOCAL_FASTER_WHISPER_ENGINE:
        try:
            config["whisper_model_size"] = stt_engine or config.get("whisper_model_size", "base")
            transcript, model_label, usage, utterances = transcribe_with_faster_whisper(audio_path, config, log_list=log_list)
            return finalize_stt_result(transcript, model_label, usage, utterances)
        except Exception as e:
            if log_list is not None:
                log_list.append(f"faster-whisper STT 오류: {e}")
            raise RuntimeError(f"로컬 STT 실패: {e}") from e

    if stt_provider == LOCAL_DIRECTML_ENGINE:
        try:
            from voice.directml_whisper import DIRECTML_MODEL_ID, transcribe_with_directml

            model_id = str(stt_engine or DIRECTML_MODEL_ID).strip()
            transcript, utterances = transcribe_with_directml(
                audio_path,
                model_id=model_id,
                ffmpeg_exe=FFMPEG_EXE,
                temp_root=TEMP_DIR_NAME,
                language=config.get("language"),
                creationflags=CREATE_NO_WINDOW,
                cancel_check=config.get("_cancel_check"),
            )
            return finalize_stt_result(
                transcript,
                f"DirectML Whisper ({model_id}, DmlExecutionProvider)",
                None,
                utterances,
            )
        except Exception as error:
            if log_list is not None:
                log_list.append(f"DirectML STT error: {error}")
            raise RuntimeError(
                "DirectML local STT failed. No CPU or alternate STT fallback is enabled. "
                f"Details: {error}"
            ) from error

    if stt_provider == LOCAL_WHISPER_CPP_VULKAN_ENGINE:
        try:
            config["whisper_cpp_model_name"] = stt_engine or config.get("whisper_cpp_model_name", "large-v3-turbo-q5_0")
            transcript, model_label, usage, utterances = transcribe_with_whisper_cpp_vulkan(audio_path, config, log_list=log_list)
            return finalize_stt_result(transcript, model_label, usage, utterances)
        except Exception as e:
            if log_list is not None:
                log_list.append(f"whisper.cpp Vulkan STT 오류: {e}")
            raise RuntimeError(f"로컬 STT 실패: {e}") from e

    if stt_provider == PROVIDER_GROQ:
        config["groq_stt_model_name"] = stt_engine or config.get("groq_stt_model_name", GROQ_DEFAULT_STT_MODEL)
        transcript, model_label, usage, utterances = transcribe_with_groq(audio_path, config, log_list=log_list)
        return finalize_stt_result(transcript, model_label, usage, utterances)

    if stt_provider == PROVIDER_DEEPGRAM:
        config["deepgram_stt_model_name"] = stt_engine or config.get("deepgram_stt_model_name", DEEPGRAM_DEFAULT_MODEL)
        transcript, model_label, usage, utterances = transcribe_with_deepgram(audio_path, config, log_list=log_list)
        return finalize_stt_result(transcript, model_label, usage, utterances)

    try_list.append(stt_engine)
    if fallback_on_quota:
        try_list.extend([m for m in SUMMARY_PRIORITY_LIST if m not in try_list])

    for model_name in try_list:
        try:
            cancel_check = config.get("_cancel_check")
            if cancel_check is not None:
                cancel_check()
            transcript, model_label, usage, utterances = transcribe_with_gemini_chunked(
                audio_path,
                model_name,
                config,
                log_list=log_list,
            )
            return finalize_stt_result(transcript, model_label, usage, utterances)
        except Exception as e:
            last_error = e
            if log_list is not None:
                log_list.append(f"STT 엔진 `{model_name}` 오류: {e}")
            if fallback_on_quota and is_quota_exceeded_error(e):
                if log_list is not None:
                    log_list.append(f"Gemini STT quota 초과 감지: 다음 모델로 폴백합니다. ({model_name})")
                continue
            raise RuntimeError(f"STT 실패 ({model_name}): {e}") from e
    if last_error is not None:
        raise RuntimeError(f"STT 폴백 실패: {last_error}") from last_error
    raise RuntimeError("STT 실패: 사용 가능한 엔진이 없습니다.")

