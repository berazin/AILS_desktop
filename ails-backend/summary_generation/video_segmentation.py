"""적응형 세그먼트 구성과 구간별 분석 전략 선택.

프로파일링 패스의 VideoProfile, 기존 장면 검출 결과, STT 발화를 입력으로 받아
영상을 의미 있는 시간 구간으로 나누고, 구간별 측정 신호(SegmentProfile)에 따라
연속 점수 기반으로 분석 전략(SegmentStrategy)을 고른다. 여기에는 AI API 호출이
없으며 모든 판단은 로컬에서 계산된 신호에 근거한다.

경계 신호는 하나만 쓰지 않는다: 장면 전환, 긴 무음, 발화 공백, 화제 전환 발화,
pHash 기반 시각 연속성 붕괴를 조합하고, 최소 구간 길이 제약으로 기계적인
과분할을 막는다. 코딩·판서처럼 경계가 드문 구간은 boundaryless cap까지만
잘라내어 같은 주제를 다루는 긴 작업을 억지로 쪼개지 않는다.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import threading
from dataclasses import asdict, dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import numpy as np
from pathlib import Path

from PIL import Image

from pipeline_utils import looks_like_topic_transition
from .video_profiling import MOTION_FULL_SCALE, FrameSample, VideoProfile, hamming_distance, perceptual_hash


SEGMENTATION_VERSION = 1


class SegmentationError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class SegmentationOptions:
    min_segment_seconds: float = 15.0
    max_segment_seconds: float = 180.0
    boundaryless_max_seconds: float = 420.0
    min_boundary_spacing_seconds: float = 2.0
    silence_gap_seconds: float = 3.0
    speech_gap_seconds: float = 6.0
    topic_min_gap_seconds: float = 0.8
    visual_break_distance: int = 24
    strong_boundary_strength: float = 0.6
    scene_search_margin_seconds: float = 1.0
    scene_coverage_merge_seconds: float = 3.0
    duplicate_hash_distance: int = 4
    duplicate_mean_difference: float = 3.0

    def __post_init__(self) -> None:
        if self.min_segment_seconds <= 0 or self.max_segment_seconds < self.min_segment_seconds:
            raise ValueError("segment duration bounds are invalid")
        if self.boundaryless_max_seconds < self.max_segment_seconds:
            raise ValueError("boundaryless_max_seconds must be at least max_segment_seconds")


@dataclass(frozen=True, slots=True)
class StrategyThresholds:
    speech_density_high: float = 0.55
    text_density_low: float = 0.15
    text_density_moderate: float = 0.30
    text_density_high: float = 0.45
    motion_high: float = 0.12
    visual_change_moderate: float = 0.15
    visual_change_high: float = 0.30
    small_change_moderate: float = 0.15
    small_change_high: float = 0.30
    text_change_moderate: float = 0.12
    text_change_high: float = 0.30
    visual_persistence_high: float = 0.60
    scene_rate_moderate: float = 4.0
    scene_rate_high: float = 10.0
    vlm_min_visual_information: float = 0.25
    strategy_min_score: float = 0.40
    strategy_margin: float = 0.12


@dataclass(slots=True)
class SegmentProfile:
    duration_seconds: float = 0.0
    speech_density: float = 0.0
    scene_change_rate: float = 0.0
    visual_change_rate: float = 0.0
    small_change_rate: float = 0.0
    motion_level: float = 0.0
    text_density: float = 0.0
    text_change_rate: float = 0.0
    visual_persistence: float = 0.0
    face_presence: float = 0.0
    subtitle_likelihood: float = 0.0
    speech_heavy_score: float = 0.0
    slide_heavy_score: float = 0.0
    tutorial_score: float = 0.0
    motion_heavy_score: float = 0.0
    text_heavy_score: float = 0.0
    visual_information_score: float = 0.0


@dataclass(slots=True)
class SegmentStrategy:
    name: str
    analyze: bool
    max_frames: int
    coverage_interval_seconds: float
    reason: str


@dataclass(slots=True)
class SegmentFrame:
    timestamp_seconds: float
    image_path: str
    image_name: str
    source: str


@dataclass(slots=True)
class VideoSegment:
    index: int
    start_seconds: float
    end_seconds: float
    boundary_reasons: list[str] = field(default_factory=list)
    profile: SegmentProfile = field(default_factory=SegmentProfile)
    strategy: SegmentStrategy = field(default_factory=lambda: SegmentStrategy("mixed", False, 0, 0.0, ""))
    frames: list[SegmentFrame] = field(default_factory=list)

    @property
    def duration_seconds(self) -> float:
        return max(0.0, self.end_seconds - self.start_seconds)


@dataclass(slots=True)
class VideoSegmentation:
    version: int
    identity: str
    task_type: str
    segments: list[VideoSegment] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, payload: dict) -> "VideoSegmentation":
        segments = []
        for item in payload.get("segments") or []:
            profile_data = item.get("profile") or {}
            strategy_data = item.get("strategy") or {}
            frames = [
                SegmentFrame(
                    timestamp_seconds=float(frame.get("timestamp_seconds") or 0.0),
                    image_path=str(frame.get("image_path") or ""),
                    image_name=str(frame.get("image_name") or ""),
                    source=str(frame.get("source") or "coverage"),
                )
                for frame in item.get("frames") or []
            ]
            segments.append(
                VideoSegment(
                    index=int(item.get("index") or 0),
                    start_seconds=float(item.get("start_seconds") or 0.0),
                    end_seconds=float(item.get("end_seconds") or 0.0),
                    boundary_reasons=[str(reason) for reason in item.get("boundary_reasons") or []],
                    profile=SegmentProfile(
                        **{
                            key: float(profile_data.get(key) or 0.0)
                            for key in SegmentProfile.__dataclass_fields__
                        }
                    ),
                    strategy=SegmentStrategy(
                        name=str(strategy_data.get("name") or "mixed"),
                        analyze=bool(strategy_data.get("analyze")),
                        max_frames=int(strategy_data.get("max_frames") or 0),
                        coverage_interval_seconds=float(strategy_data.get("coverage_interval_seconds") or 0.0),
                        reason=str(strategy_data.get("reason") or ""),
                    ),
                    frames=frames,
                )
            )
        return cls(
            version=int(payload.get("version") or 0),
            identity=str(payload.get("identity") or ""),
            task_type=str(payload.get("task_type") or ""),
            segments=segments,
        )


STRATEGY_FRAME_BUDGETS = {
    "speech_heavy": (1, 60.0),
    "slide_heavy": (2, 30.0),
    "coding_tutorial": (5, 12.0),
    "motion_heavy": (6, 8.0),
    "mixed": (3, 20.0),
}


def _soft(value: float, threshold: float, steepness: float = 10.0) -> float:
    shifted = steepness * (value - threshold)
    if shifted > 30:
        return 1.0
    if shifted < -30:
        return 0.0
    return 1.0 / (1.0 + math.exp(-shifted))


def _clamp01(value: float) -> float:
    return min(1.0, max(0.0, value))


def _timed_utterance(item) -> dict | None:
    if not isinstance(item, dict):
        return None
    text = str(item.get("text") or "").strip()
    if not text:
        return None
    try:
        start = max(0.0, float(item.get("start") or 0.0))
        end = max(start, float(item.get("end") if item.get("end") is not None else start))
    except (TypeError, ValueError):
        return None
    return {"start": start, "end": end, "text": text}


def _speech_coverage(utterances: list[dict], start: float, end: float) -> float:
    duration = max(1e-6, end - start)
    covered = 0.0
    for utterance in utterances:
        overlap = min(utterance["end"], end) - max(utterance["start"], start)
        if overlap > 0:
            covered += min(overlap, duration)
    return _clamp01(covered / duration)


def compute_segment_profile(
    *,
    start: float,
    end: float,
    samples: list[FrameSample],
    utterances: list[dict],
    scene_timestamps: list[float],
    thresholds: StrategyThresholds,
) -> SegmentProfile:
    duration = max(0.0, end - start)
    profile = SegmentProfile(duration_seconds=duration)
    if duration <= 0:
        return profile
    profile.speech_density = _speech_coverage(utterances, start, end)
    profile.scene_change_rate = (
        sum(1 for timestamp in scene_timestamps if start <= timestamp <= end) / (duration / 60.0)
    )
    in_range = [sample for sample in samples if start <= sample.timestamp_seconds <= end]
    pair_samples = in_range[1:]
    if pair_samples:
        profile.visual_change_rate = _clamp01(
            sum(sample.changed_pixel_ratio for sample in pair_samples) / len(pair_samples)
        )
        profile.motion_level = _clamp01(
            sum(sample.mean_absolute_difference for sample in pair_samples)
            / len(pair_samples)
            / MOTION_FULL_SCALE
        )
        small_count = sum(
            1
            for sample in pair_samples
            if 0.0008 <= sample.changed_pixel_ratio <= 0.08 and sample.mean_absolute_difference < 12.0
        )
        profile.small_change_rate = _clamp01(small_count / len(pair_samples))
        similar_count = sum(
            1
            for previous, sample in zip(in_range, pair_samples)
            if hamming_distance(previous.perceptual_hash, sample.perceptual_hash) <= 10
        )
        profile.visual_persistence = _clamp01(similar_count / len(pair_samples))
    if in_range:
        profile.text_density = _clamp01(sum(sample.text_density for sample in in_range) / len(in_range))
        profile.face_presence = _clamp01(sum(sample.face_presence for sample in in_range) / len(in_range))
        profile.text_change_rate = _text_change_rate(in_range, pair_samples)
    _apply_segment_scores(profile, thresholds)
    return profile


def _text_change_rate(in_range: list[FrameSample], pair_samples: list[FrameSample]) -> float:
    # text_density >= 0.1(원시 약 0.02)인 쌍을 텍스트 쌍으로 간주하고 그중 변화 비율을 재한다.
    text_pairs = [sample for sample in pair_samples if sample.text_density >= 0.1]
    if not text_pairs:
        return 0.0
    changed = sum(1 for sample in text_pairs if sample.text_changed)
    return _clamp01(changed / len(text_pairs))


def _apply_segment_scores(profile: SegmentProfile, thresholds: StrategyThresholds) -> None:
    # 텍스트 밀도가 비슷해도 텍스트 영역이 계속 바뀌면 코딩/편집, 고정되면 슬라이드로 구분한다.
    tutorial_text_change_factor = 0.35 + 0.65 * _soft(profile.text_change_rate, thresholds.text_change_moderate)
    slide_text_change_penalty = 1.0 - 0.4 * _soft(profile.text_change_rate, thresholds.text_change_high)
    profile.speech_heavy_score = _clamp01(
        _soft(profile.speech_density, thresholds.speech_density_high)
        * (1.0 - _soft(profile.text_density, thresholds.text_density_moderate))
        * (1.0 - 0.5 * _soft(profile.motion_level, thresholds.motion_high))
    )
    profile.slide_heavy_score = _clamp01(
        _soft(profile.text_density, thresholds.text_density_high)
        * _soft(profile.visual_persistence, thresholds.visual_persistence_high)
        * (1.0 - _soft(profile.motion_level, thresholds.motion_high))
        * slide_text_change_penalty
    )
    profile.tutorial_score = _clamp01(
        _soft(profile.small_change_rate, thresholds.small_change_high)
        * (1.0 - _soft(profile.scene_change_rate, thresholds.scene_rate_high))
        * _soft(profile.text_density, thresholds.text_density_low)
        * tutorial_text_change_factor
    )
    profile.motion_heavy_score = _clamp01(
        _soft(profile.motion_level, thresholds.motion_high)
        * _soft(profile.visual_change_rate, thresholds.visual_change_high)
        * (1.0 - _soft(profile.text_density, thresholds.text_density_high))
    )
    profile.text_heavy_score = _clamp01(_soft(profile.text_density, thresholds.text_density_high))
    profile.visual_information_score = _clamp01(
        0.45 * _soft(profile.text_density, thresholds.text_density_low)
        + 0.20 * _soft(profile.scene_change_rate, thresholds.scene_rate_moderate)
        + 0.30 * _soft(profile.visual_change_rate, thresholds.visual_change_moderate)
        + 0.25 * _soft(profile.small_change_rate, thresholds.small_change_moderate)
        + 0.20 * _soft(profile.motion_level, thresholds.motion_high)
    )


def select_segment_strategy(
    profile: SegmentProfile,
    thresholds: StrategyThresholds,
    *,
    has_frame_source: bool = True,
) -> SegmentStrategy:
    candidates = {
        "speech_heavy": profile.speech_heavy_score,
        "slide_heavy": profile.slide_heavy_score,
        "coding_tutorial": profile.tutorial_score,
        "motion_heavy": profile.motion_heavy_score,
    }
    ranked = sorted(candidates.items(), key=lambda item: item[1], reverse=True)
    best_name, best_score = ranked[0]
    second_score = ranked[1][1]
    if best_score < thresholds.strategy_min_score or best_score - second_score < thresholds.strategy_margin:
        name = "mixed"
        reason = "어떤 단일 신호도 우세하지 않아 혼합 전략을 사용합니다."
    else:
        name = best_name
        reason = f"{name} 점수 {best_score:.2f}가 우세합니다."
    max_frames, coverage_interval = STRATEGY_FRAME_BUDGETS.get(name, STRATEGY_FRAME_BUDGETS["mixed"])
    analyze = has_frame_source and profile.visual_information_score >= thresholds.vlm_min_visual_information
    if not analyze:
        reason += " 화면 정보 가치가 낮아 VLM 분석을 생략합니다."
    return SegmentStrategy(
        name=name,
        analyze=analyze,
        max_frames=max_frames if analyze else 0,
        coverage_interval_seconds=coverage_interval if analyze else 0.0,
        reason=reason,
    )


@dataclass(frozen=True, slots=True)
class _Boundary:
    timestamp: float
    reason: str
    strength: float


@dataclass(slots=True)
class _FrameCandidate:
    timestamp: float
    image_path: str
    source: str


def _collect_boundaries(
    profile: VideoProfile,
    scenes: list,
    utterances: list[dict],
    duration: float,
    options: SegmentationOptions,
) -> list[_Boundary]:
    boundaries: list[_Boundary] = []
    for scene in scenes or []:
        detected = float(getattr(scene, "detected_at_seconds", 0.0) or 0.0)
        if detected <= 0.5 or detected >= duration - 0.5:
            continue
        boundaries.append(_Boundary(detected, "scene", 1.0))
    for start, end in profile.silence_intervals:
        if end - start >= options.silence_gap_seconds and start > 0.5 and end < duration - 0.5:
            boundaries.append(_Boundary((start + end) / 2.0, "silence", 0.7))
    ordered = sorted(utterances, key=lambda item: (item["start"], item["end"]))
    for previous, current in zip(ordered, ordered[1:]):
        gap = current["start"] - previous["end"]
        if gap >= options.speech_gap_seconds:
            boundaries.append(_Boundary((previous["end"] + current["start"]) / 2.0, "speech_gap", 0.65))
        elif gap >= options.topic_min_gap_seconds and looks_like_topic_transition(current["text"]):
            boundaries.append(_Boundary(current["start"], "topic", 0.5))
    samples = sorted(profile.frame_samples, key=lambda sample: sample.timestamp_seconds)
    for previous, current in zip(samples, samples[1:]):
        if hamming_distance(previous.perceptual_hash, current.perceptual_hash) >= options.visual_break_distance:
            boundaries.append(_Boundary(current.timestamp_seconds, "visual_break", 0.4))
    boundaries.sort(key=lambda item: item.timestamp)
    deduped: list[_Boundary] = []
    for boundary in boundaries:
        if deduped and boundary.timestamp - deduped[-1].timestamp < options.min_boundary_spacing_seconds:
            if boundary.strength > deduped[-1].strength:
                deduped[-1] = boundary
            continue
        deduped.append(boundary)
    return deduped


def _split_interval(
    start: float,
    end: float,
    weak_boundaries: list[float],
    options: SegmentationOptions,
) -> list[tuple[float, float]]:
    if end - start <= options.max_segment_seconds:
        return [(start, end)]
    usable = [
        boundary
        for boundary in weak_boundaries
        if start + options.min_segment_seconds < boundary < end - options.min_segment_seconds
    ]
    pieces: list[tuple[float, float]] = []
    current = start
    for boundary in usable:
        if boundary - current < options.min_segment_seconds:
            continue
        pieces.append((current, boundary))
        current = boundary
        if end - current <= options.max_segment_seconds:
            break
    if end - current > options.max_segment_seconds:
        # 내부 경계가 있으면 max 간격으로, 경계가 전혀 없는 코딩·판서 구간은
        # boundaryless cap까지만 유지한 뒤 잘라낸다.
        divisor = options.max_segment_seconds if usable else options.boundaryless_max_seconds
        remaining = end - current
        piece_count = max(1, math.ceil(remaining / divisor))
        length = remaining / piece_count
        for index in range(piece_count):
            pieces.append((current + index * length, current + (index + 1) * length))
    elif current < end:
        pieces.append((current, end))
    return [(piece_start, piece_end) for piece_start, piece_end in pieces if piece_end > piece_start]


def _image_signature(image_path: str, cache: dict) -> tuple[int, np.ndarray]:
    import numpy as np
    signature = cache.get(image_path)
    if signature is not None:
        return signature
    with Image.open(image_path) as image:
        small = image.convert("L").resize((160, 90), Image.BILINEAR)
    array = np.asarray(small, dtype=np.uint8)
    signature = (perceptual_hash(array), array)
    cache[image_path] = signature
    return signature


def _select_segment_frames(
    *,
    start: float,
    end: float,
    strategy: SegmentStrategy,
    scenes: list,
    profile: VideoProfile,
    options: SegmentationOptions,
    signature_cache: dict,
) -> list[SegmentFrame]:
    import numpy as np
    if not strategy.analyze or strategy.max_frames <= 0:
        return []
    candidates: list[_FrameCandidate] = []
    for scene in scenes or []:
        detected = float(getattr(scene, "detected_at_seconds", 0.0) or 0.0)
        timestamp = detected if detected > 0 else float(getattr(scene, "timestamp_seconds", 0.0))
        if start - options.scene_search_margin_seconds <= timestamp <= end + options.scene_search_margin_seconds:
            candidates.append(_FrameCandidate(timestamp, str(scene.image_path), "scene"))
    interval = strategy.coverage_interval_seconds
    timestamps = profile.profiling_frame_timestamps
    paths = profile.profiling_frame_paths
    if interval > 0 and timestamps and paths and len(timestamps) == len(paths):
        desired = start
        while desired < end:
            desired += interval
            if desired >= end:
                break
            index = min(range(len(timestamps)), key=lambda item: abs(timestamps[item] - desired))
            if abs(timestamps[index] - desired) <= max(2.5, interval / 2):
                candidates.append(_FrameCandidate(timestamps[index], paths[index], "coverage"))
    candidates.sort(key=lambda item: item.timestamp)

    kept: list[_FrameCandidate] = []
    for candidate in candidates:
        if candidate.source == "coverage" and any(
            kept_item.source == "scene"
            and abs(kept_item.timestamp - candidate.timestamp) <= options.scene_coverage_merge_seconds
            for kept_item in kept
        ):
            continue
        duplicated = False
        for position, kept_item in enumerate(kept):
            if abs(kept_item.timestamp - candidate.timestamp) > 10.0:
                continue
            kept_hash, kept_array = _image_signature(kept_item.image_path, signature_cache)
            candidate_hash, candidate_array = _image_signature(candidate.image_path, signature_cache)
            if hamming_distance(kept_hash, candidate_hash) > options.duplicate_hash_distance:
                continue
            difference = float(np.abs(kept_array.astype(np.int16) - candidate_array.astype(np.int16)).mean())
            if difference > options.duplicate_mean_difference:
                continue
            # 거의 같은 프레임은 하나만 남기되, 장면 대표 프레임을 우선한다.
            if candidate.source == "scene" and kept_item.source != "scene":
                kept[position] = candidate
            duplicated = True
            break
        if not duplicated:
            kept.append(candidate)

    if len(kept) > strategy.max_frames:
        if strategy.max_frames == 1:
            scene_candidates = [item for item in kept if item.source == "scene"]
            kept = [scene_candidates[0] if scene_candidates else kept[len(kept) // 2]]
        else:
            indices = sorted(
                {
                    round(index * (len(kept) - 1) / (strategy.max_frames - 1))
                    for index in range(strategy.max_frames)
                }
            )
            kept = [kept[index] for index in indices]
    return [
        SegmentFrame(
            timestamp_seconds=candidate.timestamp,
            image_path=candidate.image_path,
            image_name=os.path.basename(candidate.image_path),
            source=candidate.source,
        )
        for candidate in kept
    ]


def segmentation_identity(
    profile: VideoProfile,
    utterances: list[dict],
    task_type: str,
    options: SegmentationOptions,
    thresholds: StrategyThresholds,
) -> str:
    profile_payload = profile.to_dict()
    # 캐시 키에서 환경 의존적인 절대 경로는 제외한다.
    profile_payload.pop("profiling_frame_paths", None)
    profile_digest = hashlib.sha256(
        json.dumps(profile_payload, ensure_ascii=False, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()
    utterance_digest = hashlib.sha256(
        json.dumps(utterances, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()
    config_digest = hashlib.sha256(
        json.dumps({"options": asdict(options), "thresholds": asdict(thresholds)}, sort_keys=True).encode("utf-8")
    ).hexdigest()
    return hashlib.sha256(
        f"{SEGMENTATION_VERSION}\0{task_type}\0{profile_digest}\0{utterance_digest}\0{config_digest}".encode("utf-8")
    ).hexdigest()


def build_video_segments(
    profile: VideoProfile,
    scenes: list,
    utterances,
    duration_seconds: float,
    *,
    task_type: str = "",
    identity: str = "",
    options: SegmentationOptions | None = None,
    thresholds: StrategyThresholds | None = None,
) -> VideoSegmentation:
    options = options or SegmentationOptions()
    thresholds = thresholds or StrategyThresholds()
    duration = max(0.0, float(duration_seconds))
    normalized_utterances = [
        item for item in (_timed_utterance(entry) for entry in utterances or []) if item is not None
    ]
    boundaries = _collect_boundaries(profile, scenes, normalized_utterances, duration, options)
    strong = [item for item in boundaries if item.strength >= options.strong_boundary_strength]
    weak = [item.timestamp for item in boundaries if item.strength < options.strong_boundary_strength]

    raw_intervals: list[tuple[float, float]] = []
    cursor = 0.0
    for boundary in strong:
        # 양쪽이 최소 길이를 만족할 때만 강한 경계를 받는다(과분합 방지).
        if boundary.timestamp - cursor < options.min_segment_seconds:
            continue
        if duration - boundary.timestamp < options.min_segment_seconds:
            continue
        raw_intervals.append((cursor, boundary.timestamp))
        cursor = boundary.timestamp
    raw_intervals.append((cursor, duration))

    intervals: list[tuple[float, float]] = []
    for start, end in raw_intervals:
        intervals.extend(_split_interval(start, end, weak, options))

    samples = sorted(profile.frame_samples, key=lambda sample: sample.timestamp_seconds)
    scene_timestamps = [
        float(getattr(scene, "detected_at_seconds", 0.0) or getattr(scene, "timestamp_seconds", 0.0))
        for scene in scenes or []
    ]
    reason_by_timestamp = {round(item.timestamp, 3): item.reason for item in boundaries}
    signature_cache: dict = {}
    segments: list[VideoSegment] = []
    for start, end in intervals:
        if end - start <= 0.01:
            continue
        segment = VideoSegment(
            index=len(segments) + 1,
            start_seconds=round(start, 3),
            end_seconds=round(end, 3),
            boundary_reasons=(
                ["start"] if not segments else [reason_by_timestamp.get(round(start, 3), "duration_cap")]
            ),
        )
        segment.profile = compute_segment_profile(
            start=start,
            end=end,
            samples=samples,
            utterances=normalized_utterances,
            scene_timestamps=scene_timestamps,
            thresholds=thresholds,
        )
        segment.strategy = select_segment_strategy(
            segment.profile,
            thresholds,
            has_frame_source=bool(profile.profiling_frame_paths) or bool(scenes),
        )
        segment.frames = _select_segment_frames(
            start=start,
            end=end,
            strategy=segment.strategy,
            scenes=scenes,
            profile=profile,
            options=options,
            signature_cache=signature_cache,
        )
        segments.append(segment)
    return VideoSegmentation(
        version=SEGMENTATION_VERSION,
        identity=identity,
        task_type=task_type,
        segments=segments,
    )


def segmentation_cache_path(cache_dir: str, identity: str) -> Path:
    key = hashlib.sha256(str(identity).encode("utf-8")).hexdigest()[:24]
    return Path(cache_dir) / f"segments-{key}.json"


def load_cached_segmentation(cache_dir: str, identity: str) -> VideoSegmentation | None:
    try:
        payload = json.loads(segmentation_cache_path(cache_dir, identity).read_text(encoding="utf-8"))
        if payload.get("version") != SEGMENTATION_VERSION or payload.get("identity") != identity:
            return None
        segmentation = VideoSegmentation.from_dict(payload)
        if segmentation.identity != identity:
            return None
        return segmentation
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return None


def save_segmentation_cache(cache_dir: str, segmentation: VideoSegmentation) -> None:
    destination = segmentation_cache_path(cache_dir, segmentation.identity)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(f"{destination.suffix}.{os.getpid()}.{threading.get_ident()}.tmp")
    try:
        temporary.write_text(json.dumps(segmentation.to_dict(), ensure_ascii=False), encoding="utf-8")
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def build_or_load_video_segmentation(
    analysis,
    utterances,
    task_type: str,
    *,
    options: SegmentationOptions | None = None,
    thresholds: StrategyThresholds | None = None,
) -> VideoSegmentation | None:
    """캐시된 세그먼트 구성을 재사용하거나 로컬 신호로 새로 계산한다."""
    profile = getattr(analysis, "profile", None)
    if profile is None:
        return None
    options = options or SegmentationOptions()
    thresholds = thresholds or StrategyThresholds()
    identity = segmentation_identity(profile, list(utterances or []), task_type, options, thresholds)
    cache_dir = str(getattr(analysis, "cache_dir", "") or "")
    if cache_dir:
        cached = load_cached_segmentation(cache_dir, identity)
        if cached is not None:
            return cached
        # 상세/요약 간 세그먼트 캐시 공유: 동일 영상에 대해 이미 생성된 세그먼트가 있으면 재사용
        try:
            cache_path = Path(cache_dir)
            if cache_path.is_dir():
                for seg_file in sorted(cache_path.glob("segments-*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
                    try:
                        payload = json.loads(seg_file.read_text(encoding="utf-8"))
                        if payload.get("version") == SEGMENTATION_VERSION and isinstance(payload.get("segments"), list):
                            loaded = VideoSegmentation.from_dict(payload)
                            if loaded.segments:
                                return loaded
                    except (OSError, ValueError, TypeError, json.JSONDecodeError):
                        continue
        except OSError:
            pass
    segmentation = build_video_segments(
        profile,
        list(getattr(analysis, "scenes", []) or []),
        list(utterances or []),
        float(getattr(getattr(analysis, "metadata", None), "duration_seconds", 0.0) or 0.0),
        task_type=task_type,
        identity=identity,
        options=options,
        thresholds=thresholds,
    )
    if cache_dir:
        save_segmentation_cache(cache_dir, segmentation)
    return segmentation


__all__ = [
    "SEGMENTATION_VERSION",
    "STRATEGY_FRAME_BUDGETS",
    "SegmentFrame",
    "SegmentProfile",
    "SegmentStrategy",
    "SegmentationError",
    "SegmentationOptions",
    "StrategyThresholds",
    "VideoSegment",
    "VideoSegmentation",
    "build_or_load_video_segmentation",
    "build_video_segments",
    "compute_segment_profile",
    "load_cached_segmentation",
    "save_segmentation_cache",
    "segmentation_identity",
    "select_segment_strategy",
]
