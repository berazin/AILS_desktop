"""Read review questions already written in a summary; never call a model."""
from __future__ import annotations

import re
import uuid


def parse_summary_review_questions(markdown: str) -> tuple[list[dict], list[str]]:
    blocks: list[list[str]] = []
    in_review = False
    fence = ""
    for line in markdown.splitlines():
        marker = re.match(r"^\s*(`{3,}|~{3,})", line)
        if marker:
            if not fence:
                fence = marker[1][0]
            elif marker[1][0] == fence:
                fence = ""
            if in_review and blocks:
                blocks[-1].append(line)
            continue
        heading = re.match(r"^(#{1,6})\s+(.+?)\s*#*\s*$", line) if not fence else None
        if heading and len(heading[1]) <= 2:
            in_review = bool(re.fullmatch(r"(?:\d+[.)]\s*)?(?:복습\s*문제|연습\s*문제|Review Questions)(?:\s*(?:와|및)\s*(?:정답|해설))*", heading[2], re.I))
            continue
        if not in_review:
            continue
        item = re.match(r"^###\s+(?:문제\s*)?(\d+)[.)]?\s*(.*)$", line) if not fence else None
        if item:
            blocks.append([item[2]])
        elif blocks:
            blocks[-1].append(line)

    if not blocks:
        return [], ["복습 문제 절에 '### 문제 N'과 정답이 있는 문항을 찾을 수 없습니다."]
    questions, errors = [], []
    for ordinal, lines in enumerate(blocks, 1):
        fields = {"question": [], "answer": [], "explanation": []}
        active, fence = "question", ""
        for line in lines:
            marker = re.match(r"^\s*(`{3,}|~{3,})", line)
            if marker:
                fence = "" if fence == marker[1][0] else marker[1][0]
            label = re.match(r"^\s*(?:>\s*)?(?:\*\*)?(정답|해설)(?::\*\*|\*\*:|:)\s*(.*)$", line) if not fence else None
            if label:
                active = "answer" if label[1] == "정답" else "explanation"
                fields[active].append(label[2])
            else:
                fields[active].append(line)
        answer = "\n".join(fields["answer"]).strip()
        explanation = "\n".join(fields["explanation"]).strip()
        options, body = [], []
        for line in fields["question"]:
            option = re.match(r"^\s*(?:\(([1-9])\)|([1-9])[.)])\s+(.+)$", line)
            if option:
                options.append({"id": option[1] or option[2], "text": option[3].strip()})
            else:
                body.append(line)
        question = "\n".join(body).strip()
        if not question or not answer:
            errors.append(f"문제 {ordinal}: 질문 또는 정답이 없습니다.")
            continue
        choice = ""
        if options:
            # Only an explicit number or exact option text can become a local
            # answer key. Never guess a key from a prose explanation.
            # The concept editor appends this notice beside a corrected answer.
            # Remove only its known metadata, never infer a key from prose.
            normalized = re.sub(
                r"\s*\(\*\*개념 정정:\*\* 기술 설명을 수정했습니다(?:; [^\n]*)?\)\s*$",
                "", answer).strip().strip('`').strip()
            number = re.fullmatch(r"\(?([1-9])\)?(?:번|[.)])?", normalized)
            matched = [o for o in options if o["id"] == number[1]] if number else [
                o for o in options if o["text"].strip('`') == normalized]
            if len(options) < 2 or len({o['id'] for o in options}) != len(options) or len(matched) != 1:
                errors.append(f"문제 {ordinal}: 객관식 보기와 정답 번호를 확인해 주세요.")
                continue
            choice = matched[0]["id"]
        questions.append({
            "id": uuid.uuid5(uuid.NAMESPACE_URL, f"ails:summary-review:{ordinal}").hex,
            "ordinal": ordinal,
            "question": question,
            "answer_type": "multiple_choice" if options else "short_answer",
            "options": options,
            "answer_option_id": choice,
            "reference_answer": answer,
            "explanation": explanation,
            "source_file": "", "source_excerpt": "",
        })
    return questions, errors
