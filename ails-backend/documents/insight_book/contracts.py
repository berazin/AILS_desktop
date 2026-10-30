"""Strict, bounded model contracts. Model text is data, never a tool instruction."""
from __future__ import annotations

import hashlib
import json
import re


VERDICTS = {"VERIFIED", "PARTIALLY_CORRECT", "INCORRECT", "UNCERTAIN"}
REVIEW_FORMS = ("explain", "correct", "why", "counterexample", "apply", "compare")
DEFAULT_SETTINGS = {"maintainer_enabled": True, "maintainer_every": 8,
                    "section_max_chars": 6000, "maintenance_scope": 8}


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def text(value, name, limit=12000, *, empty=False):
    if not isinstance(value, str) or len(value) > limit or (not empty and not value.strip()):
        raise ValueError(f"{name}: 비어 있거나 허용 길이를 넘는 텍스트입니다.")
    return value


def normalized(value):
    return re.sub(r"\s+", "", value).casefold()


def parse_object(raw):
    if isinstance(raw, dict):
        return raw
    value = text(raw, "AI 응답", 180000).strip()
    if value.startswith("```") and value.endswith("```"):
        value = re.sub(r"^```(?:json)?\s*", "", value)[:-3].strip()
    result = json.loads(value)
    if not isinstance(result, dict):
        raise ValueError("AI 응답은 JSON 객체여야 합니다.")
    return result


def validate_gate(raw, original, evidence):
    from .feedback import validate_feedback
    result = parse_object(raw)
    claims = result.get("claims")
    if not isinstance(claims, list) or not 1 <= len(claims) <= 30:
        raise ValueError("검증 claim 목록이 누락됐습니다.")
    known = {item["id"] for item in evidence}
    cleaned = []
    for index, claim in enumerate(claims):
        if not isinstance(claim, dict) or claim.get("verdict") not in VERDICTS:
            raise ValueError("잘못된 claim 판정입니다.")
        refs = claim.get("evidence_ids", [])
        if not isinstance(refs, list) or any(not isinstance(ref, str) or ref not in known for ref in refs):
            raise ValueError("검증 근거 ID가 실제 검색 결과와 다릅니다.")
        basis = claim.get("basis")
        if basis not in {"source", "model"} or (basis == "source" and not refs):
            raise ValueError("자료 근거와 모델 지식을 구분해야 합니다.")
        row = {"id": f"c{index + 1}", "text": text(claim.get("text"), "claim"),
               "verdict": claim["verdict"], "basis": basis, "evidence_ids": refs}
        for field in ("intuition", "explanation", "corrected", "extension", "misconception"):
            row[field] = text(claim.get(field, ""), field, 6000, empty=field != "explanation")
        if row["verdict"] in {"INCORRECT", "PARTIALLY_CORRECT"} and not row["corrected"].strip():
            raise ValueError("틀린 주장에는 올바른 개념이 필요합니다.")
        validate_feedback(claim, row)
        cleaned.append(row)
    # All original text must be assigned, including conditions and qualifications.
    if re.sub(r"\s+", "", "".join(c["text"] for c in cleaned)) != re.sub(r"\s+", "", original):
        raise ValueError("검증 claim이 원문 전체를 순서대로 포함하지 않습니다.")
    states = {c["verdict"] for c in cleaned}
    verdict = ("VERIFIED" if states == {"VERIFIED"} else "INCORRECT" if states == {"INCORRECT"}
               else "PARTIALLY_CORRECT" if states & {"INCORRECT", "PARTIALLY_CORRECT"} else "UNCERTAIN")
    knowledge = text(result.get("knowledge", ""), "검증 지식", empty=verdict != "VERIFIED")
    return {"verdict": verdict, "claims": cleaned, "knowledge": knowledge,
            "improved_insight": text(result.get("improved_insight", ""), "개선 Insight", empty=True),
            "evidence": evidence}


def validate_edit(raw, sections, scope, run_id):
    result = parse_object(raw)
    changes = result.get("changes")
    if not isinstance(changes, list) or len(changes) > 16:
        raise ValueError("Book 변경 목록이 잘못됐습니다.")
    existing = {s["id"]: s for s in sections}
    allowed = {s["id"] for s in scope}
    cleaned, seen = [], set()
    for change in changes:
        if not isinstance(change, dict):
            raise ValueError("Book 변경 항목이 객체가 아닙니다.")
        key = text(change.get("id"), "section id", 120)
        if key.startswith("new_"):
            key = f"s_{digest([run_id, key])[:24]}"
        elif key not in allowed:
            raise ValueError("검색/유지보수 범위 밖의 절은 변경할 수 없습니다.")
        if key in seen:
            raise ValueError("동일 절이 두 번 변경됐습니다.")
        seen.add(key)
        action = change.get("action")
        if action not in {"upsert", "delete"} or (action == "delete" and key not in existing):
            raise ValueError("잘못된 Book 변경 동작입니다.")
        row = {"id": key, "action": action, "reason": text(change.get("reason"), "변경 이유", 3000)}
        if action == "upsert":
            for field in ("title", "chapter", "content"):
                row[field] = text(change.get(field), field, 18000 if field == "content" else 200)
            position = change.get("position")
            if type(position) not in (int, float) or not -100000 <= position <= 100000:
                raise ValueError("절의 목차 순서가 잘못됐습니다.")
            row["position"] = position
            if key in existing and all(row[field] == existing[key][field] for field in ("title", "chapter", "content", "position")):
                continue
        cleaned.append(row)
    return {"changes": cleaned, "reason": text(result.get("reason"), "계획 이유", 6000)}


def validate_verification(raw, changes):
    result = parse_object(raw)
    ids = result.get("checked_section_ids")
    expected = {change["id"] for change in changes}
    if not isinstance(ids, list) or len(ids) != len(expected) or set(ids) != expected:
        raise ValueError("Book 검증에서 변경된 절이 누락됐습니다.")
    if type(result.get("passed")) is not bool or not isinstance(result.get("findings"), list):
        raise ValueError("Book 검증 응답 형식이 잘못됐습니다.")
    if result["passed"] and result["findings"]:
        raise ValueError("검증 성공과 미해결 문제가 충돌합니다.")
    return result


def settings(raw):
    result = dict(DEFAULT_SETTINGS)
    if not isinstance(raw, dict):
        raise ValueError("유지보수 설정이 객체가 아닙니다.")
    for key, value in raw.items():
        if key not in result:
            raise ValueError("알 수 없는 유지보수 설정입니다.")
        if key == "maintainer_enabled":
            if type(value) is not bool:
                raise ValueError("자동 유지보수 여부는 true/false입니다.")
        else:
            lower, upper = {"maintainer_every": (2, 100), "section_max_chars": (1000, 18000), "maintenance_scope": (2, 12)}[key]
            if type(value) is not int or not lower <= value <= upper:
                raise ValueError(f"{key}: {lower}~{upper} 범위여야 합니다.")
        result[key] = value
    return result
