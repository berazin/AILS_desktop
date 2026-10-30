"""Bounded GGUF metadata reading; no tensor loading or executable model code."""
import struct
from .model_role import ensure_model_body

# llama.cpp include/llama.h: llama_ftype (GGUF general.file_type).
FILE_TYPES = dict(enumerate([
    "F32", "F16", "Q4_0", "Q4_1", None, None, None, "Q8_0", "Q5_0", "Q5_1",
    "Q2_K", "Q3_K_S", "Q3_K_M", "Q3_K_L", "Q4_K_S", "Q4_K_M", "Q5_K_S", "Q5_K_M",
    "Q6_K", "IQ2_XXS", "IQ2_XS", "Q2_K_S", "IQ3_XS", "IQ3_XXS", "IQ1_S", "IQ4_NL",
    "IQ3_S", "IQ3_M", "IQ2_S", "IQ2_M", "IQ4_XS", "IQ1_M", "BF16",
]))
HEADER_LIMIT = 8 * 1024 * 1024


def normalized_quant(value):
    name = str(value).upper()
    return {"FP16": "F16", "FP32": "F32"}.get(name, name)


def read_quantization(stream):
    consumed = 0

    def read(size):
        nonlocal consumed
        if size < 0 or consumed + size > HEADER_LIMIT:
            raise ValueError("GGUF 메타데이터가 검사 한도를 초과했습니다.")
        consumed += size
        value = stream.read(size)
        if len(value) != size:
            raise ValueError("GGUF 메타데이터가 잘렸습니다.")
        return value

    def unpack(fmt):
        return struct.unpack("<" + fmt, read(struct.calcsize("<" + fmt)))[0]

    def string():
        return read(unpack("Q")).decode("utf-8")

    def value(kind, depth=0):
        formats = {0: "B", 1: "b", 2: "H", 3: "h", 4: "I", 5: "i", 6: "f", 7: "?", 10: "Q", 11: "q", 12: "d"}
        if kind in formats:
            return unpack(formats[kind])
        if kind == 8:
            return string()
        if kind == 9 and depth < 2:
            subtype, count = unpack("I"), unpack("Q")
            if count > 1_000_000:
                raise ValueError("GGUF 배열 크기가 지원 범위를 초과했습니다.")
            for _ in range(count):
                value(subtype, depth + 1)
            return None
        raise ValueError("지원하지 않는 GGUF 메타데이터 형식입니다.")

    if read(4) != b"GGUF" or unpack("I") not in (2, 3):
        raise ValueError("지원하지 않는 GGUF 파일입니다.")
    unpack("Q")  # tensor count; tensor data is never read here.
    count = unpack("Q")
    if count > 100_000:
        raise ValueError("GGUF 메타데이터 항목이 너무 많습니다.")
    quantization = None
    role = {}
    for _ in range(count):
        key, kind = string(), unpack("I")
        item = value(kind)
        if key == "general.file_type":
            result = FILE_TYPES.get(item)
            if not result:
                raise ValueError("지원하지 않는 GGUF 양자화입니다.")
            quantization = result
        elif key in ("general.architecture", "general.type"):
            role[key] = item
            ensure_model_body(metadata=role)
        if quantization and all(key in role for key in ("general.architecture", "general.type")):
            return quantization
    # A matching quantization is insufficient: role keys can appear later.
    ensure_model_body(metadata=role)
    if quantization:
        return quantization
    raise ValueError("GGUF 파일의 실제 양자화를 확인하지 못했습니다.")


def verify_quantization(path, expected):
    ensure_model_body(filename=path.name)
    with path.open("rb") as stream:
        actual = read_quantization(stream)
    if actual != normalized_quant(expected):
        raise ValueError(f"추천 양자화 {expected}와 실제 GGUF {actual}가 다릅니다.")
    return actual
