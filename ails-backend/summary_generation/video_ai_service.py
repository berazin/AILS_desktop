"""VideoAiService: feature operations and owned state."""
from __future__ import annotations
from summary_generation.video_ai_support import (
    AI_REQUEST_MAX_INPUT_TOKENS,
    Any,
    Callable,
    Mapping,
    PROVIDER_GEMINI,
    TaskCancelledError,
    UNAVAILABLE_EVIDENCE_REPLY,
    VerificationEvidenceLookup,
    _openai_web_citation_spans,
    _video_visual_cache_prefix,
    ai_compliance,
    append_status_log,
    build_image_caption_instruction,
    build_image_data_url,
    build_runtime_summary_config,
    call_gemini_image_caption_batch_with_cache,
    dataclass,
    edition_manifest,
    estimate_request_tokens,
    json,
    managed_video_action,
    nullcontext,
    os,
    parse_image_caption_json_response,
    parse_verifier_json,
    pipeline_utils,
    prepare_generation_request,
    providers,
    re,
    tag_managed_session,
    uuid,
    verification_correction_message,
)
from summary_generation.video_ai_support import __name__ as _support_name
from importlib import import_module as _import_module

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module(_support_name), name)

@dataclass(frozen=True)
class VideoAiServicePorts:
    """Only the collaborators required by this feature; no API state object."""
    append_ai_debug_trace: Callable[..., Any]
    call_managed_gateway_chat: Callable[..., Any]
    get_config: Callable[[], Any]
    replace_config: Callable[[dict], None]
    local_provider_model: Callable[..., Any]
    managed_ai_action: Callable[..., Any]
    managed_workflow_options: Callable[..., Any]
    resolve_chatbot_openai_config: Callable[..., Any]
    selected_ai_model: Callable[..., Any]
    workflow_uses_managed_ai: Callable[..., Any]

