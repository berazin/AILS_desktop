from __future__ import annotations

import json
import re

from common import append_status_log

def parse_image_caption_json_response(raw_text, provider_label="image", log_list=None):
    text = str(raw_text or "").strip()
    cleaned = re.sub(r"```json|```", "", text, flags=re.IGNORECASE).strip()
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end != -1 and end > start:
        cleaned = cleaned[start:end + 1]

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as first_error:
        merged = merge_concatenated_json_objects(cleaned)
        if merged:
            append_status_log(log_list, f"{provider_label} JSON 응답의 여러 객체를 병합해 파싱했습니다.")
            return merged

        comma_repaired = insert_missing_commas_between_json_entries(cleaned)
        if comma_repaired != cleaned:
            try:
                parsed = json.loads(comma_repaired)
                append_status_log(log_list, f"{provider_label} JSON 응답의 누락된 쉼표를 보정해 파싱했습니다.")
                return parsed
            except json.JSONDecodeError:
                merged = merge_concatenated_json_objects(comma_repaired)
                if merged:
                    append_status_log(log_list, f"{provider_label} JSON 응답의 누락된 쉼표를 보정하고 여러 객체를 병합해 파싱했습니다.")
                    return merged

        repaired, repair_meta = repair_json_like_text(cleaned, return_meta=True)
        try:
            parsed = json.loads(repaired)
            if repair_meta.get("closed_open_string"):
                trimmed = drop_last_mapping_entry(parsed)
                append_status_log(log_list, f"{provider_label} JSON 응답의 잘린 마지막 항목을 제외하고 파싱했습니다.")
                return trimmed
            append_status_log(log_list, f"{provider_label} JSON 응답을 자동 보정해 파싱했습니다.")
            return parsed
        except json.JSONDecodeError:
            merged = merge_concatenated_json_objects(repaired)
            if merged:
                append_status_log(log_list, f"{provider_label} 보정 JSON 응답의 여러 객체를 병합해 파싱했습니다.")
                return merged

            repaired_with_commas = insert_missing_commas_between_json_entries(repaired)
            if repaired_with_commas != repaired:
                try:
                    parsed = json.loads(repaired_with_commas)
                    if repair_meta.get("closed_open_string"):
                        trimmed_payload = drop_last_mapping_entry(parsed)
                        append_status_log(log_list, f"{provider_label} 보정 JSON 응답의 잘린 마지막 항목을 제외하고 파싱했습니다.")
                        return trimmed_payload
                    append_status_log(log_list, f"{provider_label} 보정 JSON 응답의 누락된 쉼표를 보정해 파싱했습니다.")
                    return parsed
                except json.JSONDecodeError:
                    merged = merge_concatenated_json_objects(repaired_with_commas)
                    if merged:
                        append_status_log(log_list, f"{provider_label} 보정 JSON 응답의 여러 객체를 병합해 파싱했습니다.")
                        return merged

            trimmed = trim_incomplete_json_tail(repaired)
            try:
                parsed = json.loads(trimmed)
                append_status_log(log_list, f"{provider_label} JSON 응답을 잘린 꼬리 기준으로 복구해 파싱했습니다.")
                return parsed
            except json.JSONDecodeError as third_error:
                trimmed_with_commas = insert_missing_commas_between_json_entries(trimmed)
                if trimmed_with_commas != trimmed:
                    try:
                        parsed = json.loads(trimmed_with_commas)
                        append_status_log(log_list, f"{provider_label} 잘린 JSON 응답의 누락된 쉼표를 보정해 파싱했습니다.")
                        return parsed
                    except json.JSONDecodeError:
                        pass

                merged = merge_concatenated_json_objects(trimmed)
                if merged:
                    append_status_log(log_list, f"{provider_label} 잘린 JSON 응답의 복구 가능한 객체를 병합해 파싱했습니다.")
                    return merged

                preview = trimmed[:200].replace("\n", "\\n")
                raise RuntimeError(f"{provider_label} JSON 파싱 실패: {third_error} | preview={preview}") from first_error

def merge_concatenated_json_objects(text):
    source = str(text or "").strip()
    first_brace = source.find("{")
    if first_brace < 0:
        return None

    decoder = json.JSONDecoder()
    merged = {}
    parsed_count = 0
    first_success_pos = None
    pos = first_brace

    while pos < len(source):
        while pos < len(source) and (source[pos].isspace() or source[pos] in ",;"):
            pos += 1
        if pos >= len(source):
            break
        if source[pos] != "{":
            next_pos = source.find("{", pos + 1)
            if next_pos < 0:
                break
            pos = next_pos
        try:
            payload, end_pos = decoder.raw_decode(source, pos)
        except json.JSONDecodeError:
            next_pos = source.find("{", pos + 1)
            if next_pos < 0:
                break
            pos = next_pos
            continue

        if first_success_pos is None:
            first_success_pos = pos
        if isinstance(payload, dict):
            merged.update(payload)
            parsed_count += 1
        pos = max(end_pos, pos + 1)

    if parsed_count and first_success_pos == first_brace and merged:
        return merged
    return None

