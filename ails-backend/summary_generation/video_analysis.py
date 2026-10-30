from __future__ import annotations

import atexit
import ctypes
import hashlib
import json
import os
import shutil
import tempfile
import threading
import time
import wave
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Callable, Sequence, TYPE_CHECKING

if TYPE_CHECKING:
    import numpy as np

from PIL import Image

from .video_profiling import VideoProfiler, VideoProfile


HUNDRED_NANOSECONDS_PER_SECOND = 10_000_000
ANALYSIS_CACHE_VERSION = 3
DEFAULT_CACHE_MAX_AGE_SECONDS = 90 * 24 * 60 * 60
DEFAULT_CACHE_MAX_BYTES = 15 * 1024 * 1024 * 1024
NATIVE_DLL_PATH = Path(__file__).resolve().parents[1] / "native" / "ails_media_foundation.dll"
_CALLBACK = getattr(ctypes, "WINFUNCTYPE", ctypes.CFUNCTYPE)
_SHARED_BRIDGE = None
_SHARED_BRIDGE_LOCK = threading.Lock()
_ANALYSIS_LOCKS: dict[str, threading.Lock] = {}
_ANALYSIS_LOCKS_GUARD = threading.Lock()
_CACHE_USERS: dict[str, int] = {}
_CACHE_USERS_GUARD = threading.Lock()


class VideoAnalysisError(RuntimeError):
    pass


class VideoAnalysisCancelled(VideoAnalysisError):
    pass


@dataclass(frozen=True, slots=True)
class VideoAnalysisOptions:
    frame_interval_seconds: float = 0.5
    comparison_width: int = 320
    comparison_height: int = 180
    mean_difference_threshold: float = 12.0
    changed_pixel_threshold: int = 15
    changed_pixel_ratio_threshold: float = 0.15
    minimum_scene_interval_seconds: float = 1.0
    stable_window_start_seconds: float = 0.2
    stable_window_end_seconds: float = 0.5
    jpeg_quality: int = 90
    profiling_frame_interval_seconds: float = 5.0
    profiling_frame_max_width: int = 1280
    profiling_frame_jpeg_quality: int = 85

    def __post_init__(self) -> None:
        if self.frame_interval_seconds <= 0:
            raise ValueError("frame_interval_seconds must be positive")
        if self.comparison_width <= 0 or self.comparison_height <= 0:
            raise ValueError("comparison dimensions must be positive")
        if not 0 <= self.changed_pixel_ratio_threshold <= 1:
            raise ValueError("changed_pixel_ratio_threshold must be between 0 and 1")
        if self.minimum_scene_interval_seconds < 0:
            raise ValueError("minimum_scene_interval_seconds cannot be negative")
        if not 0 <= self.stable_window_start_seconds <= self.stable_window_end_seconds:
            raise ValueError("stable frame window is invalid")
        if not 1 <= self.jpeg_quality <= 100:
            raise ValueError("jpeg_quality must be between 1 and 100")
        if self.profiling_frame_interval_seconds < 0:
            raise ValueError("profiling_frame_interval_seconds cannot be negative")
        if self.profiling_frame_max_width <= 0:
            raise ValueError("profiling_frame_max_width must be positive")
        if not 1 <= self.profiling_frame_jpeg_quality <= 100:
            raise ValueError("profiling_frame_jpeg_quality must be between 1 and 100")


def options_from_config(config: dict) -> VideoAnalysisOptions:
    return VideoAnalysisOptions(frame_interval_seconds=float(config.get("video_frame_interval_seconds", 0.5)))


@dataclass(frozen=True, slots=True)
class FrameDifference:
    mean_absolute_difference: float
    changed_pixel_ratio: float


@dataclass(frozen=True, slots=True)
class VideoMetadata:
    duration_seconds: float
    width: int
    height: int
    frame_rate: float
    has_video: bool
    has_audio: bool
    video_codec: str = ""
    audio_codec: str = ""
    rotation_degrees: int = 0


@dataclass(frozen=True, slots=True)
class SceneInfo:
    index: int
    timestamp_seconds: float
    detected_at_seconds: float
    image_path: str
    mean_absolute_difference: float
    changed_pixel_ratio: float


@dataclass(frozen=True, slots=True)
class AudioInfo:
    wav_path: str
    sample_rate: int = 16_000
    channels: int = 1
    bits_per_sample: int = 16
    duration_seconds: float = 0.0
    bytes_written: int = 0


