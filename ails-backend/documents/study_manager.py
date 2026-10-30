from __future__ import annotations
from chat.answer_evidence import normalize_evidence
from documents.study_chat_context import encode_study_chat_context, decode_study_chat_context
from documents.study_web_sources import encode_web_sources, decode_web_sources

import hashlib
import json
import math
import os
import re
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Mapping


SCHEMA_VERSION = 6

# 세션은 열린 뒤 60초가 지나야 1회로 집계한다.
SESSION_MIN_SECONDS = 60.0
# 하나의 활동 이벤트가 가져갈 수 있는 최대 학습 시간(초).
MAX_ACTIVITY_SECONDS_PER_EVENT = 120.0
MAX_DOCUMENT_NOTE_LENGTH = 20_000
MAX_DOCUMENT_TAGS = 20
MAX_DOCUMENT_TAG_LENGTH = 60

_schema_lock = threading.Lock()


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso_time(value: datetime | None = None) -> str:
    return (value or _utc_now()).astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _parse_time(value: Any) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _normalized_pdf_path(value: Any) -> str:
    path = os.path.abspath(str(value or "").strip())
    if not str(value or "").strip():
        raise ValueError("pdf_path is required.")
    if not os.path.isfile(path):
        raise FileNotFoundError(f"PDF file was not found: {path}")
    return path


def _document_identity(pdf_path: str) -> tuple[str, int, int]:
    stat = os.stat(pdf_path)
    identity = "\0".join((
        os.path.normcase(os.path.abspath(pdf_path)),
        str(int(stat.st_size)),
        str(int(stat.st_mtime_ns)),
    ))
    return hashlib.sha256(identity.encode("utf-8", errors="replace")).hexdigest(), int(stat.st_size), int(stat.st_mtime_ns)


def _stored_document_id(db_path: str, normalized_pdf: str) -> str | None:
    """Find a document row by its stored path when the source PDF is gone."""
    target = os.path.normcase(normalized_pdf)
    with _database(db_path) as connection:
        rows = connection.execute(
            "SELECT document_id, pdf_path FROM study_documents"
        ).fetchall()
    for row in rows:
        stored = os.path.abspath(str(row["pdf_path"] or ""))
        if os.path.normcase(stored) == target:
            return row["document_id"]
    return None


def _resolve_document_id(db_path: str, pdf_path: Any) -> tuple[str, str]:
    """Return (document_id, normalized_pdf), tolerating a deleted/moved source.

    Read/delete flows must stay usable after the source PDF disappeared;
    write flows still require the file so new records anchor to real PDFs.
    """
    raw = str(pdf_path or "").strip()
    if not raw:
        raise ValueError("pdf_path is required.")
    normalized = os.path.abspath(raw)
    if os.path.isfile(normalized):
        return _document_identity(normalized)[0], normalized
    stored = _stored_document_id(db_path, normalized)
    if stored is not None:
        return stored, normalized
    raise FileNotFoundError(f"PDF file was not found: {normalized}")


def _bounded_text(value: Any, limit: int) -> str:
    return str(value or "").strip()[:limit]


def _required_text(value: Any, *, name: str, limit: int) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"{name} is required.")
    if len(text) > limit:
        raise ValueError(f"{name} is too long.")
    return text


def _positive_int(value: Any, *, name: str, maximum: int = 1_000_000) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{name} must be an integer.") from error
    if parsed < 1 or parsed > maximum:
        raise ValueError(f"{name} is outside the supported range.")
    return parsed


