"""Check confirmed evidence against grading content, allowing proven text cleanup."""
import re

from documents.answer_key_sources import digest, file_version

PROBLEM_FIELDS = ("id", "chapter", "number", "subquestion", "page", "page_end", "label_bbox", "problem_text", "choices", "answer_type")
_NEXT_SECTION = re.compile(r"(?m)^\s*(?:[Ⅰ-Ⅻ]+|[IVXLCDM]+)[.．)]\s+\S[^\n]*$")
_EXPLANATION = re.compile(r"^\s*(?:해설|풀이|설명|정답|참고|explanation|solution|answer)\s*[:：\n]", re.I)
_CONDITION = re.compile(r"[?？]|조건|가정|제약|단위|제외|한정|단\s*[,，]|하시오|고르시오|구하라|\b(?:if|unless|assume|given|provided|must|only|choose|select)\b", re.I)


def problem_snapshot(problem):
    return {key: problem.get(key) for key in PROBLEM_FIELDS}


def problem_version(problem):
    return digest(problem_snapshot(problem))


def _text(value):
    return str(value or "").replace("\r\n", "\n").replace("\r", "\n").strip()


def _explanatory_tail(tail):
    if not tail:
        return True
    if _CONDITION.search(tail):
        return False
    if _EXPLANATION.match(tail):
        return True
    heading = _NEXT_SECTION.search(tail)
    # An explanatory paragraph followed by the next section is outside the
    # choices. Unlabelled trailing conditions remain significant.
    return bool(heading and (not tail[:heading.start()].strip() or tail[:heading.start()].rstrip().endswith(".")))


def _grading_text(problem):
    text = _text(problem.get("problem_text"))
    choices = problem.get("choices") or []
    if problem.get("answer_type") != "multiple_choice" or len(choices) < 2:
        return text
    parts = []
    for index, choice in enumerate(choices, 1):
        marker = rf"(?:{chr(0x245f + index)}|{index}\s*[.)]|{chr(64 + index)}\s*[.)])"
        parts.append(marker + r"[ \t]*" + re.escape(_text(choice)))
    pattern = r"(?m)^[ \t]*" + r"(?:[ \t]*\n)+[ \t]*".join(parts) + r"[ \t]*(?=\n|$)"
    matches = list(re.finditer(pattern, text))
    if len(matches) != 1:
        return text
    match = matches[0]
    stem, tail = text[:match.start()].strip(), text[match.end():].strip()
    return stem if stem and _explanatory_tail(tail) else text


def confirmed_snapshot(link, current):
    saved_version = link.get("problem_version")
    snapshot = link.get("problem_snapshot")
    if isinstance(snapshot, dict) and problem_version(snapshot) == saved_version:
        return snapshot
    if problem_version(current) == saved_version:
        return problem_snapshot(current)
    # Legacy hashes are recoverable only if the stored original reproduces the
    # exact confirmed hash. Never assume the original itself was confirmed.
    original = current.get("paddleocr_original")
    if isinstance(original, dict):
        for fields in (original, {"problem_text": original.get("problem_text")}):
            candidate = {**problem_snapshot(current), **{key: value for key, value in fields.items() if key in PROBLEM_FIELDS}}
            if problem_version(candidate) == saved_version:
                return candidate
    return None


def cleanup_compatible(link, current):
    previous = confirmed_snapshot(link, current)
    if not previous:
        return False
    return same_grading_content(previous, current)


def same_grading_content(previous, current):
    from documents.problem_binary_answers import binary_prompt_kind
    binary_reclassification = (previous.get("answer_type") == "short_answer" and current.get("answer_type") == "ox"
                               and binary_prompt_kind(previous.get("problem_text"))
                               and _text(previous.get("problem_text")) == _text(current.get("problem_text")))
    ignored = {"problem_text", "answer_type"} if binary_reclassification else {"problem_text"}
    if any(previous.get(key) != current.get(key) for key in PROBLEM_FIELDS if key not in ignored):
        return False
    return _grading_text(previous) == _grading_text(current)


def link_validity(link, problem, pdf_path, versions=None):
    if not link:
        return {"status": "unlinked", "reason_code": "answer_key_unconfirmed", "reason": "연결된 답지가 없어 채점 시 AI가 평가합니다. ‘답지 미연결’에서 답지를 연결할 수 있습니다."}
    versions = {} if versions is None else versions

    def version(path):
        if path not in versions:
            try:
                versions[path] = file_version(path)
            except OSError:
                versions[path] = None
        return versions[path]

    def stale(code, message):
        return {"status": "stale", "reason_code": code, "reason": message}

    source = link["source"]
    if version(source["path"]) is None:
        return stale("answer_key_source_missing", "연결된 답지 파일을 찾을 수 없습니다. 파일 위치를 확인하거나 답지를 다시 선택해 주세요.")
    if version(source["path"]) != source["version"]:
        return stale("answer_key_source_changed", "연결된 답지 파일이 변경됐습니다. ‘답지 재확인’에서 변경된 정답을 확인해 주세요.")
    if version(pdf_path) != link["problem_source"]["version"]:
        return stale("problem_source_changed", "문제 PDF가 변경됐습니다. 문제를 다시 인식한 뒤 답지 연결을 확인해 주세요.")
    if problem is None:
        return stale("answer_key_problem_missing", "연결된 문제의 저장 정보를 찾을 수 없습니다. 문제 목록을 다시 불러와 주세요.")
    if problem_version(problem) != link["problem_version"] and not cleanup_compatible(link, problem):
        previous = confirmed_snapshot(link, problem)
        changed = "문제 내용 또는 문항 정보가"
        if previous:
            changed = "질문·조건이"
            for fields, label in ((["choices"], "보기 또는 보기 순서가"), (["answer_type"], "채점 유형이"),
                                  (["number", "subquestion"], "문항 번호·소문항이"), (["page", "page_end", "label_bbox"], "페이지·위치 정보가"), (["chapter", "id"], "문항 정보가")):
                if any(previous.get(key) != problem.get(key) for key in fields):
                    changed = label
                    break
        return stale("answer_key_problem_changed", f"답지는 연결되어 있지만, 연결 후 문제의 {changed} 변경됐습니다. ‘답지 재확인’에서 정답과의 대응을 확인해 주세요.")
    return {"status": "confirmed", "reason_code": "", "reason": ""}