def insert_missing_commas_between_json_entries(text):
    source = str(text or "")
    if not source:
        return source

    result = []
    stack = []
    in_string = False
    escaped = False
    i = 0

    while i < len(source):
        ch = source[i]
        result.append(ch)

        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
                if len(stack) == 1 and _next_json_token(source, i + 1) == '"':
                    result.append(",")
            i += 1
            continue

        if ch == '"':
            in_string = True
            escaped = False
        elif ch in "{[":
            stack.append(ch)
        elif ch == "}":
            if stack and stack[-1] == "{":
                stack.pop()
            if len(stack) == 1 and _next_json_token(source, i + 1) == '"':
                result.append(",")
        elif ch == "]":
            if stack and stack[-1] == "[":
                stack.pop()
            if len(stack) == 1 and _next_json_token(source, i + 1) == '"':
                result.append(",")
        i += 1

    return "".join(result)

def _next_json_token(source, start_index):
    index = start_index
    while index < len(source) and source[index].isspace():
        index += 1
    if index >= len(source):
        return ""
    return source[index]

def repair_json_like_text(text, return_meta=False):
    source = str(text or "")
    repaired = []
    in_string = False
    escaped = False
    delimiter_stack = []
    meta = {
        "closed_open_string": False,
        "appended_closers": 0,
    }
    i = 0

    while i < len(source):
        ch = source[i]
        if in_string:
            if escaped:
                repaired.append(ch)
                escaped = False
            elif ch == "\\":
                next_char = source[i + 1] if i + 1 < len(source) else ""
                if next_char == "u":
                    hex_part = source[i + 2:i + 6]
                    if len(hex_part) == 4 and all(part in "0123456789abcdefABCDEF" for part in hex_part):
                        repaired.append(ch)
                        escaped = True
                    else:
                        repaired.append("\\\\")
                elif next_char in '"\\/bfnrt':
                    repaired.append(ch)
                    escaped = True
                else:
                    repaired.append("\\\\")
            elif ch == "\r":
                repaired.append("\\n")
                if i + 1 < len(source) and source[i + 1] == "\n":
                    i += 1
            elif ch == "\n":
                repaired.append("\\n")
            elif ch == "\t":
                repaired.append("\\t")
            elif ch == '"':
                repaired.append(ch)
                in_string = False
            else:
                repaired.append(ch)
        else:
            if ch in "{[":
                delimiter_stack.append(ch)
            elif ch == "}":
                if delimiter_stack and delimiter_stack[-1] == "{":
                    delimiter_stack.pop()
                else:
                    i += 1
                    continue
            elif ch == "]":
                if delimiter_stack and delimiter_stack[-1] == "[":
                    delimiter_stack.pop()
                else:
                    i += 1
                    continue
            repaired.append(ch)
            if ch == '"':
                in_string = True
                escaped = False
        i += 1

    if in_string:
        repaired.append('"')
        meta["closed_open_string"] = True

    while delimiter_stack:
        opener = delimiter_stack.pop()
        repaired.append("}" if opener == "{" else "]")
        meta["appended_closers"] += 1

    repaired_text = "".join(repaired)
    repaired_text = re.sub(r",(\s*[}\]])", r"\1", repaired_text)
    if return_meta:
        return repaired_text, meta
    return repaired_text

def drop_last_mapping_entry(payload):
    if not isinstance(payload, dict):
        return payload
    if not payload:
        return {}
    keys = list(payload.keys())
    return {key: payload[key] for key in keys[:-1]}

def trim_incomplete_json_tail(text):
    source = str(text or "").strip()
    if not source.startswith("{"):
        return source

    in_string = False
    escaped = False
    depth = 0
    last_top_level_comma = -1

    for index, ch in enumerate(source):
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue

        if ch == '"':
            in_string = True
        elif ch in "{[":
            depth += 1
        elif ch in "}]":
            depth = max(0, depth - 1)
        elif ch == "," and depth == 1:
            last_top_level_comma = index

    if last_top_level_comma < 0:
        return repair_json_like_text(source)

    trimmed = source[:last_top_level_comma].rstrip(", \n\r\t")
    if not trimmed.endswith("}"):
        trimmed += "}"
    return repair_json_like_text(trimmed)


