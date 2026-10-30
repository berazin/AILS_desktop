"""저비용 로컬 영상 프로파일링 패스.

Media Foundation decode 패스 안에서 함께 실행되며 numpy/PIL 로컬 계산만 사용한다.
외부 AI API 호출도, 추가 ML 런타임 의존성도 없다. 측정된 신호는 이후 단계에서
영상 전체와 구간(segment)별 성격을 파악해 세그먼트 구성과 분석 전략을 적응적으로
선택하는 데 쓰인다.

신호 스케일 규약:
- speech_density / silence_ratio / small_change_rate / visual_persistence /
  text_change_rate / subtitle_likelihood: 0~1 비율.
- visual_change_rate: 인접 샘플 프레임 쌍의 changed pixel ratio 평균(0~1).
- motion_level: 인접 쌍 mean absolute difference 평균을 MOTION_FULL_SCALE(0~255
  스케일)로 나눈 값. 게임플레이 수준의 움직임이 0.2~0.6, 정적 화면은 0.05 미만.
- text_density: 텍스트 줄 후보 행의 edge 픽셀 비율을 TEXT_DENSITY_FULL_SCALE로
  정규화. 텍스트가 화면을 지배하는 슬라이드에서 0.6~1.0.
- face_presence: 피부톤 픽셀 비율을 FACE_PRESENCE_FULL_SCALE로 정규화한 근사값.
"""

from __future__ import annotations

import wave
from dataclasses import asdict, dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import numpy as np

from PIL import Image


MOTION_FULL_SCALE = 60.0
TEXT_DENSITY_FULL_SCALE = 0.20
FACE_PRESENCE_FULL_SCALE = 0.35


class VideoProfilingError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class VideoProfilingOptions:
    text_sample_width: int = 160
    text_sample_height: int = 90
    text_edge_threshold: int = 30
    text_min_transitions: float = 0.06
    text_row_max_density: float = 0.7
    text_min_raw_density: float = 0.02
    text_change_delta: float = 0.03
    subtitle_top: float = 0.72
    subtitle_bottom: float = 0.97
    subtitle_left: float = 0.20
    subtitle_right: float = 0.80
    phash_size: int = 32
    persistence_max_distance: int = 10
    small_change_min_ratio: float = 0.0008
    small_change_max_ratio: float = 0.08
    small_change_max_mean_difference: float = 12.0
    skin_sample_width: int = 64
    skin_sample_height: int = 36
    vad_window_seconds: float = 0.03
    vad_margin_db: float = 12.0
    vad_floor_percentile: float = 10.0
    vad_min_silence_seconds: float = 1.0
    vad_long_silence_seconds: float = 2.0

    def __post_init__(self) -> None:
        if self.text_sample_width <= 0 or self.text_sample_height <= 0:
            raise ValueError("text sample dimensions must be positive")
        if self.phash_size < 8:
            raise ValueError("phash_size must be at least 8")
        if not 0 <= self.subtitle_top < self.subtitle_bottom <= 1:
            raise ValueError("subtitle strip bounds are invalid")
        if not 0 <= self.subtitle_left < self.subtitle_right <= 1:
            raise ValueError("subtitle strip bounds are invalid")
        if self.small_change_min_ratio > self.small_change_max_ratio:
            raise ValueError("small change ratio bounds are invalid")


@dataclass(slots=True)
class FrameSample:
    timestamp_seconds: float
    mean_absolute_difference: float = 0.0
    changed_pixel_ratio: float = 0.0
    text_density: float = 0.0
    face_presence: float = 0.0
    text_changed: bool = False
    perceptual_hash: int = 0