@dataclass(frozen=True, slots=True)
class VideoAnalysisProgress:
    current_position_seconds: float
    duration_seconds: float
    progress: float
    detected_scene_count: int


@dataclass(slots=True)
class VideoAnalysisResult:
    source_path: str
    source_fingerprint: str
    analysis_key: str
    metadata: VideoMetadata
    scenes: list[SceneInfo] = field(default_factory=list)
    audio: AudioInfo | None = None
    profile: VideoProfile | None = None
    cache_dir: str = ""
    cached: bool = False

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, payload: dict) -> "VideoAnalysisResult":
        return cls(
            source_path=str(payload["source_path"]),
            source_fingerprint=str(payload["source_fingerprint"]),
            analysis_key=str(payload["analysis_key"]),
            metadata=VideoMetadata(**payload["metadata"]),
            scenes=[SceneInfo(**item) for item in payload.get("scenes", [])],
            audio=AudioInfo(**payload["audio"]) if payload.get("audio") else None,
            profile=VideoProfile.from_dict(payload["profile"]) if payload.get("profile") else None,
            cache_dir=str(payload.get("cache_dir", "")),
            cached=bool(payload.get("cached", False)),
        )


@dataclass(slots=True)
class _SceneFrame:
    timestamp_seconds: float
    gray: np.ndarray
    payload: object
    stability: float


@dataclass(slots=True)
class _PendingScene:
    detected_at_seconds: float
    difference: FrameDifference
    fallback: _SceneFrame
    candidates: list[_SceneFrame] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class SceneSelection:
    timestamp_seconds: float
    detected_at_seconds: float
    difference: FrameDifference
    payload: object


def calculate_frame_difference(
    previous: Sequence[int] | np.ndarray,
    current: Sequence[int] | np.ndarray,
    *,
    changed_pixel_threshold: int = 15,
) -> FrameDifference:
    import numpy as np
    previous_array = np.asarray(previous, dtype=np.uint8)
    current_array = np.asarray(current, dtype=np.uint8)
    if previous_array.shape != current_array.shape or previous_array.size == 0:
        raise ValueError("frames must have the same non-empty shape")
    difference = np.abs(previous_array.astype(np.int16) - current_array.astype(np.int16))
    return FrameDifference(
        mean_absolute_difference=float(np.mean(difference)),
        changed_pixel_ratio=float(np.mean(difference >= int(changed_pixel_threshold))),
    )


class SceneDetector:
    """Pure scene selection state; frame payloads are opaque to the detector."""

    def __init__(self, options: VideoAnalysisOptions | None = None):
        import numpy as np
        self.options = options or VideoAnalysisOptions()
        self._previous_gray: np.ndarray | None = None
        self._last_scene_timestamp: float | None = None
        self._pending: _PendingScene | None = None

    def _changed(self, difference: FrameDifference) -> bool:
        return (
            difference.mean_absolute_difference >= self.options.mean_difference_threshold
            and difference.changed_pixel_ratio >= self.options.changed_pixel_ratio_threshold
        )

    def _finish_pending(self) -> SceneSelection:
        pending = self._pending
        if pending is None:
            raise RuntimeError("no pending scene")
        selected = min(pending.candidates, key=lambda item: item.stability) if pending.candidates else pending.fallback
        self._pending = None
        self._last_scene_timestamp = selected.timestamp_seconds
        return SceneSelection(
            timestamp_seconds=selected.timestamp_seconds,
            detected_at_seconds=pending.detected_at_seconds,
            difference=pending.difference,
            payload=selected.payload,
        )

    def push(self, timestamp_seconds: float, gray: np.ndarray, payload: object = None) -> list[SceneSelection]:
        import numpy as np
        timestamp = max(0.0, float(timestamp_seconds))
        current_gray = np.asarray(gray, dtype=np.uint8)
        if current_gray.size == 0:
            raise ValueError("gray frame cannot be empty")
        if self._previous_gray is None:
            self._previous_gray = current_gray.copy()
            self._last_scene_timestamp = timestamp
            return [
                SceneSelection(
                    timestamp_seconds=timestamp,
                    detected_at_seconds=timestamp,
                    difference=FrameDifference(0.0, 0.0),
                    payload=payload,
                )
            ]

        stability = calculate_frame_difference(
            self._previous_gray,
            current_gray,
            changed_pixel_threshold=self.options.changed_pixel_threshold,
        )
        self._previous_gray = current_gray.copy()

        if self._pending is not None:
            elapsed = timestamp - self._pending.detected_at_seconds
            frame = _SceneFrame(timestamp, current_gray.copy(), payload, stability.mean_absolute_difference)
            self._pending.fallback = frame
            if self.options.stable_window_start_seconds <= elapsed <= self.options.stable_window_end_seconds:
                self._pending.candidates.append(frame)
            if elapsed >= self.options.stable_window_end_seconds:
                return [self._finish_pending()]
            return []

        if not self._changed(stability):
            return []
        if (
            self._last_scene_timestamp is not None
            and timestamp - self._last_scene_timestamp < self.options.minimum_scene_interval_seconds
        ):
            return []

        frame = _SceneFrame(timestamp, current_gray.copy(), payload, stability.mean_absolute_difference)
        self._pending = _PendingScene(timestamp, stability, frame)
        return []

    def flush(self) -> list[SceneSelection]:
        return [self._finish_pending()] if self._pending is not None else []


