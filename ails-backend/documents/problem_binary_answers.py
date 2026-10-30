"""O/X and true/false input contracts; never normalize ordinary code or prose."""
import re

_SEPARATOR = r"(?:[,/·ㆍ]|와|또는|or)"
_TF = re.compile(r"(?<![A-Za-z0-9_])T(?:RUE)?(?![A-Za-z0-9_])\s*" + _SEPARATOR + r"\s*F(?:ALSE)?(?![A-Za-z0-9_])", re.I)
_OX = re.compile(r"(?:[○◯⭕Ｏ]|(?<![A-Za-z0-9_])O(?![A-Za-z0-9_]))\s*" + _SEPARATOR + r"\s*(?:[×✕✖❌Ｘ]|X(?![A-Za-z0-9_]))", re.I)
_VALUES = {"true": True, "t": True, "o": True, "○": True, "◯": True, "⭕": True, "ｏ": True,
           "false": False, "f": False, "x": False, "×": False, "✕": False, "✖": False, "❌": False, "ｘ": False}


def binary_prompt_kind(text):
    # A string literal containing "true/false" does not ask for a truth choice.
    prompt = re.sub(r'''"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`[^`]*`''', "", str(text or ""))
    return "tf" if _TF.search(prompt) else "ox" if _OX.search(prompt) else None


def binary_answers(text):
    text = str(text or "").strip().casefold()
    if text in _VALUES:
        return {"": _VALUES[text]}
    result = {}
    for line in text.splitlines():
        match = re.fullmatch(r"\s*\((\d{1,2})\)\s*(\S+)\s*", line)
        if not match or match[1] in result or match[2] not in _VALUES:
            return None
        result[match[1]] = _VALUES[match[2]]
    return result or None


def binary_grading_enabled(problem, policy):
    return bool(policy.get("kind") == "ox" or problem.get("answer_type") == "ox"
                or problem.get("answer_type") in {"short_answer", "unknown"} and binary_prompt_kind(problem.get("problem_text")))
