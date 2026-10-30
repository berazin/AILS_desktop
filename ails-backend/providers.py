from provider_names import LOCAL_STT_PROVIDERS, CUSTOM_PROVIDER_LABEL, provider_to_api, provider_to_ui
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



def continue_summary_if_needed(
    prompt,
    initial_response,
    config,
    log_list,
    usage_events,
    last_model_name,
):
    combined = strip_summary_restart_artifacts(
        strip_source_progress_markers(strip_more_markers(initial_response))
    )
    raw_response = initial_response
    current_model_name = last_model_name
    max_continuations = 4
    source_units = _extract_source_units_from_prompt(prompt)
    performed_continuations = 0

    if not has_more_marker(raw_response):
        return combined.strip(), current_model_name
    if not source_units:
        if log_list is not None:
            append_status_log(log_list, "[MORE] 감지: SOURCE BLOCK이 없어 자동 이어쓰기를 진행하지 않고 현재 응답까지만 사용합니다.")
        return combined.strip(), current_model_name

    for continuation_index in range(max_continuations):
        if not has_more_marker(raw_response):
            break

        last_source_id = extract_last_source_id(raw_response)
        if not last_source_id:
            if log_list is not None:
                append_status_log(log_list, "SOURCE 이어쓰기: LAST_SOURCE_ID가 없어 마지막 SOURCE 위치를 복구합니다.")
            recovery_prompt = (
                "[작업]\n"
                "아래 SOURCE BLOCK과 이미 작성된 요약 응답을 비교해, 실제로 반영이 끝난 마지막 SOURCE ID를 찾으세요.\n"
                "설명 없이 마지막 줄 한 줄만 `LAST_SOURCE_ID=S###` 형식으로 출력하세요.\n\n"
                "[이미 작성된 요약 응답]\n"
                f"{combined[-6000:]}\n\n"
                "[SOURCE BLOCK BEGIN]\n"
                f"{format_source_units_block(source_units, start_index=1)}\n"
                "[SOURCE BLOCK END]"
            )
            recovery_response, current_model_name, recovery_usage = call_ai_summary(
                recovery_prompt,
                config,
                log_list,
            )
            usage_events.append(build_usage_event("summary", current_model_name, recovery_usage, input_type="text"))
            last_source_id = extract_last_source_id(recovery_response)
            if not last_source_id:
                if log_list is not None:
                    append_status_log(log_list, "SOURCE 이어쓰기 중단: LAST_SOURCE_ID를 복구하지 못해 현재 응답까지만 사용합니다.")
                break
            if log_list is not None:
                append_status_log(log_list, f"SOURCE 이어쓰기 위치 복구 완료: {last_source_id}")

        next_start_index = get_next_source_start_index(last_source_id, len(source_units))
        if next_start_index is None:
            if log_list is not None:
                append_status_log(log_list, "SOURCE 이어쓰기 중단: 다음 SOURCE 시작 위치를 계산하지 못했습니다.")
            break
        if next_start_index > len(source_units):
            raw_response = strip_more_markers(raw_response)
            break

        remaining_source_block = format_source_units_block(
            source_units[next_start_index - 1:],
            start_index=next_start_index,
        )
        continuation_prompt = _replace_source_block_in_prompt(prompt, remaining_source_block)
        continuation_prompt += (
            "\n\n[직전 응답 마지막 부분]\n"
            + combined[-3000:]
            + "\n\n[이어쓰기 규칙]\n"
            "- 위 SOURCE BLOCK에는 아직 요약되지 않은 SOURCE만 남아 있습니다.\n"
            "- 남은 SOURCE를 순서대로 끝까지 훑고, 새 정보가 있으면 간단히라도 반드시 반영하세요.\n"
            "- 기존 제목, 기존 문장, 기존 설명을 반복하지 말고 바로 다음 SOURCE부터 이어 쓰세요.\n"
            "- 새 문서 제목, 새 서론, 복습, 재정리, 같은 개념 재포장은 금지합니다.\n"
            "- 이번 응답에서도 마지막 줄에 반드시 `LAST_SOURCE_ID=S###` 또는 `LAST_SOURCE_ID=S### [MORE]`만 출력하세요."
        )
        if log_list is not None:
            append_status_log(
                log_list,
                f"SOURCE 이어쓰기 {continuation_index + 1}/{max_continuations}: {last_source_id} 이후 SOURCE만 다시 전송합니다.",
            )

        next_response, current_model_name, continuation_usage = call_ai_summary(
            continuation_prompt,
            config,
            log_list,
        )
        usage_events.append(build_usage_event("summary", current_model_name, continuation_usage, input_type="text"))
        performed_continuations += 1
        cleaned_next = strip_summary_restart_artifacts(
            strip_source_progress_markers(strip_more_markers(next_response)),
            used_heading_keys=extract_used_heading_keys(combined),
        )
        cleaned_next = trim_chunk_boundary_overlap(combined, cleaned_next)
        if not cleaned_next:
            if log_list is not None:
                append_status_log(log_list, "SOURCE 이어쓰기 중단: 새로 추가된 본문이 없어 현재 응답까지만 사용합니다.")
            break
        combined = f"{combined.rstrip()}\n{cleaned_next}".strip()
        raw_response = next_response

    if log_list is not None and performed_continuations > 0:
        if has_more_marker(raw_response):
            append_status_log(log_list, f"SOURCE 이어쓰기 중단: 최대 {max_continuations}회에 도달했습니다.")
        else:
            append_status_log(log_list, f"SOURCE 이어쓰기 완료: 추가 호출 {performed_continuations}회")
    return strip_source_progress_markers(combined).strip(), current_model_name

def is_quota_exceeded_error(error):
    message = str(error).lower()
    quota_markers = [
        "quota",
        "resource_exhausted",
        "rate limit",
        "429",
        "too many requests",
        "quota exceeded",
        "exceeded your current quota",
    ]
    return any(marker in message for marker in quota_markers)

def call_groq_summary(prompt, config, log_list=None):
    raise ValueError("Personal cloud API connections are no longer supported.")

def call_deepseek_summary(prompt, config, log_list=None):
    raise ValueError("Personal cloud API connections are no longer supported.")

def call_lmstudio_summary(prompt, config, log_list=None):
    lmstudio_model_name = config.get("lmstudio_summary_model_name", config.get("summary_model_name", LMSTUDIO_DEFAULT_SUMMARY_MODEL))
    endpoint = config.get("lmstudio_base_url", LMSTUDIO_DEFAULT_BASE_URL)
    append_status_log(log_list, f"LM Studio summary 호출 시작: {lmstudio_model_name}")
    append_status_log(log_list, f"LM Studio summary endpoint: {endpoint}")
    append_status_log(log_list, f"LM Studio summary 요청 길이: {len(str(prompt or '')):,}자")
    content, usage = call_openai_compatible_chat(
        endpoint,
        "",
        lmstudio_model_name,
        [{"role": "user", "content": prompt}],
        provider_label="LM Studio summary",
        log_list=log_list,
        cancel_check=config.get("_cancel_check"),
        allow_empty_api_key=True,
        debug_trace_callback=config.get("_debug_trace") if is_debug_trace_enabled(config) else None,
        debug_trace_label=f"LM Studio summary / {lmstudio_model_name} 응답 스트림",
    )
    return content, lmstudio_model_name, usage