class _NativeMetadata(ctypes.Structure):
    _fields_ = [
        ("duration_100ns", ctypes.c_int64),
        ("width", ctypes.c_uint32),
        ("height", ctypes.c_uint32),
        ("frame_rate", ctypes.c_double),
        ("has_video", ctypes.c_int32),
        ("has_audio", ctypes.c_int32),
        ("video_codec", ctypes.c_wchar * 64),
        ("audio_codec", ctypes.c_wchar * 64),
        ("rotation_degrees", ctypes.c_int32),
    ]


_FrameCallback = _CALLBACK(
    ctypes.c_int,
    ctypes.c_void_p,
    ctypes.c_uint32,
    ctypes.c_uint32,
    ctypes.c_uint32,
    ctypes.c_int32,
    ctypes.c_int64,
    ctypes.c_void_p,
)
_AudioCallback = _CALLBACK(
    ctypes.c_int,
    ctypes.c_void_p,
    ctypes.c_uint32,
    ctypes.c_int64,
    ctypes.c_void_p,
)
_ProgressCallback = _CALLBACK(
    ctypes.c_int,
    ctypes.c_int64,
    ctypes.c_int64,
    ctypes.c_void_p,
)


class MediaFoundationBridge:
    def __init__(self, dll_path: str | os.PathLike[str] = NATIVE_DLL_PATH):
        if os.name != "nt":
            raise VideoAnalysisError("Windows Media Foundation is only available on Windows")
        path = Path(dll_path)
        if not path.is_file():
            raise FileNotFoundError(f"Media Foundation bridge was not found: {path}")
        self._dll = ctypes.WinDLL(str(path))
        self._closed = False
        self._configure()
        status = int(self._dll.AilsMfStartup())
        if status < 0:
            raise VideoAnalysisError(f"Media Foundation startup failed: 0x{status & 0xFFFFFFFF:08X}")

    def _configure(self) -> None:
        self._dll.AilsMfStartup.argtypes = []
        self._dll.AilsMfStartup.restype = ctypes.c_int32
        self._dll.AilsMfShutdown.argtypes = []
        self._dll.AilsMfShutdown.restype = None
        self._dll.AilsMfProbe.argtypes = [
            ctypes.c_wchar_p,
            ctypes.POINTER(_NativeMetadata),
            ctypes.POINTER(ctypes.c_wchar),
            ctypes.c_uint32,
        ]
        self._dll.AilsMfProbe.restype = ctypes.c_int32
        self._dll.AilsMfDecode.argtypes = [
            ctypes.c_wchar_p,
            ctypes.c_int64,
            _FrameCallback,
            _AudioCallback,
            _ProgressCallback,
            ctypes.c_void_p,
            ctypes.POINTER(ctypes.c_wchar),
            ctypes.c_uint32,
        ]
        self._dll.AilsMfDecode.restype = ctypes.c_int32

    @staticmethod
    def _raise_native(operation: str, status: int, error_buffer) -> None:
        detail = str(error_buffer.value or "").strip()
        suffix = f": {detail}" if detail else ""
        raise VideoAnalysisError(f"{operation} failed (0x{status & 0xFFFFFFFF:08X}){suffix}")

    def probe(self, source_path: str) -> VideoMetadata:
        native = _NativeMetadata()
        error = ctypes.create_unicode_buffer(1024)
        status = int(self._dll.AilsMfProbe(source_path, ctypes.byref(native), error, len(error)))
        if status < 0:
            self._raise_native("Media Foundation probe", status, error)
        return VideoMetadata(
            duration_seconds=max(0.0, native.duration_100ns / HUNDRED_NANOSECONDS_PER_SECOND),
            width=int(native.width),
            height=int(native.height),
            frame_rate=max(0.0, float(native.frame_rate)),
            has_video=bool(native.has_video),
            has_audio=bool(native.has_audio),
            video_codec=str(native.video_codec).strip("\x00 "),
            audio_codec=str(native.audio_codec).strip("\x00 "),
            rotation_degrees=int(native.rotation_degrees),
        )

    def decode(
        self,
        source_path: str,
        frame_interval_100ns: int,
        frame_callback: Callable,
        audio_callback: Callable,
        progress_callback: Callable,
    ) -> None:
        callback_error: list[BaseException] = []

        def guarded(callback):
            def invoke(*args):
                if callback_error:
                    return 0
                try:
                    return 1 if callback(*args[:-1]) is not False else 0
                except BaseException as error:
                    callback_error.append(error)
                    return 0
            return invoke

        native_frame = _FrameCallback(guarded(frame_callback))
        native_audio = _AudioCallback(guarded(audio_callback))
        native_progress = _ProgressCallback(guarded(progress_callback))
        error = ctypes.create_unicode_buffer(1024)
        status = int(
            self._dll.AilsMfDecode(
                source_path,
                int(frame_interval_100ns),
                native_frame,
                native_audio,
                native_progress,
                None,
                error,
                len(error),
            )
        )
        if callback_error:
            raise callback_error[0]
        if status == -2147023673:
            raise VideoAnalysisCancelled("video analysis was cancelled")
        if status < 0:
            self._raise_native("Media Foundation decode", status, error)

    def close(self) -> None:
        if not self._closed:
            self._dll.AilsMfShutdown()
            self._closed = True

    def __enter__(self) -> "MediaFoundationBridge":
        return self

    def __exit__(self, _exc_type, _exc, _traceback) -> None:
        self.close()


