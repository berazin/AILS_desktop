"""Grammar rules for sentence endings split at a physical OCR line wrap."""

from __future__ import annotations

import re

_PERIOD_ENDING = re.compile(r"(입니다|습니다|니다|이다|다)\.(?![A-Za-z0-9_.])")
_STANDALONE_DA = re.compile(r"(?:^|\s)(?:모두|전부)$")
_ASCII_TAIL = re.compile(r"[A-Za-z0-9_]+$")
_REFERENCE_UNITS = frozenset("장쪽절항권")


def joins_period_ending(text: str, left: int, right: int) -> bool:
    """Attach an incomplete ending followed by a sentence period.

    Only the caller's approved line seam is edited. A period by itself is not
    enough: ordinary words and filenames must keep Kiwi's separator decision.
    """
    ending = _PERIOD_ENDING.match(text, right)
    if ending is None:
        return False
    suffix = ending.group(1)
    if not "가" <= text[left] <= "힣":
        return suffix in {"이다", "입니다"} and text[left].isascii() and text[left].isalnum()
    if suffix == "다" and _STANDALONE_DA.search(text[:left + 1]):
        return False
    if suffix == "니다":
        # 니다 is the remainder of the formal ending after a syllable with ㅂ.
        return (ord(text[left]) - ord("가")) % 28 == 17
    return True


def joins_grammatical_wrap(text: str, left: int, right: int, kiwi) -> bool:
    """Use particle, reference-unit and adnominal tags at the line seam only."""
    tokenize = getattr(kiwi, "tokenize", None)
    if tokenize is None:
        return False
    ascii_tail = _ASCII_TAIL.search(text[:left + 1])
    if ascii_tail:
        tail = ascii_tail.group()
        following = re.match(r"\S+", text[right:]).group()
        # A bare case particle after a numeric seam is frequently tagged as
        # a homonymous noun by Kiwi (e.g. 255 + 가). Restrict to the complete
        # particle followed by whitespace; counters such as 가지 are excluded.
        if tail.isdigit() and re.match(r"^(?:가|는|를|에|로)(?=\s)", text[right:]):
            return True
        tokens = tokenize(tail + following)
        boundary = len(tail)
        if not any(token.start < boundary and token.start + token.len == boundary
                   and token.tag in {"SL", "SN"} for token in tokens):
            return False
        for token in tokens:
            if token.start != boundary:
                continue
            if token.tag.startswith("J"):
                return True
            if (tail.isdigit() and text[right] in _REFERENCE_UNITS
                    and token.len == 1 and token.tag in {"NNG", "NNB"}):
                return True
        return False
    if not ("가" <= text[left] <= "힣" and "가" <= text[right] <= "힣"):
        return False
    tokens = tokenize(text[left] + text[right])
    if any(token.start == 0 and token.len == 2 and token.tag == "MM" for token in tokens):
        return True
    return (any(token.start == 0 and token.len == 2 and token.tag in {"VA", "VV"}
                for token in tokens)
            and any(token.tag == "ETM" and token.start <= 1 < token.start + token.len
                    for token in tokens))