@dataclass(slots=True)
class VideoProfile:
    speech_density: float = 0.0
    silence_ratio: float = 0.0
    scene_change_rate: float = 0.0
    visual_change_rate: float = 0.0
    small_change_rate: float = 0.0
    motion_level: float = 0.0
    text_density: float = 0.0
    text_change_rate: float = 0.0
    visual_persistence: float = 0.0
    face_presence: float = 0.0
    subtitle_likelihood: float = 0.0
    silence_intervals: list[list[float]] = field(default_factory=list)
    frame_samples: list[FrameSample] = field(default_factory=list)
    profiling_frame_paths: list[str] = field(default_factory=list)
    profiling_frame_timestamps: list[float] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, payload: dict) -> "VideoProfile":
        data = payload if isinstance(payload, dict) else {}
        profile = cls(
            speech_density=_clamp01(_float(data.get("speech_density"))),
            silence_ratio=_clamp01(_float(data.get("silence_ratio"))),
            scene_change_rate=max(0.0, _float(data.get("scene_change_rate"))),
            visual_change_rate=_clamp01(_float(data.get("visual_change_rate"))),
            small_change_rate=_clamp01(_float(data.get("small_change_rate"))),
            motion_level=_clamp01(_float(data.get("motion_level"))),
            text_density=_clamp01(_float(data.get("text_density"))),
            text_change_rate=_clamp01(_float(data.get("text_change_rate"))),
            visual_persistence=_clamp01(_float(data.get("visual_persistence"))),
            face_presence=_clamp01(_float(data.get("face_presence"))),
            subtitle_likelihood=_clamp01(_float(data.get("subtitle_likelihood"))),
        )
        for interval in data.get("silence_intervals") or []:
            if isinstance(interval, (list, tuple)) and len(interval) >= 2:
                profile.silence_intervals.append([_float(interval[0]), _float(interval[1])])
        for sample in data.get("frame_samples") or []:
            if isinstance(sample, dict):
                profile.frame_samples.append(
                    FrameSample(
                        timestamp_seconds=max(0.0, _float(sample.get("timestamp_seconds"))),
                        mean_absolute_difference=max(0.0, _float(sample.get("mean_absolute_difference"))),
                        changed_pixel_ratio=_clamp01(_float(sample.get("changed_pixel_ratio"))),
                        text_density=_clamp01(_float(sample.get("text_density"))),
                        face_presence=_clamp01(_float(sample.get("face_presence"))),
                        text_changed=bool(sample.get("text_changed")),
                        perceptual_hash=int(sample.get("perceptual_hash") or 0),
                    )
                )
        profile.profiling_frame_paths = [str(item) for item in data.get("profiling_frame_paths") or []]
        profile.profiling_frame_timestamps = [
            max(0.0, _float(item)) for item in data.get("profiling_frame_timestamps") or []
        ]
        return profile


def _float(value) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _clamp01(value: float) -> float:
    return min(1.0, max(0.0, value))


def _dct_matrix(size: int) -> np.ndarray:
    import numpy as np
    frequencies = np.arange(size, dtype=np.float64)[:, None]
    positions = np.arange(size, dtype=np.float64)[None, :]
    matrix = np.cos(np.pi * (2 * positions + 0.5) * frequencies / size) * np.sqrt(2.0 / size)
    matrix[0, :] /= np.sqrt(2.0)
    return matrix


def perceptual_hash(gray: np.ndarray, *, size: int = 32, dct_matrix: np.ndarray | None = None) -> int:
    """pHash 근사: 32x32 DCT 저주파 8x8 블록의 중앙값 비교 비트."""
    import numpy as np
    matrix = dct_matrix if dct_matrix is not None else _dct_matrix(size)
    image = Image.fromarray(np.asarray(gray, dtype=np.uint8), "L").resize((size, size), Image.BILINEAR)
    pixels = np.asarray(image, dtype=np.float64)
    frequency = matrix @ pixels @ matrix.T
    block = frequency[1:9, 1:9]
    median = float(np.median(block))
    bits = block > median
    value = 0
    for bit in bits.flatten():
        value = (value << 1) | int(bit)
    return value


def hamming_distance(left: int, right: int) -> int:
    return (left ^ right).bit_count()


def _resample_gray(gray: np.ndarray, width: int, height: int) -> np.ndarray:
    import numpy as np
    image = Image.fromarray(np.asarray(gray, dtype=np.uint8), "L").resize((width, height), Image.BILINEAR)
    return np.asarray(image, dtype=np.uint8)


def _edge_row_metrics(small_gray: np.ndarray, options: VideoProfilingOptions) -> tuple[np.ndarray, np.ndarray]:
    import numpy as np
    edges = np.abs(np.diff(small_gray.astype(np.int16), axis=1)) >= options.text_edge_threshold
    width = edges.shape[1]
    row_density = edges.mean(axis=1)
    transitions = np.abs(np.diff(edges.astype(np.int8), axis=1)).sum(axis=1) / max(1, width - 1)
    return row_density, transitions


def _text_row_mask(row_density: np.ndarray, transitions: np.ndarray, options: VideoProfilingOptions) -> np.ndarray:
    return (
        (transitions >= options.text_min_transitions)
        & (transitions <= 0.95)
        & (row_density >= 0.015)
        & (row_density <= options.text_row_max_density)
    )


def _skin_ratio(image: Image.Image, options: VideoProfilingOptions) -> float:
    import numpy as np
    small = image.resize((options.skin_sample_width, options.skin_sample_height), Image.BILINEAR).convert("RGB")
    pixels = np.asarray(small, dtype=np.int16)
    red = pixels[:, :, 0]
    green = pixels[:, :, 1]
    blue = pixels[:, :, 2]
    maximum = pixels.max(axis=2)
    minimum = pixels.min(axis=2)
    skin = (
        (red > 95) & (green > 40) & (blue > 20)
        & (red > green) & (red >= blue)
        & ((red - green) > 15)
        & ((maximum - minimum) > 15)
        & (red < 250)
    )
    return float(skin.mean())


