"""Per-task progress and resume invariants; never shared across slots."""

from __future__ import annotations

from contextlib import ExitStack
from typing import Any
from common import (
    build_retry_task_payload,
    save_resume_state,
)
from voice.deepgram_transcript import collapse_deepgram_repeated_views
from .claim_verification import build_image_records
from .managed_costs import (
    merge_settlements,
    prior_settlements,
)
from pipeline_utils import build_summary_transcript_text
from dataclasses import dataclass, field


@dataclass
class TaskRunState:
    """One task slot's media, writer ledger and checkpoint state."""

    engine: Any
    task: dict
    cfg: dict
    bookmark_text: Any = None
    chunks: Any = None
    cleanup_usage_events: list = field(default_factory=list)
    concept_review_enabled: Any = None
    current_phase: str = "initializing"
    ffmpeg_path: Any = None
    full_md: Any = None
    generated_image_dirs: list = field(default_factory=list)
    has_timed_image_meta: Any = None
    idx: Any = None
    image_caps: dict = field(default_factory=dict)
    image_completed: bool = False
    image_completed_in_this_run: bool = False
    image_dir_name: Any = None
    image_link_dir: Any = None
    image_meta: list = field(default_factory=list)
    image_usage_events: list = field(default_factory=list)
    img_d_name: str = ""
    last_m: str = "N/A"
    download_dir: str = ""
    media_work_completed: bool = False
    media_temp_dirs: list = field(default_factory=list)
    mp3_f: Any = None
    needs_review: Any = None
    preserve_partial_artifacts: bool = False
    raw_stt_snapshot: Any = None
    rechecked_chunk_ids: Any = None
    report_user_modified: Any = None
    resolved_summary_model_name: Any = None
    resolved_summary_provider: Any = None
    resume_media: Any = None
    resume_signature: Any = None
    resume_state: Any = None
    resume_state_path: Any = None
    roll_s: Any = None
    run_id: Any = None
    safe_title: Any = None
    saved_summary_progress: Any = None
    segment_files: list = field(default_factory=list)
    source_video_path: Any = None
    stt_completed: bool = False
    stt_completed_in_this_run: bool = False
    stt_duration_seconds: float = 0.0
    stt_m: str = ""
    stt_usage: Any = None
    stt_usage_event: Any = None
    stt_utterances: list = field(default_factory=list)
    summary_body_for_verification: Any = None
    summary_claims: Any = None
    summary_resume_identity: Any = None
    summary_resume_payload: Any = None
    task_grade: Any = None
    task_results: list = field(default_factory=list)
    task_semester: Any = None
    task_type: Any = None
    timed_image_matching_enabled: Any = None
    timed_source_records: list = field(default_factory=list)
    transcript: str = ""
    ts_f: Any = None
    usage_events: list = field(default_factory=list)
    usage_placeholder: Any = None
    used_images_set: Any = None
    verification_image_records: Any = None
    verification_source_records: Any = None
    verified_single_pipeline: Any = None
    verifier_effort: str = ""
    verifier_m: str = ""
    video_analysis_result: Any = None
    video_cache_scope: ExitStack = field(default_factory=ExitStack)
    video_content_instruction: Any = None
    video_mode: Any = None
    video_segmentation: Any = None
    video_verifier_limit: Any = None
    video_visual_events: list = field(default_factory=list)
    video_visual_model: str = ""
    video_writer_limit: Any = None
    was_cancelled: bool = False

    def complete_managed_stage(self, phase):
        close_stage = self.cfg.get("_managed_stage_complete")
        if callable(close_stage):
            close_stage(phase)


    def completed_writer_parts(self):
        """Restore chunk positions from the ledger, then migrate old reports."""
        written = self.summary_resume_payload.get("written_chunk_indices")
        indices = list(written) if isinstance(written, list) else list(range(self.idx))
        if (any(not isinstance(number, int) or not 0 <= number < self.idx for number in indices)
                or len(set(indices)) != len(indices)):
            raise RuntimeError("저장된 작성 청크와 검사 본문을 대응시킬 수 없습니다.")
        ledger = self.summary_resume_payload.get("written_chunk_bodies")
        if isinstance(ledger, list):
            parts = list(ledger)
        else:
            # Older checkpoints did not record the written body per
            # chunk. Prefer their exact checked/pending drafts when
            # every position is known; only then try old separators.
            checked = self.summary_resume_payload.get("checked_chunks") or {}
            pending = self.summary_resume_payload.get("pending_chunk") or {}
            incomplete = self.summary_resume_payload.get("incomplete_chunks") or []
            known = {key: value.get("draft") for key, value in checked.items()
                     if isinstance(value, dict)}
            if isinstance(pending, dict):
                known[pending.get("chunk_id")] = pending.get("draft")
            for item in incomplete:
                if isinstance(item, dict):
                    known[item.get("chunk_id")] = item.get("draft")
            known_parts = [known.get(f"chunk-{number + 1}") for number in indices]
            if known_parts and all(isinstance(part, str) and part for part in known_parts):
                parts = known_parts
            else:
                tail = self.full_md.split(self.usage_placeholder, 1)
                separator = "\n\n---\n"
                if len(tail) != 2 or not tail[1].lstrip("\n").endswith(separator):
                    raise RuntimeError("저장된 작성 청크의 정리본 경계를 확인할 수 없습니다.")
                parts = tail[1].lstrip("\n")[:-len(separator)].split("\n\n---\n\n\n")
        marker_at = self.full_md.find(self.usage_placeholder)
        if marker_at < 0:
            raise RuntimeError("저장된 작성 청크의 정리본 경계를 확인할 수 없습니다.")
        prefix_end = marker_at + len(self.usage_placeholder)
        while prefix_end < len(self.full_md) and self.full_md[prefix_end] == "\n":
            prefix_end += 1
        prefix = self.full_md[:prefix_end]
        rendered = prefix + "\n\n---\n\n\n".join(parts) + "\n\n---\n" if parts else prefix
        if (len(parts) != len(indices) or rendered != self.full_md
                or "\n\n".join(parts) != self.summary_body_for_verification):
            raise RuntimeError("저장된 작성 청크와 검사 본문을 대응시킬 수 없습니다.")
        return parts, indices


    def current_chunk_evidence(self, chunk_index, prior_image_records):
        """Rebuild replay evidence from the current STT and visual result."""
        chunk = self.chunks[chunk_index]
        source_ids = {
            str(item.get("source_id") or "")
            for item in chunk.get("utterances", [])
            if isinstance(item, dict)
        }
        source_records = ([record for record in self.timed_source_records
                           if record.get("source_id") in source_ids]
                          if source_ids and all(source_id.startswith("T") for source_id in source_ids)
                          else [])
        if {record.get("source_id") for record in source_records} != source_ids:
            # Without every timed utterance the integrated result
            # cannot be complete. The verifier records
            # timed_stt_unavailable and keeps the written draft.
            source_records = []
        current_images = {}
        for image_record in build_image_records(self.image_caps, self.image_link_dir):
            current_images[image_record["file_name"]] = image_record
        image_records = []
        for old_record in prior_image_records:
            file_name = str(old_record.get("file_name") or "")
            current = current_images.get(file_name)
            if current:
                image_records.append({**current, "source_id": old_record.get("source_id")})
        start = chunk.get("start") if chunk.get("timed") else None
        end = chunk.get("end") if chunk.get("timed") else None
        scene_records = [event for event in self.video_visual_events
                         if isinstance(event, dict) and not event.get("duplicate_of")
                         and (start is None or end is None or
                              start <= float(event.get("timestamp") or 0) <= end)]
        return source_records, image_records, scene_records


    def has_usable_stt_text(self):
        return bool(
            build_summary_transcript_text(
                self.transcript,
                self.stt_utterances,
                self.stt_duration_seconds,
            )
        )


    def persist_partial_progress(self):

        if not (self.stt_completed or self.image_completed or self.resume_media or self.download_dir):
            return False
        if not self.resume_state_path or not self.resume_signature:
            return False
        payload = {
            "managed_sessions": merge_settlements(
                [*prior_settlements((self.resume_state or {}).get("managed_sessions")), *(self.cfg.get("_managed_previous_settlements") or [])],
                self.cfg.get("_managed_session_records"),
            ),
            "task_type": self.task.get("type"),
            "title": self.task.get("title"),
            "retry_task": build_retry_task_payload(self.task),
        }
        if self.stt_completed:
            raw_stt = self.raw_stt_snapshot or {}
            persisted_transcript = raw_stt.get("transcript", self.transcript)
            persisted_utterances = raw_stt.get("utterances", self.stt_utterances)
            persisted_timed_records = raw_stt.get("timed_source_records", self.timed_source_records)
            if "deepgram" in str(self.stt_m or "").casefold():
                persisted_transcript, _repeated_views = collapse_deepgram_repeated_views(
                    persisted_transcript,
                    persisted_utterances,
                )
            payload["stt"] = {
                "transcript": persisted_transcript,
                "model": self.stt_m,
                "usage": self.stt_usage or {},
                "utterances": persisted_utterances,
                "timed_source_records": persisted_timed_records,
                "timed_source_contract_version": 2,
                "duration_seconds": self.stt_duration_seconds,
            }
            if self.stt_usage_event:
                payload["stt_usage_event"] = self.stt_usage_event
        if self.image_completed:
            payload["image"] = {
                "captions": self.image_caps,
                "image_meta": self.image_meta,
                "image_dir_name": self.image_dir_name,
            }
            payload["image_usage_events"] = [event for event in self.image_usage_events if event]
        if self.summary_resume_payload:
            payload["summary"] = self.summary_resume_payload
        if self.resume_media:
            payload["media"] = self.resume_media
        if self.download_dir:
            payload["download_dir"] = self.download_dir
        save_resume_state(self.resume_state_path, self.resume_signature, payload)
        self.preserve_partial_artifacts = True
        return True


    def replace_written_part(self, chunk_id, old_body, new_body):

        parts, indices = self.completed_writer_parts()
        try:
            number = int(chunk_id.removeprefix("chunk-")) - 1
            if chunk_id != f"chunk-{number + 1}":
                raise ValueError("invalid chunk ID")
            position = indices.index(number)
        except (ValueError, TypeError) as error:
            raise RuntimeError("저장된 작성 청크의 위치가 올바르지 않습니다.") from error
        if parts[position] != old_body:
            raise RuntimeError("저장된 작성 청크의 본문 위치가 달라졌습니다.")
        parts[position] = new_body
        marker_at = self.full_md.find(self.usage_placeholder)
        prefix_end = marker_at + len(self.usage_placeholder)
        while prefix_end < len(self.full_md) and self.full_md[prefix_end] == "\n":
            prefix_end += 1
        self.full_md = (self.full_md[:prefix_end] + "\n\n---\n\n\n".join(parts)
                   + "\n\n---\n")
        self.summary_body_for_verification = "\n\n".join(parts)
        self.summary_resume_payload["written_chunk_bodies"] = parts
        self.summary_resume_payload["summary_body"] = self.summary_body_for_verification
        self.summary_resume_payload["full_markdown"] = self.full_md


    def sync_phase_usage_events(self):
        self.usage_events.clear()
        self.usage_events.extend(event for event in self.image_usage_events if event)
        self.usage_events.extend(self.cleanup_usage_events)
        if self.stt_usage_event:
            self.usage_events.append(self.stt_usage_event)
