"""Keep the code runner's pipe encoding and supported runtime I/O aligned."""
from pathlib import Path

CONSOLE_ENCODINGS = frozenset({"auto", "utf-8", "cp949"})


def normalize_console_encoding(value=None) -> str:
    if value is None:
        return "auto"
    if not isinstance(value, str) or value not in CONSOLE_ENCODINGS:
        raise ValueError("콘솔 입출력 인코딩은 자동, UTF-8, CP949 중에서 선택해 주세요.")
    return value


def resolve_console_encoding(value=None) -> str:
    # AILS-owned runtimes use UTF-8 in automatic mode. Legacy tools can opt in
    # to CP949 explicitly; byte-based guessing can corrupt valid mixed chunks.
    choice = normalize_console_encoding(value)
    return "utf-8" if choice == "auto" else choice


def java_encoding_options(encoding="utf-8", *, compiler=False) -> list[str]:
    charset = "MS949" if encoding == "cp949" else "UTF-8"
    prefix = "-J-D" if compiler else "-D"
    return [f"{prefix}{name}={charset}" for name in (
        "file.encoding", "stdout.encoding", "stderr.encoding",
        "sun.stdout.encoding", "sun.stderr.encoding",
    )]


def configure_console_runtime(command: list[str], env: dict, selection=None) -> tuple[list[str], dict, str]:
    encoding = resolve_console_encoding(selection)
    command, env = list(command), dict(env)
    env["PYTHONIOENCODING"] = encoding
    env["PYTHONUNBUFFERED"] = "1"
    if command and Path(command[0]).stem.lower() in {"java", "javaw"}:
        command[1:1] = java_encoding_options(encoding)
    return command, env, encoding