class VideoProfiler:
    """decode 프레임 콜백에서 소비되는 순수 로컬 프로파일러."""

    def __init__(self, options: VideoProfilingOptions | None = None):
        import numpy as np
        self.options = options or VideoProfilingOptions()
        self._samples: list[FrameSample] = []
        self._dct_matrix = _dct_matrix(self.options.phash_size)
        self._previous_gray: np.ndarray | None = None
        self._previous_text_rows: np.ndarray | None = None
        self._previous_text_raw = 0.0
        self._pair_mean_differences: list[float] = []
        self._pair_changed_ratios: list[float] = []
        self._pair_small_change_count = 0
        self._pair_similar_count = 0
        self._text_pair_count = 0
        self._text_change_pair_count = 0
        self._subtitle_frame_count = 0
        self._pair_count = 0
        self._previous_hash = 0

    @property
    def sample_count(self) -> int:
        return len(self._samples)

    def push(self, timestamp_seconds: float, gray: np.ndarray, image: Image.Image | None = None) -> None:
        import numpy as np
        options = self.options
        gray_array = np.asarray(gray, dtype=np.uint8)
        if gray_array.ndim != 2 or gray_array.size == 0:
            raise VideoProfilingError("profiler gray frame must be a non-empty 2D array")
        small = _resample_gray(gray_array, options.text_sample_width, options.text_sample_height)
        hash_value = perceptual_hash(small, size=options.phash_size, dct_matrix=self._dct_matrix)
        row_density, transitions = _edge_row_metrics(small, options)
        text_mask = _text_row_mask(row_density, transitions, options)
        raw_density = float(row_density[text_mask].mean()) if text_mask.any() else 0.0
        text_density = _clamp01(raw_density / TEXT_DENSITY_FULL_SCALE)
        face_presence = _clamp01(_skin_ratio(image, options) / FACE_PRESENCE_FULL_SCALE) if image is not None else 0.0
        subtitle = self._subtitle_present(row_density, transitions, text_mask, small.shape[0])

        mean_difference = 0.0
        changed_ratio = 0.0
        text_changed = False
        if self._previous_gray is not None and self._previous_gray.shape == gray_array.shape:
            difference = np.abs(self._previous_gray.astype(np.int16) - gray_array.astype(np.int16))
            mean_difference = float(difference.mean())
            changed_ratio = float((difference >= 15).mean())
            self._pair_mean_differences.append(mean_difference)
            self._pair_changed_ratios.append(changed_ratio)
            if (
                options.small_change_min_ratio <= changed_ratio <= options.small_change_max_ratio
                and mean_difference < options.small_change_max_mean_difference
            ):
                self._pair_small_change_count += 1
            self._pair_count += 1
            if hamming_distance(self._previous_hash, hash_value) <= options.persistence_max_distance:
                self._pair_similar_count += 1
            if (
                raw_density > options.text_min_raw_density
                and self._previous_text_raw > options.text_min_raw_density
                and self._previous_text_rows is not None
                and self._previous_text_rows.shape == row_density.shape
            ):
                self._text_pair_count += 1
                delta = float(np.abs(row_density - self._previous_text_rows).mean())
                if delta >= options.text_change_delta:
                    text_changed = True
                    self._text_change_pair_count += 1

        self._previous_gray = gray_array.copy()
        self._previous_hash = hash_value
        self._previous_text_rows = row_density
        self._previous_text_raw = raw_density
        if subtitle:
            self._subtitle_frame_count += 1
        self._samples.append(
            FrameSample(
                timestamp_seconds=max(0.0, float(timestamp_seconds)),
                mean_absolute_difference=round(mean_difference, 4),
                changed_pixel_ratio=round(changed_ratio, 6),
                text_density=round(text_density, 4),
                face_presence=round(face_presence, 4),
                text_changed=text_changed,
                perceptual_hash=hash_value,
            )
        )

    def _subtitle_present(
        self,
        row_density: np.ndarray,
        transitions: np.ndarray,
        text_mask: np.ndarray,
        height: int,
    ) -> bool:
        import numpy as np
        options = self.options
        top = int(height * options.subtitle_top)
        bottom = max(top + 1, int(height * options.subtitle_bottom))
        strip_density = row_density[top:bottom]
        strip_transitions = transitions[top:bottom]
        strip_mask = text_mask[top:bottom]
        if not strip_mask.any():
            return False
        rows = np.flatnonzero(strip_mask)
        consecutive = any(rows[index + 1] - rows[index] == 1 for index in range(len(rows) - 1))
        if not consecutive:
            return False
        if strip_density[strip_mask].mean() < 0.03:
            return False
        if strip_transitions[strip_mask].mean() < options.text_min_transitions:
            return False
        # 자막 줄은 화면 상단보다 텍스트 밀도가 높아야 한다.
        upper_density = float(row_density[:top].mean()) if top > 0 else 0.0
        return bool(upper_density < strip_density[strip_mask].mean())

    def finish(
        self,
        *,
        duration_seconds: float,
        scene_count: int,
        audio_wav_path: str | None = None,
    ) -> VideoProfile:
        import numpy as np
        options = self.options
        profile = VideoProfile()
        duration = max(0.0, float(duration_seconds))
        pair_count = self._pair_count
        if pair_count > 0:
            profile.visual_change_rate = _clamp01(float(np.mean(self._pair_changed_ratios)))
            profile.small_change_rate = _clamp01(self._pair_small_change_count / pair_count)
            profile.motion_level = _clamp01(float(np.mean(self._pair_mean_differences)) / MOTION_FULL_SCALE)
            profile.visual_persistence = _clamp01(self._pair_similar_count / pair_count)
        if self._samples:
            profile.text_density = _clamp01(float(np.mean([sample.text_density for sample in self._samples])))
            profile.face_presence = _clamp01(float(np.mean([sample.face_presence for sample in self._samples])))
            profile.subtitle_likelihood = _clamp01(self._subtitle_frame_count / len(self._samples))
        if self._text_pair_count > 0:
            profile.text_change_rate = _clamp01(self._text_change_pair_count / self._text_pair_count)
        if duration > 0:
            profile.scene_change_rate = max(0.0, float(scene_count) / (duration / 60.0))
        if audio_wav_path:
            speech_density, silence_ratio, silence_intervals = _measure_speech(audio_wav_path, options)
            profile.speech_density = speech_density
            profile.silence_ratio = silence_ratio
            profile.silence_intervals = silence_intervals
        profile.frame_samples = self._samples
        return profile


