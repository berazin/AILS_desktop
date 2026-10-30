"""Saved prompt migration without loading media/model execution helpers."""
import re
from common import BASE_PROMPT_TEMPLATE, MASTERY_CHALLENGE_RULE_BLOCK, LIVE_CODING_RULE_BLOCK, SUMMARY_BOUNDARY_RULE_BLOCK


def upgrade_prompt_template(prompt_text):
    if not prompt_text:
        return BASE_PROMPT_TEMPLATE

    normalized = prompt_text.replace("\r\n", "\n")
    if (
        "[입력 데이터]" in normalized
        and "[작성 규칙]" in normalized
        and "현재 파트와 가까운 이미지 후보" in normalized
        and "Mastery Challenge 출력 규칙" in normalized
    ):
        return BASE_PROMPT_TEMPLATE
    if (
        "[입력 데이터 - 컨텍스트 참조]" in normalized
        and "[작성 가이드라인 - A+ 전략]" in normalized
        and "[출력 형식 및 제한]" in normalized
    ):
        return BASE_PROMPT_TEMPLATE
    updated = re.sub(
        r"10\. \*\*마지막 파트\*\*:.*?(?=\n\n11\. 실습\(Live Coding\) 요약 규칙:)",
        MASTERY_CHALLENGE_RULE_BLOCK.strip(),
        normalized,
        flags=re.S
    )
    updated = re.sub(
        r"11\. 실습\(Live Coding\) 요약 규칙:.*?(?=\n\[출력 형식 및 제한\])",
        LIVE_CODING_RULE_BLOCK,
        updated,
        flags=re.S
    )
    updated = re.sub(
        r"\[청크 경계 규칙\].*?(?=\n\n11\. 실습\(Live Coding\) 요약 규칙:)",
        SUMMARY_BOUNDARY_RULE_BLOCK.strip(),
        updated,
        flags=re.S
    )
    if "{mastery_instruction}" not in updated:
        updated = updated.replace(
            "11. 실습(Live Coding) 요약 규칙:",
            MASTERY_CHALLENGE_RULE_BLOCK + "\n11. 실습(Live Coding) 요약 규칙:",
            1
        )
    if "[청크 경계 규칙]" not in updated:
        updated = updated.replace(
            "11. 실습(Live Coding) 요약 규칙:",
            SUMMARY_BOUNDARY_RULE_BLOCK + "\n11. 실습(Live Coding) 요약 규칙:",
            1
        )
    updated = re.sub(
        r"- \[현재까지의 전체 목차 구조\]\n\{current_outline\}\n?",
        "",
        updated,
    )
    updated = re.sub(
        r"- \[이미 사용한 섹션 제목[^\]]*\]\n\{used_section_titles\}\n?",
        "",
        updated,
    )
    updated = updated.replace(
        "10. 이미지가 실제로 필요할 때만 관련 문단 아래에 넣으세요. 이미지를 넣을 때는 반드시 마크다운 이미지 링크 형식 `![Slide]({image_dir}/slide_000.jpg)`을 사용하세요. 파일명만 단독으로 쓰지 마세요.",
        "10. 현재 파트와 직접 관련 있는 이미지 후보가 있으면, 해당 설명 바로 아래에 이미지를 넣으세요. 이미지를 넣을 때는 반드시 후보 목록의 `삽입 링크`를 그대로 사용한 마크다운 이미지 링크 형식 `![Slide](<{image_dir}/slide_000.jpg>)`을 사용하세요. 파일명만 단독으로 쓰지 마세요.\n11. 마크다운 표를 작성할 때는 반드시 표 앞에 한 줄, 표 뒤에 한 줄의 빈 줄을 두세요."
    )
    return updated
