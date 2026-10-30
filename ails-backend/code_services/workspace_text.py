"""Decode source text without rewriting the file's existing encoding."""
import codecs


def decode_workspace_text(data: bytes, suffix: str) -> tuple[str, str]:
    if data.startswith(codecs.BOM_UTF8):
        return data.decode("utf-8-sig"), "utf-8-sig"
    try:
        return data.decode("utf-8"), "utf-8"
    except UnicodeDecodeError:
        if suffix.lower() not in {".c", ".cpp"}:
            raise
        return data.decode("cp949"), "cp949"


def encode_workspace_text(text: str, original: bytes, suffix: str) -> bytes:
    _, encoding = decode_workspace_text(original, suffix)
    return text.encode(encoding)
