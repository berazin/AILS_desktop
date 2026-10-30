"""학습자료 백그라운드 임베딩·OCR 작업 관리.

`background_document_embedding`·`background_document_ocr` 설정이 켜져 있으면
학습자료 새로고침 때 문서별 임베딩/OCR 상태를 확인해 아직 끝나지 않은 문서를
백그라운드로 처리한다. 진행 상황은 문서 단위로 파일 원장(ledger)에 저장되므로
프로그램 종료·로컬 AI 종료 등으로 작업이 도중에 끊겨도 완료된 문서는 그대로
유지되고, 관리 스레드가 주기적으로 남은 항목을 다시 꺼내 끊긴 지점부터 이어간다.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
import threading
import time
from typing import Any, Callable, Mapping

from local_inference import GpuPriority
from background_spacing_work import SpacingWorkMixin
from background_document_queue_policy import DisabledWorkQueueMixin
from documents.presentation_processing_policy import is_presentation_pdf
from settings.value_coercion import coerce_config_bool

OCR_REQUIRED_REASON = "OCR 필요"
EMBEDDING_MODEL_UNAVAILABLE = "로컬 임베딩 모델을 사용할 수 없어 대기 중입니다."
OCR_RUNTIME_UNAVAILABLE = "OCR 런타임을 사용할 수 없어 대기 중입니다."
ITEM_STATES = {"pending", "running", "done", "skipped", "blocked", "failed", "password_required"}
# 원장 버전 2: 백그라운드 OCR 대상이 확장됐다(레거시 OCR 문서·프레젠테이션
# 변환 PDF). 기존 원장의 완료·건너뜀 ocr 항목은 새 기준으로 한 번 다시
# 판정해야 하므로 로드 시 pending으로 되돌린다.
LEDGER_VERSION = 2
SOURCE_PRESENTATION = "presentation"
# 백그라운드 OCR 판정 큐에 올릴 수 있는 원본 확장자. EPUB 등 paperback
# 문서(.epub/.mobi/.azw/.azw3/.fb2/.rtf)와 그 외 비-PDF는 OCR 대상이 아니다.
OCR_CANDIDATE_EXTENSIONS = frozenset({".pdf", ".ppt", ".pptx"})
TRANSLATION_ERRORS = {
    "", "cancelled", "review_required", "auth", "billing", "transient",
    "document_changed", "invalid_result",
}
TRANSLATION_COUNTS = {
    "completed", "total", "page", "cached", "pending", "failed", "rendered",
    "translated", "cache_hits", "rendered_paragraphs", "layout_failures", "qa_issues",
}


def _translation_counts(value: Any) -> dict[str, int]:
    if not isinstance(value, Mapping):
        return {}
    return {key: count for key, count in value.items()
            if key in TRANSLATION_COUNTS and type(count) is int and 0 <= count <= 2 ** 53 - 1}


def _translation_descriptor(value: Any) -> dict[str, Any]:
    from dataclasses import asdict
    from documents.document_translation_provider import DocumentTranslationOptions, TranslationGlossary

    required = {
        "document_revision", "target_language", "source_language", "provider",
        "prompt_version", "glossary_hash", "layout_version", "options", "selected_pages",
    }
    if not isinstance(value, Mapping) or set(value) - required - {"glossary"} or required - set(value):
        raise ValueError("Invalid translation descriptor fields")
    descriptor = dict(value)
    for key in ("document_revision", "glossary_hash"):
        if not isinstance(value[key], str) or not re.fullmatch(r"[0-9a-fA-F]{64}", value[key]):
            raise ValueError("Invalid translation digest")
        descriptor[key] = value[key].lower()
    for key in ("target_language", "source_language"):
        if not isinstance(value[key], str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,63}", value[key]):
            raise ValueError("Invalid translation language")
    for key in ("prompt_version", "layout_version"):
        version = value[key]
        if not ((type(version) is int and 0 <= version <= 2 ** 31 - 1)
                or (isinstance(version, str) and re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", version))):
            raise ValueError("Invalid translation version")
    provider = value["provider"]
    if not isinstance(provider, Mapping) or set(provider) != {"provider", "model", "endpoint_hash"}:
        raise ValueError("Invalid translation provider fields")
    for key in ("provider", "model"):
        text = provider[key]
        if (not isinstance(text, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_./:@-]{0,255}", text)
                or "://" in text):
            raise ValueError("Invalid translation provider identity")
    if not isinstance(provider["endpoint_hash"], str) or not re.fullmatch(r"[0-9a-fA-F]{64}", provider["endpoint_hash"]):
        raise ValueError("Invalid translation endpoint digest")
    descriptor["provider"] = {**provider, "endpoint_hash": provider["endpoint_hash"].lower()}
    options = value["options"]
    option_keys = {
        "batch_size", "max_segment_characters", "max_retries", "preserve_layout",
        "preserve_formulas", "preserve_code", "use_glossary", "adaptive_typesetting", "source_language",
    }
    if not isinstance(options, Mapping) or set(options) - option_keys:
        raise ValueError("Invalid translation option fields")
    if options.get("source_language", value["source_language"]) != value["source_language"]:
        raise ValueError("Translation source language mismatch")
    descriptor["options"] = asdict(DocumentTranslationOptions(**{**options, "source_language": value["source_language"]}))
    pages = value["selected_pages"]
    if not isinstance(pages, list) or any(type(page) is not int or not 1 <= page <= 2 ** 31 - 1 for page in pages):
        raise ValueError("Invalid translation selected pages")
    descriptor["selected_pages"] = sorted(set(pages))
    glossary = value.get("glossary", [])
    if not isinstance(glossary, list) or any(
        not isinstance(entry, Mapping)
        or set(entry) - {"source_term", "target_term", "confidence", "locked", "origin"}
        or not {"source_term", "target_term"} <= set(entry) for entry in glossary
    ):
        raise ValueError("Invalid translation glossary fields")
    normalized_glossary = TranslationGlossary(tuple(glossary))
    if normalized_glossary.version != descriptor["glossary_hash"]:
        raise ValueError("Translation glossary digest mismatch")
    descriptor["glossary"] = [asdict(entry) for entry in normalized_glossary.items]
    return descriptor


def _translation_job_id(path: str, descriptor: Mapping[str, Any]) -> str:
    payload = {"path": os.path.normcase(os.path.abspath(path)), "descriptor": descriptor}
    digest = hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True,
                                       separators=(",", ":"), allow_nan=False).encode("utf-8")).hexdigest()
    return f"translation|{digest}"


def _translation_public_item(item: Mapping[str, Any]) -> dict[str, Any]:
    return {"kind": "translation", "job_id": item["job_id"], "state": item["state"],
            "attempts": item["attempts"], "error": item["error"],
            "progress": _translation_counts(item.get("progress")),
            "next_retry_at": item["next_retry_at"]}


def _background_ocr_target_reason(
    status: Mapping[str, Any],
    source: str,
    *,
    re_ocr_non_ails: bool = False,
    path: str | None = None,
) -> str | None:
    """텍스트 레이어가 있어도 백그라운드 OCR이 필요한 문서인지 판정한다.

    대상:
    - 프레젠테이션 변환 PDF — 단, 텍스트 레이어가 없는 슬라이드가 있을 때만.
      모든 슬라이드에 텍스트 레이어가 있으면 재OCR하지 않는다(path가
      알려진 경우에만 판정한다).
    - AILS 메타데이터가 없는 PDF(re_ocr_non_ails 옵션이 켜져 있을 때).
      단 본문이 visible native text로 구성된 일반 텍스트 PDF은 제외하고,
      searchable scan(래스터 이미지 + invisible 텍스트 레이어)만 대상으로
      한다(pdf_scan_detection 참조).
    - 레거시 파이프라인으로 OCR된 문서(/AILSFullOCR은 있지만 PP-StructureV3 분석 payload가 없는 문서)
    - 최신 파이프라인(PP-StructureV3)과 불일치하거나 설정이 변경(config_stale)된 문서
    """
    if not status.get("has_text"):
        return None
    if source == SOURCE_PRESENTATION or (path and is_presentation_pdf(path)):
        if path:
            from pdf.pdf_ocr import pdf_pages_missing_text_layer

            try:
                textless_pages = pdf_pages_missing_text_layer(path, minimum_characters=1)
            except Exception:
                textless_pages = None
            if textless_pages is not None and not textless_pages:
                return None
        return "프레젠테이션 변환 PDF"
    if not status.get("ocr_embedded"):
        if re_ocr_non_ails:
            if path:
                import pdf.pdf_scan_detection as pdf_scan_detection
                if pdf_scan_detection.pdf_has_visible_native_body(path):
                    return None
            return "AILS 메타데이터 없는 PDF"
        return None
    analysis = status.get("analysis")
    if not analysis:
        return "레거시 OCR 업그레이드"
    pipeline = str(analysis.get("pipeline") or "")
    if pipeline != "PP-StructureV3":
        return "구버전 파이프라인 업그레이드"
    if analysis.get("config_stale"):
        return "OCR 설정 변경 반영"
    from pdf.pdf_ocr import OCR_VERSION

    embedded_version = str(status.get("ocr_embedded_version") or "")
    if embedded_version and embedded_version != OCR_VERSION:
        return "OCR 버전 업그레이드 필요"
    return None


def _is_path_ocr_excluded(path: str, excluded_paths: Any) -> bool:
    norm = os.path.abspath(str(path or ""))
    for excluded in (excluded_paths or ()):
        excluded_norm = os.path.abspath(str(excluded or ""))
        if not excluded_norm:
            continue
        if norm == excluded_norm:
            return True
        try:
            if os.path.commonpath([excluded_norm, norm]) == excluded_norm:
                return True
        except ValueError:
            continue
    return False


def _lazy_convert_presentation(path: str) -> str:
    from documents.presentation_service import convert_presentation_to_pdf
    return convert_presentation_to_pdf(path)


def _default_store_path() -> str:
    runtime_dir = os.environ.get("AILS_RUNTIME_DATA_DIR")
    if runtime_dir:
        root = os.path.abspath(os.path.expandvars(os.path.expanduser(runtime_dir)))
        return os.path.join(root, "background", "document_work.json")
    appdata = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA") or tempfile.gettempdir()
    return os.path.join(appdata, "AILS", "background", "document_work.json")


def _load_pdf_ocr():
    import pdf.pdf_ocr as pdf_ocr
    return pdf_ocr


class BackgroundDocumentWorkManager(DisabledWorkQueueMixin, SpacingWorkMixin):
    """문서 단위 원장과 분리된 판정·실행 큐로 임베딩·OCR을 진행한다."""

    TICK_SECONDS = 15.0
    MAX_ATTEMPTS = 3
    RETRY_BASE_SECONDS = 60.0
    RETRY_MAX_SECONDS = 600.0

    def __init__(
        self,
        store_path: str | None = None,
        *,
        enqueue_index: Callable[[str], bool] | None = None,
        index_status: Callable[[str], dict] | None = None,
        ocr_status: Callable[..., dict] | None = None,
        resolve_ocr_model: Callable[..., str] | None = None,
        run_ocr: Callable[..., dict] | None = None,
        on_document_ocr_complete: Callable[[str], None] | None = None,
        convert_presentation: Callable[[str], str] | None = None,
        run_translation: Callable[..., Mapping[str, Any]] | None = None,
        start_thread: bool = True,
    ) -> None:
        self._store_path = store_path or _default_store_path()
        self._enqueue_index = enqueue_index or (lambda path: _theory_search().enqueue_document_index(path))
        self._index_status = index_status or (lambda path: _theory_search().document_index_status(path))
        if ocr_status is not None:
            def _wrapped_ocr_status(path: str, **kwargs):
                try:
                    return ocr_status(path, **kwargs)
                except TypeError:
                    return ocr_status(path)

            self._ocr_status = _wrapped_ocr_status
        else:
            self._ocr_status = lambda path, **kwargs: _load_pdf_ocr().pdf_ocr_status(path, **kwargs)
        self._resolve_ocr_model = resolve_ocr_model or (
            lambda **kwargs: _load_pdf_ocr().resolve_ocr_model_variant(kwargs.pop("model_variant", None), **kwargs)
        )
        if run_ocr is not None:
            def _wrapped_run_ocr(path, language, model_variant, emit, force=False, priority=None, only_textless_pages=False):
                try:
                    return run_ocr(path, language=language, model_variant=model_variant, emit=emit, force=force, priority=priority, only_textless_pages=only_textless_pages)
                except TypeError:
                    # 구 run_ocr 훅은 신규 kwargs를 받지 않는다. 호환되는 인자만 내려간다.
                    try:
                        return run_ocr(path, language=language, model_variant=model_variant, emit=emit, force=force, priority=priority)
                    except TypeError:
                        return run_ocr(path, language=language, model_variant=model_variant, emit=emit, force=force)
            self._run_ocr = _wrapped_run_ocr
        else:
            self._run_ocr = (
                lambda path, language, model_variant, emit, force=False, priority=None, only_textless_pages=False: _load_pdf_ocr().run_full_pdf_ocr(
                    path, language=language, model_variant=model_variant, emit=emit, force=force, priority=priority, only_textless_pages=only_textless_pages
                )
            )
        self._convert_presentation = convert_presentation or _lazy_convert_presentation
        self._on_document_ocr_complete = on_document_ocr_complete
        self._run_translation = run_translation
        self._translation_events: dict[str, threading.Event] = {}
        self._spacing_passwords: dict[str, str] = {}
        # 단위 테스트는 명시적 pump_once()로 검증하므로 스레드를 띄우지 않는다.
        self._start_thread_enabled = start_thread
        self._lock = threading.Lock()
        self._wake = threading.Condition(self._lock)
        self._ocr_thread: threading.Thread | None = None
        self._eval_thread: threading.Thread | None = None
        self._stop = False
        # 실제 앱 프로세스에서만 작업을 진행한다(재시작 이어하기 또는 이번 실행의
        # 자료 스캔이 있었을 때). 테스트 등 부수 프로세스가 사용자 원장을
        # 몰래 처리하지 않게 하는 안전장치다.
        self._active = False
        self._settings: dict[str, Any] = {
            "embedding_enabled": True,
            "translation_enabled": False,
            "ocr_enabled": False,
            "spacing_enabled": False,
            "spacing_non_ails": False,
            "ocr_model_variant": "auto",
            "ocr_non_ails": False,
            "ocr_excluded_paths": set(),
            "language": "korean",
            "base_dir": "",
        }
        # 판정 큐: OCR 후보 문서들 (PDF, PPT/PPTX)
        self._eval_queue: list[str] = []
        self._eval_items: dict[str, dict[str, Any]] = {}

        self._ledger: dict[str, Any] = {"version": LEDGER_VERSION, "items": {}, "last_scan_at": ""}
        self._load_ledger()

    # ------------------------------------------------------------------
    # 원장 저장
    # ------------------------------------------------------------------

    def _load_ledger(self) -> None:
        try:
            with open(self._store_path, "r", encoding="utf-8") as handle:
                loaded = json.load(handle)
            items = loaded.get("items") if isinstance(loaded, Mapping) else None
            if isinstance(items, dict):
                normalized_items: dict[str, dict[str, Any]] = {}
                for key, value in items.items():
                    if not isinstance(value, Mapping):
                        continue
                    try:
                        item = self._normalized_item(value)
                    except (TypeError, ValueError):
                        continue
                    if item["kind"] == "translation" and str(key) != item["job_id"]:
                        continue
                    # 백그라운드 OCR 큐는 디스크에 저장하지 않으며 실행 시 비워져 있어야 함
                    if item["kind"] == "ocr":
                        continue
                    if item["kind"] == "spacing":
                        # Retry budgets belong to this app process, not the PDF.
                        item.update(attempts=0, next_retry_at=0.0, error="")
                        if item["state"] == "failed":
                            item["state"] = "pending"
                    normalized_items[str(key)] = item
                self._ledger = {
                    "version": LEDGER_VERSION,
                    "items": normalized_items,
                    "last_scan_at": str(loaded.get("last_scan_at") or ""),  # type: ignore[union-attr]
                }
        except (OSError, ValueError):
            self._ledger = {"version": LEDGER_VERSION, "items": {}, "last_scan_at": ""}

    @staticmethod
    def _normalized_item(value: Mapping) -> dict[str, Any]:
        kind = str(value.get("kind") or "")
        path = os.path.abspath(str(value.get("path") or ""))
        state = str(value.get("state") or "pending")
        signature = value.get("signature")
        try:
            next_retry_at = float(value.get("next_retry_at") or 0.0)
        except (TypeError, ValueError):
            next_retry_at = 0.0
        try:
            attempts = max(0, int(value.get("attempts") or 0))
        except (TypeError, ValueError):
            attempts = 0
        item = {
            "kind": kind,
            "path": path,
            "state": state if state in ITEM_STATES else "pending",
            "error": str(value.get("error") or "")[:500],
            "attempts": attempts,
            "next_retry_at": next_retry_at,
            "source": str(value.get("source") or ""),
            "signature": [int(signature[0]), int(signature[1])] if isinstance(signature, (list, tuple)) and len(signature) == 2 and all(isinstance(part, (int, float)) for part in signature) else None,
            "progress": value.get("progress") if isinstance(value.get("progress"), Mapping) else None,
            "updated_at": str(value.get("updated_at") or ""),
            "done_at": str(value.get("done_at") or ""),
            **({"refinement_version": str(value.get("refinement_version") or "")} if kind == "spacing" else {}),
        }
        if kind == "spacing" and item["error"] == "File has not been decrypted":
            item.update(state="password_required", error="PDF 비밀번호를 입력해 주세요.", progress=None)
        if kind == "translation":
            descriptor = _translation_descriptor(value.get("descriptor"))
            item.update(descriptor=descriptor, job_id=_translation_job_id(path, descriptor),
                        progress=_translation_counts(value.get("progress")), source="", signature=None,
                        error=item["error"] if item["error"] in TRANSLATION_ERRORS else "invalid_result")
        return item

    def _save_locked(self) -> None:
        try:
            os.makedirs(os.path.dirname(self._store_path), exist_ok=True)
            temp_path = self._store_path + ".tmp"
            # 백그라운드 OCR 큐는 디스크 원장에 저장하지 않음 (embedding 항목만 저장)
            persisted_items = {
                k: ({field: value for field, value in v.items()
                     if field not in {"attempts", "next_retry_at", "error"}} if v.get("kind") == "spacing" else v)
                for k, v in self._ledger["items"].items()
                if v.get("kind") != "ocr"
            }
            payload = {
                "version": LEDGER_VERSION,
                "items": persisted_items,
                "last_scan_at": str(self._ledger.get("last_scan_at") or ""),
            }
            with open(temp_path, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, ensure_ascii=False)
            for attempt in range(3):
                try:
                    os.replace(temp_path, self._store_path)
                    break
                except OSError:
                    if attempt == 2:
                        raise
                    time.sleep(0.05 * (attempt + 1))
        except OSError:
            raise OSError("Unable to persist document work") from None

    @staticmethod
    def _item_key(kind: str, path: str) -> str:
        return f"{kind}|{os.path.abspath(path)}"

    @staticmethod
    def _signature(path: str) -> list[int] | None:
        try:
            stat_result = os.stat(path)
        except OSError:
            return None
        return [int(stat_result.st_size), int(stat_result.st_mtime_ns)]

    def _touch(self, item: dict[str, Any], **changes: Any) -> None:
        item.update(changes)
        item["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        self._prune_disabled_work_locked(persist=False)
        self._save_locked()

    # ------------------------------------------------------------------
    # 설정·스캔 반영
    # ------------------------------------------------------------------

    def configure(self, config: Mapping[str, Any], *, resume_pending: bool = False) -> None:
        with self._wake:
            if self._stop:
                return
            self._prune_pdf_work_temps_locked()
            old_spacing_enabled = self._settings.get("spacing_enabled", False)
            old_spacing_non_ails = self._settings.get("spacing_non_ails", False)
            old_non_ails = self._settings.get("ocr_non_ails", False)
            new_non_ails = coerce_config_bool(config.get("background_document_ocr_non_ails"), False)
            old_excluded = set(self._settings.get("ocr_excluded_paths") or ())
            raw_excluded = config.get("background_document_ocr_excluded_paths") or ()
            new_excluded = {
                os.path.abspath(str(p)) for p in raw_excluded if str(p or "").strip()
            } if isinstance(raw_excluded, (list, tuple, set)) else set()
            self._settings.update(
                {
                    "translation_enabled": coerce_config_bool(config.get("background_document_translation"), False),
                    "embedding_enabled": coerce_config_bool(config.get("background_document_embedding"), True),
                    "ocr_enabled": coerce_config_bool(config.get("background_document_ocr"), False),
                    "spacing_enabled": coerce_config_bool(config.get("background_document_spacing"), False),
                    "spacing_non_ails": coerce_config_bool(config.get("background_document_spacing_non_ails"), False),
                    "ocr_model_variant": str(config.get("pdf_ocr_model_variant") or "auto"),
                    "ocr_non_ails": new_non_ails,
                    "ocr_excluded_paths": new_excluded,
                    "language": str(config.get("language") or "korean"),
                    "base_dir": str(config.get("md_save_path") or ""),
                }
            )
            if self._settings["spacing_enabled"] and not resume_pending and (
                (not old_spacing_non_ails and self._settings["spacing_non_ails"])
                or (not old_spacing_enabled and self._settings["spacing_enabled"])
            ):
                for item in self._ledger["items"].values():
                    if item["kind"] == "spacing" and item["state"] not in {"running", "password_required"}:
                        item.update(state="pending", error="", attempts=0, next_retry_at=0.0)
                self._save_locked()
            # 비-AILS 재OCR 설정이 켜졌으면 이전에 건너뛴 후보들을 다시 판정 큐로 보낸다.
            if not old_non_ails and new_non_ails:
                for cand in self._eval_items.values():
                    if cand.get("state") == "skipped":
                        cand["state"] = "pending"
                        if cand["path"] not in self._eval_queue:
                            self._eval_queue.append(cand["path"])

            # 제외 목록이 변경되었을 때:
            if old_excluded != new_excluded:
                # 1) 새로 제외된 항목은 skipped 처리하고 판정 큐에서 즉시 제거
                self._eval_queue = [p for p in self._eval_queue if not _is_path_ocr_excluded(p, new_excluded)]
                for item in self._ledger["items"].values():
                    if item.get("kind") == "ocr" and item.get("state") in {"pending", "blocked", "failed"}:
                        if _is_path_ocr_excluded(item["path"], new_excluded):
                            item["state"] = "skipped"
                            item["error"] = "OCR 제외 설정됨"
                for cand in self._eval_items.values():
                    if cand.get("state") in {"pending", "evaluating"} and _is_path_ocr_excluded(cand["path"], new_excluded):
                        cand["state"] = "skipped"
                        cand["error"] = "OCR 제외 설정됨"
                # 2) 제외 해제된 항목은 다시 pending으로 복구
                for cand in self._eval_items.values():
                    if cand.get("state") == "skipped" and cand.get("error") == "OCR 제외 설정됨":
                        if not _is_path_ocr_excluded(cand["path"], new_excluded):
                            cand["state"] = "pending"
                            cand["error"] = ""
                            if cand["path"] not in self._eval_queue:
                                self._eval_queue.append(cand["path"])
                for item in self._ledger["items"].values():
                    if item.get("kind") == "ocr" and item.get("state") == "skipped" and item.get("error") == "OCR 제외 설정됨":
                        if not _is_path_ocr_excluded(item["path"], new_excluded):
                            item["error"] = ""
                            source = str(item.get("source") or "")
                            self._enqueue_candidate_locked(
                                item["path"],
                                source=source,
                                is_presentation=(
                                    source == SOURCE_PRESENTATION
                                    and os.path.splitext(item["path"])[1].casefold() != ".pdf"
                                ),
                            )

            if not self._settings["translation_enabled"]:
                for event in self._translation_events.values():
                    event.set()
            if resume_pending:
                # 이전 프로세스에서 실행 중이던 임베딩 항목은 대기 상태로 되돌려 이어서 진행한다.
                self._active = True
                for item in self._ledger["items"].values():
                    if item["state"] == "running" and (
                        item["kind"] in {"embedding", "spacing"} or (
                            item["kind"] == "translation" and item["job_id"] not in self._translation_events
                        )
                    ):
                        item["state"] = "pending"
                        item["progress"] = None
                        if item["kind"] == "translation":
                            item["attempts"] = max(0, item["attempts"] - 1)
                self._save_locked()
            self._prune_disabled_work_locked()
            self._start_threads_locked()
            self._wake.notify_all()

    def set_translation_callback(self, callback: Callable[..., Mapping[str, Any]] | None) -> None:
        with self._wake:
            self._run_translation = callback
            self._wake.notify_all()

    def enqueue_translation(self, path: str, descriptor: Mapping[str, Any]) -> dict[str, Any]:
        validated = _translation_descriptor(descriptor)
        normalized = os.path.abspath(os.fspath(path))
        if not os.path.isfile(normalized):
            raise ValueError("Translation source file is unavailable")
        job_id = _translation_job_id(normalized, validated)
        with self._wake:
            if self._stop:
                raise RuntimeError("Background document work has stopped")
            if not self._work_enabled_locked("translation"):
                raise ValueError("백그라운드 번역이 꺼져 있습니다.")
            item = self._ledger["items"].get(job_id)
            previous = dict(item) if item is not None else None
            if item is None:
                item = self._normalized_item({"kind": "translation", "path": normalized,
                                              "descriptor": validated})
                self._ledger["items"][job_id] = item
            try:
                if item["state"] not in {"done", "running"}:
                    self._touch(item, state="pending", error="", attempts=0, next_retry_at=0.0, done_at="")
                else:
                    self._save_locked()
            except OSError:
                if previous is None:
                    self._ledger["items"].pop(job_id, None)
                else:
                    item.clear()
                    item.update(previous)
                raise
            self._active = True
            self._start_threads_locked()
            self._wake.notify_all()
            return _translation_public_item(item)

    def cancel_translation(self, job_id: str) -> bool:
        with self._wake:
            item = self._ledger["items"].get(job_id)
            if item is None or item["kind"] != "translation" or item["state"] in {"done", "skipped"}:
                return False
            event = self._translation_events.get(job_id)
            if event is not None:
                event.set()
                self._touch(item, error="cancelled")
            else:
                self._touch(item, state="blocked", error="cancelled", next_retry_at=0.0)
            self._wake.notify_all()
            return True

    def set_ocr_complete_callback(self, callback: Callable[[str], None] | None) -> None:
        self._on_document_ocr_complete = callback

    def note_material_paths(
        self,
        *,
        embedding_paths: list[str] | tuple[str, ...] = (),
        pdf_paths: list[str] | tuple[str, ...] = (),
        presentation_paths: list[str] | tuple[str, ...] = (),
        presentation_pdf_paths: list[str] | tuple[str, ...] = (),
    ) -> None:
        """학습자료 새로고침 결과를 받아 처리 대상 문서를 원장 및 판정 큐에 반영한다."""
        from pdf.pdf_work_files import is_pdf_work_temp
        embedding_paths = [p for p in embedding_paths if not is_pdf_work_temp(p)]
        pdf_paths = [p for p in pdf_paths if not is_pdf_work_temp(p)]
        presentation_pdf_paths = [p for p in presentation_pdf_paths if not is_pdf_work_temp(p)]
        with self._wake:
            if self._stop:
                return
            self._active = True
            changed = False
            pres_pdf_set = {
                os.path.abspath(str(path or "")) for path in presentation_pdf_paths
            }
            self._note_spacing_locked(pdf_paths, presentation_pdf_paths=pres_pdf_set)
            if self._settings["embedding_enabled"]:
                for path in embedding_paths:
                    changed = self._ensure_item_locked("embedding", path) or changed

            if self._settings["ocr_enabled"]:
                excluded_paths = set(self._settings.get("ocr_excluded_paths") or ())
                # 1. 뷰어로 변환된 PPT PDF들
                for path in presentation_pdf_paths:
                    if _is_path_ocr_excluded(path, excluded_paths):
                        self._ensure_item_locked("ocr", path, source=SOURCE_PRESENTATION)
                        continue
                    self._ensure_item_locked("ocr", path, source=SOURCE_PRESENTATION)
                    self._enqueue_candidate_locked(path, source=SOURCE_PRESENTATION, is_presentation=False)
                # 2. 미변환 PPT/PPTX 파일들 (뷰어로 열지 않았어도 포함)
                for path in presentation_paths:
                    if _is_path_ocr_excluded(path, excluded_paths):
                        self._ensure_item_locked("ocr", path, source=SOURCE_PRESENTATION)
                        continue
                    self._ensure_item_locked("ocr", path, source=SOURCE_PRESENTATION)
                    self._enqueue_candidate_locked(path, source=SOURCE_PRESENTATION, is_presentation=True)
                # 3. 일반 PDF 파일들
                for path in pdf_paths:
                    source = SOURCE_PRESENTATION if os.path.abspath(str(path or "")) in pres_pdf_set else ""
                    if _is_path_ocr_excluded(path, excluded_paths):
                        self._ensure_item_locked("ocr", path, source=source)
                        continue
                    self._ensure_item_locked("ocr", path, source=source)
                    self._enqueue_candidate_locked(path, source=source, is_presentation=False)

            self._ledger["last_scan_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            if changed:
                self._save_locked()
            self._start_threads_locked()
            self._wake.notify_all()

    def _enqueue_candidate_locked(self, path: str, source: str = "", is_presentation: bool = False) -> bool:
        if not self._settings["ocr_enabled"]:
            return False
        normalized = os.path.abspath(str(path or ""))
        if not os.path.isfile(normalized):
            return False
        if os.path.splitext(normalized)[1].casefold() not in OCR_CANDIDATE_EXTENSIONS:
            # EPUB 등 비-PDF 문서는 백그라운드 OCR 판정 대상이 아니다.
            return False
        excluded_paths = set(self._settings.get("ocr_excluded_paths") or ())
        if _is_path_ocr_excluded(normalized, excluded_paths):
            return False
        signature = self._signature(normalized)
        existing = self._eval_items.get(normalized)
        current_non_ails = self._settings.get("ocr_non_ails", False)
        if existing is not None:
            if (
                signature is not None
                and existing.get("signature") == signature
                and existing.get("state") in {"done", "skipped"}
                and existing.get("evaluated_with_non_ails") == current_non_ails
            ):
                return False
            existing.update(
                state="pending",
                error="",
                source=source,
                is_presentation=is_presentation,
                signature=signature,
                evaluated_with_non_ails=current_non_ails,
            )
            if normalized not in self._eval_queue:
                self._eval_queue.append(normalized)
            return True

        self._eval_items[normalized] = {
            "path": normalized,
            "source": source,
            "is_presentation": is_presentation,
            "state": "pending",
            "error": "",
            "signature": signature,
            "evaluated_with_non_ails": current_non_ails,
        }
        self._eval_queue.append(normalized)
        return True

    def _enqueue_ocr_item_locked(self, path: str, source: str = "", reason: str = "") -> bool:
        if not self._settings["ocr_enabled"]:
            return False
        normalized = os.path.abspath(str(path or ""))
        if not os.path.isfile(normalized):
            return False
        excluded_paths = set(self._settings.get("ocr_excluded_paths") or ())
        if _is_path_ocr_excluded(normalized, excluded_paths):
            return False
        key = self._item_key("ocr", normalized)
        items = self._ledger["items"]
        signature = self._signature(normalized)
        item = items.get(key)
        if item is None:
            items[key] = {
                "kind": "ocr",
                "path": normalized,
                "state": "pending",
                "error": reason,
                "attempts": 0,
                "next_retry_at": 0.0,
                "source": str(source or ""),
                "signature": signature,
                "progress": None,
                "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "done_at": "",
            }
            return True
        if source and item.get("source") != source:
            item["source"] = source
            item["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        if item["state"] != "running":
            item.update(
                state="pending",
                error=reason,
                attempts=0,
                next_retry_at=0.0,
                progress=None,
                signature=signature,
                updated_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                done_at="",
            )
            return True
        return False

    def _ensure_item_locked(self, kind: str, path: str, source: str | None = None) -> bool:
        if not self._work_enabled_locked(kind):
            return False
        normalized = os.path.abspath(str(path or ""))
        if not os.path.isfile(normalized):
            return False
        key = self._item_key(kind, normalized)
        items = self._ledger["items"]
        signature = self._signature(normalized)
        item = items.get(key)
        if kind == "ocr":
            # EPUB 등 비-PDF 문서는 백그라운드 OCR 대상이 아니다.
            if os.path.splitext(normalized)[1].casefold() not in OCR_CANDIDATE_EXTENSIONS:
                skip_reason = "PDF가 아니므로 백그라운드 OCR 대상이 아닙니다."
            else:
                excluded_paths = set(self._settings.get("ocr_excluded_paths") or ())
                skip_reason = (
                    "OCR 제외 설정됨"
                    if _is_path_ocr_excluded(normalized, excluded_paths)
                    else ""
                )
            if skip_reason:
                if item is None:
                    items[key] = {
                        "kind": kind,
                        "path": normalized,
                        "state": "skipped",
                        "error": skip_reason,
                        "attempts": 0,
                        "next_retry_at": 0.0,
                        "source": str(source or ""),
                        "signature": signature,
                        "progress": None,
                        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                        "done_at": "",
                    }
                    return True
                elif item.get("state") != "skipped":
                    item.update(
                        state="skipped",
                        error=skip_reason,
                        updated_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    )
                    return True
                return False
        if item is None:
            items[key] = {
                "kind": kind,
                "path": normalized,
                # OCR은 판정 결과가 재OCR 대상일 때만 pending으로 승격한다.
                "state": "skipped" if kind == "ocr" else "pending",
                "error": "",
                "attempts": 0,
                "next_retry_at": 0.0,
                "source": str(source or ""),
                "signature": signature,
                "progress": None,
                "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "done_at": "",
            }
            if kind != "ocr":
                self._save_locked()
            return True
        if source and item.get("source") != source:
            item["source"] = source
            item["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            if kind != "ocr":
                self._save_locked()
        if signature is not None and item.get("signature") == signature:
            return False
        if item["state"] != "running":
            item.update(
                state="skipped" if kind == "ocr" else "pending",
                error="",
                attempts=0,
                next_retry_at=0.0,
                progress=None,
                signature=None,
                updated_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                done_at="",
            )
            if kind != "ocr":
                self._save_locked()
        return True

    def _reset_embedding_item_locked(self, path: str) -> None:
        if not self._settings["embedding_enabled"]:
            return
        normalized = os.path.abspath(str(path or ""))
        key = self._item_key("embedding", normalized)
        item = self._ledger["items"].get(key)
        if item is None:
            if not os.path.isfile(normalized):
                return
            self._ensure_item_locked("embedding", normalized)
            return
        item.update(
            state="pending",
            error="",
            attempts=0,
            next_retry_at=0.0,
            progress=None,
            signature=None,
            done_at="",
            updated_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        )
        self._save_locked()

    # ------------------------------------------------------------------
    # 판정 및 작업 스레드
    # ------------------------------------------------------------------

    def _start_threads_locked(self) -> None:
        if self._stop or not self._start_thread_enabled:
            return
        if self._eval_thread is None or not self._eval_thread.is_alive():
            self._eval_thread = threading.Thread(
                target=self._eval_loop, name="ails-background-eval", daemon=True
            )
            self._eval_thread.start()
        if self._ocr_thread is None or not self._ocr_thread.is_alive():
            self._ocr_thread = threading.Thread(
                target=self._ocr_loop, name="ails-background-ocr", daemon=True
            )
            self._ocr_thread.start()

    def _has_pending_eval_locked(self) -> bool:
        if not self._active or not self._settings.get("ocr_enabled"):
            return False
        return len(self._eval_queue) > 0

    def _pop_next_eval_locked(self) -> dict[str, Any] | None:
        if not self._active or not self._settings.get("ocr_enabled"):
            return None
        while self._eval_queue:
            path = self._eval_queue.pop(0)
            candidate = self._eval_items.get(path)
            if candidate is not None and candidate.get("state") == "pending":
                candidate["state"] = "evaluating"
                return candidate
        return None

    def _eval_loop(self) -> None:
        while True:
            with self._wake:
                while not self._stop and not self._has_pending_eval_locked():
                    self._wake.wait(self.TICK_SECONDS)
                if self._stop:
                    return
                candidate = self._pop_next_eval_locked()
            if candidate is not None:
                try:
                    self._evaluate_candidate(candidate, time.time())
                except Exception:
                    continue

    def _evaluate_candidate(self, candidate: dict[str, Any], now: float) -> None:
        with self._lock:
            if not self._settings["ocr_enabled"]:
                return
        path = candidate["path"]
        source = candidate.get("source") or ""
        is_pres = candidate.get("is_presentation", False)
        eval_path = path

        if is_pres:
            try:
                converted = self._convert_presentation(path)
                if not converted or not os.path.isfile(converted):
                    with self._lock:
                        candidate["state"] = "failed"
                        candidate["error"] = "프레젠테이션 변환 결과 파일을 찾을 수 없습니다."
                        ocr_key = self._item_key("ocr", path)
                        ocr_item = self._ledger["items"].get(ocr_key)
                        if ocr_item is not None:
                            ocr_item["state"] = "failed"
                            ocr_item["error"] = "프레젠테이션 변환 결과 파일을 찾을 수 없습니다."
                    return
                eval_path = os.path.abspath(converted)
                candidate["target_pdf"] = eval_path
            except Exception as error:
                with self._lock:
                    candidate["state"] = "failed"
                    candidate["error"] = f"프레젠테이션 변환 실패: {str(error)[:300]}"
                    ocr_key = self._item_key("ocr", path)
                    ocr_item = self._ledger["items"].get(ocr_key)
                    if ocr_item is not None:
                        ocr_item["state"] = "failed"
                        ocr_item["error"] = f"프레젠테이션 변환 실패: {str(error)[:300]}"
                return

        if not os.path.isfile(eval_path):
            with self._lock:
                candidate["state"] = "failed"
                candidate["error"] = "파일을 찾을 수 없습니다."
                ocr_key = self._item_key("ocr", eval_path)
                ocr_item = self._ledger["items"].get(ocr_key)
                if ocr_item is not None:
                    ocr_item["state"] = "failed"
                    ocr_item["error"] = "파일을 찾을 수 없습니다."
            return

        with self._lock:
            excluded_paths = set(self._settings.get("ocr_excluded_paths") or ())
        if _is_path_ocr_excluded(path, excluded_paths) or _is_path_ocr_excluded(eval_path, excluded_paths):
            with self._wake:
                candidate["state"] = "skipped"
                candidate["error"] = "OCR 제외 설정됨"
                ocr_key = self._item_key("ocr", eval_path)
                ocr_item = self._ledger["items"].get(ocr_key)
                if ocr_item is not None:
                    ocr_item["state"] = "skipped"
                    ocr_item["error"] = "OCR 제외 설정됨"
                    ocr_item["signature"] = self._signature(eval_path)
                if is_pres and self._settings.get("embedding_enabled"):
                    self._ensure_item_locked("embedding", eval_path)
                    self._save_locked()
            return

        try:
            status = self._ocr_status(eval_path, rebuild_native_index=False)
        except Exception as error:
            with self._lock:
                candidate["state"] = "failed"
                candidate["error"] = str(error)[:300]
                ocr_key = self._item_key("ocr", eval_path)
                ocr_item = self._ledger["items"].get(ocr_key)
                if ocr_item is not None:
                    ocr_item["state"] = "failed"
                    ocr_item["error"] = str(error)[:300]
            return

        needs_ocr = False
        reason = ""
        if not status.get("has_text"):
            needs_ocr = True
            reason = OCR_REQUIRED_REASON
        elif status.get("index_repair_required"):
            needs_ocr = True
            reason = "색인 복구 필요"
        else:
            with self._lock:
                re_ocr_non_ails = bool(self._settings.get("ocr_non_ails", False))
            reason = (
                _background_ocr_target_reason(
                    status,
                    source,
                    re_ocr_non_ails=re_ocr_non_ails,
                    path=eval_path,
                )
                or ""
            )
            if not reason and status.get("needs_ocr") and status.get("ocr_stale"):
                reason = "OCR 업그레이드 필요"
            needs_ocr = bool(reason)

        with self._wake:
            if needs_ocr:
                candidate["state"] = "done"
                candidate["error"] = reason
                self._enqueue_ocr_item_locked(eval_path, source=source, reason=reason)
                self._wake.notify_all()
            else:
                candidate["state"] = "skipped"
                candidate["error"] = ""
                ocr_key = self._item_key("ocr", eval_path)
                ocr_item = self._ledger["items"].get(ocr_key)
                if ocr_item is not None:
                    ocr_item["state"] = "skipped"
                    ocr_item["signature"] = self._signature(eval_path)
                if is_pres and self._settings.get("embedding_enabled"):
                    self._ensure_item_locked("embedding", eval_path)
                    self._save_locked()

    def _has_ocr_or_embedding_work_locked(self) -> bool:
        if not self._active:
            return False
        now = time.time()
        if self._spacing_ready_locked() is not None:
            return True
        if self._translation_ready_locked(now):
            return True
        if self._settings.get("embedding_enabled"):
            for item in self._ledger["items"].values():
                if item["kind"] == "embedding" and item["state"] not in {"done", "skipped"}:
                    if item["state"] == "blocked" and float(item.get("next_retry_at") or 0.0) > now:
                        continue
                    if item["state"] == "failed":
                        if int(item.get("attempts") or 0) >= self.MAX_ATTEMPTS:
                            continue
                        if float(item.get("next_retry_at") or 0.0) > now:
                            continue
                    return True
        if self._settings.get("ocr_enabled"):
            for item in self._ledger["items"].values():
                if item["kind"] == "ocr" and item["state"] == "pending":
                    return True
        return False

    def _ocr_loop(self) -> None:
        while True:
            with self._wake:
                while not self._stop and not self._has_ocr_or_embedding_work_locked():
                    self._wake.wait(self._spacing_wait_timeout_locked())
                if self._stop:
                    return
                now = time.time()
                self._process_embeddings_locked(now)
                translation = self._claim_translation_locked(now)
                ocr_item = (
                    self._next_ocr_item_locked(now)
                    if translation is None and self._settings.get("ocr_enabled")
                    else None
                )
                spacing_item = self._claim_spacing_locked(now) if translation is None and ocr_item is None else None
            try:
                if translation is not None:
                    self._run_translation_item(*translation, now)
                elif ocr_item is not None:
                    self._run_ocr_item(ocr_item["path"], now)
                elif spacing_item is not None:
                    self._run_spacing_item(spacing_item)
            except Exception:
                continue

    def stop(self) -> None:
        with self._wake:
            self._stop = True
            self._spacing_passwords.clear()
            for event in self._translation_events.values():
                event.set()
            self._wake.notify_all()
        deadline = time.monotonic() + 3.0
        for worker in (self._eval_thread, self._ocr_thread):
            if worker is not None and worker is not threading.current_thread():
                worker.join(max(0.0, deadline - time.monotonic()))

    # ------------------------------------------------------------------
    # 진행
    # ------------------------------------------------------------------

    def _retry_delay(self, attempts: int) -> float:
        return min(self.RETRY_MAX_SECONDS, self.RETRY_BASE_SECONDS * max(1, 2 ** max(0, attempts - 1)))

    def pump_eval(self, now: float | None = None, limit: int | None = None) -> int:
        current = time.time() if now is None else now
        processed = 0
        while limit is None or processed < limit:
            with self._lock:
                candidate = self._pop_next_eval_locked()
            if candidate is None:
                break
            self._evaluate_candidate(candidate, current)
            processed += 1
        return processed

    def pump_once(self, now: float | None = None) -> None:
        if not self._active or self._stop:
            return
        current = time.time() if now is None else now
        self.pump_eval(current)
        with self._lock:
            if self._stop:
                return
            self._process_embeddings_locked(current)
            translation = self._claim_translation_locked(current)
            ocr_item = (
                self._next_ocr_item_locked(current)
                if translation is None and self._settings.get("ocr_enabled")
                else None
            )
            spacing_item = self._claim_spacing_locked(current) if translation is None and ocr_item is None else None
        if translation is not None:
            self._run_translation_item(*translation, current)
        elif ocr_item is not None:
            self._run_ocr_item(ocr_item["path"], current)
        elif spacing_item is not None:
            self._run_spacing_item(spacing_item, current)

    def _translation_ready_locked(self, now: float) -> dict[str, Any] | None:
        if (self._stop or not self._active or not self._settings["translation_enabled"]
                or self._run_translation is None or self._translation_events):
            return None
        for item in self._ledger["items"].values():
            if (item["kind"] == "translation" and item["state"] in {"pending", "failed"}
                    and item["attempts"] < self.MAX_ATTEMPTS and item["next_retry_at"] <= now):
                return item
        return None

    def _claim_translation_locked(self, now: float) -> tuple | None:
        item = self._translation_ready_locked(now)
        if item is None:
            return None
        event = threading.Event()
        previous = dict(item)
        try:
            self._touch(item, state="running", error="", attempts=item["attempts"] + 1, next_retry_at=0.0)
        except OSError:
            item.clear()
            item.update(previous)
            raise
        self._translation_events[item["job_id"]] = event
        return item, event, self._run_translation

    def _run_translation_item(self, item: dict[str, Any], event: threading.Event,
                              callback: Callable, now: float) -> None:
        from pathlib import Path
        from pdf.pdf_translation import PdfTranslationCancelled, source_identity
        from documents.document_translation_provider import _status_code

        def cancel_check() -> None:
            if event.is_set():
                raise PdfTranslationCancelled("Translation cancelled")

        def record(event_data: Any) -> None:
            counts = _translation_counts(event_data)
            if not counts:
                return
            with self._lock:
                if item["state"] == "running" and not event.is_set() and item["progress"] != counts:
                    self._touch(item, progress=counts)

        state, error = "blocked", "invalid_result"
        try:
            cancel_check()
            descriptor = _translation_descriptor(item["descriptor"])
            if source_identity(Path(item["path"]))["sha256"] != descriptor["document_revision"]:
                error = "document_changed"
            else:
                cancel_check()
                result = callback(item["path"], descriptor, record, cancel_check)
                cancel_check()
                if isinstance(result, Mapping):
                    status, outcome = result.get("status"), result.get("outcome")
                    metrics = _translation_counts(result.get("metrics"))
                    systemic = result.get("systemic_status")
                    if systemic in ("auth", "billing", "transient"):
                        state, error = ("failed" if systemic == "transient" else "blocked"), systemic
                    elif status in {"auth", "billing"} or outcome in {"auth", "billing"}:
                        error = status if status in {"auth", "billing"} else outcome
                    elif (status == "review_required" or outcome in {"partial", "review_required"}
                          or any(metrics.get(key, 0) for key in ("failed", "pending", "layout_failures", "qa_issues"))):
                        error = "review_required"
                    elif outcome == "success" and status in {None, "approved", "success", "done"}:
                        state, error = "done", ""
                    elif outcome in {"transient", "failed"}:
                        state, error = "failed", "transient"
        except PdfTranslationCancelled:
            state, error = "blocked", "cancelled"
        except FileNotFoundError:
            error = "document_changed"
        except Exception as exception:
            code = _status_code(exception)
            if code in {401, 403}:
                state, error = "blocked", "auth"
            elif code == 402:
                state, error = "blocked", "billing"
            else:
                state, error = "failed", "transient"
        except BaseException:
            state = "running"
            raise
        finally:
            with self._wake:
                if event.is_set():
                    state = "blocked" if item["error"] == "cancelled" else "pending"
                    error = "cancelled" if state == "blocked" else ""
                if event.is_set() or error == "cancelled":
                    item["attempts"] = max(0, item["attempts"] - 1)
                self._translation_events.pop(item["job_id"], None)
                if state != "running":
                    self._touch(item, state=state, error=error,
                                next_retry_at=now + self._retry_delay(item["attempts"]) if state == "failed" else 0.0,
                                done_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()) if state == "done" else "")
                self._wake.notify_all()

    def _process_embeddings_locked(self, now: float) -> None:
        if not self._settings["embedding_enabled"]:
            return
        for key, item in list(self._ledger["items"].items()):
            if item["kind"] != "embedding":
                continue
            state = item["state"]
            if state in {"done", "skipped"}:
                continue
            if state == "blocked" and float(item.get("next_retry_at") or 0.0) > now:
                continue
            if state == "failed":
                if int(item.get("attempts") or 0) >= self.MAX_ATTEMPTS:
                    continue
                if float(item.get("next_retry_at") or 0.0) > now:
                    continue
            path = item["path"]
            if not os.path.isfile(path):
                self._touch(item, state="failed", error="파일을 찾을 수 없습니다.")
                continue
            try:
                status = self._index_status(path)
            except Exception as error:
                self._touch(
                    item,
                    state="failed",
                    error=str(error)[:300],
                    attempts=int(item.get("attempts") or 0) + 1,
                    next_retry_at=now + self._retry_delay(int(item.get("attempts") or 0) + 1),
                )
                continue
            status_value = str(status.get("status") or "")
            if status_value == "ready":
                if status.get("degraded"):
                    self._touch(
                        item,
                        state="blocked",
                        error=EMBEDDING_MODEL_UNAVAILABLE,
                        attempts=int(item.get("attempts") or 0) + 1,
                        next_retry_at=now + self._retry_delay(int(item.get("attempts") or 0) + 1),
                    )
                else:
                    self._touch(item, state="done", error="", signature=self._signature(path), progress=None, done_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
                continue
            if status_value == "unavailable":
                reason = str(status.get("reason") or "")
                if reason == OCR_REQUIRED_REASON:
                    if self._settings["ocr_enabled"]:
                        # 백그라운드 OCR이 끝나면 이어서 임베딩한다.
                        self._touch(item, state="pending", error="")
                    else:
                        self._touch(item, state="skipped", error=OCR_REQUIRED_REASON, signature=self._signature(path))
                else:
                    self._touch(item, state="skipped", error=reason or "검색 가능한 텍스트가 없습니다.", signature=self._signature(path))
                continue
            # 아직 인덱싱 중이거나 이 세션에서 시작 전이면 큐에 넣는다(멱등).
            try:
                self._enqueue_index(path)
            except Exception as error:
                self._touch(
                    item,
                    state="failed",
                    error=str(error)[:300],
                    attempts=int(item.get("attempts") or 0) + 1,
                    next_retry_at=now + self._retry_delay(int(item.get("attempts") or 0) + 1),
                )
                continue
            if item["state"] != "running":
                self._touch(item, state="running", error="", progress=None)

    def _next_ocr_item_locked(self, now: float) -> dict[str, Any] | None:
        for key, item in sorted(self._ledger["items"].items()):
            if item["kind"] != "ocr" or item["state"] != "pending":
                continue
            if not os.path.isfile(item["path"]):
                self._touch(item, state="failed", error="파일을 찾을 수 없습니다.")
                continue
            self._touch(item, state="running", progress=None, error="")
            return item
        return None

    def _run_ocr_item(self, path: str, now: float) -> None:
        key = self._item_key("ocr", path)

        def record(event: Mapping[str, Any]) -> None:
            if str(event.get("type") or "") != "progress":
                return
            with self._lock:
                item = self._ledger["items"].get(key)
                if item is None or item["state"] != "running":
                    return
                progress = item.get("progress") or {}
                page = int(event.get("page") or 0)
                total = int(event.get("total") or 0)
                # 같은 페이지의 중복 이벤트마다 저장하지 않는다.
                if int(progress.get("page") or 0) == page and int(progress.get("total") or 0) == total:
                    return
                item["progress"] = {"page": page, "total": total}
                self._save_locked()

        with self._lock:
            excluded_paths = set(self._settings.get("ocr_excluded_paths") or ())
        if _is_path_ocr_excluded(path, excluded_paths):
            with self._lock:
                item = self._ledger["items"].get(key)
                if item is not None:
                    self._touch(item, state="skipped", error="OCR 제외 설정됨", signature=self._signature(path))
            return
        if os.path.splitext(path)[1].casefold() != ".pdf":
            # EPUB 등 비-PDF 문서는 백그라운드 OCR을 실행하지 않는다.
            with self._lock:
                item = self._ledger["items"].get(key)
                if item is not None:
                    self._touch(
                        item,
                        state="skipped",
                        error="PDF가 아니므로 백그라운드 OCR 대상이 아닙니다.",
                        signature=self._signature(path),
                    )
            return

        try:
            status = self._ocr_status(path, rebuild_native_index=False)
        except Exception as error:
            with self._lock:
                item = self._ledger["items"].get(key)
                if item is not None:
                    self._touch(item, state="failed", error=str(error)[:300], attempts=int(item.get("attempts") or 0) + 1, next_retry_at=0.0)
            return
        with self._lock:
            item = self._ledger["items"].get(key)
        source = str((item or {}).get("source") or "")
        if status.get("has_text") and not status.get("index_repair_required"):
            reason = _background_ocr_target_reason(
                status,
                source,
                re_ocr_non_ails=bool(self._settings.get("ocr_non_ails", False)),
                path=path,
            )
            if reason is None:
                with self._lock:
                    item = self._ledger["items"].get(key)
                    if item is not None:
                        self._touch(item, state="skipped", error="", signature=self._signature(path))
                return
        else:
            reason = None
        # 텍스트 레이어가 이미 있는 문서(레거시 OCR 업그레이드·프레젠테이션
        # 변환 PDF)는 force로 다시 OCR해 새 텍스트 레이어와 분석 payload를
        # 원본 PDF에 다시 기록한다.
        force = bool(status.get("has_text"))
        if reason:
            with self._lock:
                item = self._ledger["items"].get(key)
                if item is not None:
                    self._touch(item, error=reason)
        try:
            model_variant = self._resolve_ocr_model(
                model_variant=str(self._settings.get("ocr_model_variant") or "auto"),
                allow_cpu=False,
                language=str(self._settings.get("language") or "korean"),
            )
        except Exception as error:
            with self._lock:
                item = self._ledger["items"].get(key)
                if item is not None:
                    self._touch(
                        item,
                        state="blocked",
                        error=f"{OCR_RUNTIME_UNAVAILABLE} ({str(error)[:200]})",
                        attempts=int(item.get("attempts") or 0) + 1,
                        next_retry_at=0.0,
                    )
            return
        try:
            result = self._run_ocr(
                path,
                language=str(self._settings.get("language") or "korean"),
                model_variant=model_variant,
                emit=record,
                force=force,
                priority=GpuPriority.BACKGROUND,
                # 프레젠테이션 변환 PDF은 텍스트 레이어가 없는 슬라이드만 OCR한다.
                only_textless_pages=is_presentation_pdf(path, source),
            )
        except FileNotFoundError:
            with self._lock:
                item = self._ledger["items"].get(key)
                if item is not None:
                    self._touch(item, state="failed", error="파일을 찾을 수 없습니다.")
            return
        except Exception as error:
            with self._lock:
                item = self._ledger["items"].get(key)
                if item is not None:
                    attempts = int(item.get("attempts") or 0) + 1
                    self._touch(item, state="failed", error=str(error)[:300], attempts=attempts, next_retry_at=0.0)
            return
        skipped = bool(isinstance(result, Mapping) and result.get("skipped"))
        with self._lock:
            item = self._ledger["items"].get(key)
            if item is not None:
                self._touch(
                    item,
                    state="skipped" if skipped else "done",
                    error="",
                    signature=self._signature(path),
                    progress=None,
                    done_at="" if skipped else time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                )
                if not skipped and self._settings["embedding_enabled"]:
                    # OCR로 텍스트가 생겼으니 임베딩을 이어서 진행한다.
                    self._reset_embedding_item_locked(path)
        if skipped or self._on_document_ocr_complete is None:
            return
        try:
            self._on_document_ocr_complete(path)
        except Exception:
            pass

    # ------------------------------------------------------------------
    # 상태 공개
    # ------------------------------------------------------------------

    def status(self) -> dict[str, Any]:
        with self._lock:
            self._prune_disabled_work_locked()
            self._prune_pdf_work_temps_locked()
            excluded_paths = set(self._settings.get("ocr_excluded_paths") or ())
            counts: dict[str, dict[str, int]] = {
                "embedding": {},
                "translation": {},
                "ocr": {},
                "evaluating": {},
            }
            for item in self._ledger["items"].values():
                kind = item["kind"]
                st = item["state"]
                if not self._work_enabled_locked(kind) and st not in {"done", "skipped"}:
                    continue
                if kind == "ocr" and _is_path_ocr_excluded(item["path"], excluded_paths):
                    st = "skipped"
                bucket = counts.setdefault(kind, {})
                bucket[st] = bucket.get(st, 0) + 1

            for c in self._eval_items.values():
                st = c.get("state", "pending")
                if _is_path_ocr_excluded(c["path"], excluded_paths):
                    st = "skipped"
                counts["evaluating"][st] = counts["evaluating"].get(st, 0) + 1

            current_ocr = None
            for item in self._ledger["items"].values():
                if item["kind"] == "ocr" and item["state"] == "running":
                    if not self._settings["ocr_enabled"]:
                        continue
                    if _is_path_ocr_excluded(item["path"], excluded_paths):
                        continue
                    progress = item.get("progress") or {}
                    current_ocr = {
                        "path": item["path"],
                        "page": int(progress.get("page") or 0),
                        "total": int(progress.get("total") or 0),
                    }
                    break
            return {
                "settings": dict(self._settings),
                "counts": counts,
                "last_scan_at": self._ledger.get("last_scan_at") or "",
                "current_ocr": current_ocr,
                "current_translation": next((_translation_public_item(item)
                    for item in self._ledger["items"].values()
                    if self._settings["translation_enabled"] and item["kind"] == "translation" and item["state"] == "running"), None),
            }

    def queue_details(self) -> dict[str, Any]:
        """현재 대기 중이거나 진행 중인 문서들의 상세 목록을 반환한다."""
        with self._lock:
            self._prune_disabled_work_locked()
            self._prune_pdf_work_temps_locked()
            excluded_paths = set(self._settings.get("ocr_excluded_paths") or ())
            current_ocr = None
            evaluating_items: list[dict[str, Any]] = []
            ocr_pending_items: list[dict[str, Any]] = []
            ocr_failed_items: list[dict[str, Any]] = []
            embedding_pending_items: list[dict[str, Any]] = []
            translation_items: list[dict[str, Any]] = []

            # 1. 판정 큐에서 대기/판정 중인 문서
            for item in self._eval_items.values():
                st = item.get("state", "pending")
                p = str(item.get("path") or "")
                if _is_path_ocr_excluded(p, excluded_paths):
                    continue
                if st in {"pending", "evaluating"}:
                    evaluating_items.append({
                        "path": p,
                        "file_name": os.path.basename(p),
                        "state": st,
                        "source": str(item.get("source") or ""),
                        "is_presentation": bool(item.get("is_presentation", False)),
                    })

            # 2. OCR / 임베딩 큐에서 대기/실행 중인 문서
            for item in self._ledger["items"].values():
                kind = item.get("kind")
                st = item.get("state")
                if not self._work_enabled_locked(kind):
                    continue
                p = str(item.get("path") or "")
                if kind == "ocr":
                    if _is_path_ocr_excluded(p, excluded_paths):
                        continue
                    if st == "running":
                        progress = item.get("progress") or {}
                        current_ocr = {
                            "path": p,
                            "file_name": os.path.basename(p),
                            "page": int(progress.get("page") or 0),
                            "total": int(progress.get("total") or 0),
                        }
                    if st in {"pending", "running"}:
                        ocr_pending_items.append({
                            "path": p,
                            "file_name": os.path.basename(p),
                            "state": st,
                            "reason": str(item.get("error") or ""),
                            "attempts": int(item.get("attempts") or 0),
                        })
                    elif st in {"failed", "blocked"}:
                        # 자동 재시도하지 않는 실패·차단 항목도 원인과 함께 노출한다.
                        ocr_failed_items.append({
                            "path": p,
                            "file_name": os.path.basename(p),
                            "state": st,
                            "error": str(item.get("error") or ""),
                            "attempts": int(item.get("attempts") or 0),
                            "next_retry_at": float(item.get("next_retry_at") or 0.0),
                        })
                elif kind == "translation" and st != "done":
                    translation_items.append(_translation_public_item(item))
                elif kind == "embedding" and st in {"pending", "running"}:
                    embedding_pending_items.append({
                        "path": p,
                        "file_name": os.path.basename(p),
                        "state": st,
                        "attempts": int(item.get("attempts") or 0),
                    })

            return {
                "current_ocr": current_ocr,
                "evaluating": evaluating_items,
                "ocr_pending": ocr_pending_items,
                "ocr_failed": ocr_failed_items,
                "embedding_pending": embedding_pending_items,
                "translation_pending": translation_items,
                "spacing_pending": self._spacing_queue_locked(),
                "total_waiting": sum(i["state"] in {"pending", "running"} for i in self._spacing_queue_locked()) + len(evaluating_items) + len(ocr_pending_items) + len(embedding_pending_items)
                    + sum(item["state"] in {"pending", "running"} for item in translation_items),
            }


_compatibility_manager = None
_compatibility_manager_lock = threading.Lock()


def __getattr__(name):
    if name != "BACKGROUND_DOCUMENT_WORK":
        raise AttributeError(name)
    global _compatibility_manager
    with _compatibility_manager_lock:
        if _compatibility_manager is None:
            _compatibility_manager = BackgroundDocumentWorkManager()
        return _compatibility_manager


def _theory_search():
    import chat.theory_search as theory_search

    return theory_search