def _measure_speech(wav_path: str, options: VideoProfilingOptions) -> tuple[float, float, list[list[float]]]:
    """에너지 기반 VAD로 발화 밀도·무음 비율·무음 구간을 측정한다."""
    import numpy as np
    try:
        with wave.open(str(wav_path), "rb") as audio:
            sample_rate = audio.getframerate() or 16_000
            channels = audio.getnchannels() or 1
            frames = audio.readframes(audio.getnframes())
    except (OSError, wave.Error):
        return 0.0, 0.0, []
    samples = np.frombuffer(frames, dtype=np.int16)
    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1)
    window = max(1, int(round(sample_rate * options.vad_window_seconds)))
    window_count = len(samples) // window
    if window_count == 0:
        return 0.0, 1.0, []
    usable = samples[: window_count * window].astype(np.float32).reshape(window_count, window)
    rms = np.sqrt((usable ** 2).mean(axis=1))
    decibels = 20.0 * np.log10(rms / 32_768.0 + 1e-9)
    floor = float(np.percentile(decibels, options.vad_floor_percentile))
    threshold = float(np.clip(floor + options.vad_margin_db, -70.0, -20.0))
    speech = decibels > threshold
    total_seconds = window_count * options.vad_window_seconds
    speech_density = _clamp01(float(speech.mean()))

    silence_runs: list[list[float]] = []
    run_start = None
    for index, is_speech in enumerate(speech):
        if is_speech:
            if run_start is not None:
                silence_runs.append([run_start, index])
                run_start = None
        elif run_start is None:
            run_start = index
    if run_start is not None:
        silence_runs.append([run_start, window_count])
    intervals = [
        [round(start * options.vad_window_seconds, 3), round(end * options.vad_window_seconds, 3)]
        for start, end in silence_runs
        if (end - start) * options.vad_window_seconds >= options.vad_min_silence_seconds
    ]
    long_silence_seconds = sum(
        (end - start) * options.vad_window_seconds
        for start, end in silence_runs
        if (end - start) * options.vad_window_seconds >= options.vad_long_silence_seconds
    )
    silence_ratio = _clamp01(long_silence_seconds / total_seconds) if total_seconds > 0 else 0.0
    return speech_density, silence_ratio, intervals


__all__ = [
    "FACE_PRESENCE_FULL_SCALE",
    "MOTION_FULL_SCALE",
    "TEXT_DENSITY_FULL_SCALE",
    "FrameSample",
    "VideoProfile",
    "VideoProfilingError",
    "VideoProfilingOptions",
    "VideoProfiler",
    "hamming_distance",
    "perceptual_hash",
]