def _shared_bridge() -> MediaFoundationBridge:
    global _SHARED_BRIDGE
    with _SHARED_BRIDGE_LOCK:
        if _SHARED_BRIDGE is None:
            _SHARED_BRIDGE = MediaFoundationBridge()
        return _SHARED_BRIDGE


def _shutdown_shared_bridge() -> None:
    global _SHARED_BRIDGE
    with _SHARED_BRIDGE_LOCK:
        if _SHARED_BRIDGE is not None:
            _SHARED_BRIDGE.close()
            _SHARED_BRIDGE = None


atexit.register(_shutdown_shared_bridge)


def source_fingerprint(source_path: str | os.PathLike[str], sample_bytes: int = 64 * 1024) -> str:
    path = Path(source_path)
    if not path.is_file():
        raise FileNotFoundError(f"video file was not found: {path}")
    before = path.stat()
    digest = hashlib.sha256()
    digest.update(str(before.st_size).encode("ascii"))
    digest.update(b"\0")
    digest.update(str(before.st_mtime_ns).encode("ascii"))
    with path.open("rb") as source:
        digest.update(source.read(sample_bytes))
        if before.st_size > sample_bytes:
            source.seek(max(0, before.st_size - sample_bytes))
            digest.update(source.read(sample_bytes))
    after = path.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise VideoAnalysisError("video file changed while its fingerprint was being calculated")
    return digest.hexdigest()


def default_video_cache_root() -> Path:
    base = os.environ.get("LOCALAPPDATA") or tempfile.gettempdir()
    return Path(base) / "AILS" / "video-analysis"


