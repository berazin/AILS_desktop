"""Split only over-budget review scopes while retaining source/body positions."""

from __future__ import annotations

import hashlib
from common import re
from .integrated_chunk_verification import (
    VerificationInputBudgetExceeded,
    build_integrated_chunk_prompt,
    build_concept_only_prompt,
    build_fidelity_comparison_prompt,
)
from .video_modes import DETAILED_TASK
from pipeline_utils import estimate_token_count
from .verification_calls import (
    concept_prompt_for_budget,
    verification_prompt_exceeds_budget,
    verification_request_size,
    verification_web_search_enabled,
)


def create_review_window_splitters(*, run):
    """Split only over-budget review scopes while retaining source/body positions."""
    def split_review_units(mode, draft, sources, images, scenes, *, working_limit=None,
                           concept_content_limit=None):
        """Partition oversized verification without discarding any source or prose."""
        # Keep every draft window paired with every source group.
        # Draft order is conceptual, while STT and scenes are temporal;
        # splitting both lists in half independently loses comparisons.
        pending = [(draft, 0, len(draft), [("stt", item) for item in sources]
                    + [("scene", item) for item in scenes])]
        resolved = []
        while pending:
            body, start, end, evidence = pending.pop(0)
            stt_part = [item for kind, item in evidence if kind == "stt"]
            scene_part = [item for kind, item in evidence if kind == "scene"]
            if mode == "fidelity":
                prompt = build_fidelity_comparison_prompt(
                    comparison_id="window-fidelity-9999", draft_markdown=body,
                    cleaned_stt=stt_part, scene_records=scene_part,
                    summary_mode="detailed" if run.video_mode == DETAILED_TASK else "summary",
                    source_payload=run.summary_resume_payload.get("source_payload"))
            elif mode == "concept":
                prompt = concept_prompt_for_budget(run,
                    "window-concept-9999", body)
            else:
                prompt = build_integrated_chunk_prompt(
                    chunk_id="window-integrated-9999", draft_markdown=body,
                    stt_records=stt_part, scene_analysis=scene_part,
                    concept_review_enabled=True, claim_hints=[])
            if not verification_prompt_exceeds_budget(run,
                    prompt, mode,
                    verification_web_search_enabled(run,
                        run.cfg.get("_video_verification_prechecked_identity") or {}, mode),
                    working_limit=working_limit) and (
                    concept_content_limit is None
                    or estimate_token_count(body) <= concept_content_limit):
                resolved.append((body, start, end, stt_part, scene_part))
                continue
            if len(evidence) > 1:
                cut = len(evidence) // 2
                pending[:0] = [(body, start, end, evidence[:cut]),
                               (body, start, end, evidence[cut:])]
            else:
                mid = len(body) // 2
                boundaries = [match.end() for match in re.finditer(r"\n\n|[.!?]\s+", body)]
                cut = min(boundaries, key=lambda value: abs(value - mid)) if boundaries else None
                if cut and 0 < cut < len(body):
                    pending[:0] = [(body[:cut], start, start + cut, evidence),
                                   (body[cut:], start + cut, end, evidence)]
                else:
                    raise VerificationInputBudgetExceeded(
                        "단일 문장과 근거가 선택 모델의 검증 입력 예산을 넘었습니다.")
        if mode == "fidelity":
            return [(f"window-{mode}-{index + 1}", body, stt_part, images,
                     scene_part, start, end)
                    for index, (body, start, end, stt_part, scene_part)
                    in enumerate(resolved)]
        return [(f"window-{mode}-{index + 1}", body, stt_part, images, scene_part)
                for index, (body, _start, _end, stt_part, scene_part)
                in enumerate(resolved)]

    def split_after_tool_budget(mode, unit_id, draft, sources, images, scenes,
                                *, body_start=0, max_units=128):
        """Retry a paid-but-unfinished scope on smaller, stable input ranges."""
        depth_match = re.search(r"-adaptive-(\d+)-", unit_id)
        depth = int(depth_match.group(1)) if depth_match else 0
        if depth >= 6:
            return []
        web_enabled = verification_web_search_enabled(run,
            run.cfg.get("_video_verification_prechecked_identity") or {}, mode)
        if mode == "fidelity":
            prompt = build_fidelity_comparison_prompt(
                comparison_id=unit_id, draft_markdown=draft,
                cleaned_stt=sources, scene_records=scenes,
                summary_mode="detailed" if run.video_mode == DETAILED_TASK else "summary",
                source_payload=run.summary_resume_payload.get("source_payload"))
            floor = build_fidelity_comparison_prompt(
                comparison_id=unit_id, draft_markdown="x",
                cleaned_stt=[], scene_records=[],
                summary_mode="detailed" if run.video_mode == DETAILED_TASK else "summary",
                source_payload=run.summary_resume_payload.get("source_payload"))
        else:
            prompt = build_concept_only_prompt(
                unit_id=unit_id, revised_markdown=draft,
                web_search_enabled=web_enabled)
            floor = build_concept_only_prompt(
                unit_id=unit_id, revised_markdown="x",
                web_search_enabled=web_enabled)
        prompt_tokens, _ = verification_request_size(run, prompt, mode, web_enabled)
        fixed_tokens, _ = verification_request_size(run, floor, mode, web_enabled)
        if prompt_tokens <= fixed_tokens + 1:
            return []
        smaller_limit = fixed_tokens + max(1, (prompt_tokens - fixed_tokens) * 3 // 4)
        try:
            # Concept child IDs and body hashes have different token
            # overhead from the parent. Shrink prose independently of
            # that metadata; retain the real request budget check.
            pieces = split_review_units(
                mode, draft, sources, images, scenes,
                working_limit=None if mode == "concept" else smaller_limit,
                concept_content_limit=(max(1, estimate_token_count(draft) * 3 // 4)
                                       if mode == "concept" else None))
        except VerificationInputBudgetExceeded:
            return []
        if not 1 < len(pieces) <= max_units:
            return []
        if mode == "concept" and "".join(piece[1] for piece in pieces) != draft:
            return []
        parent_key = hashlib.sha256(unit_id.encode("utf-8")).hexdigest()[:12]
        children = []
        for index, piece in enumerate(pieces, 1):
            child_id = f"window-{mode}-adaptive-{depth + 1}-{parent_key}-{index}"
            if mode == "fidelity":
                _old_id, body, stt_part, image_part, scene_part, start, end = piece
                children.append((child_id, body, stt_part, image_part, scene_part,
                                 body_start + start, body_start + end))
            else:
                children.append((child_id, *piece[1:]))
        return children

    return split_review_units, split_after_tool_budget
