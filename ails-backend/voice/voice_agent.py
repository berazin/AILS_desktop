from __future__ import annotations

import json
import re
from collections.abc import Mapping

from language_support import language_display_name, normalize_app_language
from chat.research_tool_schemas import RESEARCH_TOOL_SCHEMAS


def _no_argument_tool(name: str, description: str) -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "strict": True,
            "parameters": {"type": "object", "properties": {}, "required": [], "additionalProperties": False},
        },
    }


VOICE_TOOL_SCHEMAS = [
    *[
        _no_argument_tool(name, description)
        for name, description in (
            ("inspect_workspace", "Inspect the current AILS workspace state, visible text, and available controls before acting."),
            ("show_home", "Show the AILS home workspace."),
            ("show_dashboard", "Show the AILS learning dashboard."),
            ("open_settings", "Open the AILS settings workspace."),
            ("open_help", "Open the AILS help window."),
            ("open_chatbot", "Open the AILS learning chatbot window."),
            ("close_chatbot", "Close the AILS learning chatbot window."),
        )
    ],
    {
        "type": "function",
        "function": {
            "name": "list_workspace_controls",
            "description": "List current interactive workspace controls and stable control IDs. Use this before activating or editing a control.",
            "strict": True,
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string", "maxLength": 120}},
                "required": [],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "activate_workspace_control",
            "description": "Use a control returned by list_workspace_controls. Supports the same click, double-click, context-menu, and focus interactions as the user.",
            "strict": True,
            "parameters": {
                "type": "object",
                "properties": {
                    "control_id": {"type": "string", "minLength": 1, "maxLength": 160},
                    "interaction": {"type": "string", "enum": ["click", "double_click", "context_menu", "focus"]},
                },
                "required": ["control_id", "interaction"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_workspace_control",
            "description": "Set the value of an input, textarea, select, checkbox, radio, or editable control returned by list_workspace_controls.",
            "strict": True,
            "parameters": {
                "type": "object",
                "properties": {
                    "control_id": {"type": "string", "minLength": 1, "maxLength": 160},
                    "value": {"type": "string", "maxLength": 12000},
                },
                "required": ["control_id", "value"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_sidebar_visibility",
            "description": "Show, hide, or toggle the AILS workspace sidebar.",
            "strict": True,
            "parameters": {
                "type": "object",
                "properties": {"visibility": {"type": "string", "enum": ["show", "hide", "toggle"]}},
                "required": ["visibility"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "navigate_page",
            "description": "Move the open PDF to an explicit 1-based page number.",
            "strict": True,
            "parameters": {
                "type": "object",
                "properties": {"page": {"type": "integer", "minimum": 1, "maximum": 100000}},
                "required": ["page"],
                "additionalProperties": False,
            },
        },
    },
    *[
        {
            "type": "function",
            "function": {
                "name": name,
                "description": description,
                "strict": True,
                "parameters": {"type": "object", "properties": {}, "required": [], "additionalProperties": False},
            },
        }
        for name, description in (
            ("next_page", "Move the open PDF to the next page."),
            ("previous_page", "Move the open PDF to the previous page."),
            ("open_practice", "Open the existing practice mode for the current PDF."),
            ("close_practice", "Close the currently open practice mode."),
            ("show_hint", "Show the existing hint for the current practice problem."),
            ("next_problem", "Move to the next existing practice problem."),
            ("previous_problem", "Move to the previous existing practice problem."),
            ("request_pdf_ocr", "Open AILS's existing PDF OCR confirmation dialog for the current PDF."),
        )
    ],
    {
        "type": "function",
        "function": {
            "name": "open_material",
            "description": "Open a matching path from grep_search/semantic_search, or a candidate_id from list_materials. Use only returned library paths/IDs. query is the requested course/week/session. Never substitute unrelated materials; search expanded course names or paginate before declaring missing.",
            "strict": False,
            "parameters": {
                "type": "object",
                "properties": {"candidate_id": {"type": "string", "maxLength": 80},
                               "path": {"type": "string", "maxLength": 2000},
                               "query": {"type": "string", "maxLength": 240}},
                "required": [],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_document",
            "description": "Search the open PDF text and return the matching pages with short snippets.",
            "strict": True,
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string", "minLength": 1, "maxLength": 200}},
                "required": ["query"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_context",
            "description": (
                "Search or reuse relevant chunks from the active local PDF, Markdown, or TXT material. "
                "For search, keep the context-resolved question in query and put inferred standard textbook "
                "concepts, class names, method names, and acronyms in textbook_terms. Both searches are fused."
            ),
            "strict": True,
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["search", "reuse"]},
                    "document_id": {"type": "string", "minLength": 1, "maxLength": 2000},
                    "query": {"type": "string", "maxLength": 1000},
                    "textbook_terms": {"type": "string", "maxLength": 500},
                    "top_k": {"type": "integer", "minimum": 1, "maximum": 6},
                },
                "required": ["action", "document_id"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_current_page_context",
            "description": "Fetch the recognized text of the currently open PDF page. Call this before answering questions about the page content.",
            "strict": True,
            "parameters": {"type": "object", "properties": {}, "required": [], "additionalProperties": False},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_materials",
            "description": "Search ALL openable material titles, filenames and folder/course names; OSS also matches 오픈소스소프트웨어/Open Source Software. query supports course + week/session (e.g. oss 5주차1). Empty query lists a page, not the whole library. Follow next_offset with the SAME query; total/has_more indicate completeness. Try expanded course names before declaring missing. Use returned candidate_id to open; workspace_id identifies code workspaces.",
            "strict": False,
            "parameters": {"type": "object", "properties": {
                "query": {"type": "string", "maxLength": 240},
                "offset": {"type": "integer", "minimum": 0},
                "limit": {"type": "integer", "minimum": 1, "maximum": 20},
            }, "required": [], "additionalProperties": False},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "expert_answer",
            "description": "Use the configured expert model for difficult reasoning or calculations.",
            "strict": True,
            "parameters": {
                "type": "object",
                "properties": {
                    "question": {"type": "string", "minLength": 1, "maxLength": 12000},
                    "context": {"type": "string", "maxLength": 12000},
                },
                "required": ["question"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "save_to_chatbot",
            "description": "Save markdown to the conversation only when explicitly asked to save. Summarizing or analyzing is not a save request.",
            "strict": True,
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "minLength": 1, "maxLength": 120},
                    "content": {"type": "string", "minLength": 1, "maxLength": 8000},
                },
                "required": ["title", "content"],
                "additionalProperties": False,
            },
        },
    },
]

VOICE_TOOL_CATEGORIES = {
    "workspace": (
        "inspect_workspace",
        "list_workspace_controls",
        "activate_workspace_control",
        "set_workspace_control",
        "show_home",
        "show_dashboard",
        "open_settings",
        "open_help",
        "open_chatbot",
        "close_chatbot",
        "set_sidebar_visibility",
    ),
    "navigation": ("navigate_page", "next_page", "previous_page"),
    "materials": ("list_materials", "open_material"),
    "study": (
        "open_practice",
        "close_practice",
        "show_hint",
        "next_problem",
        "previous_problem",
        "request_pdf_ocr",
    ),
    "retrieval": ("search_document", "search_context", "get_current_page_context"),
    "answer": ("expert_answer", "save_to_chatbot"),
}
TOOL_CATEGORY_SELECTOR_SCHEMA = {
    "type": "function",
    "function": {
        "name": "select_tool_categories",
        "description": "Enable tools: workspace=app home/settings/UI; navigation=PDF pages only; materials=list/open files; study=practice/OCR; retrieval=document search; answer=expert/save.",
        "strict": True,
        "parameters": {
            "type": "object",
            "properties": {
                "categories": {
                    "type": "array",
                    "items": {"type": "string", "enum": list(VOICE_TOOL_CATEGORIES)},
                    "minItems": 1,
                    "maxItems": len(VOICE_TOOL_CATEGORIES),
                    "uniqueItems": True,
                },
            },
            "required": ["categories"],
            "additionalProperties": False,
        },
    },
}

CHATBOT_TOOL_SCHEMAS = [*VOICE_TOOL_SCHEMAS, *RESEARCH_TOOL_SCHEMAS]
CHATBOT_TOOL_CATEGORIES = {**VOICE_TOOL_CATEGORIES,
    "answer": (*VOICE_TOOL_CATEGORIES["answer"], "calculator"),
    "research": tuple(schema["function"]["name"] for schema in RESEARCH_TOOL_SCHEMAS),
}
CHATBOT_CATEGORY_SELECTOR_SCHEMA = json.loads(json.dumps(TOOL_CATEGORY_SELECTOR_SCHEMA))
CHATBOT_CATEGORY_SELECTOR_SCHEMA["function"]["description"] += " research=library/code search, source reading, outline, PDF images, calculator."
CHATBOT_CATEGORY_SELECTOR_SCHEMA["function"]["parameters"]["properties"]["categories"].update(
    items={"type": "string", "enum": list(CHATBOT_TOOL_CATEGORIES)}, maxItems=len(CHATBOT_TOOL_CATEGORIES))

VOICE_TOOL_NAMES = frozenset(
    item["function"]["name"] for item in CHATBOT_TOOL_SCHEMAS
) | {"select_tool_categories"}

# 챗봇(홈·문서) 기본 도구 집합. 나머지 도구는 select_tool_categories로 연다.
CHATBOT_HOME_DEFAULT_TOOL_NAMES = (
    "select_tool_categories",
    "expert_answer",
    "save_to_chatbot",
)
CHATBOT_DOCUMENT_EXTRA_TOOL_NAMES = (
    "search_context",
    "get_current_page_context",
    "navigate_page",
)
CHATBOT_DOCUMENT_DEFAULT_TOOL_NAMES = CHATBOT_HOME_DEFAULT_TOOL_NAMES + CHATBOT_DOCUMENT_EXTRA_TOOL_NAMES

MAX_TOOL_ROUNDS = 5
MAX_TOOL_CALLS_PER_ROUND = 8


def chatbot_selected_categories(tool_rounds: object) -> list[str]:
    """이번 질문의 tool_rounds에서 열린 범주를 결정적 순서로 반환한다."""

    name_to_category = {
        name: category
        for category, names in CHATBOT_TOOL_CATEGORIES.items()
        for name in names
    }
    selected: set[str] = set()
    for round_value in tool_rounds if isinstance(tool_rounds, list) else []:
        if not isinstance(round_value, Mapping):
            continue
        calls = round_value.get("calls") if isinstance(round_value.get("calls"), list) else []
        for call in calls:
            if not isinstance(call, Mapping):
                continue
            name = str(call.get("name") or "")
            if name == "select_tool_categories":
                arguments = call.get("arguments") if isinstance(call.get("arguments"), Mapping) else {}
                categories = arguments.get("categories") if isinstance(arguments.get("categories"), list) else []
                selected.update(
                    str(category) for category in categories if str(category) in CHATBOT_TOOL_CATEGORIES
                )
            elif name in name_to_category:
                selected.add(name_to_category[name])
    ordered = [
        category
        for category in CHATBOT_TOOL_CATEGORIES
        if category in selected
    ]
    return ordered


def chatbot_tool_schemas_for_rounds(tool_rounds: object, *, has_document: bool, question: str = "") -> list[dict]:
    """챗봇 요청에 제공할 도구 스키마를 결정적으로 뽑아낸다.

    기본 집합(홈 3개/문서 6개)에서 시작해, 이번 질문의 tool_rounds에서
    select_tool_categories로 선택했거나 이미 사용한 범주의 도구를 추가한다.
    같은 집합이면 순서와 설명이 항상 동일하다.
    """

    schema_by_name = {
        str(schema["function"]["name"]): schema
        for schema in [*CHATBOT_TOOL_SCHEMAS, CHATBOT_CATEGORY_SELECTOR_SCHEMA]
        if isinstance(schema, Mapping) and isinstance(schema.get("function"), Mapping)
    }
    default_names = CHATBOT_DOCUMENT_DEFAULT_TOOL_NAMES if has_document else CHATBOT_HOME_DEFAULT_TOOL_NAMES
    ordered_names = list(default_names)
    # Hints expose existing tools; the model still decides whether to call them.
    # Other languages and less explicit requests retain category discovery.
    hints = {
        "show_home": r"홈|\bhome\b",
        "show_dashboard": r"대시보드|\bdashboard\b",
        "open_settings": r"설정|\bsettings\b",
        "open_help": r"도움말|\bhelp\b",
        "list_materials": r"자료|파일|\bmaterials\b|\bfiles\b",
    }
    ordered_names.extend(name for name, pattern in hints.items() if re.search(pattern, question, re.I))
    if re.search(r"열어|열라고|띄워|\bopen\b", question, re.I):
        ordered_names.extend(name for name in ("list_materials", "open_material") if name not in ordered_names)
        ordered_names.append("grep_search")
    opened_names = {
        name
        for category in chatbot_selected_categories(tool_rounds)
        for name in CHATBOT_TOOL_CATEGORIES[category]
        if name in schema_by_name
    }
    for schema in CHATBOT_TOOL_SCHEMAS:
        name = str(schema["function"]["name"])
        if name in opened_names and name not in ordered_names:
            ordered_names.append(name)
    document_only = {
        name for category in ("navigation", "study", "retrieval")
        for name in VOICE_TOOL_CATEGORIES[category]
    }
    return [schema_by_name[name] for name in ordered_names
            if name in schema_by_name and (has_document or name not in document_only)]


def voice_tool_schemas_for_rounds(tool_rounds: object, *, local: bool) -> list[dict]:
    if not local:
        return VOICE_TOOL_SCHEMAS

    selected = set()
    name_to_category = {
        name: category
        for category, names in VOICE_TOOL_CATEGORIES.items()
        for name in names
    }
    for round_value in tool_rounds if isinstance(tool_rounds, list) else []:
        if not isinstance(round_value, Mapping):
            continue
        calls = round_value.get("calls") if isinstance(round_value.get("calls"), list) else []
        for call in calls:
            if not isinstance(call, Mapping):
                continue
            name = str(call.get("name") or "")
            if name == "select_tool_categories":
                arguments = call.get("arguments") if isinstance(call.get("arguments"), Mapping) else {}
                categories = arguments.get("categories") if isinstance(arguments.get("categories"), list) else []
                selected.update(str(category) for category in categories if str(category) in VOICE_TOOL_CATEGORIES)
            elif name in name_to_category:
                selected.add(name_to_category[name])

    selected_names = {
        name
        for category in selected
        for name in VOICE_TOOL_CATEGORIES[category]
    }
    return [
        TOOL_CATEGORY_SELECTOR_SCHEMA,
        *(schema for schema in VOICE_TOOL_SCHEMAS if schema["function"]["name"] in selected_names),
    ]


def append_tool_rounds(messages: list[dict], tool_rounds: object) -> None:
    rounds = []
    for round_value in tool_rounds if isinstance(tool_rounds, list) else []:
        if not isinstance(round_value, Mapping) or len(rounds) >= MAX_TOOL_ROUNDS:
            continue
        calls = []
        call_ids = set()
        raw_calls = round_value.get("calls") if isinstance(round_value.get("calls"), list) else []
        for call in raw_calls:
            if not isinstance(call, Mapping) or len(calls) >= MAX_TOOL_CALLS_PER_ROUND:
                continue
            call_id = str(call.get("id") or "").strip()[:120]
            name = str(call.get("name") or "").strip()
            arguments = call.get("arguments") if isinstance(call.get("arguments"), Mapping) else {}
            if not call_id or call_id in call_ids or name not in VOICE_TOOL_NAMES:
                raise ValueError("보이스 도구 호출 기록이 올바르지 않습니다.")
            call_ids.add(call_id)
            calls.append({
                "id": call_id,
                "type": "function",
                "function": {
                    "name": name,
                    "arguments": json.dumps(dict(arguments), ensure_ascii=False, separators=(",", ":")),
                },
            })
        if not calls:
            continue
        messages.append({"role": "assistant", "content": "", "tool_calls": calls})
        results = []
        raw_results = round_value.get("results") if isinstance(round_value.get("results"), list) else []
        for result in raw_results:
            if not isinstance(result, Mapping):
                continue
            call_id = str(result.get("tool_call_id") or "").strip()[:120]
            if call_id not in call_ids:
                raise ValueError("보이스 도구 결과가 호출 기록과 일치하지 않습니다.")
            content = str(result.get("content") or "").strip()[:12000]
            messages.append({"role": "tool", "tool_call_id": call_id, "content": content})
            results.append({"tool_call_id": call_id, "content": content})
        rounds.append({"calls": calls, "results": results})


def build_realtime_voice_messages(
    transcript: object,
    context: object,
    tool_rounds: object = None,
    language: str = "korean",
) -> tuple[list[dict], dict]:
    language = normalize_app_language(language)
    language_name = language_display_name(language)
    text = str(transcript or "").strip()
    if not text or len(text) > 2000:
        raise ValueError("보이스 발화는 1~2000자여야 합니다.")
    normalized_context = _normalize_realtime_context(context)
    messages = [{
        "role": "system",
        "content": (
            f"You are the {language_name} AILS voice assistant. Every request to change app state MUST use a function tool. "
            f"Never merely say that you will perform an action. For non-action questions, answer concisely in natural spoken {language_name} without markdown. "
            "When select_tool_categories is supplied, call it first for every category needed by the request, then use the newly supplied tools. "
            "For generic workspace UI actions, inspect or list controls first and use only a returned control_id; never invent one. "
            "Study-worthy results the user should re-read slowly, such as a page summary or concept review, MUST be persisted with "
            "save_to_chatbot using markdown content; then speak only a one-sentence notice and never read the saved content aloud. "
            "Use only supplied tools and material candidate IDs. Multiple tools are allowed. After tool results, answer any remaining question. "
            "The context JSON holds only small state; call get_current_page_context for page text and list_materials for material candidates when needed."
        ),
    }]
    # Context rides inside the final user message: the Qwen chat template only
    # accepts a system message at the very beginning, and keeping rules+tools
    # as a stable prefix preserves the llama.cpp KV cache within tool rounds.
    messages.append({
        "role": "user",
        "content": "Current AILS context JSON: "
        + json.dumps(normalized_context, ensure_ascii=False, separators=(",", ":"))
        + "\n\nUser request: "
        + text,
    })

    append_tool_rounds(messages, tool_rounds)
    return messages, normalized_context


def parse_streamed_voice_tool_call(value: object) -> dict:
    source = json.loads(str(value or ""))
    function = source.get("function") if isinstance(source, Mapping) else None
    if not isinstance(function, Mapping):
        raise ValueError("보이스 도구 호출 형식이 올바르지 않습니다.")
    call_id = str(source.get("id") or "").strip()[:120]
    name = str(function.get("name") or "").strip()
    if not call_id or name not in VOICE_TOOL_NAMES:
        raise ValueError("지원하지 않는 보이스 도구 호출입니다.")
    try:
        arguments = json.loads(str(function.get("arguments") or "{}"))
    except json.JSONDecodeError as error:
        raise ValueError("보이스 도구 인자가 올바른 JSON이 아닙니다.") from error
    if not isinstance(arguments, dict):
        raise ValueError("보이스 도구 인자는 객체여야 합니다.")
    return {"id": call_id, "name": name, "arguments": arguments}


def _normalize_realtime_context(context: object) -> dict:
    source = context if isinstance(context, Mapping) else {}
    page_count = _bounded_int(source.get("page_count"), 0, 100000)
    current_page = _bounded_int(source.get("current_page"), 0, page_count or 100000)
    return {
        "document_title": str(source.get("document_title") or "").strip()[:240],
        "current_page": current_page,
        "page_count": page_count,
        "pdf_open": bool(source.get("pdf_open")),
        "practice_open": bool(source.get("practice_open")),
        "problem_count": _bounded_int(source.get("problem_count"), 0, 100000),
        "ocr_active": bool(source.get("ocr_active")),
        "selected_text": str(source.get("selected_text") or "").strip()[:2000],
        "workspace_surface": str(source.get("workspace_surface") or "").strip()[:40],
        "document_kind": str(source.get("document_kind") or "").strip()[:40],
        "sidebar_visible": bool(source.get("sidebar_visible")),
        "chatbot_open": bool(source.get("chatbot_open")),
        "settings_open": bool(source.get("settings_open")),
        "help_open": bool(source.get("help_open")),
        "edit_mode": bool(source.get("edit_mode")),
        "fullscreen": bool(source.get("fullscreen")),
    }


def _bounded_int(value: object, minimum: int, maximum: int) -> int:
    if isinstance(value, bool):
        return minimum
    try:
        result = int(value or 0)
    except (TypeError, ValueError):
        return minimum
    return max(minimum, min(maximum, result))