def call_custom_summary(prompt, config, log_list=None):
    raise ValueError("Personal cloud API connections are no longer supported.")

def call_ai_summary(prompt, config, log_list=None):
    managed_call = config.get("_managed_summary_call")
    if callable(managed_call):
        return managed_call(prompt, config, log_list)
    if config.get("summary_provider") == PROVIDER_LMSTUDIO:
        return call_lmstudio_summary(prompt, config, log_list=log_list)
    raise ValueError("Choose an AILS account, ChatGPT subscription, or local model.")


def extract_pdf_pages(pdf_path, target_dir, pdf_password="", cancel_check=None):
    import pypdfium2 as pdfium
    from pdf.pdfium_runtime import locked_pdfium

    reset_generated_dir(target_dir)
    
    final_images = []
    image_meta = []
    doc = None
    pdfium_guard = locked_pdfium()
    pdfium_guard.__enter__()
    try:
        try:
            doc = pdfium.PdfDocument(pdf_path, password=pdf_password or None)
        except pdfium.PdfiumError as error:
            if "password" not in str(error).lower():
                raise
            if not pdf_password:
                raise RuntimeError("PDF 암호가 필요합니다.") from error
            raise RuntimeError("PDF 암호가 올바르지 않습니다.") from error
        for page_num in range(len(doc)):
            if cancel_check is not None:
                cancel_check()
            page = doc[page_num]
            img_name = f"slide_{page_num:03d}.jpg"
            img_path = os.path.join(target_dir, img_name)
            bitmap = None
            pil_image = None
            image = None
            try:
                bitmap = page.render(scale=150 / 72)
                pil_image = bitmap.to_pil()
                image = pil_image.convert("RGB")
                image.save(img_path, format="JPEG", quality=92)
            finally:
                if image is not None:
                    image.close()
                if pil_image is not None:
                    pil_image.close()
                if bitmap is not None:
                    bitmap.close()
                page.close()
            final_images.append(img_name)
            image_meta.append({
                "image_name": img_name,
                "page_index": page_num,
                "start_time": None,
                "end_time": None,
                "estimated": True,
            })
    except RuntimeError:
        raise
    except Exception as e:
        print(f"PDF 추출 중 오류 발생: {e}")
    finally:
        try:
            if doc is not None:
                doc.close()
        finally:
            pdfium_guard.__exit__(None, None, None)
        
    return final_images, target_dir, image_meta

def extract_scenes_by_interval(video_path, _base_name, interval, threshold, target_dir, cancel_event=None, cancel_check=None):
    reset_generated_dir(target_dir)
    temp_template = os.path.join(target_dir, "raw_%03d.jpg")
    run_subprocess_with_cancel(
        [FFMPEG_EXE, '-i', video_path, '-vf', f"fps=1/{interval}", '-pix_fmt', 'yuvj420p', temp_template, '-y'],
        cancel_event=cancel_event,
        capture_output=True,
        creationflags=CREATE_NO_WINDOW,
        check=False,
    )
    raw_images = sorted([f for f in os.listdir(target_dir) if f.startswith('raw_')])
    
    final_images = []
    image_meta = []
    best_candidate = None

    for img_name in raw_images:
        if cancel_check is not None:
            cancel_check()
        curr_path = os.path.join(target_dir, img_name)
        raw_match = re.search(r"raw_(\d+)\.jpg", img_name)
        raw_index = int(raw_match.group(1)) if raw_match else len(final_images) + 1
        capture_time = max(0.0, (raw_index - 1) * safe_float(interval, 0.0))
        if best_candidate is None:
            best_candidate = {
                "path": curr_path,
                "cluster_start": capture_time,
                "cluster_end": capture_time,
            }
            continue

        if is_meaningful_slide_change(best_candidate["path"], curr_path, threshold):
            new_name = f"slide_{len(final_images):03d}.jpg"
            new_p = os.path.join(target_dir, new_name)
            os.replace(best_candidate["path"], new_p)
            final_images.append(new_name)
            image_meta.append({
                "image_name": new_name,
                "start_time": best_candidate["cluster_start"],
                "end_time": best_candidate["cluster_end"],
                "estimated": False,
            })
            best_candidate = {
                "path": curr_path,
                "cluster_start": capture_time,
                "cluster_end": capture_time,
            }
        else:
            os.remove(best_candidate["path"])
            best_candidate = {
                "path": curr_path,
                "cluster_start": best_candidate["cluster_start"],
                "cluster_end": capture_time,
            }
            
    if best_candidate:
        new_name = f"slide_{len(final_images):03d}.jpg"
        new_p = os.path.join(target_dir, new_name)
        os.replace(best_candidate["path"], new_p)
        final_images.append(new_name)
        image_meta.append({
            "image_name": new_name,
            "start_time": best_candidate["cluster_start"],
            "end_time": best_candidate["cluster_end"],
            "estimated": False,
        })

    return sorted(final_images), target_dir, image_meta

def call_groq_image_caption_batch(batch, image_dir, config, log_list=None):
    raise ValueError("Personal cloud API connections are no longer supported.")

def call_deepseek_image_caption_batch(batch, image_dir, config, log_list=None):
    raise ValueError("Personal cloud API connections are no longer supported.")

def call_lmstudio_image_caption_batch(batch, image_dir, config, log_list=None):
    model_name = config.get("lmstudio_image_model_name", config.get("image_model_name", LMSTUDIO_DEFAULT_IMAGE_MODEL))
    append_status_log(log_list, f"LM Studio image 호출 시작: {model_name}")
    instruction = build_image_caption_instruction(
        batch,
        allow_duplicate_detection=not bool(config.get("disable_image_duplicate_detection")),
        language=config.get("language"),
    )
    content_parts = [{"type": "text", "text": instruction}]
    for img_name in batch:
        image_path = os.path.join(image_dir, img_name)
        content_parts.append({
            "type": "image_url",
            "image_url": {"url": build_image_data_url(image_path)}
        })
    content_parts.append({
        "type": "text",
        "text": "Filenames: " + ", ".join(batch)
    })
    emit_debug_trace(config, f"LM Studio image / {model_name} 이미지 프롬프트", f"{instruction}\n\nFilenames: {', '.join(batch)}", "prompt")
    text, usage = call_openai_compatible_chat(
        config.get("lmstudio_base_url", LMSTUDIO_DEFAULT_BASE_URL),
        "",
        model_name,
        [{"role": "user", "content": content_parts}],
        provider_label="LM Studio image",
        log_list=log_list,
        cancel_check=config.get("_cancel_check"),
        allow_empty_api_key=True,
        debug_trace_callback=config.get("_debug_trace") if is_debug_trace_enabled(config) else None,
        debug_trace_label=f"LM Studio image / {model_name} 응답 스트림",
    )
    return parse_image_caption_json_response(text, "LM Studio image", log_list=log_list), model_name, usage

