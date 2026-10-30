from __future__ import annotations

import logging
import os
import re
import tempfile
import threading
import time
import uuid
import wave
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from language_support import normalize_app_language

if TYPE_CHECKING:
    from model_manager import ModelManager


def __getattr__(name):
    # Preserve the historical exports without loading model storage/download
    # code when configuration only applies the language and VAD threshold.
    if name in {"ModelManager", "ModelUnavailableError"}:
        import model_manager
        return getattr(model_manager, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


VOICE_LANGUAGE_DEFAULT = "korean"
# Regression-verified: the Korean managed manifest is the only streaming
# zipformer loadable by the pinned sherpa-onnx 1.13.6 runtime. The English
# (2023-06-26), Simplified-Chinese (2023-12-12), and multilingual Japanese
# (2025-02-10) exports all fail with "'attention_dims' does not exist in the
# metadata", while the Korean model loads — verified by real decode runs.
# Non-Korean voice sessions therefore use whisper.cpp directly (language set
# via whisper's -l flag) until a compatible streaming export exists.
VOICE_LANGUAGE_MODELS = {
    "korean": {
        "managed": True,
        "model_id": "sherpa-onnx-streaming-zipformer-korean-fp32",
    },
}
VOICE_MODEL_ID = "sherpa-onnx-streaming-zipformer-korean-fp32"
VOICE_SAMPLE_RATE = 16_000
MAX_PCM_CHUNK_BYTES = VOICE_SAMPLE_RATE * 2 * 2
SESSION_TTL_SECONDS = 10 * 60
VAD_THRESHOLD_DEFAULT = 0.3
VAD_THRESHOLD_MIN = 0.05
VAD_THRESHOLD_MAX = 0.9
MAX_SESSION_FINALS = 16
MAX_WHISPER_UTTERANCE_SECONDS = 90
WHISPER_PREROLL_SECONDS = 1
SPEECHLESS_TEXT = re.compile(r"^[\s.,?!;:~·…\-—_\"'`()\[\]{}<>「」『』·]+$")


def has_speech_text(text: object) -> bool:
    """False when the transcript carries only punctuation or whitespace."""
    normalized = str(text or "").strip()
    return bool(normalized) and not SPEECHLESS_TEXT.match(normalized)

_logger = logging.getLogger("ails.voice")


@dataclass
class _VoiceSession:
    stream: object
    vad: object
    finals: list[str] = field(default_factory=list)
    updated_at: float = field(default_factory=time.monotonic)
    lock: threading.Lock = field(default_factory=threading.Lock)
    vad_threshold: float = VAD_THRESHOLD_DEFAULT
    backend: str = "sherpa"
    model_name: str = ""
    use_vulkan: bool = True
    language: str = VOICE_LANGUAGE_DEFAULT
    recognizer: object = None
    model_path: str = ""
    pcm: bytearray = field(default_factory=bytearray)
    preroll: bytearray = field(default_factory=bytearray)
    recording: bool = False
    first_pass_parts: list[str] = field(default_factory=list)


class VoiceRecognitionService:
    _vad_threshold = VAD_THRESHOLD_DEFAULT
    _language = VOICE_LANGUAGE_DEFAULT

    def __init__(self, model_manager: ModelManager | None = None) -> None:
        self._models = model_manager
        self._models_lock = threading.Lock()
        self._recognizer = None
        self._sherpa = None
        self._model_path = ""
        self._language = VOICE_LANGUAGE_DEFAULT
        self._load_lock = threading.Lock()
        self._decode_lock = threading.Lock()
        self._sessions: dict[str, _VoiceSession] = {}
        self._sessions_lock = threading.Lock()
        self._vad_threshold = VAD_THRESHOLD_DEFAULT

    def _model_store(self):
        with self._models_lock:
            if self._models is None:
                from model_manager import ModelManager
                self._models = ModelManager()
            return self._models

    @property
    def vad_threshold(self) -> float:
        return self._vad_threshold

    @property
    def language(self) -> str:
        return self._language

    def set_vad_threshold(self, value: object) -> float:
        try:
            threshold = float(value)
        except (TypeError, ValueError):
            threshold = VAD_THRESHOLD_DEFAULT
        self._vad_threshold = min(VAD_THRESHOLD_MAX, max(VAD_THRESHOLD_MIN, threshold))
        return self._vad_threshold

    def set_language(self, value: object) -> str:
        """Switch the streaming recognizer language on the next session start.

        Running sessions keep the recognizer they were created with, so an
        in-flight voice session is never invalidated mid-transcription.
        """
        language = normalize_app_language(value)
        if language == self._language:
            return self._language
        self._language = language
        with self._load_lock:
            self._recognizer = None
            self._sherpa = None
            self._model_path = ""
        _logger.info("[Voice] Streaming recognizer language set to %s", language)
        return self._language

    def status(self) -> dict:
        if not self.streaming_supported():
            # Non-Korean languages run whisper.cpp only; sherpa readiness and
            # streaming-model downloads do not apply.
            return {
                "managed": False,
                "ready": True,
                "download_required": False,
                "update_available": False,
                "model_id": "",
                "file_size": 0,
                "runtime_ready": True,
                "runtime_version": "whisper.cpp",
                "core_version": "",
                "runtime_error": "",
                "backend": "whisper.cpp",
                "precision": "GGML",
                "vad": "AILS VAD",
                "streaming": "whisper_only",
                "language": self._language,
                "active_sessions": len(self._sessions),
            }
        import importlib.metadata
        try:
            runtime_version = importlib.metadata.version("sherpa-onnx")
            core_version = importlib.metadata.version("sherpa-onnx-core")
            runtime_ready = runtime_version == core_version
            runtime_error = "" if runtime_ready else "sherpa-onnx runtime version mismatch"
        except importlib.metadata.PackageNotFoundError as error:
            runtime_version = ""
            core_version = ""
            runtime_ready = False
            runtime_error = f"Missing package: {error.name}"
        spec = VOICE_LANGUAGE_MODELS[VOICE_LANGUAGE_DEFAULT]
        model = self._model_store().status(spec["model_id"])
        model_ready = bool(model.get("ready"))
        return {
            **model,
            "ready": runtime_ready and model_ready,
            "runtime_ready": runtime_ready,
            "runtime_version": runtime_version,
            "core_version": core_version,
            "runtime_error": runtime_error,
            "backend": "sherpa-onnx CPU",
            "precision": "FP32",
            "vad": "Silero VAD",
            "streaming": "sherpa",
            "language": self._language,
            "active_sessions": len(self._sessions),
        }

    def streaming_supported(self, language: object = None) -> bool:
        return normalize_app_language(language if language is not None else self._language) in VOICE_LANGUAGE_MODELS

    def install_model(self, confirmed: bool, emit=None) -> dict:
        if not confirmed:
            raise ValueError("보이스 모델 다운로드는 사용자 확인 후에만 실행할 수 있습니다.")
        if not self.streaming_supported():
            return {"managed": False, "ready": True, "streaming": "whisper_only", "language": self._language}
        spec = VOICE_LANGUAGE_MODELS[VOICE_LANGUAGE_DEFAULT]
        return self._model_store().install(spec["model_id"], progress=emit)

    def start(self) -> dict:
        if not self.streaming_supported():
            return self.start_whisper("", False)
        recognizer = self._ensure_recognizer()
        self._cleanup_stale_sessions()
        session_id = uuid.uuid4().hex
        session = _VoiceSession(
            stream=recognizer.create_stream(),
            vad=self._new_vad(),
            vad_threshold=self._vad_threshold,
            language=self._language,
            recognizer=recognizer,
            model_path=self._model_path,
        )
        with self._sessions_lock:
            self._sessions[session_id] = session
        return {"session_id": session_id, "sample_rate": VOICE_SAMPLE_RATE, "backend": "sherpa-onnx CPU", "language": session.language}

    def start_whisper(self, model_name: str, use_vulkan: bool) -> dict:
        self._cleanup_stale_sessions()
        session_id = uuid.uuid4().hex
        session = _VoiceSession(
            stream=None,
            vad=None,
            backend="whisper",
            model_name=str(model_name or "base"),
            use_vulkan=bool(use_vulkan),
            language=self._language,
        )
        with self._sessions_lock:
            self._sessions[session_id] = session
        backend = "whisper.cpp Vulkan" if session.use_vulkan else "whisper.cpp CPU"
        return {
            "session_id": session_id,
            "sample_rate": VOICE_SAMPLE_RATE,
            "backend": backend,
            "model": session.model_name,
        }

    def start_two_pass(self, model_name: str, use_vulkan: bool) -> dict:
        if not self.streaming_supported():
            return self.start_whisper(model_name, use_vulkan)
        recognizer = self._ensure_recognizer()
        self._cleanup_stale_sessions()
        session_id = uuid.uuid4().hex
        session = _VoiceSession(
            stream=recognizer.create_stream(),
            vad=self._new_vad(),
            vad_threshold=self._vad_threshold,
            backend="two_pass",
            model_name=str(model_name or "base"),
            use_vulkan=bool(use_vulkan),
            language=self._language,
            recognizer=recognizer,
            model_path=self._model_path,
        )
        with self._sessions_lock:
            self._sessions[session_id] = session
        second_pass = "Vulkan" if session.use_vulkan else "CPU"
        return {
            "session_id": session_id,
            "sample_rate": VOICE_SAMPLE_RATE,
            "backend": f"Sherpa-ONNX + whisper.cpp {second_pass}",
            "model": session.model_name,
        }

    def accept_pcm16(self, session_id: str, pcm: bytes, sample_rate: int, speech_state: str = "active") -> dict:
        if not pcm or len(pcm) > MAX_PCM_CHUNK_BYTES or len(pcm) % 2:
            raise ValueError("보이스 PCM chunk 크기가 올바르지 않습니다.")
        if sample_rate < 8_000 or sample_rate > 96_000:
            raise ValueError("보이스 sample rate가 올바르지 않습니다.")
        session = self._session(session_id)
        import numpy as np

        samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
        samples = self._resample(samples, sample_rate)
        normalized_pcm = np.clip(samples * 32768.0, -32768, 32767).astype("<i2").tobytes()
        if session.backend == "whisper":
            with session.lock:
                return self._accept_whisper_pcm(session, normalized_pcm, speech_state)
        if session.backend == "two_pass":
            return self._accept_two_pass_pcm(session, samples, normalized_pcm, speech_state)
        with session.lock, self._decode_lock:
            session.updated_at = time.monotonic()
            if session.vad_threshold != self._vad_threshold:
                session.vad = self._new_vad()
                session.vad_threshold = self._vad_threshold
            session.vad.accept_waveform(samples)
            session.stream.accept_waveform(VOICE_SAMPLE_RATE, samples)
            self._decode_ready(session)
            finals = self._finish_vad_segments(session)
            partial = self._session_recognizer(session).get_result(session.stream).strip()
            if finals and partial == finals[-1]:
                partial = ""
            if not has_speech_text(partial):
                partial = ""
            return {
                "partial": partial,
                "finals": finals,
                "text": " ".join([*session.finals, partial]).strip(),
                "speech_detected": bool(session.vad.is_speech_detected()),
            }

    def stop(self, session_id: str) -> dict:
        session = self._session(session_id)
        if session.backend in {"whisper", "two_pass"}:
            with self._sessions_lock:
                self._sessions.pop(session_id, None)
            return {"text": "", "finals": []}
        import numpy as np

        with session.lock, self._decode_lock:
            tail = np.zeros(VOICE_SAMPLE_RATE // 2, dtype=np.float32)
            session.vad.accept_waveform(tail)
            session.vad.flush()
            session.stream.accept_waveform(VOICE_SAMPLE_RATE, tail)
            session.stream.input_finished()
            self._decode_ready(session)
            self._finish_vad_segments(session)
            self._append_final(session, self._session_recognizer(session).get_result(session.stream))
            result = {"text": " ".join(session.finals).strip(), "finals": list(session.finals)}
        with self._sessions_lock:
            self._sessions.pop(session_id, None)
        return result

    def cancel(self, session_id: str) -> dict:
        with self._sessions_lock:
            removed = self._sessions.pop(str(session_id or ""), None)
        return {"cancelled": removed is not None}

    def close(self) -> None:
        """Release all session buffers and the recognizer when the app exits."""
        with self._sessions_lock:
            self._sessions.clear()
        with self._load_lock, self._decode_lock:
            self._recognizer = None
            self._sherpa = None
            self._model_path = ""

    def flush(self, session_id: str) -> dict:
        """Discard the open VAD segment and start a fresh recognition stream.

        Used when the client commits a partial transcript itself because the
        VAD segment stayed open (distant speech, no 0.5s silence gap).
        """
        session = self._session(session_id)
        if session.backend in {"whisper", "two_pass"}:
            with session.lock:
                session.pcm.clear()
                session.preroll.clear()
                session.recording = False
                session.first_pass_parts.clear()
                if session.backend == "two_pass":
                    session.vad = self._new_vad()
                    session.stream = self._session_recognizer(session).create_stream()
            return {"flushed": True}
        with session.lock, self._decode_lock:
            session.vad = self._new_vad()
            session.stream = self._session_recognizer(session).create_stream()
        return {"flushed": True}

    def _accept_whisper_pcm(self, session: _VoiceSession, pcm: bytes, speech_state: str) -> dict:
        audio = self._collect_whisper_utterance(session, pcm, speech_state)
        if audio is None:
            return self._empty_result(speech_detected=session.recording)
        transcript, model, usage = self._transcribe_whisper(audio, session)
        if not has_speech_text(transcript):
            return self._empty_result()
        self._append_final(session, transcript)
        return {
            "partial": "",
            "finals": [transcript],
            "text": transcript,
            "speech_detected": False,
            "model": model,
            "usage": usage,
        }

    def _accept_two_pass_pcm(self, session: _VoiceSession, samples, pcm: bytes, speech_state: str) -> dict:
        with session.lock, self._decode_lock:
            session.updated_at = time.monotonic()
            if session.vad_threshold != self._vad_threshold:
                session.vad = self._new_vad()
                session.vad_threshold = self._vad_threshold
            session.vad.accept_waveform(samples)
            session.stream.accept_waveform(VOICE_SAMPLE_RATE, samples)
            self._decode_ready(session)
            first_pass_finals = self._finish_vad_segments(session, persist=False)
            for text in first_pass_finals:
                if not session.first_pass_parts or session.first_pass_parts[-1] != text:
                    session.first_pass_parts.append(text)
            del session.first_pass_parts[:-MAX_SESSION_FINALS]
            partial = self._session_recognizer(session).get_result(session.stream).strip()
            if not has_speech_text(partial):
                partial = ""
            first_pass_text = " ".join([*session.first_pass_parts, partial]).strip()
            audio = self._collect_whisper_utterance(session, pcm, speech_state)
            if audio is None:
                return {
                    "partial": first_pass_text,
                    "finals": [],
                    "text": first_pass_text,
                    "speech_detected": bool(session.vad.is_speech_detected()),
                    "pass": 1,
                }
            session.first_pass_parts.clear()
            session.vad = self._new_vad()
            session.stream = self._session_recognizer(session).create_stream()
        transcript, model, usage = self._transcribe_whisper(audio, session)
        if not has_speech_text(transcript):
            return self._empty_result()
        with session.lock:
            self._append_final(session, transcript)
        return {
            "partial": "",
            "finals": [transcript],
            "text": transcript,
            "speech_detected": False,
            "model": model,
            "usage": usage,
            "pass": 2,
        }

    @staticmethod
    def _collect_whisper_utterance(session: _VoiceSession, pcm: bytes, speech_state: str):
        state = str(speech_state or "active").strip().lower()
        if state not in {"idle", "started", "active", "ended"}:
            raise ValueError("보이스 발화 상태가 올바르지 않습니다.")
        session.updated_at = time.monotonic()
        if state == "idle" and not session.recording:
            session.preroll.extend(pcm)
            keep = VOICE_SAMPLE_RATE * 2 * WHISPER_PREROLL_SECONDS
            if len(session.preroll) > keep:
                del session.preroll[:-keep]
            return None
        if not session.recording:
            session.pcm.extend(session.preroll)
            session.preroll.clear()
            session.recording = True
        session.pcm.extend(pcm)
        limit = VOICE_SAMPLE_RATE * 2 * MAX_WHISPER_UTTERANCE_SECONDS
        if len(session.pcm) > limit:
            del session.pcm[:-limit]
        if state != "ended":
            return None
        audio = bytes(session.pcm)
        session.pcm.clear()
        session.recording = False
        return audio

    @staticmethod
    def _empty_result(speech_detected: bool = False) -> dict:
        return {"partial": "", "finals": [], "text": "", "speech_detected": speech_detected}

    @staticmethod
    def _transcribe_whisper(pcm: bytes, session: _VoiceSession):
        if len(pcm) < VOICE_SAMPLE_RATE // 5 * 2:
            return "", "", None
        path = ""
        try:
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as handle:
                path = handle.name
            with wave.open(path, "wb") as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(VOICE_SAMPLE_RATE)
                wav.writeframes(pcm)
            from providers import transcribe_with_whisper_cpp_vulkan

            transcript, model, usage, _utterances = transcribe_with_whisper_cpp_vulkan(path, {
                "stt_model_name": session.model_name,
                "whisper_cpp_model_name": session.model_name,
                "whisper_cpp_use_vulkan": session.use_vulkan,
                "whisper_cpp_cpu_fallback": False,
                "language": session.language,
            })
            return transcript, model, usage
        finally:
            if path:
                try:
                    os.remove(path)
                except FileNotFoundError:
                    pass

    def _ensure_recognizer(self):
        if self._recognizer is not None:
            return self._recognizer
        with self._load_lock:
            if self._recognizer is not None:
                return self._recognizer
            spec = VOICE_LANGUAGE_MODELS[VOICE_LANGUAGE_DEFAULT]
            try:
                import sherpa_onnx
            except ImportError as error:
                from model_manager import ModelUnavailableError
                raise ModelUnavailableError("sherpa-onnx 실행 모듈이 설치되지 않았습니다.") from error
            model_path = self._model_store().resolve(spec["model_id"])
            self._recognizer = sherpa_onnx.OnlineRecognizer.from_transducer(
                tokens=str(model_path / "tokens.txt"),
                encoder=str(model_path / "encoder-epoch-99-avg-1.onnx"),
                decoder=str(model_path / "decoder-epoch-99-avg-1.onnx"),
                joiner=str(model_path / "joiner-epoch-99-avg-1.onnx"),
                num_threads=2,
                provider="cpu",
                model_type="zipformer",
                decoding_method="greedy_search",
                enable_endpoint_detection=False,
            )
            self._sherpa = sherpa_onnx
            self._model_path = str(model_path)
            _logger.info("[Voice] sherpa-onnx initialized (%s)", self._language)
            _logger.info("[Voice] Backend: CPU")
            return self._recognizer

    def _new_vad(self, model_path: str | None = None):
        model_path = model_path or self._model_path
        silero = self._sherpa.SileroVadModelConfig(
            model=f"{model_path}/silero_vad.onnx",
                threshold=self._vad_threshold,
                min_silence_duration=0.5,
                min_speech_duration=0.25,
            window_size=512,
            max_speech_duration=20,
        )
        config = self._sherpa.VadModelConfig(
            silero_vad=silero,
            sample_rate=VOICE_SAMPLE_RATE,
            num_threads=1,
            provider="cpu",
        )
        return self._sherpa.VoiceActivityDetector(config, 60)

    def _session(self, session_id: str) -> _VoiceSession:
        with self._sessions_lock:
            session = self._sessions.get(str(session_id or ""))
        if session is None:
            raise ValueError("보이스 세션을 찾을 수 없습니다.")
        return session

    def _session_recognizer(self, session: _VoiceSession):
        # Sessions built before multi-language support may not carry a pinned
        # recognizer; fall back to the service-level one.
        return session.recognizer or self._recognizer

    def _decode_ready(self, session: _VoiceSession) -> None:
        recognizer = session.recognizer or self._recognizer
        while recognizer.is_ready(session.stream):
            recognizer.decode_stream(session.stream)

    def _finish_vad_segments(self, session: _VoiceSession, persist: bool = True) -> list[str]:
        recognizer = session.recognizer or self._recognizer
        finals = []
        while not session.vad.empty():
            session.vad.pop()
            text = recognizer.get_result(session.stream).strip()
            if (self._append_final(session, text) if persist else has_speech_text(text)):
                finals.append(text)
            recognizer.reset(session.stream)
        return finals

    @staticmethod
    def _append_final(session: _VoiceSession, text: str) -> bool:
        normalized = str(text or "").strip()
        if not normalized or not has_speech_text(normalized):
            return False
        if session.finals and session.finals[-1] == normalized:
            return False
        session.finals.append(normalized)
        if len(session.finals) > MAX_SESSION_FINALS:
            del session.finals[:-MAX_SESSION_FINALS]
        return True

    @staticmethod
    def _resample(samples, sample_rate: int):
        if sample_rate == VOICE_SAMPLE_RATE:
            return samples
        import numpy as np

        size = max(1, round(len(samples) * VOICE_SAMPLE_RATE / sample_rate))
        positions = np.linspace(0, len(samples) - 1, size, dtype=np.float64)
        return np.interp(positions, np.arange(len(samples)), samples).astype(np.float32)

    def _cleanup_stale_sessions(self) -> None:
        cutoff = time.monotonic() - SESSION_TTL_SECONDS
        with self._sessions_lock:
            stale = [session_id for session_id, session in self._sessions.items() if session.updated_at < cutoff]
            for session_id in stale:
                self._sessions.pop(session_id, None)


VOICE_RECOGNITION_SERVICE = VoiceRecognitionService()
