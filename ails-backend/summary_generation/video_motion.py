"""Cache short motion candidates separately from paid segment descriptions."""

from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path

from .video_segmentation import SegmentFrame, SegmentStrategy, VideoSegmentation


MOTION_CANDIDATE_VERSION = 1
MOTION_SCAN_INTERVAL_SECONDS = 0.5


def _candidate_path(cache_dir: str, fingerprint: str) -> Path:
    key = hashlib.sha256(f"{MOTION_CANDIDATE_VERSION}\0{fingerprint}".encode()).hexdigest()[:24]
    return Path(cache_dir) / f"motion-candidates-{key}.json"


def detect_short_motion_candidates(source_path: str, duration_seconds: float, check_cancel) -> list[dict]:
    """Find bursts from close original frames, including changes between profiling samples."""
    import cv2

    capture = cv2.VideoCapture(source_path)
    if not capture.isOpened():
        raise RuntimeError("동적 장면 후보를 위해 원본 영상을 열 수 없습니다.")
    fps = float(capture.get(cv2.CAP_PROP_FPS) or 0)
    if not math.isfinite(fps) or fps <= 0:
        capture.release()
        raise RuntimeError("동적 장면 후보를 위해 영상 프레임 속도를 읽을 수 없습니다.")
    previous = None
    active = []
    candidates = []
    try:
        count = max(0, math.ceil(duration_seconds / MOTION_SCAN_INTERVAL_SECONDS))
        frame_index = 0
        exhausted = False
        for index in range(count):
            if index % 40 == 0:
                check_cancel()
            timestamp = index * MOTION_SCAN_INTERVAL_SECONDS
            target_frame = round(timestamp * fps)
            while frame_index <= target_frame:
                if not capture.grab():
                    exhausted = True
                    break
                frame_index += 1
            if exhausted:
                break
            ok, frame = capture.retrieve()
            if not ok or frame is None:
                previous = None
                continue
            gray = cv2.resize(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), (96, 54))
            changed = False
            if previous is not None:
                delta = cv2.absdiff(previous, gray)
                ratio = float((delta > 18).mean())
                mean = float(delta.mean())
                # A full scene cut is not an observed continuous movement.
                changed = 0.08 <= ratio < 0.8 and mean >= 5.0
            previous = gray
            if changed:
                active.append(timestamp)
            elif active:
                if active[-1] - active[0] <= 4.0:
                    candidates.append({"start": max(0.0, active[0] - MOTION_SCAN_INTERVAL_SECONDS),
                                       "end": min(duration_seconds, active[-1])})
                active = []
        if active and active[-1] - active[0] <= 4.0:
            candidates.append({"start": max(0.0, active[0] - MOTION_SCAN_INTERVAL_SECONDS),
                               "end": min(duration_seconds, active[-1])})
    finally:
        capture.release()
    return candidates


def load_or_detect_motion_candidates(analysis, check_cancel) -> list[dict]:
    """The intermediate result is replayable without repeating the local scan."""
    if not getattr(analysis, "source_path", None):
        return []
    cache_dir = str(analysis.cache_dir or "")
    fingerprint = str(analysis.source_fingerprint or "")
    path = _candidate_path(cache_dir, fingerprint)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if (payload.get("version") == MOTION_CANDIDATE_VERSION
                and payload.get("source_fingerprint") == fingerprint
                and isinstance(payload.get("candidates"), list)):
            return payload["candidates"]
    except (OSError, ValueError, TypeError):
        pass
    candidates = detect_short_motion_candidates(
        str(analysis.source_path), float(analysis.metadata.duration_seconds), check_cancel,
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f".json.{os.getpid()}.tmp")
    try:
        temporary.write_text(json.dumps({"version": MOTION_CANDIDATE_VERSION,
                                         "source_fingerprint": fingerprint,
                                         "candidates": candidates}), encoding="utf-8")
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    return candidates


