"""PracticeGeneration: one feature workflow and its explicitly supplied collaborators."""
from __future__ import annotations
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from common import PROVIDER_GEMINI
from common import resolve_app_path
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import as_completed
from contextlib import nullcontext
from documents.material_catalog_rules import LECTURE_REPORT_RE
from documents.material_catalog_rules import NEW_LECTURE_REPORT_RE
from documents.material_catalog_rules import ensure_safe_material_dir
from documents.material_file_policy import ensure_safe_material_path
from documents.material_practice_lock import PRACTICE_SET_LOCK
from documents.material_practice_service import distribute_practice_counts
from documents.material_practice_service import format_practice_markdown
from documents.material_practice_service import material_practice_output_dir
from documents.material_practice_service import practice_set_summary
from documents.material_practice_service import publish_practice_set
from documents.material_practice_service import sanitize_material_child_name
from documents.material_practice_service import unique_material_path
from documents.material_practice_service import validate_generated_quiz
from pipeline_utils import build_quiz_source_text
from pipeline_utils import build_runtime_summary_config
from system_storage import visible_data_folder
import ai_compliance
import ai_model_selection
import documents.material_practice_context
import documents.material_practice_service
import documents.paperback_document
import documents.presentation_service
import edition_manifest
import os
import pipeline_utils
import providers
import re
import threading
import uuid


_PRACTICE_EVENT_INIT_LOCK = threading.Lock()


@dataclass(frozen=True)
class PracticeGenerationPorts:
    call_managed_gateway_chat: Callable[..., Any]
    invalidate_lecture_materials_cache: Callable[..., Any]
    lecture_materials: Callable[..., Any]
    list_pdf_chat_turns: Callable[..., Any]
    local_provider_model: Callable[..., Any]
    managed_ai_action: Callable[..., Any]
    managed_workflow_options: Callable[..., Any]
    memory_enabled: Callable[..., Any]
    memory_service: Callable[..., Any]
    pdf_study_document_info: Callable[..., Any]
    read_material_file: Callable[..., Any]
    refresh_reports_from_disk: Callable[..., Any]
    refresh_retry_candidates_from_disk: Callable[..., Any]
    resolve_chatbot_openai_config: Callable[..., Any]
    verified_memory_user_id: Callable[..., Any]
    workflow_uses_managed_ai: Callable[..., Any]
    get_config: Callable[..., Any]
    get_lecture_materials_cache_lock: Callable[..., Any]


