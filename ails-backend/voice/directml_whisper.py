from __future__ import annotations

import importlib
import importlib.metadata
import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import wave
from pathlib import Path
from typing import Callable

from edition_manifest import require_directml_whisper_model, require_local_stt_provider
from language_support import whisper_language_token


DIRECTML_PROVIDER = "Local (DirectML)"
DIRECTML_MODEL_ID = "large-v3-turbo"
DIRECTML_GENAI_VERSION = "0.13.1"
DIRECTML_ORT_VERSION = "1.24.4"
DIRECTML_CHUNK_SECONDS = 29
DIRECTML_PROMPT = "<|startoftranscript|><|ko|><|transcribe|><|notimestamps|>"
REQUIRED_MODEL_FILES = (
    "audio_processor_config.json",
    "decoder.onnx",
    "encoder.onnx",
    "genai_config.json",
    "tokenizer.json",
)

_PROCESSOR_MODEL = None
_ENCODER_SESSION = None
_DECODER_SESSION = None
_PROCESSOR = None
_MODEL_PATH = ""


def _runtime_root() -> Path:
    if getattr(sys, "frozen", False):
        executable_root = Path(sys.executable).resolve().parent
        internal = executable_root / "_internal"
        return internal if internal.is_dir() else executable_root
    return Path(__file__).resolve().parents[1]