class VideoAiService:
    def __init__(self, ports: VideoAiServicePorts):
        self._ports = ports
        self.append_ai_debug_trace = ports.append_ai_debug_trace
        self.call_managed_gateway_chat = ports.call_managed_gateway_chat
        self.local_provider_model = ports.local_provider_model
        self.managed_ai_action = ports.managed_ai_action
        self.managed_workflow_options = ports.managed_workflow_options
        self.resolve_chatbot_openai_config = ports.resolve_chatbot_openai_config
        self.selected_ai_model = ports.selected_ai_model
        self.workflow_uses_managed_ai = ports.workflow_uses_managed_ai

    @property
    def config(self):
        return self._ports.get_config()

    @config.setter
    def config(self, value):
        self._ports.replace_config(value)

    def call_video_verification_web_search(self, claim_ids: list[str], query: str,
                                           config: Mapping, request_id: str) -> dict:
        """Search only through official OpenAI Responses or the authenticated Worker."""
        import requests
        if not config.get("summary_verification_web_search_enabled"):
            return {"status": "unavailable"}
        query = VerificationEvidenceLookup.validate_technical_query(query)
        try:
            request_id = str(uuid.UUID(request_id))
        except (TypeError, ValueError):
            return {"status": "unavailable"}
        identity = config.get("_video_verification_identity")
        if not isinstance(identity, Mapping):
            return {"status": "unavailable"}
        model = str(identity.get("model_id") or "")
        ai_compliance.require_external_provider_consent(
            "OpenAI", self.config,
            ai_compliance.compliance_metadata(edition_manifest.EDITION_MANIFEST),
        )
        cancel_check = config.get("_cancel_check")
        if callable(cancel_check):
            cancel_check()
        if identity.get("mode") == "local":
            selection = config.get("_video_verification_selection")
            if isinstance(selection, Mapping):
                provider, selected_model = selection.get("provider"), selection.get("modelId")
            else:
                provider, selected_model = self.local_provider_model("video_verification")
            if provider != "OpenAI" or selected_model != model or model not in {"gpt-5-nano", "gpt-5.6-luna", "gpt-5.6-sol", "gpt-6-luna"}:
                return {"status": "unavailable"}
            base_url, key, resolved_model, _label, allow_empty = self.resolve_chatbot_openai_config(provider, model)
            if (base_url != "https://api.openai.com/v1/chat/completions" or resolved_model != model
                    or allow_empty or not key):
                return {"status": "unavailable"}
            try:
                response = requests.post("https://api.openai.com/v1/responses",
                                         headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                                         json=prepare_generation_request({"model": model, "input": f"Find authoritative technical references for: {query}. Answer briefly with citations.",
                                               "tools": [{"type": "web_search"}], "tool_choice": "required",
                                               "max_tool_calls": 1, "store": False}),
                                         timeout=30)
                response.raise_for_status()
                payload = response.json()
            except (requests.RequestException, ValueError):
                return {"status": "error"}
            if not isinstance(payload, dict) or payload.get("status") != "completed":
                return {"status": "unavailable"}
            return {"status": "found" if _openai_web_citation_spans(payload) else "missing",
                    "mode": "local", "response": payload}
        if identity.get("mode") != "managed" or not model.startswith("openai/"):
            return {"status": "unavailable"}
        revision = identity.get("policy_revision")
        if isinstance(revision, bool) or not isinstance(revision, int) or revision <= 0:
            return {"status": "unavailable"}
        from accounts.auth_support import ManagedAuthError
        with self.managed_ai_action("video_verification", estimated_cost_usd=0.015,
                                    model_id=model, policy_revision=revision, purpose="web_search") as session:
            if session.get("model_id") != model or session.get("policy_revision") != revision:
                raise ManagedAuthError("영상 검증 모델 정책이 작업 중 변경되었습니다.")
            if isinstance(config.get("_managed_session_records"), list) and not session.get("_stage_pool") and session.get("transport") != "chatgpt":
                config["_managed_session_records"].append(tag_managed_session(session, "web_search"))
            gateway_url = str(session.get("gateway_url") or "")
            if not gateway_url.endswith("/v1/gateway/chat/completions"):
                return {"status": "unavailable"}
            try:
                response = requests.post(gateway_url.rsplit("/chat/completions", 1)[0] + "/web-search",
                                         headers={"Authorization": f"Bearer {session['token']}", "Content-Type": "application/json"},
                                         json={"model": model, "claim_ids": claim_ids, "query": query,
                                               "request_id": request_id}, timeout=30)
                if response.status_code in {401, 402, 403}:
                    raise ManagedAuthError("관리형 웹 검색 인증 또는 크레딧을 확인해 주세요.", status=response.status_code)
                response.raise_for_status()
                payload = response.json()
            except ManagedAuthError:
                raise
            except (requests.RequestException, ValueError):
                return {"status": "error"}
            if not isinstance(payload, dict) or payload.get("status") not in {"found", "missing", "error", "limit", "unavailable"}:
                return {"status": "error"}
            if not payload.get("usage_confirmed") and payload.get("status") == "found":
                return {"status": "unavailable"}
            return {"status": payload["status"], "mode": "managed", "response": payload}

    def call_video_verification_with_tools(
        self, messages: list[dict], config: Mapping, tools: list[dict], execute_tool_call,
        *, response_format: dict, max_tool_rounds: int = 3, log_list=None,
        on_round_complete=None, prior_usages=None, prior_tool_rounds: int = 0,
        prior_tool_outcomes=None, validate_structured_result=None,
        on_tool_complete=None, prior_correction_used: bool = False,
        available_tools=None, correction_source_ids=None, locked_claim_quotes=None,
    ):
        """Run bounded verifier tool turns and return JSON text, model, summed usage.

        A tool callback receives one assistant tool_call and returns text, or a
        mapping with ``content`` and optional OpenAI ``image_parts``. Images are
        attached in a following user message because tool-role images are not
        consistently supported by OpenAI-compatible providers. The required
        validator returns a normalized result after checking source evidence.
        Round callbacks expose tool calls, usage, and only a validated final
        result; tool callbacks expose IDs and status without frame contents.
        """
        if not 0 <= max_tool_rounds <= 24:
            raise ValueError("max_tool_rounds must be between 0 and 24")
        if not 0 <= prior_tool_rounds <= max_tool_rounds + 1:
            raise ValueError("prior_tool_rounds exceeds max_tool_rounds")
        if not callable(execute_tool_call):
            raise TypeError("execute_tool_call must be callable")
        if not callable(validate_structured_result):
            raise TypeError("validate_structured_result must be callable")
        from summary_generation.integrated_chunk_verification import VerificationInputBudgetExceeded
        schema = (response_format.get("json_schema") or {}).get("schema") if isinstance(response_format, dict) else None
        if not isinstance(schema, dict) or schema.get("type") != "object":
            raise ValueError("Verifier response_format must contain an object JSON schema")

        def has_required_shape(value):
            if not isinstance(value, dict):
                return False
            required = schema.get("required") or []
            properties = schema.get("properties") or {}
            if not isinstance(required, list) or not required or not isinstance(properties, dict):
                return False
            if any(key not in value for key in required):
                return False
            if schema.get("additionalProperties") is False and set(value) - set(properties):
                return False
            for key in required:
                expected = properties.get(key)
                if not isinstance(expected, dict):
                    return False
                kind = expected.get("type")
                actual = value[key]
                if kind == "array" and not isinstance(actual, list):
                    return False
                if kind == "object" and not isinstance(actual, dict):
                    return False
                if kind == "integer" and (isinstance(actual, bool) or not isinstance(actual, int)):
                    return False
                if kind == "string" and not isinstance(actual, str):
                    return False
            return True
        cancel_check = config.get("_cancel_check")
        reasoning_effort = str(config.get("summary_verification_reasoning_effort") or "medium")
        if reasoning_effort not in {"none", "minimal", "low", "medium", "high"}:
            raise ValueError("영상 근거 검증 추론 수준이 올바르지 않습니다.")
        conversation = [dict(message) for message in messages]
        usages = [dict(item) for item in (prior_usages or [])]
        tool_outcomes = [dict(item) for item in (prior_tool_outcomes or [])]
        correction_used = bool(prior_correction_used)
        allowed_tools = {
            item.get("function", {}).get("name"): item.get("function", {})
            for item in tools if isinstance(item, dict) and isinstance(item.get("function"), dict)
        }

        def invalid_tool_request(call):
            if not isinstance(call, dict) or not isinstance(call.get("id"), str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", call["id"]):
                return "id"
            function = call.get("function")
            if not isinstance(function, dict) or function.get("name") not in allowed_tools:
                return "request"
            raw_args = function.get("arguments")
            if not isinstance(raw_args, str) or len(raw_args) > (16_000 if function["name"] == "register_concept_candidates" else 10_000 if function["name"] == "register_claims" else 2_000):
                return "request"
            try:
                args = json.loads(raw_args)
            except (TypeError, ValueError):
                return "request"
            if not isinstance(args, dict):
                return "request"
            parameters = allowed_tools[function["name"]].get("parameters") or {}
            if parameters.get("additionalProperties") is False and set(args) - set(parameters.get("properties") or {}):
                return "request"
            if any(key not in args for key in parameters.get("required") or []):
                return "request"
            properties = parameters.get("properties") or {}
            if function["name"] == "register_concept_candidates":
                items = args.get("candidates")
                if not isinstance(items, list) or not 1 <= len(items) <= 20 or any(
                    not isinstance(item, dict)
                    or not {"summary_quote", "t_ids", "reason", "needs_frame"} <= set(item)
                    or set(item) - {"summary_quote", "t_ids", "reason", "needs_frame"}
                    or not isinstance(item["summary_quote"], str) or not 1 <= len(item["summary_quote"]) <= 2000
                    or not isinstance(item["reason"], str) or not 1 <= len(item["reason"]) <= 300
                    or not isinstance(item["needs_frame"], bool)
                    or not isinstance(item["t_ids"], list) or len(item["t_ids"]) > 4
                    or len(item["t_ids"]) != len(set(map(str, item["t_ids"])))
                    or any(not isinstance(t_id, str) or not re.fullmatch(r"[ST]\d{4}", t_id)
                           for t_id in item["t_ids"])
                    for item in items
                ):
                    return "request"
            if function["name"] == "register_claims":
                items = args.get("claims")
                if not isinstance(items, list) or not 1 <= len(items) <= 20 or any(
                    not isinstance(item, dict) or "summary_quote" not in item
                    or set(item) - {"summary_quote", "occurrence"}
                    or not isinstance(item["summary_quote"], str) or not 1 <= len(item["summary_quote"]) <= 2000
                    or ("occurrence" in item and (not isinstance(item["occurrence"], int)
                        or isinstance(item["occurrence"], bool) or item["occurrence"] < 0)) for item in items
                ):
                    return "request"
            ids = args.get("claim_ids")
            if "block_ids" in properties:
                block_ids = args.get("block_ids")
                if (not isinstance(block_ids, list) or not 1 <= len(block_ids) <= 4
                        or any(not isinstance(item, str) or not re.fullmatch(r"B\d{4}", item)
                               for item in block_ids)):
                    return "request"
            if "claim_ids" in properties and (not isinstance(ids, list) or not 1 <= len(ids) <= 4 or any(
                not isinstance(item, str) or not re.fullmatch(r"C\d{3,4}", item) for item in ids
            )):
                return "request"
            keywords = args.get("keywords", "")
            if "keywords" in properties and (not isinstance(keywords, str) or len(keywords) > 80):
                return "request"
            if function["name"] in {"lookup_stt", "lookup_stt_by_id", "lookup_stt_by_time"}:
                quote = args.get("summary_quote")
                source_ids = args.get("t_ids")
                if (len(ids) != 1 or (quote is not None and (not isinstance(quote, str) or not 1 <= len(quote) <= 2_000))
                        or (source_ids is not None and (not isinstance(source_ids, list)
                            or not 1 <= len(source_ids) <= 4 or any(
                                not isinstance(item, str) or not re.fullmatch(r"[ST]\d{4}", item)
                                for item in source_ids)))
                        or (source_ids and (args.get("start_seconds") is not None or args.get("end_seconds") is not None))
                        or (not source_ids and args.get("start_seconds") is None and args.get("end_seconds") is None)):
                    return "request"
                if function["name"] == "lookup_stt_by_id" and not source_ids:
                    return "request"
                if function["name"] == "lookup_stt_by_time" and (source_ids
                        or args.get("start_seconds") is None or args.get("end_seconds") is None):
                    return "request"
            if "query" in properties:
                try:
                    VerificationEvidenceLookup.validate_technical_query(args.get("query"))
                except ValueError:
                    return "request"
                if function["name"] != "lookup_concept_web" and args.get("reason_code") != "technical_accuracy_uncertain":
                    return "request"
            elif function["name"] in {"lookup_frame", "lookup_frame_by_t_id"} and properties:
                t_id = args.get("t_id")
                if t_id is not None:
                    if (len(ids) != 1 or not isinstance(t_id, str) or not re.fullmatch(r"T\d{4}", t_id)
                            or str(keywords).strip() or args.get("start_seconds") is not None
                            or args.get("end_seconds") is not None):
                        return "request"
                elif function["name"] == "lookup_frame_by_t_id":
                    return "request"
                elif not str(keywords).strip() and args.get("start_seconds") is None and args.get("end_seconds") is None:
                    return "request"
            for key in ("start_seconds", "end_seconds"):
                value = args.get(key)
                if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= 100_000_000):
                    return "request"
            if args.get("start_seconds") is not None and args.get("end_seconds") is not None and args["end_seconds"] < args["start_seconds"]:
                return "request"
            return None

        def record_round(message, usage):
            invalid_message = not isinstance(message, dict) or message.get("role") != "assistant"
            if invalid_message:
                message = {}
            usages.append(dict(usage or {}))
            tool_calls = message.get("tool_calls") or []
            invalid_kind = next((kind for call in tool_calls if (kind := invalid_tool_request(call))), None)
            if tool_calls and round_index >= max_tool_rounds:
                invalid_kind = "budget"
            parsed = None
            rejected_structured_result = None
            validation_error = ValueError("Verifier response has no assistant message") if invalid_message else None
            validation_code = "validation_error"
            fatal_error = None
            if not tool_calls and validation_error is None:
                try:
                    parsed = parse_verifier_json(message.get("content"))
                except (TypeError, ValueError):
                    validation_error = ValueError("Verifier response is not JSON")
                    validation_code = "json_syntax"
                if validation_error is None and not has_required_shape(parsed):
                    validation_error = ValueError("Verifier response does not match required schema fields")
                    validation_code = "schema_shape"
                if validation_error is None:
                    try:
                        parsed = validate_structured_result(parsed)
                        if not isinstance(parsed, dict):
                            raise ValueError("Verifier validation did not return a normalized object")
                    except (ValueError, TypeError) as error:
                        rejected_structured_result = parsed
                        validation_error = error
                        validation_code = "semantic_validation"
                    except Exception as error:
                        fatal_error = error
            correction_message = None
            if validation_error is not None or invalid_kind is not None:
                code = ({"id": "tool_id", "request": "tool_request", "budget": "tool_limit"}.get(invalid_kind)
                        if invalid_kind else validation_code)
                claim_id, allowed_ids, locked_claim_id, missing_lookup_ids = "", None, "", []
                if (code == "semantic_validation" and callable(correction_source_ids)
                        and isinstance(rejected_structured_result, dict)):
                    match = re.search(r"\b(claims|issues|edits)\[(\d{1,3})\]\.source_ids\b", str(validation_error)[:256])
                    entries = rejected_structured_result.get(match.group(1)) if match else None
                    if match and isinstance(entries, list) and int(match.group(2)) < len(entries):
                        claim = entries[int(match.group(2))]
                        if isinstance(claim, dict) and re.fullmatch(r"C\d{3,4}", str(claim.get("claim_id") or "")):
                            claim_id = claim["claim_id"]
                            allowed_ids = correction_source_ids(claim_id)
                if (code == "semantic_validation" and callable(locked_claim_quotes)
                        and isinstance(rejected_structured_result, dict)):
                    match = re.search(r"\bclaims\[(\d{1,3})\]\.summary_quote\b", str(validation_error)[:256])
                    claims = rejected_structured_result.get("claims")
                    if match and isinstance(claims, list) and int(match.group(1)) < len(claims):
                        claim = claims[int(match.group(1))]
                        candidate = str(claim.get("claim_id") or "") if isinstance(claim, dict) else ""
                        if re.fullmatch(r"C\d{3,4}", candidate) and locked_claim_quotes(candidate):
                            locked_claim_id = candidate
                if code == "semantic_validation" and str(validation_error).startswith((
                        "Evidence lookup references claims absent from inventory:",
                        "Registered claims absent from inventory:")):
                    missing_lookup_ids = re.findall(r"\bC\d{3,4}\b", str(validation_error)[:256])
                correction_message = verification_correction_message(
                    code, validation_error, claim_id=claim_id,
                    allowed_source_ids=allowed_ids if isinstance(allowed_ids, list) else None,
                    locked_claim_id=locked_claim_id, missing_lookup_claim_ids=missing_lookup_ids)
            if (validation_error and "unsafe_edit" in str(validation_error)
                    and isinstance(rejected_structured_result, dict)
                    and len(json.dumps(rejected_structured_result, ensure_ascii=False)) > 100_000):
                # Record paid usage, but never repair after dropping the problems
                # needed to check whether the correction actually preserves them.
                correction_message = None
                fatal_error = ValueError("Unsafe verification response is too large to retain for correction")
            if callable(on_round_complete):
                checkpoint = {
                    "round_index": round_index,
                    "tool_calls": [] if invalid_kind in {"id", "budget"} else [dict(call) for call in tool_calls],
                    "completed": not tool_calls and validation_error is None and fatal_error is None,
                    "invalid_request": bool(invalid_kind or validation_error),
                    "correction_used": bool(correction_used or invalid_kind or validation_error),
                    "unsafe_edit_retry": bool(validation_error and "unsafe_edit" in str(validation_error)),
                    "usage": dict(usage or {}),
                    "model": str((usage or {}).get("model") or model_name),
                }
                if checkpoint["completed"]:
                    checkpoint["structured_result"] = parsed
                elif rejected_structured_result is not None:
                    checkpoint["rejected_structured_result"] = rejected_structured_result
                if not checkpoint["completed"] and not correction_used and correction_message:
                    checkpoint["correction_message"] = correction_message
                on_round_complete(checkpoint)
            if fatal_error is not None:
                raise fatal_error
            return parsed, validation_error, invalid_kind, validation_code, correction_message

        selection = config.get("_video_verification_selection")
        if not isinstance(selection, Mapping):
            selection = self.selected_ai_model("video_summary")
        pinned_identity = config.get("_video_verification_identity")
        if pinned_identity is not None and not isinstance(pinned_identity, Mapping):
            raise ValueError("Invalid video verification model identity")
        if selection["mode"] == "local":
            if "provider" in selection and "modelId" in selection:
                provider, model_name = selection["provider"], selection["modelId"]
            else:
                provider, model_name = self.local_provider_model("video_summary")
            base_url, api_key, model_name, label, allow_empty = self.resolve_chatbot_openai_config(
                provider, model_name,
            )
            if pinned_identity and (
                pinned_identity.get("mode") != "local" or pinned_identity.get("model_id") != model_name
            ):
                raise RuntimeError("영상 검증 모델 선택이 작업 중 변경되었습니다.")

            def call_round(request_options):
                message, usage = pipeline_utils.call_openai_compatible_chat(
                    base_url, api_key, model_name, conversation,
                    provider_label=f"{label} video verification",
                    allow_empty_api_key=allow_empty,
                    log_list=log_list, cancel_check=cancel_check,
                    request_options=request_options, return_message=True,
                    max_retries=0,
                )
                return message, usage, record_round(message, usage)

        else:
            model_name = str((pinned_identity or {}).get("model_id") or "")
            session_options = self.managed_workflow_options("video_verification") if not pinned_identity else {}
            if pinned_identity:
                if pinned_identity.get("mode") not in {"managed", "chatgpt"}:
                    raise RuntimeError("영상 검증 모델 선택이 작업 중 변경되었습니다.")
                pinned_model = str(pinned_identity.get("model_id") or "")
                pinned_revision = pinned_identity.get("policy_revision")
                if not pinned_model or (pinned_identity.get("mode") == "managed" and (isinstance(pinned_revision, bool) or not isinstance(pinned_revision, int) or pinned_revision <= 0)):
                    raise ValueError("Invalid managed video verification identity")
                session_options = {"model_id": pinned_model, "policy_revision": pinned_revision}

            def call_round(request_options):
                nonlocal model_name
                with managed_video_action(self, config, "verification", "video_verification", **session_options) as session:
                    model_name = str(session["model_id"])
                    if pinned_identity and (
                        model_name != pinned_identity["model_id"]
                        or (pinned_identity.get("mode") == "managed" and int(session.get("policy_revision") or 0) != pinned_identity["policy_revision"])
                    ):
                        raise RuntimeError("영상 검증 모델 정책이 작업 중 변경되었습니다.")
                    if isinstance(config.get("_managed_session_records"), list) and not session.get("_stage_pool") and session.get("transport") != "chatgpt":
                        config["_managed_session_records"].append(tag_managed_session(session, "verification"))
                    message, usage = self.call_managed_gateway_chat(
                        session, conversation, log_list=log_list,
                        cancel_check=cancel_check, request_options=request_options,
                        return_message=True, max_retries=0,
                    )
                    return message, usage, record_round(message, usage)

        for round_index in range(prior_tool_rounds, max_tool_rounds + 2):
            if callable(cancel_check):
                cancel_check()
            active_tools = available_tools() if callable(available_tools) else tools
            if not isinstance(active_tools, list):
                raise TypeError("available_tools must return a list")
            allowed_names = {item.get("function", {}).get("name") for item in tools if isinstance(item, dict)}
            if any(not isinstance(item, dict) or item.get("function", {}).get("name") not in allowed_names
                   for item in active_tools):
                raise ValueError("available_tools returned an unknown tool")
            allowed_tools = {item.get("function", {}).get("name"): item.get("function", {}) for item in active_tools}
            request_options = {"response_format": response_format,
                               "reasoning": {"effort": reasoning_effort}}
            if round_index < max_tool_rounds and active_tools:
                request_options["tools"] = active_tools
                request_options["tool_choice"] = "auto"
            estimated_input = estimate_request_tokens({
                "model": model_name, "messages": conversation,
                "response_format": response_format, "tools": request_options.get("tools", [])})
            working_limit = int(config.get("_video_verifier_working_limit") or
                                pipeline_utils.video_request_working_limit(model_name))
            if estimated_input > min(AI_REQUEST_MAX_INPUT_TOKENS, working_limit):
                raise VerificationInputBudgetExceeded("검증 도구 대화가 안전 입력 예산을 넘었습니다.")
            message, usage, (parsed, validation_error, invalid_kind, validation_code, correction_message) = call_round(request_options)
            if validation_error is not None or invalid_kind is not None:
                if correction_used or round_index >= max_tool_rounds + 1:
                    code = ({"id": "tool_id", "request": "tool_request", "budget": "tool_limit"}.get(invalid_kind)
                            if invalid_kind else validation_code)
                    raise ValueError(correction_message or verification_correction_message(code, validation_error))
                correction_used = True
                if invalid_kind in {"id", "budget"} or validation_error is not None:
                    code = ({"id": "tool_id", "request": "tool_request", "budget": "tool_limit"}.get(invalid_kind)
                            if invalid_kind else ("semantic_validation" if validation_error and validation_code == "semantic_validation" else validation_code))
                    if (validation_error and "unsafe_edit" in str(validation_error)
                            and isinstance(parsed, dict)):
                        rejected_json = json.dumps(parsed, ensure_ascii=False)
                        if len(rejected_json) <= 100_000:
                            conversation.append({"role": "assistant", "content": rejected_json})
                    conversation.append({"role": "user", "content": correction_message or verification_correction_message(code, validation_error)})
                    continue
            tool_calls = message.get("tool_calls") or []
            if tool_calls:
                if round_index >= max_tool_rounds:
                    raise RuntimeError("영상 근거 검증의 도구 호출 한도를 초과했습니다.")
                conversation.append(message)
                image_parts = []
                for tool_call in tool_calls:
                    if callable(cancel_check):
                        cancel_check()
                    call_id = tool_call.get("id") if isinstance(tool_call, dict) else None
                    function = tool_call.get("function") if isinstance(tool_call, dict) else None
                    tool_name = str(function.get("name") or "") if isinstance(function, Mapping) else ""
                    try:
                        if invalid_tool_request(tool_call):
                            result = {"content": '{"status":"invalid_request","evidence":[],"error":"invalid_request"}', "evidence_status": "invalid_request"}
                        else:
                            result = execute_tool_call(tool_call)
                        if isinstance(result, Mapping):
                            content = result.get("content")
                            parts = result.get("image_parts") or []
                            evidence_status = result.get("evidence_status", "unknown")
                            if evidence_status not in {"found", "missing", "error", "invalid_request", "limit", "unavailable", "unknown"}:
                                raise ValueError("Invalid evidence_status")
                            if not isinstance(parts, list) or any(
                                not isinstance(part, dict) or part.get("type") != "image_url"
                                for part in parts
                            ):
                                raise ValueError("image_parts must contain image_url parts")
                        else:
                            content = result
                            evidence_status = "unknown"
                            parts = []
                        if not isinstance(content, str):
                            raise TypeError("Tool result content must be text")
                    except TaskCancelledError:
                        raise
                    except Exception as error:
                        # The paid model round is already checkpointed. Preserve
                        # the lookup's explicit failure category without details.
                        evidence_status = getattr(error, "evidence_status", None)
                        if evidence_status not in {"invalid_request", "limit", "error"} and not isinstance(error, OSError):
                            raise
                        evidence_status = evidence_status if evidence_status in {"invalid_request", "limit"} else "error"
                        content = (json.dumps({"status": evidence_status, "evidence": [], "error": evidence_status})
                                   if evidence_status != "error" else UNAVAILABLE_EVIDENCE_REPLY)
                        parts = []
                    if parts:
                        image_parts.append({"type": "text", "text": f"Evidence image for tool call {call_id}:"})
                        image_parts.extend(parts)
                    conversation.append({"role": "tool", "tool_call_id": call_id, "content": content})
                    outcome = {"tool_call_id": call_id, "name": tool_name, "evidence_status": evidence_status}
                    tool_outcomes.append(outcome)
                    if callable(on_tool_complete):
                        on_tool_complete({"round_index": round_index, **outcome, "completed": True})
                if image_parts:
                    conversation.append({"role": "user", "content": image_parts})
                if invalid_kind == "request":
                    conversation.append({"role": "user", "content": verification_correction_message("tool_request")})
                continue
            content = message.get("content")
            if not isinstance(content, str) or not content.strip():
                raise RuntimeError("영상 근거 검증의 최종 JSON 응답이 비어 있습니다.")
            if not isinstance(parsed, dict):
                raise RuntimeError("영상 근거 검증의 최종 응답이 JSON 객체가 아닙니다.")
            total = {
                "input_tokens": sum(int(item.get("input_tokens") or 0) for item in usages),
                "output_tokens": sum(int(item.get("output_tokens") or 0) for item in usages),
                "total_tokens": sum(int(item.get("total_tokens") or 0) for item in usages),
                "source": "api" if all(item.get("source") == "api" for item in usages) else "estimated",
                "calls": usages,
                "tool_rounds": round_index,
                "tool_budget_exhausted": bool(tools and round_index >= max_tool_rounds),
                "tool_outcomes": tool_outcomes,
            }
            for key in ("thought_tokens", "prompt_cache_hit_tokens", "prompt_cache_miss_tokens", "cache_write_tokens"):
                if any(key in item for item in usages):
                    total[key] = sum(item.get(key, 0) for item in usages)
            if all("actual_cost_usd" in item for item in usages):
                total["actual_cost_usd"] = sum(item["actual_cost_usd"] for item in usages)
            return content, str((usage or {}).get("model") or model_name), total
        raise RuntimeError("영상 근거 검증이 호출 한도 내에 끝나지 않았습니다.")






    def call_managed_video_summary(self, prompt: str, config: Mapping, log_list=None):
        shared_session = config.get("_managed_summary_session")
        pinned = config.get("_summary_pinned_identity") or {}
        session_options = ({"model_id": pinned["model_id"], "policy_revision": pinned["policy_revision"]}
                           if pinned.get("mode") == "managed" else self.managed_workflow_options("video_summary"))
        action = nullcontext(shared_session) if isinstance(shared_session, Mapping) else managed_video_action(self, config, "summary", "video_summary", **session_options)
        with action as session:
            if isinstance(config.get("_managed_session_records"), list) and not session.get("_stage_pool") and session.get("transport") != "chatgpt":
                config["_managed_session_records"].append(tag_managed_session(session, "summary"))
            append_status_log(log_list, f"관리형 영상 정리 모델: {session['model_id']}")
            request_options = {"reasoning": {"effort": config.get("summary_reasoning_effort") or "none"}}
            if config.get("_summary_json_bundle"):
                request_options["response_format"] = {"type": "json_object"}
            content, usage = self.call_managed_gateway_chat(
                session,
                [{"role": "user", "content": prompt}],
                log_list=log_list,
                cancel_check=config.get("_cancel_check"),
                request_options=request_options,
            )
            return content, session["model_id"], usage

    def call_video_stt_cleanup(self, prompt: str, config: Mapping, log_list=None):
        """Charge STT cleanup to its own selected workflow and receipt phase."""
        selection = config.get("_stt_cleanup_selection") or self.selected_ai_model("video_stt_cleanup")
        if selection["mode"] == "local":
            provider, model_name = str(selection["provider"]), str(selection["modelId"])
            base_url, api_key, model_name, label, allow_empty = self.resolve_chatbot_openai_config(
                provider, model_name,
            )
            content, usage = pipeline_utils.call_openai_compatible_chat(
                base_url, api_key, model_name, [{"role": "user", "content": prompt}],
                provider_label=f"{label} STT cleanup", log_list=log_list,
                cancel_check=config.get("_cancel_check"), allow_empty_api_key=allow_empty,
                request_options={"response_format": {"type": "json_object"}},
            )
            return content, str(usage.get("model") or model_name), usage
        identity = config.get("_stt_cleanup_pinned_identity") or {}
        session_options = ({"model_id": identity["model_id"],
                            "policy_revision": identity["policy_revision"]}
                           if identity.get("mode") == "managed"
                           else self.managed_workflow_options("video_stt_cleanup"))
        with managed_video_action(self, config, "stt_cleanup", "video_stt_cleanup", **session_options) as session:
            if isinstance(config.get("_managed_session_records"), list) and not session.get("_stage_pool") and session.get("transport") != "chatgpt":
                config["_managed_session_records"].append(tag_managed_session(session, "stt_cleanup"))
            content, usage = self.call_managed_gateway_chat(
                session, [{"role": "user", "content": prompt}], log_list=log_list,
                cancel_check=config.get("_cancel_check"),
                request_options={"response_format": {"type": "json_object"},
                                 "reasoning": {"effort": "none"}},
            )
            return content, session["model_id"], usage

    def call_image_analysis_batch(self, batch, image_dir, config: Mapping, log_list=None):
        """Analyze one caption batch through the shared managed/BYOK selector."""
        instruction = build_image_caption_instruction(
            batch,
            allow_duplicate_detection=not bool(config.get("disable_image_duplicate_detection")),
            language=config.get("language"),
        )
        content_parts = [{"type": "text", "text": instruction}]
        for image_name in batch:
            content_parts.append({
                "type": "image_url",
                "image_url": {"url": build_image_data_url(os.path.join(image_dir, image_name))},
            })
        content_parts.append({"type": "text", "text": "Filenames: " + ", ".join(batch)})
        messages = [{"role": "user", "content": content_parts}]
        selection = self.selected_ai_model("image_analysis")
        if selection["mode"] == "local":
            provider, model_name = self.local_provider_model("image_analysis")
            if provider == PROVIDER_GEMINI:
                runtime_config = dict(config)
                runtime_config["image_model_name"] = model_name
                return call_gemini_image_caption_batch_with_cache(
                    batch, image_dir, runtime_config, log_list=log_list,
                )
            base_url, api_key, model_name, label, allow_empty = self.resolve_chatbot_openai_config(
                provider, model_name,
            )
            content, usage = pipeline_utils.call_openai_compatible_chat(
                base_url, api_key, model_name, messages,
                provider_label=f"{label} image analysis",
                log_list=log_list,
                cancel_check=config.get("_cancel_check"),
                allow_empty_api_key=allow_empty,
                request_options={"response_format": {"type": "json_object"}, },
                timeout=90,
                total_timeout=120,
                max_retries=0,
            )
            return parse_image_caption_json_response(content, label, log_list=log_list), model_name, usage
        with managed_video_action(self, config, "image_analysis", "image_analysis", **self.managed_workflow_options("image_analysis")) as session:
            if isinstance(config.get("_managed_session_records"), list) and not session.get("_stage_pool") and session.get("transport") != "chatgpt":
                config["_managed_session_records"].append(tag_managed_session(session, "image_analysis"))
            append_status_log(log_list, f"관리형 이미지 분석 모델: {session['model_id']}")
            content, usage = self.call_managed_gateway_chat(
                session, messages,
                log_list=log_list,
                cancel_check=config.get("_cancel_check"),
                request_options={
                    "response_format": {"type": "json_object"},
                    "reasoning": {"effort": "none"},

                },
                timeout=90,
                total_timeout=120,
                max_retries=0,
            )
            return parse_image_caption_json_response(
                content, "AILS managed image analysis", log_list=log_list,
            ), session["model_id"], usage

    def call_video_visual_event(self, messages: list[dict], config: Mapping, log_list=None, *, response_format: dict, max_tokens: int | None = None):
        # Keep the legacy keyword compatible; output is now provider-controlled.
        # requests uses its connect timeout while writing the image payload too.
        # Give uploads room under concurrent LMS jobs, while retaining the 60s
        # idle-read timeout. The total includes upload + streamed generation.
        transport_options = {"timeout": (180, 60), "total_timeout": 300, "max_retries": 0}
        shared_session = config.get("_managed_visual_session")
        if shared_session is None and self.workflow_uses_managed_ai("video_visual"):
            with managed_video_action(self, config, "video_visual", "video_visual", **self.managed_workflow_options("video_visual")) as session:
                return self.call_video_visual_event(
                    messages, {**config, "_managed_visual_session": session}, log_list,
                    response_format=response_format,
                )
        if isinstance(shared_session, Mapping):
            if isinstance(config.get("_managed_session_records"), list) and not shared_session.get("_stage_pool") and shared_session.get("transport") != "chatgpt":
                config["_managed_session_records"].append(tag_managed_session(shared_session, "video_visual"))
            messages, cache_options = ((messages, {}) if shared_session.get("transport") == "chatgpt"
                                       else _video_visual_cache_prefix(messages, shared_session["model_id"]))
            if cache_options:
                # Vercel maps providerOptions; the raw OpenAI request option is
                # ignored on its compatibility route. Do not write unique STT
                # suffixes to cache at the higher cache-write rate.
                cache_options["providerOptions"] = {"openai": {
                    "promptCacheOptions": cache_options["prompt_cache_options"],
                }}
            content, usage = self.call_managed_gateway_chat(
                shared_session,
                messages,
                log_list=log_list,
                cancel_check=config.get("_cancel_check"),
                request_options={
                    **cache_options,
                    "response_format": response_format,
                    "reasoning": {"effort": "none"},

                },
                **transport_options,
            )
            model_name = str(usage.get("model") or shared_session["model_id"])
            return content, model_name, usage

        provider, model_name = self.local_provider_model("video_visual")
        base_url, api_key, model_name, label, _ = self.resolve_chatbot_openai_config(provider, model_name)
        messages, cache_options = _video_visual_cache_prefix(messages, model_name)
        content, usage = pipeline_utils.call_openai_compatible_chat(
            base_url,
            api_key,
            model_name,
            messages,
            provider_label=f"{label} video vision",
            log_list=log_list,
            cancel_check=config.get("_cancel_check"),
            request_options={
                **cache_options,
                "response_format": response_format,

            },
            **transport_options,
        )
        return content, str(usage.get("model") or model_name), usage

    def call_personal_video_summary(self, prompt: str, config: Mapping, log_list=None):
        provider, model_name = self.local_provider_model("video_summary")
        if provider == PROVIDER_GEMINI:
            runtime_config = build_runtime_summary_config(config, provider=provider, model_name=model_name)
            return providers.call_ai_summary(prompt, runtime_config, log_list=log_list)
        base_url, api_key, model_name, label, _ = self.resolve_chatbot_openai_config(provider, model_name)
        extra_options = (
            {"request_options": {"response_format": {"type": "json_object"},
                                 "reasoning": {"effort": config.get("summary_reasoning_effort") or "none"}}}
            if config.get("_summary_json_bundle") else {}
        )
        content, usage = pipeline_utils.call_openai_compatible_chat(
            base_url,
            api_key,
            model_name,
            [{"role": "user", "content": prompt}],
            provider_label=f"{label} video summary",
            log_list=log_list,
            cancel_check=config.get("_cancel_check"),
            **extra_options,
        )
        return content, str(usage.get("model") or model_name), usage

    def call_video_verification(self, prompt: str, config: Mapping, log_list=None):
        from summary_generation.claim_verification import VERIFICATION_JSON_SCHEMA, call_luna_verification

        selection = config.get("_video_verification_selection")
        if not isinstance(selection, Mapping):
            selection = self.selected_ai_model("video_summary")
        if selection["mode"] == "local":
            if "provider" in selection and "modelId" in selection:
                provider, model_name = selection["provider"], selection["modelId"]
            else:
                provider, model_name = self.local_provider_model("video_summary")
            if provider != "OpenAI":
                base_url, api_key, model_name, label, _ = self.resolve_chatbot_openai_config(provider, model_name)
                from summary_generation.claim_verification import VERIFICATION_JSON_SCHEMA
                content, usage = pipeline_utils.call_openai_compatible_chat(
                    base_url, api_key, model_name, [{"role": "user", "content": prompt}],
                    provider_label=f"{label} verification", log_list=log_list,
                    cancel_check=config.get("_cancel_check"),
                    request_options={
                        "response_format": {
                            "type": "json_schema",
                            "json_schema": {
                                "name": "lecture_claim_verification", "strict": True,
                                "schema": VERIFICATION_JSON_SCHEMA,
                            },
                        },
                    },
                )
                return content, str(usage.get("model") or model_name), usage
            return call_luna_verification(
                prompt, {**config, "summary_verification_model_name": model_name}, log_list=log_list,
            )
        identity = config.get("_video_verification_identity")
        if isinstance(identity, Mapping) and identity.get("mode") == "managed":
            session_options = {"model_id": identity["model_id"], "policy_revision": identity["policy_revision"]}
        else:
            session_options = self.managed_workflow_options("video_verification")
        with managed_video_action(self, config, "verification", "video_verification", **session_options) as session:
            if isinstance(config.get("_managed_session_records"), list) and not session.get("_stage_pool") and session.get("transport") != "chatgpt":
                config["_managed_session_records"].append(tag_managed_session(session, "verification"))
            content, usage = self.call_managed_gateway_chat(
                session, [{"role": "user", "content": prompt}],
                log_list=log_list,
                cancel_check=config.get("_cancel_check"),
                request_options={
                    "response_format": {
                        "type": "json_schema",
                        "json_schema": {
                            "name": "lecture_claim_verification", "strict": True,
                            "schema": VERIFICATION_JSON_SCHEMA,
                        },
                    },

                },
            )
            return content, session["model_id"], usage