class PracticeGeneration:
    def __init__(self, ports: PracticeGenerationPorts):
        self._ports = ports
        self.call_managed_gateway_chat = ports.call_managed_gateway_chat
        self.invalidate_lecture_materials_cache = ports.invalidate_lecture_materials_cache
        self.lecture_materials = ports.lecture_materials
        self.list_pdf_chat_turns = ports.list_pdf_chat_turns
        self.local_provider_model = ports.local_provider_model
        self.managed_ai_action = ports.managed_ai_action
        self.managed_workflow_options = ports.managed_workflow_options
        self.memory_enabled = ports.memory_enabled
        self.memory_service = ports.memory_service
        self.pdf_study_document_info = ports.pdf_study_document_info
        self.read_material_file = ports.read_material_file
        self.refresh_reports_from_disk = ports.refresh_reports_from_disk
        self.refresh_retry_candidates_from_disk = ports.refresh_retry_candidates_from_disk
        self.resolve_chatbot_openai_config = ports.resolve_chatbot_openai_config
        self.verified_memory_user_id = ports.verified_memory_user_id
        self.workflow_uses_managed_ai = ports.workflow_uses_managed_ai
        self._material_practice_events_lock = threading.Lock()
        self._material_practice_active_events = {}
        self._closed = False

    def close(self):
        with self._material_practice_events_lock:
            self._closed = True
            for event in self._material_practice_active_events.values():
                event.set()

    @property
    def config(self):
        return self._ports.get_config()

    @property
    def lecture_materials_cache_lock(self):
        return self._ports.get_lecture_materials_cache_lock()

    def _material_practice_events(self):
        if not hasattr(self, "_material_practice_events_lock"):
            with _PRACTICE_EVENT_INIT_LOCK:
                if not hasattr(self, "_material_practice_events_lock"):
                    self._material_practice_events_lock = threading.Lock()
                    self._material_practice_active_events = {}
        return self._material_practice_events_lock, self._material_practice_active_events

    def cancel_material_practice_generation(self, payload: dict):
        generation_id = str(payload.get("generation_id") or "").strip()
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", generation_id):
            raise ValueError("generation_id is invalid.")
        lock, events = self._material_practice_events()
        with lock:
            event = events.get(generation_id)
            if event is not None:
                event.set()
        return {"cancelled": event is not None, "generation_id": generation_id}

    def cancel_all_material_practice_generations(self):
        lock, events = self._material_practice_events()
        with lock:
            for event in events.values():
                event.set()
            return {"cancelled_count": len(events)}

    def generate_material_practice(self, payload: dict):
        generation_id = str(payload.get("generation_id") or uuid.uuid4().hex).strip()
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", generation_id):
            raise ValueError("generation_id is invalid.")
        lock, events = self._material_practice_events()
        event = threading.Event()
        with lock:
            if self._closed:
                raise RuntimeError("Practice generation has closed")
            if generation_id in events:
                raise ValueError("generation_id is already in use.")
            events[generation_id] = event
        try:
            return self._generate_material_practice_impl(payload, generation_id, event)
        finally:
            with lock:
                events.pop(generation_id, None)

    def _generate_material_practice_impl(self, payload: dict, generation_id: str, cancel_event: threading.Event):
        base_dir = resolve_app_path(self.config.get("md_save_path", ""))
        folder_path = ensure_safe_material_dir(payload.get("folder_path", "") or payload.get("path", ""), base_dir)
        context_module = documents.material_practice_context
        sources = context_module.normalize_context_sources(payload.get("context_sources"))
        reference_pdfs = context_module.normalize_reference_pdfs(payload.get("reference_pdf_paths"), base_dir)
        home_chat = context_module.normalize_home_chat(payload.get("home_chat")) if sources["chat"] else []

        def check_generation_ready():
            if cancel_event.is_set():
                raise RuntimeError("Practice generation was cancelled.")
            ai_compliance.require_external_ai_consent(
                "/api/material-practice/generate",
                self.config,
                ai_compliance.compliance_metadata(edition_manifest.EDITION_MANIFEST),
            )

        check_generation_ready()
        raw_file_counts = payload.get("file_counts")
        file_counts: dict[str, int] = {}
        if isinstance(raw_file_counts, dict):
            for raw_path, raw_count in raw_file_counts.items():
                try:
                    file_count = int(raw_count)
                except (TypeError, ValueError):
                    continue
                if file_count <= 0:
                    continue
                file_path = ensure_safe_material_path(str(raw_path or ""), base_dir)
                if os.path.splitext(file_path)[1].lower() != ".md":
                    continue
                try:
                    common = os.path.commonpath([file_path, folder_path])
                except ValueError:
                    common = ""
                if os.path.normcase(common) != os.path.normcase(folder_path):
                    raise ValueError("Selected markdown files must be inside the selected folder.")
                file_counts[file_path] = max(1, min(file_count, 100))

        raw_week_counts = payload.get("week_counts")
        week_counts: dict[int, int] = {}
        if isinstance(raw_week_counts, dict):
            for raw_week, raw_count in raw_week_counts.items():
                if not str(raw_week).strip().isdigit():
                    continue
                week = int(raw_week)
                try:
                    week_count = int(raw_count)
                except (TypeError, ValueError):
                    continue
                if week_count > 0:
                    week_counts[week] = max(1, min(week_count, 100))

        raw_weeks = payload.get("week_numbers", payload.get("weeks", []))
        if file_counts:
            week_numbers = []
            count = sum(file_counts.values())
        elif week_counts:
            week_numbers = sorted(week_counts)
            count = sum(week_counts.values())
        else:
            if not isinstance(raw_weeks, list):
                raise ValueError("week_numbers must be a list.")
            week_numbers = sorted({int(week) for week in raw_weeks if str(week).strip().isdigit()})
            try:
                count = int(payload.get("count", 10))
            except (TypeError, ValueError):
                count = 10
            count = max(1, min(count, 100))
            if week_numbers:
                distributed_week_counts = distribute_practice_counts(count, len(week_numbers))
                week_counts = {week: distributed_week_counts[index] for index, week in enumerate(week_numbers)}
        if not week_numbers and not file_counts:
            raise ValueError("Select at least one week.")

        folder_name = os.path.basename(folder_path)
        report_entries = []
        if file_counts:
            for file_path in file_counts:
                file_name = os.path.basename(file_path)
                match = LECTURE_REPORT_RE.match(file_name)
                new_match = NEW_LECTURE_REPORT_RE.match(file_name)
                if match:
                    week = int(match.group("week"))
                    sequence = int(match.group("sequence"))
                elif new_match:
                    week = int(new_match.group("week"))
                    sequence = int(new_match.group("sequence"))
                else:
                    week = None
                    sequence = 0
                report_entries.append((week, sequence, file_path, file_name))
        else:
            for root, dirs, files in os.walk(folder_path):
                dirs[:] = [name for name in dirs if visible_data_folder(os.path.join(root, name))]
                for file_name in files:
                    match = LECTURE_REPORT_RE.match(file_name)
                    new_match = NEW_LECTURE_REPORT_RE.match(file_name)
                    if not match and not new_match:
                        continue
                    active_match = match if match else new_match
                    week = int(active_match.group("week"))
                    if week not in week_numbers:
                        continue
                    report_entries.append((week, int(active_match.group("sequence")), os.path.join(root, file_name), file_name))
        report_entries.sort(key=lambda item: (item[0] is None, item[0] or 0, item[1], item[3]))
        if not report_entries:
            raise FileNotFoundError("No matching markdown files were found for the selected options.")

        report_payloads = []
        reports_by_week: dict[int, list[dict]] = {}
        for week, sequence, report_path, file_name in report_entries:
            report_path = ensure_safe_material_path(report_path, base_dir)
            with open(report_path, "r", encoding="utf-8", errors="replace") as handle:
                content = handle.read()
            report_payload = {
                "week": week,
                "sequence": sequence,
                "path": report_path,
                "file_name": file_name,
                "content": content,
            }
            report_payloads.append(report_payload)
            if week is not None:
                reports_by_week.setdefault(week, []).append(report_payload)

        context_records: dict[str, list[dict]] = {name: [] for name in context_module.SOURCE_NAMES}
        context_records["_pdf_count"] = len(reference_pdfs)
        context_failures: dict[str, str] = {}
        partial_failures = set()
        if sources["chat"]:
            if reference_pdfs:
                failed = 0
                for pdf_path in reference_pdfs:
                    try:
                        turns = self.list_pdf_chat_turns({"pdf_path": pdf_path}).get("turns", [])
                        for turn in turns:
                            context_records["chat"].append({
                                "id": str(turn.get("turn_id") or ""),
                                # Saved assistant answers are read only to find
                                # MD-overlapping topic labels, never sent raw.
                                "text": (
                                    f"{str(turn.get('question') or '')[:1000]}\n"
                                    f"{str(turn.get('concept_summary') or '')[:1000]}\n"
                                    f"{str(turn.get('answer') or '')[:4000]}"
                                ),
                            })
                    except Exception:
                        failed += 1
                for message in home_chat:
                    context_records["chat"].append({"id": message["id"], "text": message["content"]})
                if failed and not context_records["chat"]:
                    context_failures["chat"] = "read_error"
                elif failed:
                    partial_failures.add("chat")
            else:
                for message in home_chat:
                    context_records["chat"].append({"id": message["id"], "text": message["content"]})
        if sources["bookmarks"] and reference_pdfs:
            failed = 0
            for pdf_path in reference_pdfs:
                try:
                    document_info = self.pdf_study_document_info({"pdf_path": pdf_path})
                    context_records["bookmarks"].extend(context_module.bookmarked_page_records(pdf_path, document_info))
                except Exception:
                    failed += 1
            if failed and not context_records["bookmarks"]:
                context_failures["bookmarks"] = "read_error"
            elif failed:
                partial_failures.add("bookmarks")
        if sources["memory"]:
            if not self.memory_enabled():
                context_failures["memory"] = "memory_disabled"
            else:
                try:
                    # memory_service verifies /me and opens only that user's DB.
                    memory_service = self.memory_service()
                except Exception:
                    try:
                        self.verified_memory_user_id()
                    except Exception:
                        context_failures["memory"] = "account_unverified"
                    else:
                        context_failures["memory"] = "read_error"
                else:
                    try:
                        memory_items = memory_service.list_items()
                    except Exception:
                        context_failures["memory"] = "read_error"
                    else:
                        context_records["memory"] = [
                            {"id": item.id, "text": f"{item.subject}\n{item.content}\n{' '.join(item.keywords)}"}
                            for item in reversed(memory_items) if item.status == "active"
                        ]
        context_usage = {}
        for report_payload in report_payloads:
            labels, usage = context_module.topic_hints_for_markdown(
                report_payload["content"], context_records, sources, context_failures,
            )
            for source in partial_failures:
                usage[source]["skipped_reasons"].append("read_error")
            report_payload["topic_hints"] = labels
            context_usage[report_payload["path"]] = usage

        use_managed = self.workflow_uses_managed_ai("practice_generation")
        if use_managed:
            quiz_cfg = None
        else:
            provider, model_name = self.local_provider_model("practice_generation")
            quiz_cfg = build_runtime_summary_config(self.config, provider=provider, model_name=model_name)
        report_targets = []
        if file_counts:
            for report_payload in report_payloads:
                report_targets.append((report_payload, file_counts[report_payload["path"]]))
        else:
            for week in week_numbers:
                week_reports = reports_by_week.get(week, [])
                for report_payload, report_count in zip(week_reports, distribute_practice_counts(week_counts.get(week, 1), len(week_reports))):
                    report_targets.append((report_payload, report_count))

        def generate_for_report(index: int, report_payload: dict, report_count: int):
            if report_payload["week"] is None:
                heading = f"# {os.path.splitext(report_payload['file_name'])[0]}\n\n"
            else:
                heading = f"# {folder_name} {report_payload['week']}주차 {report_payload['sequence']}정리본\n\n"
            quiz_source = build_quiz_source_text(f"{heading}{report_payload['content']}", max_chars=12000)
            prompt = pipeline_utils.build_quiz_generation_prompt(
                report_count, quiz_source, language=self.config.get("language"),
                topic_hints=report_payload["topic_hints"],
            )
            check_generation_ready()
            if managed_session:
                response_text, usage = self.call_managed_gateway_chat(
                    managed_session,
                    [{"role": "user", "content": prompt}],
                    timeout=120,
                    max_retries=1,
                    cancel_check=check_generation_ready,
                )
                actual_model = managed_session["model_id"]
            elif provider == PROVIDER_GEMINI:
                response_text, actual_model, usage = providers.call_ai_summary(
                    prompt, {**quiz_cfg, "_cancel_check": check_generation_ready}, log_list=None,
                )
            else:
                base_url, api_key, actual_model, label, allow_empty = self.resolve_chatbot_openai_config(provider, model_name)
                check_generation_ready()
                response_text, usage = pipeline_utils.call_openai_compatible_chat(
                    base_url, api_key, actual_model, [{"role": "user", "content": prompt}],
                    provider_label=f"{label} practice generation",
                    allow_empty_api_key=allow_empty, timeout=120, max_retries=1,
                    cancel_check=check_generation_ready,
                )
            raw_items = documents.material_practice_service.parse_quiz_response_items(response_text)
            items = []
            excluded = []
            for raw_item in raw_items:
                item, reason = validate_generated_quiz(
                    raw_item, report_payload["content"], report_payload["file_name"]
                )
                if item is None:
                    excluded.append(f"{report_payload['file_name']}: {reason}")
                else:
                    items.append(item)
            return {
                "index": index,
                "week": report_payload["week"],
                "file_name": report_payload["file_name"],
                "items": items[:report_count],
                "excluded": excluded,
                "model": actual_model,
                "usage": usage or {},
            }

        results = []
        errors = []
        excluded_count = 0
        max_workers = min(len(report_targets), 6)
        action = (
            self.managed_ai_action(
                "practice_generation",
                ai_model_selection.MANAGED_AI_ACTION_ESTIMATE_USD * max(1, len(report_targets)),
                **self.managed_workflow_options("practice_generation"),
            )
            if use_managed
            else nullcontext(None)
        )
        check_generation_ready()
        with action as managed_session:
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                futures = [
                    executor.submit(generate_for_report, index, report_payload, report_count)
                    for index, (report_payload, report_count) in enumerate(report_targets)
                ]
                for future in as_completed(futures):
                    if cancel_event.is_set():
                        for pending in futures:
                            pending.cancel()
                        continue
                    try:
                        results.append(future.result())
                    except Exception as error:
                        errors.append(str(error))
                        if isinstance(error, ai_compliance.AIConsentRequired):
                            cancel_event.set()

        check_generation_ready()

        results.sort(key=lambda item: item["index"])
        quizzes = []
        source_names = [report_payload["file_name"] for report_payload in report_payloads]
        model_names = []
        quizzes_by_week: dict[int, list[dict]] = {}
        for result in results:
            errors.extend(result.get("excluded", []))
            excluded_count += len(result.get("excluded", []))
            if result.get("model"):
                model_names.append(str(result["model"]))
            if file_counts or result.get("week") is None:
                quizzes.extend(result["items"])
            else:
                quizzes_by_week.setdefault(int(result["week"]), []).extend(result["items"])
        for week in week_numbers:
            quizzes.extend(quizzes_by_week.get(week, [])[: week_counts.get(week, 0)])
        if not quizzes:
            details = f": {'; '.join(errors[:3])}" if errors else "."
            raise ValueError(f"The quiz model did not return any valid questions{details}")

        week_label = ",".join(f"{week}주차" for week in week_numbers) if week_numbers else "선택파일"
        output_title = str(payload.get("output_name", "") or "").strip() or f"{folder_name}_{week_label}_연습문제"
        output_name = sanitize_material_child_name(output_title, allow_extension=True)
        if not output_name.lower().endswith(".md"):
            output_name = f"{output_name}.md"
        output_dir = material_practice_output_dir(
            folder_path,
            base_dir,
            [report_payload["path"] for report_payload in report_payloads],
        )
        if os.path.normcase(os.path.commonpath([os.path.realpath(output_dir), os.path.realpath(base_dir)])) != os.path.normcase(os.path.realpath(base_dir)):
            raise ValueError("Practice output must remain inside the learning material root.")
        lock, events = self._material_practice_events()
        with PRACTICE_SET_LOCK:
            # Cancellation and publication have one ordering point. A cancel
            # accepted before this lock prevents publication; a later cancel
            # reports that the job is already committed.
            with lock:
                check_generation_ready()
                events.pop(generation_id, None)
                output_path = unique_material_path(output_dir, output_name)
                markdown = format_practice_markdown(
                    os.path.splitext(os.path.basename(output_path))[0],
                    source_names,
                    quizzes,
                    {
                        "model": ", ".join(dict.fromkeys(model_names)) or "unknown",
                        "errors": errors,
                        "request_count": len(report_payloads),
                    },
                )
                practice_set = publish_practice_set(output_path, markdown, quizzes, context_usage)
        self.refresh_reports_from_disk()
        self.refresh_retry_candidates_from_disk()
        if hasattr(self, "lecture_materials_cache_lock"):
            self.invalidate_lecture_materials_cache()
        return {
            "file": self.read_material_file(output_path),
            "output_path": output_path,
            "count": len(quizzes),
            "practice_set": practice_set_summary(output_path),
            "generation_id": generation_id,
            "context_usage": context_usage,
            "excluded_count": excluded_count,
            "excluded_reasons": errors,
            "materials": self.lecture_materials(),
        }
