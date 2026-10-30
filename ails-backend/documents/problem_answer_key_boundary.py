"""Explicit answer headings shared by catalog extraction and legacy redaction."""
import re

ANSWER_KEY_HEADING_PATTERN = re.compile(
    r"^\s*(?:(?:(?:명품\s*)?c\s*\+\s*\+\s*(?:programming\s*)?)?"
    r"check\s*time\s*(?:정답|해답)"
    r"|(?:[^.!?？]{0,100}\s+)?(?:정답(?:\s*표)?|해답|해설)"
    r"(?:\s*(?:및|과|/|·)\s*(?:정답|해답|해설))?)"
    r"(?:\s+\d{1,4})?\s*$|^\s*(?:문항|번호|문제번호)\s+정답(?:\s+(?:문항|정답|해설))*\s*$",
    re.IGNORECASE,
)


def is_answer_key_heading(text, next_text=""):
    # A figure/table caption may end in "해답" (for example a Hanoi diagram).
    # It is body evidence, not the start of the book's answer appendix.
    if re.match(r"^\s*[\[(]?\s*(?:그림|표|fig(?:ure)?\.?|table)\s*\d", text, re.I):
        return False
    return bool(ANSWER_KEY_HEADING_PATTERN.match(text) or re.fullmatch(
        r"\s*(?:(?:answer\s*key|answers?|solutions?)(?:\s+\d+)?|(?:number|question)\s+answer(?:\s+criteria)?)\s*", text, re.I) or (
        text.strip() == "답" and re.match(r"^\s*문항\s+정답", next_text)
    ))


def trim_answer_key_tail(text):
    lines = text.splitlines(keepends=True)
    for index, line in enumerate(lines):
        if is_answer_key_heading(line.strip(), lines[index + 1].strip() if index + 1 < len(lines) else ""):
            return "".join(lines[:index]).rstrip()
    return text
