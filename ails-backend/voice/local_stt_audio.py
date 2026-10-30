from __future__ import annotations

import gc
import os
import subprocess
import tempfile
import time
import wave
from contextlib import contextmanager
from pathlib import Path
from typing import Callable, Iterator, TYPE_CHECKING

if TYPE_CHECKING:
    import numpy as np



LOCAL_STT_SAMPLE_RATE = 16_000


def build_ffmpeg_float32_decode_command(
    ffmpeg_exe: str,
    source_path: str,
    output_path: str,
    *,
    sample_rate: int = LOCAL_STT_SAMPLE_RATE,
) -> list[str]:
    return [
        ffmpeg_exe,
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        source_path,
        "-map",
        "0:a:0",
        "-vn",
        "-sn",
        "-dn",
        "-ac",
        "1",
        "-ar",
        str(sample_rate),
        "-acodec",
        "pcm_f32le",
        "-f",
        "f32le",
        "-y",
        output_path,
    ]


def _terminate_process(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=3)
    except Exception:
        process.kill()
        process.wait()


def decode_audio_file_to_float32(
    source_path: str,
    output_path: str,
    *,
    ffmpeg_exe: str,
    creationflags: int = 0,
    cancel_check: Callable[[], None] | None = None,
) -> None:
    import numpy as np
    try:
        with wave.open(str(source_path), "rb") as source:
            if (
                source.getnchannels() == 1
                and source.getframerate() == LOCAL_STT_SAMPLE_RATE
                and source.getsampwidth() == 2
                and source.getcomptype() == "NONE"
            ):
                with open(output_path, "wb") as output:
                    while True:
                        if cancel_check is not None:
                            cancel_check()
                        frames = source.readframes(LOCAL_STT_SAMPLE_RATE * 30)
                        if not frames:
                            break
                        samples = np.frombuffer(frames, dtype="<i2").astype(np.float32)
                        samples *= 1.0 / 32768.0
                        output.write(samples.tobytes())
                return
    except (wave.Error, EOFError):
        pass
    command = build_ffmpeg_float32_decode_command(ffmpeg_exe, source_path, output_path)
    process = subprocess.Popen(
        command,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=creationflags,
    )
    try:
        while process.poll() is None:
            if cancel_check is not None:
                cancel_check()
            time.sleep(0.1)
        _stdout, stderr = process.communicate()
    except BaseException:
        _terminate_process(process)
        raise
    if process.returncode != 0:
        detail = str(stderr or "").strip()[-1200:]
        raise RuntimeError(f"FFmpeg local STT audio decoding failed: {detail or process.returncode}")


@contextmanager
def decoded_audio_float32(
    source_path: str,
    *,
    ffmpeg_exe: str,
    temp_dir: str,
    creationflags: int = 0,
    cancel_check: Callable[[], None] | None = None,
) -> Iterator[np.memmap]:
    import numpy as np
    source = Path(source_path)
    if not source.is_file():
        raise FileNotFoundError(f"Local STT audio file was not found: {source}")

    os.makedirs(temp_dir, exist_ok=True)
    descriptor, raw_path = tempfile.mkstemp(prefix="faster_whisper_", suffix=".f32le", dir=temp_dir)
    os.close(descriptor)
    audio: np.memmap | None = None
    try:
        decode_audio_file_to_float32(
            str(source),
            raw_path,
            ffmpeg_exe=ffmpeg_exe,
            creationflags=creationflags,
            cancel_check=cancel_check,
        )
        byte_size = os.path.getsize(raw_path)
        if byte_size <= 0 or byte_size % np.dtype(np.float32).itemsize != 0:
            raise RuntimeError("FFmpeg produced an invalid local STT PCM stream.")
        audio = np.memmap(raw_path, dtype=np.float32, mode="r")
        yield audio
    finally:
        if audio is not None:
            mapped_file = getattr(audio, "_mmap", None)
            if mapped_file is not None:
                mapped_file.close()
            del audio
        gc.collect()
        try:
            os.remove(raw_path)
        except FileNotFoundError:
            pass
