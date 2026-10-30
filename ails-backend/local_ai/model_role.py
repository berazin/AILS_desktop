"""Identify auxiliary GGUF roles without guessing from file size or model score."""
import re

_AUXILIARY = re.compile(r"(?:^|[./_-])(?:mtp|draft|drafter|projector)(?:$|[./_-])", re.IGNORECASE)


def is_auxiliary_gguf(filename):
    name = str(filename or "").replace("\\", "/")
    return "mmproj" in name.lower() or bool(_AUXILIARY.search(name))


def ensure_model_body(filename="", metadata=None):
    metadata = metadata or {}
    architecture = str(metadata.get("general.architecture") or "").lower().replace("_", "-")
    model_type = str(metadata.get("general.type") or "").lower()
    if (is_auxiliary_gguf(filename) or is_auxiliary_gguf(architecture)
            or architecture.endswith("-assistant") or model_type not in ("", "model")):
        raise ValueError("MTP·draft·projector 등의 보조 GGUF는 모델 본체로 선택할 수 없습니다.")