def call_custom_image_caption_batch(batch, image_dir, config, log_list=None):
    raise ValueError("Personal cloud API connections are no longer supported.")

def get_image_analysis_batch_size(provider, config):
    if is_custom_model_option(config.get("image_model_name", "")):
        return max(1, int(config.get("custom_image_batch_size", 5) or 5))
    if provider == PROVIDER_GROQ:
        return 5
    if provider == PROVIDER_DEEPSEEK:
        return min(int(config.get("deepseek_image_batch_size", 5) or 5), 5)
    if provider == PROVIDER_LMSTUDIO:
        return max(1, int(config.get("lmstudio_image_batch_size", 5) or 5))
    if provider == PROVIDER_GEMINI:
        return 15
    return 15

def analyze_image_batch_with_provider(batch, image_dir, config, provider, model_name, log_list=None):
    selected_call = config.get("_image_analysis_call")
    if callable(selected_call):
        return selected_call(batch, image_dir, config, log_list=log_list)
    if provider == PROVIDER_LMSTUDIO:
        return call_lmstudio_image_caption_batch(batch, image_dir, config, log_list=log_list)
    raise ValueError("Choose an AILS account, ChatGPT subscription, or local model.")

def normalize_image_caption_batch_result(batch, batch_result, log_list=None, allow_duplicate_detection=True):
    expected = [str(name).strip() for name in (batch or []) if str(name).strip()]
    payload = batch_result or {}
    if not isinstance(payload, dict):
        raise RuntimeError("이미지 분석 응답이 JSON 객체가 아닙니다.")

    normalized = {}
    duplicate_records = []
    retry_names = []
    for name in expected:
        if name not in payload:
            continue
        value = payload.get(name)
        if isinstance(value, str):
            caption_text = normalize_compact_text(value)
            if caption_text:
                normalized[name] = caption_text
            continue
        if not isinstance(value, dict):
            continue

        caption_text = normalize_compact_text(value.get("caption", ""))
        duplicate_of = normalize_compact_text(value.get("duplicate_of", value.get("duplicate", "")))
        is_duplicate = bool(value.get("is_duplicate")) or bool(duplicate_of)

        if is_duplicate and not allow_duplicate_detection:
            if caption_text:
                normalized[name] = caption_text
            else:
                retry_names.append(name)
                if log_list is not None:
                    append_status_log(log_list, f"중복 비활성화 모드라 {name}의 duplicate 응답을 무시하고 재시도합니다.")
            continue

        if is_duplicate and duplicate_of and duplicate_of != name:
            duplicate_records.append({
                "image_name": name,
                "duplicate_of": duplicate_of,
                "reason": "모델이 중복 이미지로 표시",
            })
            continue

        if caption_text:
            normalized[name] = caption_text
        elif is_duplicate:
            retry_names.append(name)
            if log_list is not None:
                append_status_log(log_list, f"중복 이미지 응답 보정: {name}에 duplicate_of가 없어 다른 모델로 재시도합니다.")

    return normalized, duplicate_records, retry_names

def get_missing_caption_image_names(batch, batch_result=None, handled_names=None, retry_names=None, trust_payload_keys=False):
    expected = [str(name) for name in (batch or [])]
    actual_keys = {str(name) for name in (batch_result or {}).keys()} if trust_payload_keys else set()
    actual_keys.update(str(name) for name in (handled_names or []) if str(name).strip())
    actual_keys.difference_update(str(name) for name in (retry_names or []) if str(name).strip())
    return [name for name in expected if name not in actual_keys]

def build_final_image_duplicate_review_prompt(image_names, captions, language="korean"):
    language = normalize_app_language(language)
    reason_example = "짧은 한국어 이유" if language == "korean" else f"short {language_display_name(language)} reason"
    ordered_payload = []
    for name in image_names or []:
        image_name = str(name or "").strip()
        caption = normalize_compact_text((captions or {}).get(image_name, ""))
        if not image_name or not caption or "분석 실패" in caption or "analysis failed" in caption.lower():
            continue
        ordered_payload.append({
            "image_name": image_name,
            "caption": caption,
        })
    captions_json = json.dumps(ordered_payload, ensure_ascii=False, indent=2)
    return (
        "[작업]\n"
        "아래는 강의 이미지들을 시간순으로 이미지 분석한 JSON 텍스트입니다. 실제 이미지는 보지 않고 caption 텍스트만 비교해, "
        "최종적으로 중복 이미지인지 한 번 더 검사하세요.\n\n"
        "[중복 판정 기준]\n"
        "- 학습 내용이 실질적으로 같고, 스크롤/커서/강조/아주 작은 화면 이동 정도만 다른 경우만 중복입니다.\n"
        "- 새로운 개념, 예시, 표/그림의 새 항목, 풀이 단계, 코드 변화, 설명 구조 변화가 있으면 중복이 아닙니다.\n"
        "- 중복으로 볼 때는 반드시 시간상 더 앞선 image_name을 duplicate_of로 지정하세요.\n"
        "- 확실하지 않으면 중복으로 표시하지 마세요.\n\n"
        "[출력 형식]\n"
        "strict JSON 객체만 출력하세요. 마크다운 코드블록은 쓰지 마세요.\n"
        "형식은 반드시 다음과 같습니다.\n"
        "{\"duplicates\":[{\"image_name\":\"slide_001.jpg\",\"duplicate_of\":\"slide_000.jpg\",\"reason\":\"" + reason_example + "\"}]}\n"
        "중복이 없으면 {\"duplicates\":[]} 만 출력하세요.\n\n"
        "[이미지 분석 JSON]\n"
        f"{captions_json}"
    )