class PersistentVideoAnalysisCache:
    def __init__(self, root: str | os.PathLike[str] | None, options: VideoAnalysisOptions):
        self.root = Path(root) if root else default_video_cache_root()
        self.options = options

    def analysis_key(self, fingerprint: str) -> str:
        settings = json.dumps(asdict(self.options), sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(
            f"{ANALYSIS_CACHE_VERSION}\0{fingerprint}\0{settings}".encode("utf-8")
        ).hexdigest()

    def directory(self, analysis_key: str) -> Path:
        return self.root / analysis_key

    @contextmanager
    def hold(self, analysis_key: str):
        """Protect files until the consumer finishes STT, frames and AI work."""
        directory = os.path.normcase(str(self.directory(analysis_key).resolve()))
        with _CACHE_USERS_GUARD:
            _CACHE_USERS[directory] = _CACHE_USERS.get(directory, 0) + 1
        try:
            yield
        finally:
            with _CACHE_USERS_GUARD:
                remaining = _CACHE_USERS[directory] - 1
                if remaining:
                    _CACHE_USERS[directory] = remaining
                else:
                    del _CACHE_USERS[directory]

    def load(self, analysis_key: str, source_path: str) -> VideoAnalysisResult | None:
        result_path = self.directory(analysis_key) / "result.json"
        try:
            payload = json.loads(result_path.read_text(encoding="utf-8"))
            if payload.get("cache_version") != ANALYSIS_CACHE_VERSION:
                return None
            result = VideoAnalysisResult.from_dict(payload["result"])
            if result.analysis_key != analysis_key:
                return None
            referenced = [Path(item.image_path) for item in result.scenes]
            if result.audio is not None:
                referenced.append(Path(result.audio.wav_path))
            if result.profile is not None:
                referenced.extend(Path(item) for item in result.profile.profiling_frame_paths)
            if any(not path.is_file() for path in referenced):
                return None
            result.source_path = str(Path(source_path).resolve())
            result.cached = True
            try:
                result_path.touch()
            except OSError:
                pass
            return result
        except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError):
            return None

    def save(self, result: VideoAnalysisResult) -> None:
        cache_dir = self.directory(result.analysis_key)
        cache_dir.mkdir(parents=True, exist_ok=True)
        payload = {"cache_version": ANALYSIS_CACHE_VERSION, "result": result.to_dict()}
        temporary = cache_dir / "result.json.tmp"
        temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temporary, cache_dir / "result.json")

    def prune(
        self,
        *,
        preserve_keys: set[str] | None = None,
        max_age_seconds: int = DEFAULT_CACHE_MAX_AGE_SECONDS,
        max_bytes: int = DEFAULT_CACHE_MAX_BYTES,
    ) -> dict[str, int]:
        preserve = preserve_keys or set()
        if max_age_seconds < 0 or max_bytes < 0:
            raise ValueError("cache limits cannot be negative")
        try:
            candidates = list(self.root.iterdir())
        except OSError:
            return {"removed_entries": 0, "removed_bytes": 0}

        entries = []
        for directory in candidates:
            if (
                len(directory.name) != 64
                or any(character not in "0123456789abcdef" for character in directory.name)
                or directory.is_symlink()
                or not directory.is_dir()
            ):
                continue
            manifest = directory / "result.json"
            if not manifest.is_file():
                continue
            try:
                size = sum(
                    Path(folder, filename).stat().st_size
                    for folder, _directories, files in os.walk(directory, followlinks=False)
                    for filename in files
                    if not Path(folder, filename).is_symlink()
                )
                entries.append((directory, manifest.stat().st_mtime, size))
            except OSError:
                continue

        removed_entries = 0
        removed_bytes = 0

        def remove(entry) -> bool:
            nonlocal removed_entries, removed_bytes
            directory, _modified, size = entry
            if directory.name in preserve:
                return False
            # Check at deletion time, not when the pruning scan starts: another
            # task may acquire the entry while directory sizes are collected.
            with _CACHE_USERS_GUARD:
                if _CACHE_USERS.get(os.path.normcase(str(directory.resolve()))):
                    return False
                try:
                    shutil.rmtree(directory)
                except OSError:
                    return False
            removed_entries += 1
            removed_bytes += size
            return True

        cutoff = time.time() - max_age_seconds
        remaining = []
        for entry in entries:
            if entry[1] < cutoff and remove(entry):
                continue
            remaining.append(entry)

        total = sum(entry[2] for entry in remaining)
        for entry in sorted(remaining, key=lambda item: item[1]):
            if total <= max_bytes:
                break
            if remove(entry):
                total -= entry[2]
        return {"removed_entries": removed_entries, "removed_bytes": removed_bytes}


def _frame_image(buffer, byte_count: int, width: int, height: int, stride: int) -> Image.Image:
    width = int(width)
    height = int(height)
    row_size = width * 4
    absolute_stride = abs(int(stride))
    if width <= 0 or height <= 0 or absolute_stride < row_size:
        raise VideoAnalysisError("native video frame dimensions are invalid")
    required = absolute_stride * (height - 1) + row_size
    if int(byte_count) < required:
        raise VideoAnalysisError("native video frame buffer is truncated")
    scanline_address = int(ctypes.cast(buffer, ctypes.c_void_p).value or 0)
    if not scanline_address:
        raise VideoAnalysisError("native video frame buffer is null")
    lowest_address = scanline_address + min(0, int(stride) * (height - 1))
    raw = ctypes.string_at(lowest_address, required)
    rows = []
    for index in range(height):
        offset = scanline_address + index * int(stride) - lowest_address
        rows.append(raw[offset:offset + row_size])
    return Image.frombytes("RGB", (width, height), b"".join(rows), "raw", "BGRX")