def resolve_directml_whisper_model_dir(model_id: str = DIRECTML_MODEL_ID) -> Path:
    normalized = str(model_id or "").strip()
    require_directml_whisper_model(normalized)
    model_dir = _runtime_root() / "models" / "whisper-directml" / normalized
    missing = [name for name in REQUIRED_MODEL_FILES if not (model_dir / name).is_file()]
    if missing:
        raise RuntimeError(
            "The approved DirectML Whisper model bundle is missing or incomplete: "
            + ", ".join(missing)
        )
    try:
        config = json.loads((model_dir / "genai_config.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Cannot read DirectML Whisper genai_config.json: {error}") from error
    model_config = config.get("model") if isinstance(config, dict) else None
    if not isinstance(model_config, dict) or str(model_config.get("type", "")).lower() != "whisper":
        raise RuntimeError("The bundled DirectML genai_config.json is not a Whisper configuration.")
    return model_dir


def _require_distribution_version(name: str, expected: str) -> None:
    try:
        actual = importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError as error:
        raise RuntimeError(f"Required DirectML runtime is missing: {name}=={expected}") from error
    if actual != expected:
        raise RuntimeError(
            f"Unapproved DirectML runtime version: {name}=={actual}; required {expected}"
        )


def validate_directml_runtime(model_id: str = DIRECTML_MODEL_ID) -> dict[str, object]:
    require_local_stt_provider(DIRECTML_PROVIDER)
    require_directml_whisper_model(model_id)
    if os.name != "nt" or platform.machine().lower() not in {"amd64", "x86_64"}:
        raise RuntimeError("Local (DirectML) requires Windows x64.")
    _require_distribution_version("onnxruntime-genai-directml", DIRECTML_GENAI_VERSION)
    _require_distribution_version("onnxruntime-directml", DIRECTML_ORT_VERSION)
    try:
        ort = importlib.import_module("onnxruntime")
        providers = set(ort.get_available_providers())
    except Exception as error:
        raise RuntimeError(f"Cannot load ONNX Runtime DirectML: {error}") from error
    if "DmlExecutionProvider" not in providers:
        raise RuntimeError(
            "DmlExecutionProvider is unavailable. A DirectML-compatible DirectX 12 GPU "
            "and a current NVIDIA, AMD, or Intel graphics driver are required."
        )
    model_dir = resolve_directml_whisper_model_dir(model_id)
    return {
        "provider": DIRECTML_PROVIDER,
        "model_id": model_id,
        "model_dir": str(model_dir),
        "execution_provider": "DmlExecutionProvider",
        "decoder_execution_provider": "CPUExecutionProvider",
        "cpu_fallback": False,
    }


def _load_model(model_id: str):
    global _PROCESSOR_MODEL, _ENCODER_SESSION, _DECODER_SESSION, _PROCESSOR, _MODEL_PATH
    status = validate_directml_runtime(model_id)
    model_path = str(status["model_dir"])
    if (
        _ENCODER_SESSION is not None
        and _DECODER_SESSION is not None
        and _PROCESSOR is not None
        and _MODEL_PATH == model_path
    ):
        return _ENCODER_SESSION, _DECODER_SESSION, _PROCESSOR
    try:
        og = importlib.import_module("onnxruntime_genai")
        ort = importlib.import_module("onnxruntime")
        processor_model = og.Model(model_path)
        processor = processor_model.create_multimodal_processor()
        encoder = ort.InferenceSession(
            str(Path(model_path) / "encoder.onnx"),
            providers=["DmlExecutionProvider"],
        )
        # DirectML 1.24 cannot execute Whisper cross-attention MultiHeadAttention.
        # Keep each model's encoder on DirectML and its token decoder on CPU.
        decoder = ort.InferenceSession(
            str(Path(model_path) / "decoder.onnx"),
            providers=["CPUExecutionProvider"],
        )
    except Exception as error:
        details = str(error)
        if "invalid model" in details.lower() or "graph output" in details.lower():
            raise RuntimeError(
                "The bundled DirectML Whisper model is invalid or its ONNX files do not match. "
                "Reinstall or update AILS before retrying local STT. "
                f"Details: {error}"
            ) from error
        raise RuntimeError(
            "DirectML Whisper could not initialize on the GPU. A DirectML-compatible "
            "DirectX 12 GPU and current graphics driver are required; no CPU fallback is enabled. "
            f"Details: {error}"
        ) from error
    _PROCESSOR_MODEL = processor_model
    _ENCODER_SESSION = encoder
    _DECODER_SESSION = decoder
    _PROCESSOR = processor
    _MODEL_PATH = model_path
    return encoder, decoder, processor


def _split_audio_to_wav_chunks(
    audio_path: str,
    *,
    ffmpeg_exe: str,
    target_dir: Path,
    creationflags: int,
    cancel_check: Callable[[], None] | None,
) -> list[Path]:
    if cancel_check is not None:
        cancel_check()
    try:
        with wave.open(str(audio_path), "rb") as source:
            if (
                source.getnchannels() == 1
                and source.getframerate() == 16000
                and source.getsampwidth() == 2
                and source.getcomptype() == "NONE"
            ):
                frames_per_chunk = 16000 * DIRECTML_CHUNK_SECONDS
                chunks = []
                index = 0
                while True:
                    if cancel_check is not None:
                        cancel_check()
                    frames = source.readframes(frames_per_chunk)
                    if not frames:
                        break
                    chunk = target_dir / f"directml_{index:05d}.wav"
                    with wave.open(str(chunk), "wb") as output:
                        output.setnchannels(1)
                        output.setsampwidth(2)
                        output.setframerate(16000)
                        output.writeframes(frames)
                    chunks.append(chunk)
                    index += 1
                if chunks:
                    return chunks
    except (wave.Error, EOFError):
        pass
    output_pattern = target_dir / "directml_%05d.wav"
    command = [
        ffmpeg_exe,
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(audio_path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        "-f",
        "segment",
        "-segment_time",
        str(DIRECTML_CHUNK_SECONDS),
        "-reset_timestamps",
        "1",
        str(output_pattern),
        "-y",
    ]
    try:
        subprocess.run(command, check=True, capture_output=True, creationflags=creationflags)
    except (OSError, subprocess.CalledProcessError) as error:
        raise RuntimeError(f"FFmpeg could not prepare audio for DirectML STT: {error}") from error
    if cancel_check is not None:
        cancel_check()
    chunks = sorted(path for path in target_dir.glob("directml_*.wav") if path.stat().st_size > 44)
    if not chunks:
        raise RuntimeError("FFmpeg produced no audio chunks for DirectML STT.")
    return chunks


def _wav_duration(path: Path) -> float:
    with wave.open(str(path), "rb") as stream:
        rate = stream.getframerate()
        return float(stream.getnframes()) / float(rate) if rate else 0.0


def _transcribe_wav(
    encoder,
    decoder,
    processor,
    wav_path: Path,
    cancel_check: Callable[[], None] | None,
    prompt: str = DIRECTML_PROMPT,
) -> str:
    try:
        np = importlib.import_module("numpy")
        og = importlib.import_module("onnxruntime_genai")
        audios = og.Audios.open(str(wav_path))
        inputs = processor([prompt], audios=audios)
        audio_features = inputs["audio_features"].as_numpy()
        input_ids = inputs["input_ids"].as_numpy().astype(np.int32)
        encoder_values = encoder.run(None, {"audio_features": audio_features})
        encoder_outputs = {
            output.name: value for output, value in zip(encoder.get_outputs(), encoder_values)
        }
        decoder_inputs = {item.name: item for item in decoder.get_inputs()}
        layer_ids = sorted(
            int(name.rsplit("_", 1)[1])
            for name in decoder_inputs
            if name.startswith("past_key_cross_")
        )
        feeds = {"input_ids": input_ids}
        for layer_id in layer_ids:
            shape = decoder_inputs[f"past_key_self_{layer_id}"].shape
            heads, head_size = int(shape[1]), int(shape[3])
            feeds[f"past_key_self_{layer_id}"] = np.zeros(
                (1, heads, 0, head_size), dtype=np.float16
            )
            feeds[f"past_value_self_{layer_id}"] = np.zeros(
                (1, heads, 0, head_size), dtype=np.float16
            )
            feeds[f"past_key_cross_{layer_id}"] = encoder_outputs[
                f"present_key_cross_{layer_id}"
            ]
            feeds[f"past_value_cross_{layer_id}"] = encoder_outputs[
                f"present_value_cross_{layer_id}"
            ]

        tokens = [int(token) for token in input_ids[0]]
        decoder_output_names = [output.name for output in decoder.get_outputs()]
        for _ in range(max(0, 448 - len(tokens))):
            if cancel_check is not None:
                cancel_check()
            values = decoder.run(None, feeds)
            outputs = dict(zip(decoder_output_names, values))
            token = int(np.argmax(outputs["logits"][0, -1]))
            tokens.append(token)
            if token == 50257:
                break
            feeds["input_ids"] = np.asarray([[token]], dtype=np.int32)
            for layer_id in layer_ids:
                feeds[f"past_key_self_{layer_id}"] = outputs[f"present_key_self_{layer_id}"]
                feeds[f"past_value_self_{layer_id}"] = outputs[f"present_value_self_{layer_id}"]
        return str(processor.decode(np.asarray(tokens, dtype=np.int32)) or "").strip()
    except Exception as error:
        raise RuntimeError(
            "DirectML-assisted transcription failed. No alternate STT fallback is enabled. "
            f"Details: {error}"
        ) from error


def transcribe_with_directml(
    audio_path: str,
    *,
    model_id: str,
    ffmpeg_exe: str,
    temp_root: str,
    language: str = "korean",
    creationflags: int = 0,
    cancel_check: Callable[[], None] | None = None,
) -> tuple[str, list[dict[str, object]]]:
    prompt = f"<|startoftranscript|>{whisper_language_token(language)}<|transcribe|><|notimestamps|>"
    encoder, decoder, processor = _load_model(model_id)
    os.makedirs(temp_root, exist_ok=True)
    work_dir = Path(tempfile.mkdtemp(prefix="directml_whisper_", dir=temp_root))
    try:
        chunks = _split_audio_to_wav_chunks(
            audio_path,
            ffmpeg_exe=ffmpeg_exe,
            target_dir=work_dir,
            creationflags=creationflags,
            cancel_check=cancel_check,
        )
        utterances: list[dict[str, object]] = []
        texts: list[str] = []
        cursor = 0.0
        for chunk in chunks:
            if cancel_check is not None:
                cancel_check()
            text = _transcribe_wav(encoder, decoder, processor, chunk, cancel_check, prompt)
            duration = _wav_duration(chunk)
            if text:
                texts.append(text)
                utterances.append(
                    {"start": cursor, "end": cursor + duration, "text": text, "speaker": ""}
                )
            cursor += duration
        return " ".join(texts).strip(), utterances
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