def review_image_duplicates_with_summary_model(image_names, captions, config, log_list=None):
    ordered_names = [str(name or "").strip() for name in (image_names or []) if str(name or "").strip()]
    usable_names = [
        name for name in ordered_names
        if normalize_compact_text((captions or {}).get(name, ""))
        and "분석 실패" not in normalize_compact_text((captions or {}).get(name, ""))
        and "analysis failed" not in normalize_compact_text((captions or {}).get(name, "")).lower()
    ]
    if len(usable_names) < 2:
        return dict(captions or {}), [], None, ""

    append_status_log(log_list, f"이미지 최종 중복 검사 시작: 요약 모델로 {len(usable_names)}장 caption JSON 재검토")
    prompt = build_final_image_duplicate_review_prompt(usable_names, captions, language=config.get("language"))
    response_text, model_name, usage = call_ai_summary(prompt, config, log_list=log_list)
    payload = parse_image_caption_json_response(response_text, "Image duplicate review", log_list=log_list)
    raw_duplicates = payload.get("duplicates", []) if isinstance(payload, dict) else []
    if not isinstance(raw_duplicates, list):
        raw_duplicates = []

    order_index = {name: index for index, name in enumerate(ordered_names)}
    cleaned_captions = dict(captions or {})
    duplicate_records = []
    for item in raw_duplicates:
        if not isinstance(item, dict):
            continue
        image_name = str(item.get("image_name", "") or "").strip()
        duplicate_of = str(item.get("duplicate_of", "") or "").strip()
        if not image_name or not duplicate_of or image_name == duplicate_of:
            continue
        if image_name not in cleaned_captions or duplicate_of not in cleaned_captions:
            continue
        if order_index.get(duplicate_of, 10**9) >= order_index.get(image_name, -1):
            continue
        duplicate_records.append({
            "image_name": image_name,
            "duplicate_of": duplicate_of,
            "reason": normalize_compact_text(item.get("reason", "")) or "요약 모델 최종 중복 검사",
        })

    if duplicate_records:
        for item in duplicate_records:
            cleaned_captions.pop(item["image_name"], None)
        if log_list is not None:
            preview = ", ".join(f"{item['image_name']}->{item['duplicate_of']}" for item in duplicate_records[:5])
            remaining = len(duplicate_records) - min(len(duplicate_records), 5)
            suffix = f" 외 {remaining}장" if remaining > 0 else ""
            append_status_log(log_list, f"이미지 최종 중복 검사 반영: {len(duplicate_records)}장 ({preview}{suffix})")
    else:
        append_status_log(log_list, "이미지 최종 중복 검사 결과: 추가 중복 없음")

    return cleaned_captions, duplicate_records, usage, model_name

def apply_penultimate_duplicate_representatives(image_names, captions, image_meta, duplicate_records, log_list=None):
    ordered_names = [str(name or "").strip() for name in (image_names or []) if str(name or "").strip()]
    order_index = {name: index for index, name in enumerate(ordered_names)}
    parent = {name: name for name in ordered_names}
    connected_names = set()

    def find(name):
        parent.setdefault(name, name)
        while parent[name] != name:
            parent[name] = parent[parent[name]]
            name = parent[name]
        return name

    def union(left, right):
        left_root = find(left)
        right_root = find(right)
        if left_root != right_root:
            parent[right_root] = left_root

    for item in duplicate_records or []:
        if not isinstance(item, dict):
            continue
        image_name = str(item.get("image_name", "") or "").strip()
        duplicate_of = str(item.get("duplicate_of", "") or "").strip()
        if not image_name or not duplicate_of:
            continue
        if image_name not in order_index or duplicate_of not in order_index:
            continue
        union(image_name, duplicate_of)
        connected_names.add(image_name)
        connected_names.add(duplicate_of)

    groups = {}
    for name in connected_names:
        groups.setdefault(find(name), []).append(name)

    cleaned_captions = dict(captions or {})
    remove_names = set()
    representative_records = []
    for names in groups.values():
        ordered_group = sorted(set(names), key=lambda name: order_index.get(name, 10**9))
        if len(ordered_group) < 2:
            continue
        representative = ordered_group[-2]
        caption_source = representative if cleaned_captions.get(representative) else None
        if caption_source is None:
            for candidate in reversed(ordered_group):
                if cleaned_captions.get(candidate):
                    caption_source = candidate
                    break
        if caption_source is None:
            for candidate in ordered_group:
                if cleaned_captions.get(candidate):
                    caption_source = candidate
                    break
        if caption_source and cleaned_captions.get(caption_source):
            cleaned_captions[representative] = cleaned_captions[caption_source]

        for name in ordered_group:
            if name != representative:
                cleaned_captions.pop(name, None)
                remove_names.add(name)
        representative_records.append({
            "representative": representative,
            "members": ordered_group,
        })

    filtered_meta = [
        item for item in (image_meta or [])
        if str((item or {}).get("image_name", "") or "").strip() not in remove_names
    ]
    if representative_records and log_list is not None:
        preview = ", ".join(
            f"{record['representative']}({len(record['members'])}장)"
            for record in representative_records[:5]
        )
        remaining = len(representative_records) - min(len(representative_records), 5)
        suffix = f" 외 {remaining}묶음" if remaining > 0 else ""
        append_status_log(
            log_list,
            f"중복 이미지 대표 선택: 각 중복 묶음에서 뒤에서 두 번째 이미지를 사용합니다. {preview}{suffix}",
        )
    return cleaned_captions, filtered_meta, representative_records

def is_image_json_parse_failure(error):
    message = str(error or "")
    return "JSON 파싱 실패" in message or "JSON parsing failed" in message