def _display_oriented_image(image: Image.Image, rotation_degrees: int) -> Image.Image:
    rotation = int(rotation_degrees) % 360
    transpose = getattr(Image, "Transpose", Image)
    operation = {
        90: transpose.ROTATE_270,
        180: transpose.ROTATE_180,
        270: transpose.ROTATE_90,
    }.get(rotation)
    return image.transpose(operation) if operation is not None else image


def _comparison_gray(image: Image.Image, options: VideoAnalysisOptions) -> np.ndarray:
    import numpy as np
    resampling = getattr(getattr(Image, "Resampling", Image), "BILINEAR")
    return np.asarray(
        image.convert("L").resize(
            (options.comparison_width, options.comparison_height),
            resample=resampling,
        ),
        dtype=np.uint8,
    ).copy()


def _scene_file_name(index: int, timestamp_seconds: float) -> str:
    total_ms = max(0, int(round(timestamp_seconds * 1000)))
    hours, remainder = divmod(total_ms, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    seconds, milliseconds = divmod(remainder, 1000)
    return f"scene_{index:06d}_{hours:02d}-{minutes:02d}-{seconds:02d}-{milliseconds:03d}.jpg"


def _profiling_frame_name(index: int, timestamp_seconds: float) -> str:
    total_ms = max(0, int(round(timestamp_seconds * 1000)))
    hours, remainder = divmod(total_ms, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    seconds, milliseconds = divmod(remainder, 1000)
    return f"profile_{index:06d}_{hours:02d}-{minutes:02d}-{seconds:02d}-{milliseconds:03d}.jpg"


class MediaFoundationVideoAnalyzer:
    def __init__(
        self,
        *,
        cache_root: str | os.PathLike[str] | None = None,
        options: VideoAnalysisOptions | None = None,
        bridge: MediaFoundationBridge | None = None,
    ):
        self.options = options or VideoAnalysisOptions()
        self.cache = PersistentVideoAnalysisCache(cache_root, self.options)
        self._bridge = bridge
        self._owns_bridge = False

    def _get_bridge(self) -> MediaFoundationBridge:
        if self._bridge is None:
            self._bridge = _shared_bridge()
        return self._bridge

    def close(self) -> None:
        if self._owns_bridge and self._bridge is not None:
            self._bridge.close()
            self._bridge = None
            self._owns_bridge = False

    def analyze(
        self,
        source_path: str | os.PathLike[str],
        *,
        use_cache: bool = True,
        cancel_event: threading.Event | None = None,
        cancel_check: Callable[[], object] | None = None,
        progress_callback: Callable[[VideoAnalysisProgress], object] | None = None,
    ) -> VideoAnalysisResult:
        source = str(Path(source_path).resolve())

        def check_cancelled() -> None:
            if cancel_event is not None and cancel_event.is_set():
                raise VideoAnalysisCancelled("video analysis was cancelled")
            if cancel_check is not None and cancel_check():
                raise VideoAnalysisCancelled("video analysis was cancelled")

        check_cancelled()
        fingerprint = source_fingerprint(source)
        analysis_key = self.cache.analysis_key(fingerprint)
        if use_cache:
            self.cache.prune(preserve_keys={analysis_key})
            cached = self.cache.load(analysis_key, source)
            if cached is not None:
                check_cancelled()
                if progress_callback is not None:
                    keep_running = progress_callback(
                        VideoAnalysisProgress(
                            cached.metadata.duration_seconds,
                            cached.metadata.duration_seconds,
                            1.0,
                            len(cached.scenes),
                        )
                    )
                    if keep_running is False:
                        raise VideoAnalysisCancelled("video analysis was cancelled by progress callback")
                return cached

        bridge = self._get_bridge()
        metadata = bridge.probe(source)
        if not metadata.has_video and not metadata.has_audio:
            raise VideoAnalysisError("media contains neither a video stream nor an audio stream")

        cache_dir = self.cache.directory(analysis_key)
        scenes_dir = cache_dir / "scenes"
        scenes_dir.mkdir(parents=True, exist_ok=True)
        detector = SceneDetector(self.options)
        profiler = VideoProfiler()
        scenes: list[SceneInfo] = []
        profiling_dir = cache_dir / "profiling"
        profiling_frames: list[tuple[float, Path]] = []
        next_profiling_timestamp = 0.0
        audio_path = cache_dir / "audio.wav"
        temporary_audio_path = cache_dir / "audio.wav.tmp"
        audio_stream = None
        audio_bytes = 0

        if metadata.has_audio:
            audio_stream = wave.open(str(temporary_audio_path), "wb")
            audio_stream.setnchannels(1)
            audio_stream.setsampwidth(2)
            audio_stream.setframerate(16_000)

        def maybe_save_profiling_frame(timestamp_seconds: float, image: Image.Image) -> None:
            nonlocal next_profiling_timestamp
            interval = self.options.profiling_frame_interval_seconds
            if interval <= 0:
                return
            if timestamp_seconds + 1e-9 < next_profiling_timestamp:
                return
            profiling_dir.mkdir(parents=True, exist_ok=True)
            frame = image
            if image.width > self.options.profiling_frame_max_width:
                scale = self.options.profiling_frame_max_width / image.width
                frame = image.resize(
                    (self.options.profiling_frame_max_width, max(1, round(image.height * scale)))
                )
            index = len(profiling_frames) + 1
            target = profiling_dir / _profiling_frame_name(index, timestamp_seconds)
            temporary = target.with_suffix(".jpg.tmp")
            try:
                frame.save(temporary, format="JPEG", quality=self.options.profiling_frame_jpeg_quality)
                os.replace(temporary, target)
            finally:
                if frame is not image:
                    frame.close()
                temporary.unlink(missing_ok=True)
            profiling_frames.append((timestamp_seconds, target))
            next_profiling_timestamp = timestamp_seconds + interval

        def save_selection(selection: SceneSelection) -> None:
            image = selection.payload
            if not isinstance(image, Image.Image):
                raise VideoAnalysisError("scene payload is not an image")
            index = len(scenes) + 1
            target = scenes_dir / _scene_file_name(index, selection.timestamp_seconds)
            temporary = target.with_suffix(".jpg.tmp")
            try:
                image.save(temporary, format="JPEG", quality=self.options.jpeg_quality)
                os.replace(temporary, target)
            finally:
                image.close()
                temporary.unlink(missing_ok=True)
            scenes.append(
                SceneInfo(
                    index=index,
                    timestamp_seconds=selection.timestamp_seconds,
                    detected_at_seconds=selection.detected_at_seconds,
                    image_path=str(target.resolve()),
                    mean_absolute_difference=selection.difference.mean_absolute_difference,
                    changed_pixel_ratio=selection.difference.changed_pixel_ratio,
                )
            )

        def on_frame(buffer, byte_count, width, height, stride, timestamp_100ns):
            check_cancelled()
            raw_image = _frame_image(buffer, byte_count, width, height, stride)
            image = _display_oriented_image(raw_image, metadata.rotation_degrees)
            if image is not raw_image:
                raw_image.close()
            gray = _comparison_gray(image, self.options)
            timestamp = timestamp_100ns / HUNDRED_NANOSECONDS_PER_SECOND
            # 프로파일링과 커버리지 프레임 저장은 장면 payload가 닫히기 전에 실행된다.
            profiler.push(timestamp, gray, image)
            maybe_save_profiling_frame(timestamp, image)
            for selection in detector.push(timestamp, gray, image):
                save_selection(selection)
            return True

        def on_audio(buffer, byte_count, _timestamp_100ns):
            nonlocal audio_bytes
            check_cancelled()
            if audio_stream is None:
                return True
            size = int(byte_count)
            if size % 2:
                raise VideoAnalysisError("native PCM16 audio chunk has an odd byte length")
            chunk = ctypes.string_at(buffer, size)
            audio_stream.writeframesraw(chunk)
            audio_bytes += size
            return True

        def on_progress(position_100ns, duration_100ns):
            check_cancelled()
            duration = max(
                metadata.duration_seconds,
                int(duration_100ns) / HUNDRED_NANOSECONDS_PER_SECOND,
            )
            current = max(0.0, int(position_100ns) / HUNDRED_NANOSECONDS_PER_SECOND)
            progress = min(1.0, current / duration) if duration > 0 else 0.0
            if progress_callback is not None:
                keep_running = progress_callback(
                    VideoAnalysisProgress(current, duration, progress, len(scenes))
                )
                if keep_running is False:
                    raise VideoAnalysisCancelled("video analysis was cancelled by progress callback")
            return True

        try:
            try:
                bridge.decode(
                    source,
                    int(round(self.options.frame_interval_seconds * HUNDRED_NANOSECONDS_PER_SECOND)),
                    on_frame,
                    on_audio,
                    on_progress,
                )
                for selection in detector.flush():
                    save_selection(selection)
            finally:
                if audio_stream is not None:
                    audio_stream.close()
        except BaseException:
            shutil.rmtree(cache_dir, ignore_errors=True)
            raise

        check_cancelled()
        audio = None
        if metadata.has_audio:
            os.replace(temporary_audio_path, audio_path)
            audio = AudioInfo(
                wav_path=str(audio_path.resolve()),
                duration_seconds=audio_bytes / (16_000 * 2),
                bytes_written=audio_bytes,
            )
        profile = profiler.finish(
            duration_seconds=metadata.duration_seconds,
            scene_count=len(scenes),
            audio_wav_path=str(audio_path) if audio is not None else None,
        )
        profile.profiling_frame_paths = [str(target.resolve()) for _timestamp, target in profiling_frames]
        profile.profiling_frame_timestamps = [timestamp for timestamp, _target in profiling_frames]
        result = VideoAnalysisResult(
            source_path=source,
            source_fingerprint=fingerprint,
            analysis_key=analysis_key,
            metadata=metadata,
            scenes=scenes,
            audio=audio,
            profile=profile,
            cache_dir=str(cache_dir.resolve()),
        )
        self.cache.save(result)
        self.cache.prune(preserve_keys={analysis_key})
        if progress_callback is not None:
            progress_callback(
                VideoAnalysisProgress(
                    metadata.duration_seconds,
                    metadata.duration_seconds,
                    1.0,
                    len(scenes),
                )
            )
        return result


@contextmanager
def hold_video_analysis_cache(source_path, *, cache_root=None, options=None):
    cache = PersistentVideoAnalysisCache(cache_root, options or VideoAnalysisOptions())
    with cache.hold(cache.analysis_key(source_fingerprint(source_path))):
        yield


def analyze_video(
    source_path: str | os.PathLike[str],
    *,
    cache_root: str | os.PathLike[str] | None = None,
    options: VideoAnalysisOptions | None = None,
    use_cache: bool = True,
    cancel_event: threading.Event | None = None,
    cancel_check: Callable[[], object] | None = None,
    progress_callback: Callable[[VideoAnalysisProgress], object] | None = None,
) -> VideoAnalysisResult:
    analyzer = MediaFoundationVideoAnalyzer(cache_root=cache_root, options=options)
    source = str(Path(source_path).resolve())
    lock_key = hashlib.sha256(
        f"{source_fingerprint(source)}\0{json.dumps(asdict(analyzer.options), sort_keys=True)}".encode("utf-8")
    ).hexdigest()
    # ponytail: one small lock per analyzed source; use a bounded lock cache if catalogs reach thousands of videos.
    with _ANALYSIS_LOCKS_GUARD:
        analysis_lock = _ANALYSIS_LOCKS.setdefault(lock_key, threading.Lock())
    try:
        while not analysis_lock.acquire(timeout=0.2):
            if cancel_event is not None and cancel_event.is_set():
                raise VideoAnalysisCancelled("video analysis was cancelled")
            if cancel_check is not None and cancel_check():
                raise VideoAnalysisCancelled("video analysis was cancelled")
        try:
            with hold_video_analysis_cache(source, cache_root=cache_root, options=analyzer.options):
                return analyzer.analyze(
                    source,
                    use_cache=use_cache,
                    cancel_event=cancel_event,
                    cancel_check=cancel_check,
                    progress_callback=progress_callback,
                )
        finally:
            analysis_lock.release()
    finally:
        analyzer.close()


__all__ = [
    "AudioInfo",
    "FrameDifference",
    "MediaFoundationBridge",
    "MediaFoundationVideoAnalyzer",
    "PersistentVideoAnalysisCache",
    "SceneDetector",
    "SceneInfo",
    "SceneSelection",
    "VideoAnalysisCancelled",
    "VideoAnalysisError",
    "VideoAnalysisOptions",
    "VideoAnalysisProgress",
    "VideoAnalysisResult",
    "VideoMetadata",
    "VideoProfile",
    "DEFAULT_CACHE_MAX_AGE_SECONDS",
    "DEFAULT_CACHE_MAX_BYTES",
    "analyze_video",
    "hold_video_analysis_cache",
    "calculate_frame_difference",
    "default_video_cache_root",
    "options_from_config",
    "source_fingerprint",
]