def _annotation_number(value: Any, *, name: str, minimum: float, maximum: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{name} must be a number.") from error
    if not math.isfinite(number) or number < minimum or number > maximum:
        raise ValueError(f"{name} is outside the supported range.")
    return round(number, 7)


def _annotation_seed(value: Any, annotation_id: str) -> int:
    if value in (None, ""):
        hash_value = 2166136261
        encoded_id = annotation_id.encode("utf-16-le")
        for offset in range(0, len(encoded_id), 2):
            hash_value ^= int.from_bytes(encoded_id[offset:offset + 2], "little")
            hash_value = hash_value * 16777619 & 0xFFFFFFFF
        return hash_value & 0x7FFFFFFF or 1
    if isinstance(value, bool):
        raise ValueError("annotation seed must be an integer.")
    try:
        seed = int(value)
    except (TypeError, ValueError) as error:
        raise ValueError("annotation seed must be an integer.") from error
    if str(seed) != str(value).strip() or seed < 1 or seed > 0x7FFFFFFF:
        raise ValueError("annotation seed is outside the supported range.")
    return seed


def _normalize_annotation(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, Mapping):
        raise ValueError("annotation must be an object.")
    annotation_id = _required_text(payload.get("annotation_id"), name="annotation_id", limit=160)
    page = _positive_int(payload.get("page"), name="page")
    kind = str(payload.get("kind") or "").strip().lower()
    if kind not in {"stroke", "line", "ellipse", "connector", "text", "highlight", "underline"}:
        raise ValueError("annotation kind is not supported.")
    seed = _annotation_seed(payload.get("seed"), annotation_id)
    color = str(payload.get("color") or "").strip().lower()
    if re.fullmatch(r"#[0-9a-f]{6}", color) is None:
        raise ValueError("annotation color must be a six-digit hex color.")
    stroke_width = _annotation_number(
        payload.get("stroke_width", 3),
        name="stroke_width",
        minimum=0.5,
        maximum=40,
    )
    font_size = _annotation_number(
        payload.get("font_size", 16),
        name="font_size",
        minimum=8,
        maximum=96,
    )
    text = str(payload.get("text") or "").strip()
    if len(text) > 20_000:
        raise ValueError("annotation text is too long.")

    raw_points = payload.get("points") or []
    raw_rects = payload.get("rects") or []
    if not isinstance(raw_points, list) or len(raw_points) > 10_000:
        raise ValueError("annotation points are invalid.")
    if not isinstance(raw_rects, list) or len(raw_rects) > 100:
        raise ValueError("annotation rectangles are invalid.")
    coordinate_minimum = -2 if kind == "connector" else 0
    coordinate_maximum = 3 if kind == "connector" else 1
    points: list[dict[str, float]] = []
    for index, point in enumerate(raw_points):
        if not isinstance(point, Mapping):
            raise ValueError("annotation point must be an object.")
        normalized_point = {
            "x": _annotation_number(point.get("x"), name=f"points[{index}].x", minimum=coordinate_minimum, maximum=coordinate_maximum),
            "y": _annotation_number(point.get("y"), name=f"points[{index}].y", minimum=coordinate_minimum, maximum=coordinate_maximum),
        }
        if point.get("pressure") not in (None, ""):
            normalized_point["pressure"] = _annotation_number(
                point.get("pressure"),
                name=f"points[{index}].pressure",
                minimum=0,
                maximum=1,
            )
        points.append(normalized_point)
    rects: list[dict[str, float]] = []
    for index, rect in enumerate(raw_rects):
        if not isinstance(rect, Mapping):
            raise ValueError("annotation rectangle must be an object.")
        normalized_rect = {
            "x": _annotation_number(rect.get("x"), name=f"rects[{index}].x", minimum=coordinate_minimum, maximum=coordinate_maximum),
            "y": _annotation_number(rect.get("y"), name=f"rects[{index}].y", minimum=coordinate_minimum, maximum=coordinate_maximum),
            "width": _annotation_number(rect.get("width"), name=f"rects[{index}].width", minimum=0, maximum=1),
            "height": _annotation_number(rect.get("height"), name=f"rects[{index}].height", minimum=0, maximum=1),
        }
        if kind != "connector" and (
            normalized_rect["x"] + normalized_rect["width"] > 1.0000001
            or normalized_rect["y"] + normalized_rect["height"] > 1.0000001
        ):
            raise ValueError("annotation rectangle must stay inside the PDF page.")
        rects.append(normalized_rect)

    if kind == "stroke" and not points:
        raise ValueError("drawn annotations require points.")
    if kind == "line" and len(points) != 2:
        raise ValueError("line annotations require two points.")
    if kind == "ellipse" and (
        len(rects) != 1 or rects[0]["width"] <= 0 or rects[0]["height"] <= 0
    ):
        raise ValueError("ellipse annotations require one rectangle.")
    if kind == "connector" and (
        len(points) < 2
        or not rects
        or any(rect["width"] <= 0 or rect["height"] <= 0 for rect in rects)
    ):
        raise ValueError("connector annotations require a path and selected text rectangles.")
    if kind in {"highlight", "underline"} and (
        not rects or any(rect["width"] <= 0 or rect["height"] <= 0 for rect in rects)
    ):
        raise ValueError("text mark annotations require selected text rectangles.")
    if kind == "text" and (not text or len(points) != 1):
        raise ValueError("text annotations require text and one position.")
    pinned = payload.get("pinned", True)
    if kind == "text" and not isinstance(pinned, bool):
        raise ValueError("annotation pinned must be a boolean.")
    return {
        "annotation_id": annotation_id,
        "page": page,
        "kind": kind,
        "seed": seed,
        "color": color,
        "stroke_width": stroke_width,
        "font_size": font_size,
        "text": text,
        "points": points,
        "rects": rects,
        **({"pinned": pinned} if kind == "text" else {}),
    }


def _connect(db_path: str) -> sqlite3.Connection:
    connection = sqlite3.connect(db_path, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA synchronous=NORMAL")
    connection.execute("PRAGMA foreign_keys=ON")
    return connection


@contextmanager
def _database(db_path: str):
    connection = _connect(db_path)
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


class StudyStore:
    def __init__(self, db_path: str):
        normalized = os.path.abspath(str(db_path or "").strip())
        if not str(db_path or "").strip():
            raise ValueError("Study storage path is not configured.")
        os.makedirs(os.path.dirname(normalized), exist_ok=True)
        self.db_path = normalized
        self._ensure_schema()

    def _ensure_schema(self):
        with _schema_lock, _database(self.db_path) as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS study_documents (
                    document_id TEXT PRIMARY KEY,
                    pdf_path TEXT NOT NULL,
                    file_size INTEGER NOT NULL,
                    mtime_ns INTEGER NOT NULL,
                    first_seen_at TEXT NOT NULL,
                    last_seen_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS study_sessions (
                    session_id TEXT PRIMARY KEY,
                    document_id TEXT NOT NULL,
                    chapter_id TEXT NOT NULL,
                    chapter_title TEXT NOT NULL,
                    start_page INTEGER NOT NULL,
                    end_page INTEGER NOT NULL,
                    started_at TEXT NOT NULL,
                    last_activity_at TEXT NOT NULL,
                    completed_at TEXT,
                    status TEXT NOT NULL,
                    FOREIGN KEY(document_id) REFERENCES study_documents(document_id)
                );

                CREATE INDEX IF NOT EXISTS idx_study_sessions_document_chapter
                ON study_sessions(document_id, chapter_id, started_at);

                CREATE TABLE IF NOT EXISTS study_events (
                    event_id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    document_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    occurred_at TEXT NOT NULL,
                    received_at TEXT NOT NULL,
                    page INTEGER,
                    active_seconds REAL NOT NULL DEFAULT 0,
                    properties_json TEXT NOT NULL DEFAULT '{}',
                    FOREIGN KEY(session_id) REFERENCES study_sessions(session_id),
                    FOREIGN KEY(document_id) REFERENCES study_documents(document_id)
                );

                CREATE INDEX IF NOT EXISTS idx_study_events_session
                ON study_events(session_id, occurred_at);

                CREATE INDEX IF NOT EXISTS idx_study_events_received
                ON study_events(received_at);

                CREATE TABLE IF NOT EXISTS study_page_stats (
                    session_id TEXT NOT NULL,
                    page INTEGER NOT NULL,
                    active_seconds REAL NOT NULL DEFAULT 0,
                    visit_count INTEGER NOT NULL DEFAULT 0,
                    first_viewed_at TEXT NOT NULL,
                    last_viewed_at TEXT NOT NULL,
                    PRIMARY KEY(session_id, page),
                    FOREIGN KEY(session_id) REFERENCES study_sessions(session_id)
                );

                CREATE TABLE IF NOT EXISTS study_chapter_results (
                    completion_id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    document_id TEXT NOT NULL,
                    chapter_id TEXT NOT NULL,
                    chapter_title TEXT NOT NULL,
                    start_page INTEGER NOT NULL,
                    end_page INTEGER NOT NULL,
                    completed_at TEXT NOT NULL,
                    self_rating INTEGER,
                    difficult_concept TEXT NOT NULL DEFAULT '',
                    metrics_json TEXT NOT NULL,
                    feedback_json TEXT NOT NULL,
                    feedback_version INTEGER NOT NULL,
                    FOREIGN KEY(session_id) REFERENCES study_sessions(session_id),
                    FOREIGN KEY(document_id) REFERENCES study_documents(document_id)
                );

                CREATE INDEX IF NOT EXISTS idx_study_results_document_chapter
                ON study_chapter_results(document_id, chapter_id, completed_at);

                CREATE TABLE IF NOT EXISTS study_chat_turns (
                    turn_id TEXT PRIMARY KEY,
                    document_id TEXT NOT NULL,
                    session_id TEXT NOT NULL,
                    question TEXT NOT NULL,
                    answer TEXT NOT NULL,
                    concept_summary TEXT NOT NULL,
                    model TEXT NOT NULL DEFAULT '',
                    provider TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(document_id) REFERENCES study_documents(document_id)
                );

                CREATE INDEX IF NOT EXISTS idx_study_chat_turns_document_created
                ON study_chat_turns(document_id, created_at, turn_id);

                CREATE TABLE IF NOT EXISTS study_annotations (
                    annotation_id TEXT PRIMARY KEY,
                    document_id TEXT NOT NULL,
                    page INTEGER NOT NULL,
                    kind TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY(document_id) REFERENCES study_documents(document_id)
                );

                CREATE INDEX IF NOT EXISTS idx_study_annotations_document_page
                ON study_annotations(document_id, page, updated_at, annotation_id);

                CREATE TABLE IF NOT EXISTS study_bookmarks (
                    bookmark_id TEXT PRIMARY KEY,
                    document_id TEXT NOT NULL,
                    page INTEGER NOT NULL,
                    label TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY(document_id) REFERENCES study_documents(document_id)
                );

                CREATE UNIQUE INDEX IF NOT EXISTS idx_study_bookmarks_document_page
                ON study_bookmarks(document_id, page);

                CREATE TABLE IF NOT EXISTS study_document_meta (
                    document_id TEXT PRIMARY KEY,
                    note TEXT NOT NULL DEFAULT '',
                    tags_json TEXT NOT NULL DEFAULT '[]',
                    updated_at TEXT NOT NULL
                );

                PRAGMA user_version = 6;
                """
            )
            chat_columns = {
                row["name"]
                for row in connection.execute("PRAGMA table_info(study_chat_turns)")
            }
            if "answer_evidence" not in chat_columns:
                connection.execute("ALTER TABLE study_chat_turns ADD COLUMN answer_evidence TEXT NOT NULL DEFAULT ''")
            if "web_search_json" not in chat_columns:
                connection.execute("ALTER TABLE study_chat_turns ADD COLUMN web_search_json TEXT NOT NULL DEFAULT ''")
            if "practice_context" not in chat_columns:
                connection.execute("ALTER TABLE study_chat_turns ADD COLUMN practice_context TEXT NOT NULL DEFAULT ''")
            if "session_id" not in chat_columns:
                connection.execute(
                    "ALTER TABLE study_chat_turns ADD COLUMN session_id TEXT NOT NULL DEFAULT ''"
                )
            connection.execute(
                """
                UPDATE study_chat_turns
                SET session_id = 'legacy-' || document_id
                WHERE session_id = ''
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_study_chat_turns_document_session_created
                ON study_chat_turns(document_id, session_id, created_at, turn_id)
                """
            )

    @staticmethod
    def _chat_turn_response(row: Mapping[str, Any]) -> dict[str, Any]:
        web_search = decode_web_sources(row["web_search_json"], row["answer"])
        return {
            **({"web_search": web_search} if web_search is not None else {}),
            **({"practice_context": decode_study_chat_context(row["practice_context"])} if row["practice_context"] else {}),
            "answer_evidence": normalize_evidence(json.loads(row["answer_evidence"] or "[]")),
            "turn_id": row["turn_id"],
            "session_id": row["session_id"],
            "question": row["question"],
            "answer": row["answer"],
            "concept_summary": row["concept_summary"],
            "model": row["model"],
            "provider": row["provider"],
            "created_at": row["created_at"],
        }

    @staticmethod
    def _upsert_document(
        connection: sqlite3.Connection,
        *,
        pdf_path: str,
        document_id: str,
        file_size: int,
        mtime_ns: int,
        timestamp: str,
    ):
        connection.execute(
            """
            INSERT INTO study_documents(
                document_id, pdf_path, file_size, mtime_ns, first_seen_at, last_seen_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(document_id) DO UPDATE SET
                pdf_path = excluded.pdf_path,
                last_seen_at = excluded.last_seen_at
            """,
            (document_id, pdf_path, file_size, mtime_ns, timestamp, timestamp),
        )

    def save_chat_turn(
        self,
        *,
        pdf_path: str,
        turn_id: str,
        question: str,
        answer: str,
        concept_summary: str,
        session_id: str = "",
        model: str = "",
        provider: str = "",
        created_at: Any = None,
        practice_context: Mapping | None = None,
        answer_evidence=None,
        web_search: Mapping | None = None,
    ) -> dict[str, Any]:
        normalized_pdf = _normalized_pdf_path(pdf_path)
        document_id, file_size, mtime_ns = _document_identity(normalized_pdf)
        normalized_turn_id = _required_text(turn_id, name="turn_id", limit=160)
        normalized_session_id = _bounded_text(session_id, 160) or f"legacy-{document_id}"
        normalized_question = _required_text(question, name="question", limit=32_000)
        normalized_answer = _required_text(answer, name="answer", limit=256_000)
        normalized_summary = _bounded_text(concept_summary, 64_000)
        normalized_model = _bounded_text(model, 300)
        normalized_provider = _bounded_text(provider, 160)
        normalized_evidence = json.dumps(normalize_evidence(answer_evidence), ensure_ascii=False)
        normalized_practice_context = encode_study_chat_context(practice_context)
        normalized_web_search = encode_web_sources(web_search, normalized_answer)
        parsed_created_at = _parse_time(created_at) if created_at not in (None, "") else _utc_now()
        if parsed_created_at is None:
            raise ValueError("created_at must be an ISO-8601 timestamp.")
        timestamp = _iso_time(parsed_created_at)
        expected = (
            document_id,
            normalized_session_id,
            normalized_question,
            normalized_answer,
            normalized_summary,
            normalized_model,
            normalized_provider,
            normalized_practice_context,
            normalized_evidence,
            normalized_web_search,
        )

        with _database(self.db_path) as connection:
            self._upsert_document(
                connection,
                pdf_path=normalized_pdf,
                document_id=document_id,
                file_size=file_size,
                mtime_ns=mtime_ns,
                timestamp=timestamp,
            )
            inserted = connection.execute(
                """
                INSERT OR IGNORE INTO study_chat_turns(
                    turn_id, document_id, session_id, question, answer,
                    concept_summary, model, provider, practice_context, answer_evidence, web_search_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (normalized_turn_id, *expected, timestamp),
            ).rowcount
            row = connection.execute(
                "SELECT * FROM study_chat_turns WHERE turn_id = ?",
                (normalized_turn_id,),
            ).fetchone()
            if row is None:
                raise RuntimeError("The chat turn could not be saved.")
            if not inserted and web_search is None:
                # An older client may replay the same turn without the optional
                # field. Preserve the stored snapshot instead of downgrading it.
                expected = (*expected[:-1], row["web_search_json"])
            actual = tuple((row[key] or "[]") if key == "answer_evidence" else row[key] for key in (
                "document_id",
                "session_id",
                "question",
                "answer",
                "concept_summary",
                "model",
                "provider",
                "practice_context",
                "answer_evidence",
                "web_search_json",
            ))
            if actual != expected:
                raise ValueError("turn_id already belongs to a different chat turn.")
        return {"turn": self._chat_turn_response(row), "created": bool(inserted)}

    def list_chat_turns(self, *, pdf_path: str, session_id: str = "") -> dict[str, Any]:
        document_id, _ = _resolve_document_id(self.db_path, pdf_path)
        normalized_session_id = _bounded_text(session_id, 160)
        with _database(self.db_path) as connection:
            if normalized_session_id:
                rows = connection.execute(
                    """
                    SELECT * FROM study_chat_turns
                    WHERE document_id = ? AND session_id = ?
                    ORDER BY created_at, turn_id
                    """,
                    (document_id, normalized_session_id),
                ).fetchall()
            else:
                rows = connection.execute(
                    """
                    SELECT * FROM study_chat_turns
                    WHERE document_id = ?
                    ORDER BY created_at, turn_id
                    """,
                    (document_id,),
                ).fetchall()
        return {
            "document_id": document_id,
            "session_id": normalized_session_id,
            "turns": [self._chat_turn_response(row) for row in rows],
        }

    def list_chat_sessions(self, *, pdf_path: str) -> dict[str, Any]:
        document_id, _ = _resolve_document_id(self.db_path, pdf_path)
        with _database(self.db_path) as connection:
            rows = connection.execute(
                """
                SELECT session_id,
                       MIN(created_at) AS created_at,
                       MAX(created_at) AS updated_at,
                       COUNT(*) AS turn_count,
                       (
                           SELECT first_turn.question
                           FROM study_chat_turns AS first_turn
                           WHERE first_turn.document_id = turns.document_id
                             AND first_turn.session_id = turns.session_id
                           ORDER BY first_turn.created_at, first_turn.turn_id
                           LIMIT 1
                       ) AS title
                FROM study_chat_turns AS turns
                WHERE document_id = ?
                GROUP BY session_id
                ORDER BY updated_at DESC, session_id DESC
                """,
                (document_id,),
            ).fetchall()
        return {
            "document_id": document_id,
            "sessions": [dict(row) for row in rows],
        }

    def list_chat_concepts(self, *, pdf_path: str) -> dict[str, Any]:
        document_id, _ = _resolve_document_id(self.db_path, pdf_path)
        with _database(self.db_path) as connection:
            rows = connection.execute(
                """
                SELECT turns.turn_id, turns.document_id, turns.question,
                       turns.concept_summary, turns.model, turns.provider,
                       turns.created_at, documents.pdf_path
                FROM study_chat_turns AS turns
                JOIN study_documents AS documents
                  ON documents.document_id = turns.document_id
                WHERE turns.document_id = ?
                  AND TRIM(turns.concept_summary) != ''
                ORDER BY turns.created_at DESC, turns.turn_id DESC
                """,
                (document_id,),
            ).fetchall()
        return {
            "document_id": document_id,
            "concepts": [
                {
                    "turn_id": row["turn_id"],
                    "document_id": row["document_id"],
                    "document_title": os.path.basename(row["pdf_path"]),
                    "question": row["question"],
                    "concept_summary": row["concept_summary"],
                    "model": row["model"],
                    "provider": row["provider"],
                    "created_at": row["created_at"],
                }
                for row in rows
            ],
        }

    def delete_chat_turns(
        self,
        *,
        pdf_path: str,
        session_id: str = "",
        purge_document: bool = False,
    ) -> dict[str, Any]:
        document_id, _ = _resolve_document_id(self.db_path, pdf_path)
        normalized_session_id = _bounded_text(session_id, 160)
        with _database(self.db_path) as connection:
            if normalized_session_id:
                deleted_count = connection.execute(
                    "DELETE FROM study_chat_turns WHERE document_id = ? AND session_id = ?",
                    (document_id, normalized_session_id),
                ).rowcount
            else:
                deleted_count = connection.execute(
                    "DELETE FROM study_chat_turns WHERE document_id = ?",
                    (document_id,),
                ).rowcount
                if purge_document:
                    # Full-document wipe: remove every derived row and the
                    # document anchor itself (child rows first, FK order).
                    connection.execute(
                        "DELETE FROM study_annotations WHERE document_id = ?",
                        (document_id,),
                    )
                    connection.execute(
                        "DELETE FROM study_bookmarks WHERE document_id = ?",
                        (document_id,),
                    )
                    connection.execute(
                        "DELETE FROM study_document_meta WHERE document_id = ?",
                        (document_id,),
                    )
                    connection.execute(
                        """
                        DELETE FROM study_page_stats WHERE session_id IN (
                            SELECT session_id FROM study_sessions WHERE document_id = ?
                        )
                        """,
                        (document_id,),
                    )
                    connection.execute(
                        "DELETE FROM study_events WHERE document_id = ?",
                        (document_id,),
                    )
                    connection.execute(
                        "DELETE FROM study_chapter_results WHERE document_id = ?",
                        (document_id,),
                    )
                    connection.execute(
                        "DELETE FROM study_sessions WHERE document_id = ?",
                        (document_id,),
                    )
                    connection.execute(
                        "DELETE FROM study_documents WHERE document_id = ?",
                        (document_id,),
                    )
        return {
            "document_id": document_id,
            "session_id": normalized_session_id,
            "purged_document": bool(purge_document and not normalized_session_id),
            "deleted_count": deleted_count,
        }

    def delete_chat_turn(self, *, turn_id: str) -> dict[str, Any]:
        normalized_turn_id = _required_text(turn_id, name="turn_id", limit=160)
        with _database(self.db_path) as connection:
            existing = connection.execute(
                "SELECT document_id FROM study_chat_turns WHERE turn_id = ?",
                (normalized_turn_id,),
            ).fetchone()
            if existing is None:
                raise KeyError(f"chat turn was not found: {normalized_turn_id}")
            connection.execute(
                "DELETE FROM study_chat_turns WHERE turn_id = ?",
                (normalized_turn_id,),
            )
        return {
            "turn_id": normalized_turn_id,
            "document_id": existing["document_id"],
            "deleted": True,
        }

    @staticmethod
    def _annotation_response(row: Mapping[str, Any]) -> dict[str, Any]:
        annotation = json.loads(row["payload_json"])
        annotation["created_at"] = row["created_at"]
        annotation["updated_at"] = row["updated_at"]
        return annotation

    def save_annotation(self, *, pdf_path: str, annotation: Any) -> dict[str, Any]:
        normalized_pdf = _normalized_pdf_path(pdf_path)
        document_id, file_size, mtime_ns = _document_identity(normalized_pdf)
        normalized = _normalize_annotation(annotation)
        timestamp = _iso_time()
        payload_json = json.dumps(normalized, ensure_ascii=False, separators=(",", ":"))
        with _database(self.db_path) as connection:
            self._upsert_document(
                connection,
                pdf_path=normalized_pdf,
                document_id=document_id,
                file_size=file_size,
                mtime_ns=mtime_ns,
                timestamp=timestamp,
            )
            existing = connection.execute(
                "SELECT document_id, created_at FROM study_annotations WHERE annotation_id = ?",
                (normalized["annotation_id"],),
            ).fetchone()
            if existing is not None and existing["document_id"] != document_id:
                raise ValueError("annotation_id already belongs to another PDF.")
            created_at = existing["created_at"] if existing is not None else timestamp
            connection.execute(
                """
                INSERT INTO study_annotations(
                    annotation_id, document_id, page, kind, payload_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(annotation_id) DO UPDATE SET
                    page = excluded.page,
                    kind = excluded.kind,
                    payload_json = excluded.payload_json,
                    updated_at = excluded.updated_at
                """,
                (
                    normalized["annotation_id"],
                    document_id,
                    normalized["page"],
                    normalized["kind"],
                    payload_json,
                    created_at,
                    timestamp,
                ),
            )
            row = connection.execute(
                "SELECT * FROM study_annotations WHERE annotation_id = ?",
                (normalized["annotation_id"],),
            ).fetchone()
        if row is None:
            raise RuntimeError("The PDF annotation could not be saved.")
        return {"annotation": self._annotation_response(row), "created": existing is None}

    def list_annotations(self, *, pdf_path: str) -> dict[str, Any]:
        document_id, _ = _resolve_document_id(self.db_path, pdf_path)
        with _database(self.db_path) as connection:
            rows = connection.execute(
                """
                SELECT * FROM study_annotations
                WHERE document_id = ?
                ORDER BY page, created_at, annotation_id
                """,
                (document_id,),
            ).fetchall()
        return {
            "document_id": document_id,
            "annotations": [self._annotation_response(row) for row in rows],
        }

    def delete_annotation(self, *, pdf_path: str, annotation_id: str) -> dict[str, Any]:
        document_id, _ = _resolve_document_id(self.db_path, pdf_path)
        normalized_id = _required_text(annotation_id, name="annotation_id", limit=160)
        with _database(self.db_path) as connection:
            deleted_count = connection.execute(
                "DELETE FROM study_annotations WHERE document_id = ? AND annotation_id = ?",
                (document_id, normalized_id),
            ).rowcount
        return {"document_id": document_id, "deleted_count": deleted_count}

    # ── 문서 단위 학습 추적(시간/세션) · 북마크 · 문서 메모/태그 ──

    @staticmethod
    def _session_response(row: Mapping[str, Any]) -> dict[str, Any]:
        return {
            "session_id": row["session_id"],
            "document_id": row["document_id"],
            "started_at": row["started_at"],
            "last_activity_at": row["last_activity_at"],
            "status": row["status"],
        }

    @staticmethod
    def _bookmark_response(row: Mapping[str, Any]) -> dict[str, Any]:
        return {
            "bookmark_id": row["bookmark_id"],
            "page": row["page"],
            "label": row["label"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    def _study_summary(self, connection: sqlite3.Connection, document_id: str) -> dict[str, Any]:
        totals = connection.execute(
            "SELECT COALESCE(SUM(active_seconds), 0.0) AS total_seconds"
            " FROM study_events WHERE document_id = ?",
            (document_id,),
        ).fetchone()
        sessions = connection.execute(
            """
            SELECT COUNT(*) AS counted_sessions FROM study_sessions
            WHERE document_id = ?
              AND (julianday(last_activity_at) - julianday(started_at)) * 86400.0 >= ?
            """,
            (document_id, SESSION_MIN_SECONDS),
        ).fetchone()
        return {
            "total_active_seconds": round(float(totals["total_seconds"] or 0.0), 3),
            "session_count": int(sessions["counted_sessions"] or 0),
        }

    def start_session(self, *, pdf_path: str) -> dict[str, Any]:
        normalized_pdf = _normalized_pdf_path(pdf_path)
        document_id, file_size, mtime_ns = _document_identity(normalized_pdf)
        timestamp = _iso_time()
        session_id = str(uuid.uuid4())
        with _database(self.db_path) as connection:
            self._upsert_document(
                connection,
                pdf_path=normalized_pdf,
                document_id=document_id,
                file_size=file_size,
                mtime_ns=mtime_ns,
                timestamp=timestamp,
            )
            connection.execute(
                "UPDATE study_sessions SET status = 'paused'"
                " WHERE document_id = ? AND status = 'active'",
                (document_id,),
            )
            connection.execute(
                """
                INSERT INTO study_sessions(
                    session_id, document_id, chapter_id, chapter_title,
                    start_page, end_page, started_at, last_activity_at, status
                ) VALUES (?, ?, '', '', 1, 0, ?, ?, 'active')
                """,
                (session_id, document_id, timestamp, timestamp),
            )
            row = connection.execute(
                "SELECT * FROM study_sessions WHERE session_id = ?",
                (session_id,),
            ).fetchone()
            summary = self._study_summary(connection, document_id)
        if row is None:
            raise RuntimeError("The study session could not be saved.")
        return {"session": self._session_response(row), "study": summary}

    def record_session_activity(
        self,
        *,
        session_id: str,
        active_seconds: Any,
        page: Any = None,
    ) -> dict[str, Any]:
        normalized_session_id = _required_text(session_id, name="session_id", limit=160)
        try:
            seconds = float(active_seconds)
        except (TypeError, ValueError) as error:
            raise ValueError("active_seconds must be a number.") from error
        if not math.isfinite(seconds) or seconds < 0:
            raise ValueError("active_seconds is outside the supported range.")
        seconds = round(min(seconds, MAX_ACTIVITY_SECONDS_PER_EVENT), 3)
        normalized_page = _positive_int(page, name="page") if page not in (None, "") else None
        timestamp = _iso_time()
        with _database(self.db_path) as connection:
            session = connection.execute(
                "SELECT session_id, document_id FROM study_sessions WHERE session_id = ?",
                (normalized_session_id,),
            ).fetchone()
            if session is None:
                raise KeyError(f"study session was not found: {normalized_session_id}")
            connection.execute(
                """
                INSERT INTO study_events(
                    event_id, session_id, document_id, event_type,
                    occurred_at, received_at, page, active_seconds, properties_json
                ) VALUES (?, ?, ?, 'page_activity', ?, ?, ?, ?, '{}')
                """,
                (
                    str(uuid.uuid4()),
                    normalized_session_id,
                    session["document_id"],
                    timestamp,
                    timestamp,
                    normalized_page,
                    seconds,
                ),
            )
            connection.execute(
                "UPDATE study_sessions SET last_activity_at = ? WHERE session_id = ?",
                (timestamp, normalized_session_id),
            )
            summary = self._study_summary(connection, session["document_id"])
        return {"accepted": True, "active_seconds": seconds, "study": summary}

    @staticmethod
    def _stored_tags(connection: sqlite3.Connection, document_id: str) -> list[str]:
        row = connection.execute(
            "SELECT tags_json FROM study_document_meta WHERE document_id = ?",
            (document_id,),
        ).fetchone()
        if row is None:
            return []
        try:
            parsed = json.loads(row["tags_json"] or "[]")
        except ValueError:
            return []
        if not isinstance(parsed, list):
            return []
        return [str(tag) for tag in parsed if str(tag or "").strip()]

    def document_info(self, *, pdf_path: str) -> dict[str, Any]:
        document_id, _ = _resolve_document_id(self.db_path, pdf_path)
        with _database(self.db_path) as connection:
            summary = self._study_summary(connection, document_id)
            bookmark_rows = connection.execute(
                "SELECT * FROM study_bookmarks WHERE document_id = ?"
                " ORDER BY page, created_at, bookmark_id",
                (document_id,),
            ).fetchall()
            memo_rows = connection.execute(
                """
                SELECT annotation_id, page, payload_json, updated_at FROM study_annotations
                WHERE document_id = ? AND kind = 'text'
                ORDER BY page, created_at, annotation_id
                """,
                (document_id,),
            ).fetchall()
            meta_row = connection.execute(
                "SELECT note, tags_json FROM study_document_meta WHERE document_id = ?",
                (document_id,),
            ).fetchone()
        memos: list[dict[str, Any]] = []
        for row in memo_rows:
            try:
                payload = json.loads(row["payload_json"])
            except ValueError:
                payload = {}
            memos.append({
                "annotation_id": row["annotation_id"],
                "page": row["page"],
                "text": str(payload.get("text") or "") if isinstance(payload, dict) else "",
                "updated_at": row["updated_at"],
            })
        note = ""
        tags: list[str] = []
        if meta_row is not None:
            note = str(meta_row["note"] or "")
            try:
                parsed_tags = json.loads(meta_row["tags_json"] or "[]")
                if isinstance(parsed_tags, list):
                    tags = [str(tag) for tag in parsed_tags]
            except ValueError:
                tags = []
        return {
            "document_id": document_id,
            "study": summary,
            "bookmarks": [self._bookmark_response(row) for row in bookmark_rows],
            "memos": memos,
            "note": note,
            "tags": tags,
        }

    def toggle_bookmark(self, *, pdf_path: str, page: Any, label: Any = "") -> dict[str, Any]:
        normalized_pdf = _normalized_pdf_path(pdf_path)
        document_id, file_size, mtime_ns = _document_identity(normalized_pdf)
        normalized_page = _positive_int(page, name="page")
        normalized_label = _bounded_text(label, 300)
        timestamp = _iso_time()
        with _database(self.db_path) as connection:
            self._upsert_document(
                connection,
                pdf_path=normalized_pdf,
                document_id=document_id,
                file_size=file_size,
                mtime_ns=mtime_ns,
                timestamp=timestamp,
            )
            existing = connection.execute(
                "SELECT bookmark_id FROM study_bookmarks WHERE document_id = ? AND page = ?",
                (document_id, normalized_page),
            ).fetchone()
            created = existing is None
            if existing is not None:
                connection.execute(
                    "DELETE FROM study_bookmarks WHERE bookmark_id = ?",
                    (existing["bookmark_id"],),
                )
            else:
                connection.execute(
                    """
                    INSERT INTO study_bookmarks(
                        bookmark_id, document_id, page, label, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (str(uuid.uuid4()), document_id, normalized_page, normalized_label, timestamp, timestamp),
                )
            rows = connection.execute(
                "SELECT * FROM study_bookmarks WHERE document_id = ?"
                " ORDER BY page, created_at, bookmark_id",
                (document_id,),
            ).fetchall()
        return {
            "created": created,
            "page": normalized_page,
            "bookmarks": [self._bookmark_response(row) for row in rows],
        }

    @staticmethod
    def _normalize_tags(value: Any) -> list[str]:
        if not isinstance(value, list):
            raise ValueError("tags must be a list.")
        if len(value) > MAX_DOCUMENT_TAGS:
            raise ValueError("too many tags.")
        tags: list[str] = []
        seen: set[str] = set()
        for item in value:
            tag = str(item or "").strip()
            if not tag:
                continue
            if len(tag) > MAX_DOCUMENT_TAG_LENGTH:
                raise ValueError("tag is too long.")
            key = tag.casefold()
            if key in seen:
                continue
            seen.add(key)
            tags.append(tag)
        return tags

    def save_document_note(self, *, pdf_path: str, note: Any) -> dict[str, Any]:
        normalized_pdf = _normalized_pdf_path(pdf_path)
        document_id, file_size, mtime_ns = _document_identity(normalized_pdf)
        normalized_note = str(note or "").strip()[:MAX_DOCUMENT_NOTE_LENGTH]
        timestamp = _iso_time()
        with _database(self.db_path) as connection:
            self._upsert_document(
                connection,
                pdf_path=normalized_pdf,
                document_id=document_id,
                file_size=file_size,
                mtime_ns=mtime_ns,
                timestamp=timestamp,
            )
            tags = self._stored_tags(connection, document_id)
            connection.execute(
                """
                INSERT INTO study_document_meta(document_id, note, tags_json, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(document_id) DO UPDATE SET
                    note = excluded.note,
                    updated_at = excluded.updated_at
                """,
                (document_id, normalized_note, json.dumps(tags, ensure_ascii=False), timestamp),
            )
        return {"note": normalized_note, "tags": tags}

    def save_document_tags(self, *, pdf_path: str, tags: Any) -> dict[str, Any]:
        normalized_pdf = _normalized_pdf_path(pdf_path)
        document_id, file_size, mtime_ns = _document_identity(normalized_pdf)
        normalized_tags = self._normalize_tags(tags)
        timestamp = _iso_time()
        with _database(self.db_path) as connection:
            self._upsert_document(
                connection,
                pdf_path=normalized_pdf,
                document_id=document_id,
                file_size=file_size,
                mtime_ns=mtime_ns,
                timestamp=timestamp,
            )
            note_row = connection.execute(
                "SELECT note FROM study_document_meta WHERE document_id = ?",
                (document_id,),
            ).fetchone()
            note = str(note_row["note"] or "") if note_row is not None else ""
            connection.execute(
                """
                INSERT INTO study_document_meta(document_id, note, tags_json, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(document_id) DO UPDATE SET
                    tags_json = excluded.tags_json,
                    updated_at = excluded.updated_at
                """,
                (document_id, note, json.dumps(normalized_tags, ensure_ascii=False), timestamp),
            )
        return {"note": note, "tags": normalized_tags}

    def list_document_metas(self) -> dict[str, Any]:
        with _database(self.db_path) as connection:
            rows = connection.execute(
                """
                SELECT documents.pdf_path, meta.note, meta.tags_json, meta.updated_at
                FROM study_document_meta AS meta
                JOIN study_documents AS documents
                  ON documents.document_id = meta.document_id
                ORDER BY meta.updated_at DESC, documents.pdf_path
                """
            ).fetchall()
        metas: list[dict[str, Any]] = []
        for row in rows:
            try:
                parsed_tags = json.loads(row["tags_json"] or "[]")
            except ValueError:
                parsed_tags = []
            if not isinstance(parsed_tags, list):
                parsed_tags = []
            metas.append({
                "path": row["pdf_path"],
                "note": str(row["note"] or ""),
                "tags": [str(tag) for tag in parsed_tags],
                "updated_at": row["updated_at"],
            })
        return {"metas": metas}


__all__ = ["StudyStore"]
