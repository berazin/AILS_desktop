"""CodeAssistService: feature operations and owned state."""
from __future__ import annotations
from code_services.assist_support import (
    Any,
    Callable,
    dataclass,
    json,
    language_display_name,
    os,
    providers,
    re,
)
from code_services.assist_support import __name__ as _support_name
from importlib import import_module as _import_module

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module(_support_name), name)

@dataclass(frozen=True)
class CodeAssistServicePorts:
    """Only the collaborators required by this feature; no API state object."""
    call_managed_gateway_chat: Callable[..., Any]
    get_config: Callable[[], Any]
    replace_config: Callable[[dict], None]
    local_provider_model: Callable[..., Any]
    managed_ai_action: Callable[..., Any]
    managed_workflow_options: Callable[..., Any]
    parse_code_review_response: Callable[..., Any]
    workflow_uses_managed_ai: Callable[..., Any]

class CodeAssistService:
    def __init__(self, ports: CodeAssistServicePorts):
        self._ports = ports
        self.call_managed_gateway_chat = ports.call_managed_gateway_chat
        self.local_provider_model = ports.local_provider_model
        self.managed_ai_action = ports.managed_ai_action
        self.managed_workflow_options = ports.managed_workflow_options
        self.parse_code_review_response = ports.parse_code_review_response
        self.workflow_uses_managed_ai = ports.workflow_uses_managed_ai

    @property
    def config(self):
        return self._ports.get_config()

    @config.setter
    def config(self, value):
        self._ports.replace_config(value)

    def review_code_sandbox(self, payload: dict, emit=None):
        active_file = str(payload.get("file_name", "") or "").strip() or "main.py"
        language = str(payload.get("language", "") or "").strip() or "plaintext"
        code = str(payload.get("code", "") or "")
        project_name = str(payload.get("project_name", "") or "").strip() or "project"
        files = payload.get("files") if isinstance(payload.get("files"), list) else []
        run_result = payload.get("run_result") if isinstance(payload.get("run_result"), dict) else {}

        use_managed = self.workflow_uses_managed_ai("code_assist")
        provider, model_name = ("AILS", "") if use_managed else self.local_provider_model("code_assist")
        streamed_text = ""
        streamed_issue_keys = set()

        def emit_completed_issues(token):
            nonlocal streamed_text
            streamed_text += str(token or "")
            if emit is None:
                return
            decoder = json.JSONDecoder()
            for index, char in enumerate(streamed_text):
                if char != "{":
                    continue
                try:
                    candidate, _ = decoder.raw_decode(streamed_text[index:])
                except (json.JSONDecodeError, ValueError):
                    continue
                if not isinstance(candidate, dict) or not {"file", "line", "severity", "title"}.issubset(candidate):
                    continue
                normalized = self.parse_code_review_response(
                    json.dumps({"summary": "", "issues": [candidate]}, ensure_ascii=False),
                    active_file,
                ).get("issues", [])
                if not normalized:
                    continue
                issue = normalized[0]
                key = json.dumps(issue, ensure_ascii=False, sort_keys=True)
                if key in streamed_issue_keys:
                    continue
                streamed_issue_keys.add(key)
                emit({"type": "issue", "issue": issue})

        def numbered_source(source):
            return "\n".join(
                f"{index:>5} | {line}"
                for index, line in enumerate(str(source or "").splitlines(), start=1)
            )

        file_blocks = []
        total_chars = 0
        max_chars = 100000
        for item in files:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name", "") or "").strip()
            file_code = str(item.get("code", "") or "")
            normalized_name = name.replace("\\", "/").strip("/")
            if (
                not normalized_name
                or ("/" in normalized_name and not payload.get("include_nested_files"))
                or os.path.splitext(normalized_name)[1].lower() == ".txt"
            ):
                continue
            remaining = max_chars - total_chars
            if remaining <= 0:
                file_blocks.append("[Some project files were omitted because the payload was too large.]")
                break
            numbered_code = numbered_source(file_code)
            clipped = numbered_code[:remaining]
            total_chars += len(clipped)
            suffix = "\n[TRUNCATED]" if len(numbered_code) > len(clipped) else ""
            file_blocks.append(f"--- FILE: {normalized_name} ---\n{clipped}{suffix}")
        if not file_blocks:
            normalized_active_file = active_file.replace("\\", "/").strip("/")
            if (
                ("/" in normalized_active_file and not payload.get("include_nested_files"))
                or os.path.splitext(normalized_active_file)[1].lower() == ".txt"
            ):
                file_blocks.append("[No analyzable project files were found in this folder.]")
            else:
                file_blocks.append(f"--- FILE: {normalized_active_file} ---\n{numbered_source(code)[:max_chars]}")

        stdout = str(run_result.get("stdout", "") or "")
        stderr = str(run_result.get("stderr", "") or "")
        success = run_result.get("success")
        output_language = language_display_name(self.config.get("language"))
        prompt = f"""
You are an expert programming tutor and IDE diagnostic assistant.
Analyze the current project and the run result. Return ONLY valid JSON with this shape:
{{
  "summary": "short {output_language} summary",
  "can_run": true | false | null,
  "issues": [
    {{
      "file": "relative file name",
      "line": 1,
      "column": 1,
      "severity": "error" | "warning" | "info",
      "title": "short title in {output_language}",
      "explanation": "why this is a problem in {output_language}",
      "fix": "concrete fix in {output_language}"
    }}
  ]
}}

Rules:
- Focus on why the code fails to run when stdout/stderr indicates a failure.
- Project files are shown with 1-based line numbers in the form "line | source".
- The "line" field MUST be one of the displayed line numbers for that file.
- If you mention a concrete source expression, the returned line MUST be the line containing that expression.
- If there is no clear problem, return an empty issues array.
- Do not include markdown fences or commentary outside JSON.

Project: {project_name}
Active file: {active_file}
Language: {language}
Run success: {success}
STDOUT:
{stdout[:12000]}

STDERR:
{stderr[:12000]}

Project files:
{chr(10).join(file_blocks)}
""".strip()

        messages = [
            {"role": "system", "content": "Return only strict JSON for code diagnostics."},
            {"role": "user", "content": prompt},
        ]
        result_provider = providers.provider_to_ui(provider)
        if use_managed:
            def stream_review_token(_label, token, event_type):
                if emit is not None and event_type == "token":
                    emit_completed_issues(token)

            with self.managed_ai_action("code_assist", **self.managed_workflow_options("code_assist")) as session:
                raw_answer, usage = self.call_managed_gateway_chat(
                    session,
                    messages,
                    timeout=120,
                    max_retries=1,
                    debug_trace_callback=stream_review_token if emit is not None else None,
                    debug_trace_label="AILS managed code review stream" if emit is not None else "",
                )
                model_name = session["model_id"]
            result_provider = session.get("provider", "Vercel AI Gateway")
        else:
            raise ValueError("Code assistance requires an AILS or ChatGPT account.")

        review = self.parse_code_review_response(raw_answer, active_file)
        review["model"] = model_name
        review["provider"] = result_provider
        if usage:
            review["usage"] = usage
        if emit is not None:
            emit({"type": "done", "result": review})
        return review

    def prompt_edit_code_sandbox(self, payload: dict):
        active_file = str(payload.get("file_name", "") or "").strip() or "main.py"
        language = str(payload.get("language", "") or "").strip() or "plaintext"
        code = str(payload.get("code", "") or "")
        instruction = str(payload.get("instruction", "") or "").strip()
        files = payload.get("files") if isinstance(payload.get("files"), list) else []

        if not instruction:
            raise ValueError("명령을 입력하세요.")

        use_managed = self.workflow_uses_managed_ai("code_assist")
        provider, model_name = ("AILS", "") if use_managed else self.local_provider_model("code_assist")

        file_blocks = []
        for item in files:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name", "") or "").strip()
            file_code = str(item.get("code", "") or "")
            if not name or name == active_file:
                continue
            file_blocks.append(f"--- FILE: {name} ---\n{file_code}")

        context_files = "\n\n".join(file_blocks)

        system_content = (
            "You are an expert programming assistant. Your task is to modify the source code of the active file "
            "based on the user's instruction. Return ONLY the modified full source code of the active file. "
            "Do NOT wrap the code in markdown code blocks (```). Just return the raw code."
        )

        user_content = f"""
Language: {language}
Active File: {active_file}

Current Source Code of {active_file}:
{code}

Other files in the project for context:
{context_files}

User Instruction: {instruction}

Please output the modified full source code of {active_file}:
""".strip()

        messages = [
            {"role": "system", "content": system_content},
            {"role": "user", "content": user_content},
        ]

        usage = None
        result_provider = providers.provider_to_ui(provider)
        if use_managed:
            with self.managed_ai_action("code_assist", **self.managed_workflow_options("code_assist")) as session:
                raw_answer, usage = self.call_managed_gateway_chat(
                    session,
                    messages,
                    timeout=120,
                    max_retries=1,
                )
                model_name = session["model_id"]
            result_provider = session.get("provider", "Vercel AI Gateway")
        else:
            raise ValueError("Code assistance requires an AILS or ChatGPT account.")

        modified_code = str(raw_answer).strip()
        if modified_code.startswith("```"):
            modified_code = re.sub(r"^```[a-zA-Z0-9_+#.-]*\s*", "", modified_code)
            modified_code = re.sub(r"\s*```$", "", modified_code)

        result = {
            "code": modified_code,
            "model": model_name,
            "provider": result_provider,
        }
        if usage:
            result["usage"] = usage
        return result