def attach_motion_frames(analysis, segmentation: VideoSegmentation, candidates: list[dict], check_cancel) -> None:
    """Add before/during/after frames to the matching segment and invalidate its event cache."""
    if not candidates:
        return
    from .verification_evidence import EvidenceReadError, _extract_video_frame

    source = Path(analysis.source_path)
    cache_dir = Path(analysis.cache_dir) / "motion_frames"
    cache_dir.mkdir(parents=True, exist_ok=True)
    grouped = {}
    for candidate in candidates:
        start, end = float(candidate["start"]), float(candidate["end"])
        segment = next((item for item in segmentation.segments
                        if item.start_seconds <= (start + end) / 2 <= item.end_seconds), None)
        if segment is None:
            continue
        grouped.setdefault(segment.index, []).append((segment, start, end))
    selected = []
    for values in grouped.values():
        # Bound the visual request while covering early, middle and late changes.
        chosen = ([values[round(i * (len(values) - 1) / 2)] for i in range(3)]
                  if len(values) > 3 else values)
        selected.extend(chosen)
    for segment, start, end in selected:
        if not segment.strategy.analyze:
            segment.strategy = SegmentStrategy(
                "motion_heavy", True, max(3, segment.strategy.max_frames),
                segment.strategy.coverage_interval_seconds,
                "short motion candidate",
            )
        requested = [max(segment.start_seconds, start - 0.25), (start + end) / 2,
                     min(segment.end_seconds, end + 0.25)]
        candidate_key = hashlib.sha256(
            f"{MOTION_CANDIDATE_VERSION}:{analysis.source_fingerprint}:{start}:{end}".encode()
        ).hexdigest()[:12]
        for frame_index, instant in enumerate(requested):
            check_cancel()
            name = f"motion_{candidate_key}_{frame_index}.jpg"
            path = cache_dir / name
            time_path = path.with_suffix(".json")
            actual = None
            if path.is_file() and time_path.is_file():
                try:
                    saved = json.loads(time_path.read_text(encoding="utf-8"))
                    if isinstance(saved, dict) and saved.get("requested") == instant:
                        actual = float(saved["actual"])
                        if not math.isfinite(actual) or actual < 0:
                            actual = None
                except (OSError, ValueError, TypeError, KeyError):
                    actual = None
            if actual is None:
                try:
                    data, actual = _extract_video_frame(source, instant)
                except EvidenceReadError:
                    # Seeking at the final GOP or a broken frame can fail;
                    # keep the frames that were actually observed.
                    continue
                if not math.isfinite(actual) or actual < 0:
                    continue
                path.write_bytes(data)
                time_path.write_text(json.dumps({"requested": instant, "actual": actual}),
                                     encoding="utf-8")
            if segment.start_seconds <= actual <= segment.end_seconds:
                segment.frames.append(SegmentFrame(actual, str(path), name, "motion"))
        segment.frames.sort(key=lambda frame: frame.timestamp_seconds)


def prepare_fallback_motion_frames(analysis, image_meta: list[dict], image_dir: str,
                                   candidates: list[dict], check_cancel) -> dict[str, list[dict]]:
    """Supply ordered original frames to the legacy scene route when profiling is absent."""
    if not candidates or not image_meta:
        return {}
    from .verification_evidence import EvidenceReadError, _extract_video_frame

    source = Path(analysis.source_path)
    target_dir = Path(image_dir)
    grouped: dict[str, list[dict]] = {}
    for candidate in candidates:
        start, end = float(candidate["start"]), float(candidate["end"])
        midpoint = (start + end) / 2
        scene = min(image_meta, key=lambda item: abs(float(item.get("start_time") or 0) - midpoint))
        scene_distance = abs(float(scene.get("start_time") or 0) - midpoint)
        name = str(scene.get("file_name") or "") if scene_distance <= 10.0 else ""
        if name and len(grouped.get(name, [])) >= 9:
            continue
        candidate_key = hashlib.sha256(
            f"{MOTION_CANDIDATE_VERSION}:{analysis.source_fingerprint}:{start}:{end}".encode()
        ).hexdigest()[:12]
        candidate_frames = []
        for index, requested in enumerate((max(0.0, start - 0.25), midpoint,
                                            min(float(analysis.metadata.duration_seconds), end + 0.25))):
            check_cancel()
            path = target_dir / f"motion_{candidate_key}_{index}.jpg"
            meta_path = path.with_suffix(".json")
            actual = None
            if path.is_file() and meta_path.is_file():
                try:
                    saved = json.loads(meta_path.read_text(encoding="utf-8"))
                    if saved.get("requested") == requested:
                        actual = float(saved["actual"])
                except (OSError, ValueError, TypeError, KeyError):
                    actual = None
            if actual is None or not math.isfinite(actual) or actual < 0:
                try:
                    data, actual = _extract_video_frame(source, requested)
                except EvidenceReadError:
                    continue
                if not math.isfinite(actual) or actual < 0:
                    continue
                path.write_bytes(data)
                meta_path.write_text(json.dumps({"requested": requested, "actual": actual}),
                                     encoding="utf-8")
            candidate_frames.append({"path": str(path), "timestamp_seconds": actual,
                                     "candidate_start": start, "candidate_end": end,
                                     "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
        if not candidate_frames:
            continue
        if not name:
            anchor = min(candidate_frames, key=lambda frame: abs(frame["timestamp_seconds"] - midpoint))
            name = Path(anchor["path"]).name
            image_meta.append({"file_name": name,
                               "start_time": anchor["timestamp_seconds"],
                               "end_time": anchor["timestamp_seconds"],
                               "source_fingerprint": analysis.source_fingerprint,
                               "source_path": str(source.resolve())})
        grouped.setdefault(name, []).extend(candidate_frames)
    for frames in grouped.values():
        frames.sort(key=lambda frame: frame["timestamp_seconds"])
    return grouped