def generate_image_captions_silent(image_list, image_dir, config, log_list=None):
    captions = {}
    usage_events = []
    duplicate_records = []
    if not image_list:
        return captions, usage_events, duplicate_records

    image_provider = config.get("image_provider", infer_image_provider(config))
    image_model_name = config.get("image_model_name", infer_image_model_name(config))
    secondary_provider = normalize_secondary_image_provider(config)
    secondary_model_name = str(config.get("image_secondary_model_name", "") or "").strip()
    if callable(config.get("_image_analysis_call")):
        # Retain the established batching and duplicate recovery, but route every
        # request through the common model selector instead of legacy fields.
        image_provider = PROVIDER_GEMINI
        image_model_name = "AILS selected"
        secondary_provider = PROVIDER_DISABLED
        secondary_model_name = ""
    cancel_check = config.get("_cancel_check")
    allow_duplicate_detection = not bool(config.get("disable_image_duplicate_detection"))

    def merge_image_batch_result(batch, batch_result, actual_model_name, usage):
        normalized_result, batch_duplicates, retry_names = normalize_image_caption_batch_result(
            batch,
            batch_result,
            log_list=log_list,
            allow_duplicate_detection=allow_duplicate_detection,
        )
        captions.update(normalized_result)
        duplicate_records.extend(batch_duplicates)
        usage_events.append(build_usage_event("image", actual_model_name, usage, input_type="image"))
        if batch_duplicates and log_list is not None:
            preview = ", ".join(
                f"{item['image_name']}->{item['duplicate_of']}"
                for item in batch_duplicates[:5]
            )
            remaining = len(batch_duplicates) - min(len(batch_duplicates), 5)
            suffix = f" 외 {remaining}장" if remaining > 0 else ""
            append_status_log(
                log_list,
                f"이미지 분석 단계 중복 판정: {len(batch_duplicates)}장 ({preview}{suffix})"
            )
        handled_names = list(normalized_result.keys())
        handled_names.extend(item["image_name"] for item in batch_duplicates)
        return handled_names, retry_names

    def recover_missing_image_captions(missing_names, provider_specs):
        pending = [name for name in (missing_names or []) if name not in captions]
        if not pending:
            return []
        if log_list is not None:
            append_status_log(log_list, f"누락 이미지 캡션 회수 시작: {len(pending)}장")

        for label, provider, model_name in provider_specs:
            if not pending:
                break
            batch_size = min(5, get_image_analysis_batch_size(provider, config))
            next_pending = []
            for start in range(0, len(pending), batch_size):
                batch = pending[start:start + batch_size]
                if cancel_check is not None:
                    cancel_check()
                try:
                    if log_list is not None:
                        append_status_log(log_list, f"{label} 누락 이미지 회수 중: {len(batch)}장")
                    batch_result, actual_model_name, usage = analyze_image_batch_with_provider(
                        batch, image_dir, config, provider, model_name, log_list=log_list
                    )
                    handled_names, retry_names = merge_image_batch_result(batch, batch_result, actual_model_name, usage)
                    missing_after_batch = get_missing_caption_image_names(
                        batch,
                        batch_result,
                        handled_names=handled_names,
                        retry_names=retry_names,
                    )
                    next_pending.extend(name for name in missing_after_batch if name not in captions)
                except Exception as error:
                    if len(batch) > 1 and is_image_json_parse_failure(error):
                        if log_list is not None:
                            append_status_log(log_list, f"{label} 누락 이미지 회수 JSON 실패: 1장씩 다시 시도합니다. ({error})")
                        for name in batch:
                            try:
                                single_result, actual_model_name, usage = analyze_image_batch_with_provider(
                                    [name], image_dir, config, provider, model_name, log_list=log_list
                                )
                                handled_names, retry_names = merge_image_batch_result([name], single_result, actual_model_name, usage)
                                if get_missing_caption_image_names([name], single_result, handled_names=handled_names, retry_names=retry_names):
                                    next_pending.append(name)
                            except Exception:
                                next_pending.append(name)
                        continue
                    if contains_rate_limit_marker(error):
                        if log_list is not None:
                            append_status_log(log_list, f"{label} 누락 이미지 회수 제한 감지: 다음 모델로 넘깁니다. ({error})")
                    else:
                        if log_list is not None:
                            append_status_log(log_list, f"{label} 누락 이미지 회수 실패: {len(batch)}장 ({error})")
                    next_pending.extend(batch)
            pending = [name for name in next_pending if name not in captions]

        if pending:
            for name in pending:
                captions[name] = "이미지 분석 실패"
            if log_list is not None:
                append_status_log(log_list, f"누락 이미지 {len(pending)}장은 분석 실패로 표시하고 작업을 계속합니다.")
        return pending


    advanced_dual_model_enabled = (
        image_provider in DUAL_IMAGE_PROVIDER_OPTIONS
        and secondary_provider in DUAL_IMAGE_PROVIDER_OPTIONS
        and secondary_model_name
        and (
            secondary_provider != image_provider
            or secondary_model_name != image_model_name
        )
    )
    if advanced_dual_model_enabled:
        dual_scheduler_config = dict(config)
        dual_scheduler_config["_image_dual_scheduler_active"] = True
        queue_lock = threading.Lock()
        result_lock = threading.Lock()
        stop_event = threading.Event()
        providers = [
            ("1st", image_provider, image_model_name),
            ("2nd", secondary_provider, secondary_model_name),
        ]
        shared_batch_size = 5 if PROVIDER_GROQ in (image_provider, secondary_provider) else min(
            get_image_analysis_batch_size(image_provider, config),
            get_image_analysis_batch_size(secondary_provider, config),
        )
        pending_batches = [
            {"batch": image_list[start:start + shared_batch_size], "failed_providers": set()}
            for start in range(0, len(image_list), shared_batch_size)
        ]
        provider_pause_until = {label: 0.0 for label, _provider, _model in providers}
        provider_rate_limit_attempts = {label: 0 for label, _provider, _model in providers}
        shared_state = {"error": None, "inflight": 0, "deprioritized_labels": set()}

        def acquire_batch(label, provider, batch_size):
            claim_chunk_count = max(1, int(math.ceil(batch_size / float(shared_batch_size))))
            while not stop_event.is_set():
                if cancel_check is not None:
                    cancel_check()
                now = time.time()
                if label in shared_state["deprioritized_labels"]:
                    alternative_available = False
                    with queue_lock:
                        for other_label, other_provider, _other_model in providers:
                            if other_label == label:
                                continue
                            if provider_pause_until.get(other_label, 0.0) > now:
                                continue
                            if any(other_provider not in item["failed_providers"] for item in pending_batches):
                                alternative_available = True
                                break
                        if not alternative_available:
                            shared_state["deprioritized_labels"].discard(label)
                    if alternative_available:
                        sleep_with_cancel(0.2, cancel_check=cancel_check, interval=0.05)
                        continue
                pause_until = provider_pause_until.get(label, 0.0)
                if pause_until > now:
                    sleep_with_cancel(min(0.5, pause_until - now), cancel_check=cancel_check, interval=0.1)
                    continue
                with queue_lock:
                    claimed_items = []
                    claimed_indexes = []
                    for index, item in enumerate(pending_batches):
                        if provider in item["failed_providers"]:
                            continue
                        claimed_items.append(item)
                        claimed_indexes.append(index)
                        if len(claimed_items) >= claim_chunk_count:
                            break
                    if claimed_items:
                        for index in reversed(claimed_indexes):
                            pending_batches.pop(index)
                        shared_state["inflight"] += len(claimed_items)
                        remaining_after_claim = sum(len(item.get("batch", [])) for item in pending_batches)
                        combined_batch = []
                        combined_failed = set()
                        for item in claimed_items:
                            combined_batch.extend(item["batch"])
                            combined_failed.update(item["failed_providers"])
                        return {"items": claimed_items, "batch": combined_batch, "failed_providers": combined_failed}, remaining_after_claim
                    if not pending_batches and shared_state["inflight"] == 0:
                        return None, len(pending_batches)
                sleep_with_cancel(0.1, cancel_check=cancel_check, interval=0.05)
            return None, 0

        def split_batch_item(batch_item, failed_provider=None):
            split_items = []
            for item in batch_item.get("items", [batch_item]):
                failed_providers = set(item.get("failed_providers", set()))
                if failed_provider:
                    failed_providers.add(failed_provider)
                for name in item.get("batch", []):
                    split_items.append({
                        "batch": [name],
                        "failed_providers": set(failed_providers),
                    })
            return split_items

        def requeue_batch(
            batch_item,
            *,
            failed_provider=None,
            cooldown_seconds=0.0,
            mark_failed=True,
            pause_provider=None,
            prepend=False,
        ):
            with queue_lock:
                claimed_items = batch_item.get("items", [batch_item])
                shared_state["inflight"] = max(0, int(shared_state.get("inflight", 0)) - len(claimed_items))
                exhausted_items = 0
                requeue_items = []
                for item in claimed_items:
                    if failed_provider and mark_failed:
                        item["failed_providers"].add(failed_provider)
                    if len(item["failed_providers"]) >= len(providers):
                        exhausted_items += 1
                        continue
                    requeue_items.append(item)
                if requeue_items:
                    if prepend:
                        pending_batches[0:0] = requeue_items
                    else:
                        pending_batches.extend(requeue_items)
                if exhausted_items and exhausted_items == len(claimed_items):
                    shared_state["error"] = RuntimeError("Image analysis failed: both primary and secondary models failed.")
                    stop_event.set()
                    return
                target_provider = pause_provider or failed_provider
                if target_provider and cooldown_seconds > 0:
                    for label, provider, _model in providers:
                        if provider == target_provider:
                            provider_pause_until[label] = max(provider_pause_until.get(label, 0.0), time.time() + cooldown_seconds)

        def requeue_missing_images_from_success(batch_item, provider, missing_names):
            missing_set = set(missing_names or [])
            if not missing_set:
                with queue_lock:
                    shared_state["inflight"] = max(0, int(shared_state.get("inflight", 0)) - len(batch_item.get("items", [batch_item])))
                return

            requeued_images = 0
            with queue_lock:
                claimed_items = batch_item.get("items", [batch_item])
                shared_state["inflight"] = max(0, int(shared_state.get("inflight", 0)) - len(claimed_items))
                for item in claimed_items:
                    item_missing = [name for name in item.get("batch", []) if name in missing_set]
                    if not item_missing:
                        continue
                    failed_providers = set(item.get("failed_providers", set()))
                    failed_providers.add(provider)
                    if len(failed_providers) >= len(providers):
                        continue
                    pending_batches.append({
                        "batch": item_missing,
                        "failed_providers": failed_providers,
                    })
                    requeued_images += len(item_missing)
            if log_list is not None and requeued_images > 0:
                append_status_log(log_list, f"{provider} 응답 누락 감지: 캡션이 없는 이미지 {requeued_images}장만 다른 모델로 다시 분석합니다.")

        def disable_provider_for_remaining_batches(provider):
            with queue_lock:
                for item in pending_batches:
                    item["failed_providers"].add(provider)

        def image_worker(label, provider, model_name):
            batch_size = get_image_analysis_batch_size(provider, config)
            local_batch_count = 0
            if log_list is not None:
                append_status_log(log_list, f"{label} 이미지 분석 시작: {provider} / {model_name} / 배치 {batch_size}")
                if provider == PROVIDER_GROQ:
                    append_status_log(log_list, f"{label} Groq 제한 정책: TPM/RPM은 30초->20초->10초 재시도, RPD는 즉시 실패 처리")
                elif provider == PROVIDER_GEMINI:
                    append_status_log(log_list, f"{label} Gemini 이미지 분석은 context caching 없이 직접 호출합니다.")

            while not stop_event.is_set():
                if cancel_check is not None:
                    cancel_check()
                batch_item, remaining_after_claim = acquire_batch(label, provider, batch_size)
                if batch_item is None:
                    return

                batch = list(batch_item.get("batch", []))
                if not batch:
                    requeue_missing_images_from_success(batch_item, provider, [])
                    return

                local_batch_count += 1
                if log_list is not None:
                    append_status_log(log_list, f"{label} 이미지 분석 배치 처리 중: {local_batch_count} ({len(batch)}장, 남은 {remaining_after_claim}장)")
                try:
                    batch_result, actual_model_name, usage = analyze_image_batch_with_provider(
                        batch, image_dir, config, provider, model_name, log_list=log_list
                    )
                    handled_names, retry_names = merge_image_batch_result(batch, batch_result, actual_model_name, usage)
                    missing_names = get_missing_caption_image_names(
                        batch,
                        batch_result,
                        handled_names=handled_names,
                        retry_names=retry_names,
                    )
                    requeue_missing_images_from_success(batch_item, provider, missing_names)
                    provider_rate_limit_attempts[label] = 0
                    with queue_lock:
                        shared_state["deprioritized_labels"].discard(label)
                    continue
                except Exception as error:
                    rate_limit_kind = get_openai_compat_rate_limit_kind(error)
                    if is_image_json_parse_failure(error) and len(batch) > 1:
                        with queue_lock:
                            shared_state["inflight"] = max(0, int(shared_state.get("inflight", 0)) - len(batch_item.get("items", [batch_item])))
                            pending_batches[0:0] = split_batch_item(batch_item, failed_provider=provider)
                            shared_state["deprioritized_labels"].add(label)
                        if log_list is not None:
                            append_status_log(log_list, f"{label} 이미지 분석 JSON 파싱 실패: 배치 {len(batch)}장을 1장씩 나눠 다른 모델 또는 재시도로 이어갑니다. ({error})")
                        continue
                    if rate_limit_kind == "retryable":
                        wait_seconds = get_retry_wait_seconds(
                            error,
                            provider_rate_limit_attempts[label],
                            rate_limit_wait_schedule=(
                                GROQ_IMAGE_RATE_LIMIT_WAIT_SCHEDULE if provider == PROVIDER_GROQ else DEFAULT_RATE_LIMIT_WAIT_SCHEDULE
                            ),
                        )
                        provider_rate_limit_attempts[label] += 1
                        if log_list is not None:
                            append_status_log(log_list, f"{label} TPM/RPM 감지: 이미지 {len(batch)}장을 대기열에 다시 넣고 {wait_seconds:.1f}초 후 재시도합니다.")
                        with queue_lock:
                            shared_state["deprioritized_labels"].add(label)
                        requeue_batch(
                            batch_item,
                            failed_provider=provider,
                            cooldown_seconds=wait_seconds,
                            mark_failed=False,
                            pause_provider=provider,
                            prepend=True,
                        )
                        continue

                    provider_rate_limit_attempts[label] = 0
                    with queue_lock:
                        shared_state["deprioritized_labels"].discard(label)

                    if rate_limit_kind == "rpd":
                        if log_list is not None:
                            append_status_log(log_list, f"{label} RPD 감지: 이 모델은 중단하고 다른 모델이 남은 작업을 이어서 처리합니다. ({error})")
                        disable_provider_for_remaining_batches(provider)
                        requeue_batch(
                            batch_item,
                            failed_provider=provider,
                            mark_failed=True,
                            prepend=True,
                        )
                        continue

                    if log_list is not None:
                        append_status_log(log_list, f"{label} 이미지 분석 배치 실패: {local_batch_count} ({error})")
                    requeue_batch(
                        batch_item,
                        failed_provider=provider,
                        mark_failed=True,
                        prepend=True,
                    )
                    continue

        if log_list is not None:
            append_status_log(log_list, f"이미지 분석 분업 모드: 1차 {image_provider}({image_model_name}), 2차 {secondary_provider}({secondary_model_name})")

        workers = [
            threading.Thread(target=image_worker, args=(label, provider, model_name), daemon=True)
            for label, provider, model_name in providers
        ]
        for worker in workers:
            worker.start()
        for worker in workers:
            worker.join()

        if shared_state["error"] is not None:
            raise shared_state["error"]
        remaining_missing = get_missing_caption_image_names(
            image_list,
            captions,
            handled_names=[item["image_name"] for item in duplicate_records],
        )
        if remaining_missing:
            recover_missing_image_captions(
                remaining_missing,
                list(reversed(providers)),
            )
        return captions, usage_events, duplicate_records
    dynamic_dual_model_enabled = (
        secondary_provider in IMAGE_PROVIDER_OPTIONS
        and secondary_model_name
        and (secondary_provider != image_provider or secondary_model_name != image_model_name)
        and len(image_list) > get_image_analysis_batch_size(image_provider, config)
    )
    if dynamic_dual_model_enabled:
        queue_lock = threading.Lock()
        result_lock = threading.Lock()
        stop_event = threading.Event()
        total_images = len(image_list)
        queue_state = {"next_index": 0, "error": None}

        def dynamic_image_worker(provider, model_name, worker_label):
            batch_size = get_image_analysis_batch_size(provider, config)
            if log_list is not None:
                append_status_log(log_list, f"{worker_label} image analysis start: {provider} / {model_name} / batch {batch_size}")
                if provider == PROVIDER_GROQ:
                    append_status_log(log_list, f"{worker_label} Groq limit policy: TPM/RPM retries 30s->20s->10s, RPD fails immediately")
                elif provider == PROVIDER_GEMINI:
                    append_status_log(log_list, f"{worker_label} Gemini 이미지 분석은 context caching 없이 직접 호출합니다.")

            local_batch_count = 0
            while not stop_event.is_set():
                if cancel_check is not None:
                    cancel_check()
                with queue_lock:
                    if queue_state["next_index"] >= total_images:
                        return
                    start = queue_state["next_index"]
                    end = min(start + batch_size, total_images)
                    batch = image_list[start:end]
                    queue_state["next_index"] = end
                    remaining_after_claim = total_images - queue_state["next_index"]
                local_batch_count += 1
                if log_list is not None:
                    append_status_log(log_list, f"{worker_label} image batch in progress: {local_batch_count} ({len(batch)} images, {remaining_after_claim} remaining)")
                try:
                    batch_result, actual_model_name, usage = analyze_image_batch_with_provider(
                        batch, image_dir, config, provider, model_name, log_list=log_list
                    )
                    with result_lock:
                        merge_image_batch_result(batch, batch_result, actual_model_name, usage)
                except Exception as error:
                    if provider == PROVIDER_GROQ or contains_rate_limit_marker(error):
                        with result_lock:
                            if queue_state["error"] is None:
                                queue_state["error"] = RuntimeError(f"{provider} image analysis failed: {error}")
                        stop_event.set()
                        return
                    if log_list is not None:
                        append_status_log(log_list, f"{worker_label} 이미지 배치 실패: {local_batch_count} ({error})")
                    with result_lock:
                        for name in batch:
                            captions[name] = "analysis failed"

        if log_list is not None:
            append_status_log(log_list, f"Image analysis dual mode: primary {image_provider}({image_model_name}), secondary {secondary_provider}({secondary_model_name})")

        workers = [
            threading.Thread(target=dynamic_image_worker, args=(image_provider, image_model_name, "1st"), daemon=True),
            threading.Thread(target=dynamic_image_worker, args=(secondary_provider, secondary_model_name, "2nd"), daemon=True),
        ]
        for worker in workers:
            worker.start()
        for worker in workers:
            worker.join()

        if queue_state["error"] is not None:
            raise queue_state["error"]
        return captions, usage_events, duplicate_records
    dual_model_enabled = (
        secondary_provider in IMAGE_PROVIDER_OPTIONS
        and secondary_model_name
        and (secondary_provider != image_provider or secondary_model_name != image_model_name)
        and len(image_list) > 10**9
    )
    if dual_model_enabled:
        primary_images = image_list[:20]
        secondary_images = image_list[20:]
        if log_list is not None:
            log_list.append(
                f"이미지 분석 이중 모델 모드: 1차 {image_provider}({image_model_name}) 20장, "
                f"2차 {secondary_provider}({secondary_model_name}) 나머지 {len(secondary_images)}장"
            )
        primary_config = build_image_provider_config(
            config,
            image_provider,
            image_model_name,
            secondary_provider=PROVIDER_DISABLED,
            secondary_model_name="",
        )
        primary_captions, primary_usage, primary_duplicates = generate_image_captions_silent(primary_images, image_dir, primary_config, log_list=log_list)
        captions.update(primary_captions)
        usage_events.extend(primary_usage)
        duplicate_records.extend(primary_duplicates)
        if secondary_images:
            secondary_config = build_image_provider_config(
                config,
                secondary_provider,
                secondary_model_name,
                secondary_provider=PROVIDER_DISABLED,
                secondary_model_name="",
            )
            secondary_captions, secondary_usage, secondary_duplicates = generate_image_captions_silent(secondary_images, image_dir, secondary_config, log_list=log_list)
            captions.update(secondary_captions)
            usage_events.extend(secondary_usage)
            duplicate_records.extend(secondary_duplicates)
        return captions, usage_events, duplicate_records

    if image_provider == PROVIDER_GROQ:
        config["groq_image_model_name"] = image_model_name
        batch_size = 5
        if log_list is not None:
            log_list.append(f"Groq 이미지 분석 모드: 배치당 {batch_size}장")
            log_list.append("Groq 제한 정책: TPM/RPM은 30초→20초→10초 순환 재시도, RPD는 즉시 실패")
        pending_batches = [image_list[start:start + batch_size] for start in range(0, len(image_list), batch_size)]
        rate_limit_attempt_index = 0
        missing_retry_counts = {}
        processed_batches = 0
        total_batches = len(pending_batches)
        while pending_batches:
            if cancel_check is not None:
                cancel_check()
            batch = pending_batches.pop(0)
            processed_batches += 1
            if log_list is not None:
                remaining_images = sum(len(pending) for pending in pending_batches)
                log_list.append(f"이미지 분석 배치 처리 중: {processed_batches}/{total_batches} ({len(batch)}장, 남은 {remaining_images}장)")
            try:
                batch_result, actual_model_name, usage = call_groq_image_caption_batch(batch, image_dir, config, log_list=log_list)
                handled_names, retry_names = merge_image_batch_result(batch, batch_result, actual_model_name, usage)
                missing_names = get_missing_caption_image_names(
                    batch,
                    handled_names=handled_names,
                    retry_names=retry_names,
                )
                if missing_names:
                    retry_names = []
                    exhausted_names = []
                    for name in missing_names:
                        missing_retry_counts[name] = missing_retry_counts.get(name, 0) + 1
                        if missing_retry_counts[name] <= 2:
                            retry_names.append(name)
                        else:
                            exhausted_names.append(name)
                    if retry_names:
                        pending_batches.insert(0, retry_names)
                        total_batches += 1
                    for name in exhausted_names:
                        captions[name] = "분석 실패"
                    if log_list is not None:
                        log_list.append(f"Groq 응답 누락 감지: 캡션 없는 이미지 {len(retry_names)}장만 다시 분석합니다.")
                        if exhausted_names:
                            log_list.append(f"Groq 응답 누락 반복: {len(exhausted_names)}장은 분석 실패로 표시하고 계속 진행합니다.")
                rate_limit_attempt_index = 0
            except Exception as error:
                if log_list is not None:
                    log_list.append(f"이미지 분석 배치 실패: {processed_batches}/{total_batches} ({error})")
                rate_limit_kind = get_openai_compat_rate_limit_kind(error)
                if is_image_json_parse_failure(error) and len(batch) > 1:
                    pending_batches[0:0] = [[name] for name in batch]
                    total_batches += len(batch)
                    if log_list is not None:
                        log_list.append(f"Groq JSON 파싱 실패: 배치 {len(batch)}장을 1장씩 나눠 재분석합니다.")
                    continue
                if rate_limit_kind == "retryable":
                    wait_seconds = get_retry_wait_seconds(
                        error,
                        rate_limit_attempt_index,
                        rate_limit_wait_schedule=GROQ_IMAGE_RATE_LIMIT_WAIT_SCHEDULE,
                    )
                    rate_limit_attempt_index += 1
                    pending_batches.insert(0, batch)
                    if log_list is not None:
                        log_list.append(
                            f"Groq TPM/429 감지: 현재 배치 {len(batch)}장을 대기열로 되돌리고 {wait_seconds:.1f}초 후 다시 시도합니다."
                        )
                    sleep_with_cancel(wait_seconds, cancel_check=cancel_check)
                    continue
                if rate_limit_kind == "rpd":
                    raise RuntimeError(f"Groq 이미지 분석 실패(RPD): {error}") from error
                raise RuntimeError(f"Groq 이미지 분석 실패: {error}") from error
        return captions, usage_events, duplicate_records

    if image_provider == PROVIDER_DEEPSEEK:
        batch_size = min(int(config.get("deepseek_image_batch_size", 5) or 5), 5)
        total_batches = math.ceil(len(image_list) / batch_size)
        for batch_index, start in enumerate(range(0, len(image_list), batch_size), start=1):
            if cancel_check is not None:
                cancel_check()
            batch = image_list[start:start + batch_size]
            if log_list is not None:
                log_list.append(f"DeepSeek 이미지 분석 배치 처리 중: {batch_index}/{total_batches} ({len(batch)}장)")
            try:
                batch_result, actual_model_name, usage = call_deepseek_image_caption_batch(batch, image_dir, config, log_list=log_list)
                merge_image_batch_result(batch, batch_result, actual_model_name, usage)
            except Exception as error:
                if contains_rate_limit_marker(error):
                    raise
                if log_list is not None:
                    log_list.append(f"이미지 분석 배치 실패: {batch_index}/{total_batches} ({error})")
                for name in batch:
                    captions[name] = "분석 실패"
        return captions, usage_events, duplicate_records

    if image_provider == PROVIDER_LMSTUDIO:
        batch_size = get_image_analysis_batch_size(image_provider, config)
        total_batches = math.ceil(len(image_list) / batch_size)
        if log_list is not None:
            log_list.append(f"LM Studio 이미지 분석 모드: 배치당 {batch_size}장")
        for batch_index, i in enumerate(range(0, len(image_list), batch_size), start=1):
            if cancel_check is not None:
                cancel_check()
            batch = image_list[i : i + batch_size]
            try:
                if log_list is not None:
                    log_list.append(f"이미지 분석 배치 처리 중: {batch_index}/{total_batches} ({len(batch)}장)")
                batch_result, actual_model_name, usage = call_lmstudio_image_caption_batch(
                    batch, image_dir, config, log_list=log_list
                )
                merge_image_batch_result(batch, batch_result, actual_model_name, usage)
            except Exception as error:
                if contains_rate_limit_marker(error):
                    raise
                if log_list is not None:
                    log_list.append(f"이미지 분석 배치 실패: {batch_index}/{total_batches} ({error})")
                for name in batch:
                    captions[name] = "분석 실패"
        return captions, usage_events, duplicate_records

    batch_size = 15
    total_batches = math.ceil(len(image_list) / batch_size)
    if log_list is not None:
        if callable(config.get("_image_analysis_call")):
            log_list.append(f"선택한 AI 이미지 분석 모드: 배치당 {batch_size}장")
        else:
            log_list.append(f"Gemini 이미지 분석 모드: 배치당 {batch_size}장")
            log_list.append("Gemini 이미지 분석은 context caching 없이 직접 호출합니다.")
    for batch_index, i in enumerate(range(0, len(image_list), batch_size), start=1):
        if cancel_check is not None:
            cancel_check()
        batch = image_list[i : i + batch_size]
        try:
            if log_list is not None:
                log_list.append(f"이미지 분석 배치 처리 중: {batch_index}/{total_batches} ({len(batch)}장)")
            batch_result, actual_model_name, usage = analyze_image_batch_with_provider(
                batch, image_dir, config, image_provider, image_model_name, log_list=log_list
            )
            merge_image_batch_result(batch, batch_result, actual_model_name, usage)
        except Exception as error:
            if contains_rate_limit_marker(error):
                raise
            for name in batch:
                captions[name] = "분석 실패"
    return captions, usage_events, duplicate_records


from voice.providers_stt import (
    gemini_stt_timed_json_prompt,
    transcribe_with_faster_whisper,
    _whisper_cpp_timestamp_to_seconds,
    _extract_whisper_cpp_json_segments,
    transcribe_with_whisper_cpp_vulkan,
    transcribe_with_groq,
    transcribe_with_custom_openai_compat,
    transcribe_with_deepgram,
    _parse_gemini_timestamp_seconds,
    _extract_gemini_stt_json_payload,
    parse_gemini_stt_response,
    merge_usage_payloads,
    transcribe_with_gemini_chunked,
    call_stt_with_fallback_silent,
)



# api_server에서 이동: 공급자 UI 라벨 변환
