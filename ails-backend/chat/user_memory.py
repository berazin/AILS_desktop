"""사용자 맞춤형 Memory 시스템 (로컬 우선).

설계 원칙: "기억은 계속 쌓이지만 한 요청에 모델이 보는 기억은 항상 작다."

- 저장: 모든 기억은 기본적으로 로컬 SQLite에 쌓인다.
- 검색: 요청마다 전체 기억을 넣지 않고, 질문과 의미적으로 관련된 기억만
  similarity · importance · recency로 순위를 매겨 token budget 안에 담는다.
- 생성: 모든 대화를 저장하지 않고, 장기간 다시 쓸 가치가 있는 신호(선호·목표·
  반복 혼동·명시적 기억 요청)만 후보로 만들고, 유사 기억은 갱신(dedupe)한다.
- 압축: 같은 주제의 episodic 기억이 임계치를 넘으면 summary 기억을 만들고
  원본은 status='compressed'로 보존한다(삭제하지 않음). retrieval은
  active 상태만 읽으므로 자연히 summary가 우선된다.
- mastery: 문제 정답/오답·반복 혼동 신호로 EWMA 방식으로 천천히 갱신한다.

D1 동기화: 모든 변경은 ``memory_events`` outbox에 기록된다. 향후 동기화
워커는 ``MemoryStore.list_events(since_id=...)``로 로컬 → D1을 밀어넣고,
반대 방향은 동일한 스키마의 원격 store를 붙여 구현하면 된다.
"""

from __future__ import annotations

from chat.latency_spans import measured

import hashlib
import json
import os
import re
import sqlite3
import threading
import uuid
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from typing import Any, Mapping, Sequence

import numpy as np

from chat.context_composer import estimate_tokens

MEMORY_KINDS: tuple[str, ...] = ("profile", "learning", "episodic", "goal")
MEMORY_STATUSES: tuple[str, ...] = ("active", "compressed", "merged", "archived")
MEMORY_SOURCES: tuple[str, ...] = ("chat", "grading", "manual", "summary")

KIND_LABELS: dict[str, str] = {
    "profile": "선호",
    "learning": "학습",
    "goal": "목표",
    "episodic": "경험",
}

from chat.memory_settings import DEFAULT_MEMORY_SETTINGS, normalize_memory_settings

_CONFUSION_RE = re.compile(
    r"(모르겠|헷갈|이해가 안|이해를 못|다시 설명|잘 모르|틀렸|오답|못 풀)"
)
_PREFERENCE_RE = re.compile(
    r"(선호|더 좋아|쉽게 이해|더 잘 이해|이해가 잘\s*됐|짧게 설명|간결하게|"
    r"자세히 설명|쉬운 말|쉬운 표현|코드 예제|예제 위주|비유해서|단계별로 설명)"
)
_GOAL_RE = re.compile(
    r"(시험|중간고사|기말고사|수행평가|과제|목표|준비 중|D-?\d+|백준|코테|자격증)"
)
_EXPLICIT_MEMORY_RE = re.compile(r"(기억해|기억해줘|기억해 두|잊지 마|나중에도 기억)")
_ONE_OFF_RE = re.compile(
    r"^\s*(다음|이전)\s*(페이지|장|챕터)|^\s*(열어|켜줘|꺼줘|닫아|저장해|스크롤|목차|검색해|요약해|정리해줘)"
)
_TOKEN_RE = re.compile(r"[0-9A-Za-z가-힣+#_]+")
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+|\n+")


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def content_hash(text: str) -> str:
    return hashlib.sha256(str(text or "").encode("utf-8", errors="replace")).hexdigest()


def extract_keywords(text: str, limit: int = 12) -> list[str]:
    counts: dict[str, int] = {}
    for token in _TOKEN_RE.findall(str(text or "")):
        token_cf = token.casefold()
        if len(token_cf) < 2:
            continue
        counts[token_cf] = counts.get(token_cf, 0) + 1
    ranked = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    return [token for token, _count in ranked[:limit]]


@dataclass
class MemoryItem:
    id: str
    kind: str
    content: str
    subject: str = ""
    keywords: list[str] = field(default_factory=list)
    importance: float = 0.5
    status: str = "active"
    source: str = "chat"
    summary_of: list[str] = field(default_factory=list)
    access_count: int = 0
    last_accessed_at: str = ""
    created_at: str = ""
    updated_at: str = ""
    # retrieval 전용 필드
    score: float = 0.0
    similarity: float = 0.0
    model_key: str = ""
    vector: np.ndarray | None = None

    def to_api(self, *, include_score: bool = True) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "id": self.id,
            "kind": self.kind,
            "subject": self.subject,
            "content": self.content,
            "keywords": list(self.keywords),
            "importance": round(float(self.importance), 4),
            "status": self.status,
            "source": self.source,
            "summary_of": list(self.summary_of),
            "access_count": int(self.access_count),
            "last_accessed_at": self.last_accessed_at,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }
        if include_score:
            payload["score"] = round(float(self.score), 6)
            payload["similarity"] = round(float(self.similarity), 6)
        return payload


@dataclass
class MasteryRow:
    subject: str
    concept: str
    mastery: float = 0.5
    confidence: float = 0.3
    mistake_count: int = 0
    correct_count: int = 0
    last_reviewed_at: str = ""

    def to_api(self) -> dict[str, Any]:
        return {
            "subject": self.subject,
            "concept": self.concept,
            "mastery": round(float(self.mastery), 4),
            "confidence": round(float(self.confidence), 4),
            "mistake_count": int(self.mistake_count),
            "correct_count": int(self.correct_count),
            "last_reviewed_at": self.last_reviewed_at,
        }


def default_memory_db_path() -> str:
    """로컬 우선 저장 위치. 테스트·동기화 샌드박스는 환경 변수로 대체한다."""

    override = os.environ.get("AILS_MEMORY_DB", "").strip()
    if override:
        return override
    appdata = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA") or os.path.join(os.path.expanduser("~"), "AppData", "Local")
    directory = os.path.join(appdata, "AILS", "memory")
    os.makedirs(directory, exist_ok=True)
    return os.path.join(directory, "chat.user_memory.sqlite3")


def account_memory_db_path(user_id: str) -> str:
    """Keep new account memories separate from the legacy, unscoped database."""

    identity = str(user_id or "").strip()
    if not identity:
        raise ValueError("검증된 계정 ID가 필요합니다.")
    legacy_path = default_memory_db_path()
    stem, extension = os.path.splitext(legacy_path)
    account_key = hashlib.sha256(identity.encode("utf-8")).hexdigest()
    return f"{stem}.{account_key}{extension}"


def vector_to_blob(vector: np.ndarray) -> bytes:
    return np.asarray(vector, dtype=np.float32).tobytes()


def blob_to_vector(blob: Any, dimensions: int) -> np.ndarray:
    if not blob:
        return np.zeros(dimensions, dtype=np.float32)
    return np.frombuffer(bytes(blob), dtype=np.float32).copy()


class MemoryStore:
    """저장 계층 추상화. 로컬 SQLite 구현과 향후 D1 원격 구현이 이 계약을 공유한다."""

    def add_item(self, item: MemoryItem, vector: np.ndarray, model_key: str) -> MemoryItem:  # pragma: no cover - interface
        raise NotImplementedError

    def update_item(
        self,
        item_id: str,
        fields: Mapping[str, Any],
        vector: np.ndarray | None = None,
        model_key: str | None = None,
    ) -> MemoryItem | None:  # pragma: no cover - interface
        raise NotImplementedError

    def delete_item(self, item_id: str) -> bool:  # pragma: no cover - interface
        raise NotImplementedError

    def get_item(self, item_id: str) -> MemoryItem | None:  # pragma: no cover - interface
        raise NotImplementedError

    def list_items(self, kind: str | None = None, statuses: Sequence[str] = ("active",)) -> list[MemoryItem]:  # pragma: no cover - interface
        raise NotImplementedError

    def items_with_embeddings(self, statuses: Sequence[str] = ("active",)) -> list[MemoryItem]:  # pragma: no cover - interface
        raise NotImplementedError

    def touch_items(self, item_ids: Sequence[str], accessed_at: str) -> None:  # pragma: no cover - interface
        raise NotImplementedError

    def record_event(self, op: str, item_id: str, payload: Mapping[str, Any]) -> None:  # pragma: no cover - interface
        raise NotImplementedError

    def list_events(self, limit: int = 500, since_id: int = 0) -> list[dict[str, Any]]:  # pragma: no cover - interface
        raise NotImplementedError

    def get_mastery(self, subject: str, concept: str) -> MasteryRow | None:  # pragma: no cover - interface
        raise NotImplementedError

    def upsert_mastery(self, row: MasteryRow) -> MasteryRow:  # pragma: no cover - interface
        raise NotImplementedError

    def list_mastery(self) -> list[MasteryRow]:  # pragma: no cover - interface
        raise NotImplementedError

    def close(self) -> None:  # pragma: no cover - interface
        raise NotImplementedError


_SCHEMA = """
CREATE TABLE IF NOT EXISTS memory_items (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    keywords TEXT NOT NULL DEFAULT '[]',
    importance REAL NOT NULL DEFAULT 0.5,
    status TEXT NOT NULL DEFAULT 'active',
    source TEXT NOT NULL DEFAULT 'chat',
    summary_of TEXT NOT NULL DEFAULT '[]',
    access_count INTEGER NOT NULL DEFAULT 0,
    last_accessed_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memory_embeddings (
    memory_id TEXT PRIMARY KEY,
    model TEXT NOT NULL,
    dimensions INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    vector BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS mastery (
    subject TEXT NOT NULL,
    concept TEXT NOT NULL,
    mastery REAL NOT NULL DEFAULT 0.5,
    confidence REAL NOT NULL DEFAULT 0.3,
    mistake_count INTEGER NOT NULL DEFAULT 0,
    correct_count INTEGER NOT NULL DEFAULT 0,
    last_reviewed_at TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (subject, concept)
);
CREATE TABLE IF NOT EXISTS memory_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recorded_at TEXT NOT NULL,
    op TEXT NOT NULL,
    item_id TEXT NOT NULL DEFAULT '',
    payload TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_memory_items_kind_status ON memory_items(kind, status);
CREATE INDEX IF NOT EXISTS idx_memory_events_id ON memory_events(id);
"""


class SqliteMemoryStore(MemoryStore):
    """로컬 우선 저장 구현. 스키마는 D1(SQLite 호환)과 동일하게 유지한다."""

    def __init__(self, db_path: str | None = None):
        self.db_path = db_path or default_memory_db_path()
        directory = os.path.dirname(os.path.abspath(self.db_path))
        if directory:
            os.makedirs(directory, exist_ok=True)
        self._lock = threading.Lock()
        self._connection = sqlite3.connect(self.db_path, timeout=30, check_same_thread=False)
        self._connection.row_factory = sqlite3.Row
        self._connection.execute("PRAGMA journal_mode=WAL")
        self._connection.execute("PRAGMA synchronous=NORMAL")
        self._connection.executescript(_SCHEMA)
        self._connection.commit()

    # -- items -------------------------------------------------------------

    def _write_item(self, item: MemoryItem, vector: np.ndarray | None, model_key: str | None) -> MemoryItem:
        with self._lock:
            self._connection.execute(
                """
                INSERT INTO memory_items (
                    id, kind, subject, content, keywords, importance, status, source,
                    summary_of, access_count, last_accessed_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    kind=excluded.kind,
                    subject=excluded.subject,
                    content=excluded.content,
                    keywords=excluded.keywords,
                    importance=excluded.importance,
                    status=excluded.status,
                    source=excluded.source,
                    summary_of=excluded.summary_of,
                    access_count=excluded.access_count,
                    last_accessed_at=excluded.last_accessed_at,
                    created_at=excluded.created_at,
                    updated_at=excluded.updated_at
                """,
                (
                    item.id,
                    item.kind,
                    item.subject,
                    item.content,
                    json.dumps(list(item.keywords), ensure_ascii=False),
                    float(item.importance),
                    item.status,
                    item.source,
                    json.dumps(list(item.summary_of), ensure_ascii=False),
                    int(item.access_count),
                    item.last_accessed_at,
                    item.created_at,
                    item.updated_at,
                ),
            )
            if vector is not None and model_key:
                self._connection.execute(
                    """
                    INSERT INTO memory_embeddings (memory_id, model, dimensions, content_hash, vector)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(memory_id) DO UPDATE SET
                        model=excluded.model,
                        dimensions=excluded.dimensions,
                        content_hash=excluded.content_hash,
                        vector=excluded.vector
                    """,
                    (
                        item.id,
                        model_key,
                        int(np.asarray(vector).shape[0]),
                        content_hash(item.content),
                        vector_to_blob(vector),
                    ),
                )
            self._connection.commit()
        return item

    def add_item(self, item: MemoryItem, vector: np.ndarray, model_key: str) -> MemoryItem:
        return self._write_item(item, vector, model_key)

    def update_item(
        self,
        item_id: str,
        fields: Mapping[str, Any],
        vector: np.ndarray | None = None,
        model_key: str | None = None,
    ) -> MemoryItem | None:
        current = self.get_item(item_id)
        if current is None:
            return None
        updates = dict(fields)
        content_changed = "content" in updates and updates["content"] != current.content
        merged = replace(
            current,
            kind=str(updates.get("kind", current.kind)),
            subject=str(updates.get("subject", current.subject)),
            content=str(updates.get("content", current.content)),
            keywords=list(updates.get("keywords", current.keywords)),
            importance=float(updates.get("importance", current.importance)),
            status=str(updates.get("status", current.status)),
            source=str(updates.get("source", current.source)),
            summary_of=list(updates.get("summary_of", current.summary_of)),
            access_count=int(updates.get("access_count", current.access_count)),
            last_accessed_at=str(updates.get("last_accessed_at", current.last_accessed_at)),
            updated_at=str(updates.get("updated_at", current.updated_at) or utc_now_iso()),
        )
        return self._write_item(merged, vector if content_changed or vector is not None else None, model_key)

    def delete_item(self, item_id: str) -> bool:
        with self._lock:
            cursor = self._connection.execute("DELETE FROM memory_items WHERE id = ?", (item_id,))
            self._connection.execute("DELETE FROM memory_embeddings WHERE memory_id = ?", (item_id,))
            self._connection.commit()
        return cursor.rowcount > 0

    def _row_to_item(self, row: sqlite3.Row, *, with_embedding: bool) -> MemoryItem:
        item = MemoryItem(
            id=str(row["id"]),
            kind=str(row["kind"]),
            subject=str(row["subject"]),
            content=str(row["content"]),
            keywords=json.loads(row["keywords"] or "[]"),
            importance=float(row["importance"]),
            status=str(row["status"]),
            source=str(row["source"]),
            summary_of=json.loads(row["summary_of"] or "[]"),
            access_count=int(row["access_count"]),
            last_accessed_at=str(row["last_accessed_at"]),
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]),
        )
        if with_embedding:
            item.model_key = str(row["model"] or "")
            item.vector = blob_to_vector(row["vector"], int(row["dimensions"] or 0))
        return item

    def get_item(self, item_id: str) -> MemoryItem | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM memory_items WHERE id = ?",
                (item_id,),
            ).fetchone()
        if row is None:
            return None
        return self._row_to_item(row, with_embedding=False)

    def list_items(self, kind: str | None = None, statuses: Sequence[str] = ("active",)) -> list[MemoryItem]:
        clauses = []
        params: list[Any] = []
        if kind:
            clauses.append("kind = ?")
            params.append(kind)
        if statuses:
            placeholders = ",".join("?" for _ in statuses)
            clauses.append(f"status IN ({placeholders})")
            params.extend(statuses)
        sql = "SELECT * FROM memory_items"
        if clauses:
            sql += " WHERE " + " AND ".join(clauses)
        sql += " ORDER BY updated_at DESC, id"
        with self._lock:
            rows = self._connection.execute(sql, params).fetchall()
        return [self._row_to_item(row, with_embedding=False) for row in rows]

    def items_with_embeddings(self, statuses: Sequence[str] = ("active",)) -> list[MemoryItem]:
        placeholders = ",".join("?" for _ in statuses) or "''"
        sql = (
            "SELECT i.*, e.model AS model, e.vector AS vector, e.dimensions AS dimensions "
            "FROM memory_items i LEFT JOIN memory_embeddings e ON e.memory_id = i.id "
            f"WHERE i.status IN ({placeholders}) ORDER BY i.updated_at DESC, i.id"
        )
        with self._lock:
            rows = self._connection.execute(sql, list(statuses)).fetchall()
        return [self._row_to_item(row, with_embedding=True) for row in rows]

    def touch_items(self, item_ids: Sequence[str], accessed_at: str) -> None:
        ids = [item_id for item_id in dict.fromkeys(item_ids) if item_id]
        if not ids:
            return
        with self._lock:
            for item_id in ids:
                self._connection.execute(
                    "UPDATE memory_items SET access_count = access_count + 1, last_accessed_at = ? WHERE id = ?",
                    (accessed_at, item_id),
                )
            self._connection.commit()

    # -- events (D1 동기화 outbox) ------------------------------------------

    def record_event(self, op: str, item_id: str, payload: Mapping[str, Any]) -> None:
        with self._lock:
            self._connection.execute(
                "INSERT INTO memory_events (recorded_at, op, item_id, payload) VALUES (?, ?, ?, ?)",
                (utc_now_iso(), str(op), str(item_id or ""), json.dumps(dict(payload), ensure_ascii=False)),
            )
            self._connection.commit()

    def list_events(self, limit: int = 500, since_id: int = 0) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._connection.execute(
                "SELECT id, recorded_at, op, item_id, payload FROM memory_events WHERE id > ? ORDER BY id LIMIT ?",
                (int(since_id), int(limit)),
            ).fetchall()
        return [
            {
                "id": int(row["id"]),
                "recorded_at": str(row["recorded_at"]),
                "op": str(row["op"]),
                "item_id": str(row["item_id"]),
                "payload": json.loads(row["payload"] or "{}"),
            }
            for row in rows
        ]

    # -- mastery -------------------------------------------------------------

    def get_mastery(self, subject: str, concept: str) -> MasteryRow | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM mastery WHERE subject = ? AND concept = ?",
                (subject, concept),
            ).fetchone()
        if row is None:
            return None
        return MasteryRow(
            subject=str(row["subject"]),
            concept=str(row["concept"]),
            mastery=float(row["mastery"]),
            confidence=float(row["confidence"]),
            mistake_count=int(row["mistake_count"]),
            correct_count=int(row["correct_count"]),
            last_reviewed_at=str(row["last_reviewed_at"]),
        )

    def upsert_mastery(self, row: MasteryRow) -> MasteryRow:
        with self._lock:
            self._connection.execute(
                """
                INSERT INTO mastery (subject, concept, mastery, confidence, mistake_count, correct_count, last_reviewed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(subject, concept) DO UPDATE SET
                    mastery=excluded.mastery,
                    confidence=excluded.confidence,
                    mistake_count=excluded.mistake_count,
                    correct_count=excluded.correct_count,
                    last_reviewed_at=excluded.last_reviewed_at
                """,
                (
                    row.subject,
                    row.concept,
                    float(row.mastery),
                    float(row.confidence),
                    int(row.mistake_count),
                    int(row.correct_count),
                    row.last_reviewed_at,
                ),
            )
            self._connection.commit()
        return row

    def list_mastery(self) -> list[MasteryRow]:
        with self._lock:
            rows = self._connection.execute(
                "SELECT * FROM mastery ORDER BY mistake_count DESC, mastery ASC, subject, concept"
            ).fetchall()
        return [
            MasteryRow(
                subject=str(row["subject"]),
                concept=str(row["concept"]),
                mastery=float(row["mastery"]),
                confidence=float(row["confidence"]),
                mistake_count=int(row["mistake_count"]),
                correct_count=int(row["correct_count"]),
                last_reviewed_at=str(row["last_reviewed_at"]),
            )
            for row in rows
        ]

    def close(self) -> None:
        with self._lock:
            self._connection.close()


@dataclass(frozen=True)
class MemoryCandidate:
    kind: str
    content: str
    importance: float
    subject: str = ""
    keywords: list[str] = field(default_factory=list)


def extract_memory_candidates(text: str, *, min_chars: int = 8) -> list[MemoryCandidate]:
    """사용자 발화에서 장기 보존 가치가 있는 문장만 후보로 추출한다(규칙 기반).

    일회성 질문("AVL tree가 뭐야?")은 저장하지 않고, 선호·목표·혼동·명시적
    기억 요청 같은 신호만 후보로 만든다. LLM 기반 추출기로 교체할 수 있도록
    순수 함수로 유지한다.
    """

    value = str(text or "").strip()
    if len(value) < min_chars:
        return []
    if _ONE_OFF_RE.search(value):
        return []
    explicit = bool(_EXPLICIT_MEMORY_RE.search(value))
    candidates: list[MemoryCandidate] = []
    seen_contents: set[str] = set()
    for sentence in _SENTENCE_SPLIT_RE.split(value):
        sentence = re.sub(r"\s+", " ", str(sentence or "")).strip()
        if len(sentence) < min_chars:
            continue
        normalized = sentence.casefold()
        if normalized in seen_contents:
            continue
        kind = ""
        if _PREFERENCE_RE.search(sentence):
            kind = "profile"
        elif _GOAL_RE.search(sentence):
            kind = "goal"
        elif _CONFUSION_RE.search(sentence):
            kind = "learning"
        if not kind and not explicit:
            continue
        seen_contents.add(normalized)
        if kind:
            importance = {"profile": 0.7, "goal": 0.65, "learning": 0.45}[kind]
        else:
            kind = "episodic"
            importance = 0.55
        candidates.append(
            MemoryCandidate(
                kind=kind,
                content=sentence[:240],
                importance=importance,
                keywords=extract_keywords(sentence),
            )
        )
    return candidates[:3]


class UserMemoryService:
    """기억 생성·검색·압축·mastery 파사드. HTTP/UI 계층은 이 클래스만 본다."""

    def __init__(
        self,
        store: MemoryStore | None = None,
        settings: Mapping[str, Any] | None = None,
        encoder: Any = None,
        account_id: str | None = None,
        encoder_provider=None,
    ):
        self._store = store or SqliteMemoryStore(account_memory_db_path(account_id) if account_id else None)
        self.settings = normalize_memory_settings(settings)
        self._encoder = encoder
        self._encoder_provider = encoder_provider
        self._encoder_checked = encoder is not None

    # -- encoder --------------------------------------------------------------

    @property
    def encoder(self) -> Any:
        """공용 로컬 임베딩 백엔드. 없으면 hashed-lexical 폴백(오프라인 동작)."""

        if self._encoder_provider is not None and os.environ.get("AILS_MEMORY_ENCODER", "").strip().casefold() != "lexical":
            return self._encoder_provider()
        if not self._encoder_checked:
            self._encoder_checked = True
            if self._encoder is None:
                forced = os.environ.get("AILS_MEMORY_ENCODER", "").strip().casefold()
                if forced == "lexical":
                    from chat.theory_search import _LexicalFallbackBackend

                    self._encoder = _LexicalFallbackBackend("AILS_MEMORY_ENCODER=lexical")
                else:
                    try:
                        from chat.theory_search import shared_embedding_backend

                        self._encoder = shared_embedding_backend()
                    except Exception as error:  # pragma: no cover - 방어적 폴백
                        from chat.theory_search import _LexicalFallbackBackend

                        self._encoder = _LexicalFallbackBackend(str(error))
        return self._encoder

    def encode_texts(self, texts: Sequence[str]) -> np.ndarray:
        backend = self.encoder
        if not texts:
            return np.empty((0, getattr(backend, "dimensions", 384)), dtype=np.float32)
        return np.asarray(backend.encode(list(texts), "passage"), dtype=np.float32)

    # -- creation -------------------------------------------------------------

    def remember(
        self,
        content: str,
        *,
        kind: str = "episodic",
        subject: str = "",
        importance: float | None = None,
        source: str = "chat",
        keywords: Sequence[str] | None = None,
        now: str | None = None,
    ) -> tuple[MemoryItem, str]:
        """기억을 저장한다. 유사 기억이 있으면 새로 만들지 않고 갱신한다."""

        content = re.sub(r"\s+", " ", str(content or "")).strip()
        if not content:
            raise ValueError("기억 내용이 비어 있습니다.")
        kind = str(kind) if kind in MEMORY_KINDS else "episodic"
        source = str(source) if source in MEMORY_SOURCES else "chat"
        timestamp = now or utc_now_iso()
        settings = self.settings
        base_importance = float(importance) if importance is not None else 0.5
        base_importance = min(1.0, max(0.05, base_importance))
        keyword_list = [str(item) for item in (keywords or [])][:12]

        vector = self.encode_texts([content])[0]
        existing = self._find_similar(vector, content=content, kind=kind, subject=subject)
        if existing is not None:
            existing_vector = existing.vector if existing.vector is not None else vector
            # 임베딩 백엔드가 바뀌면(예: lexical 폴백 → E5) 차원이 달라진다.
            # 점 곱은 건너뛰고 토큰 유사도로만 병합 여부를 판단한다.
            similarity = (
                float(np.dot(vector, existing_vector))
                if existing_vector.shape == vector.shape
                else 0.0
            )
            merged_content = content if len(content) >= len(existing.content) else existing.content
            merged_keywords = list(dict.fromkeys([*existing.keywords, *keyword_list]))[:12]
            updated = self._store.update_item(
                existing.id,
                {
                    "content": merged_content,
                    "keywords": merged_keywords,
                    "importance": min(1.0, max(existing.importance, base_importance) + 0.02),
                    "status": "active",
                    "subject": subject or existing.subject,
                    "updated_at": timestamp,
                },
                vector=vector,
                model_key=self.encoder.model_key,
            )
            item = updated or existing
            self._store.record_event(
                "update",
                item.id,
                {"reason": "dedupe_merge", "similarity": round(float(similarity), 6)},
            )
            return item, "updated"

        item = MemoryItem(
            id=uuid.uuid4().hex,
            kind=kind,
            subject=subject,
            content=content,
            keywords=keyword_list or extract_keywords(content),
            importance=base_importance,
            status="active",
            source=source,
            created_at=timestamp,
            updated_at=timestamp,
        )
        stored = self._store.add_item(item, vector, self.encoder.model_key)
        self._store.record_event(
            "create",
            stored.id,
            {"kind": kind, "subject": subject, "source": source, "importance": base_importance},
        )
        if kind == "episodic":
            self.maybe_compress_episodic(subject=subject, now=timestamp)
        return stored, "created"

    _PARTICLES = ("으로써", "에서는", "에게서", "이라는", "라는", "으로", "로서", "에서", "에게", "께서", "부터", "까지", "보다", "처럼", "마다", "조차", "밖에", "이나", "이며", "이랑", "하고", "은", "는", "이", "가", "을", "를", "의", "에", "와", "과", "도", "만", "로", "란", "야", "여")

    @classmethod
    def _stem_token(cls, token: str) -> str:
        """토큰 끝의 흔한 조사를 떼어낸다(형태소 분석 없는 경량 정규화)."""

        value = str(token or "")
        changed = True
        while changed and len(value) > 2:
            changed = False
            for particle in cls._PARTICLES:
                if value.endswith(particle) and len(value) - len(particle) >= 2:
                    value = value[: -len(particle)]
                    changed = True
                    break
        return value

    @classmethod
    def _token_jaccard(cls, left: str, right: str) -> float:
        def token_set(value: str) -> set[str]:
            return {
                cls._stem_token(token)
                for token in (raw.casefold() for raw in _TOKEN_RE.findall(str(value or "")))
            } - {""}

        left_tokens = token_set(left)
        right_tokens = token_set(right)
        if not left_tokens or not right_tokens:
            return 0.0
        return len(left_tokens & right_tokens) / len(left_tokens | right_tokens)

    def _find_similar(
        self,
        vector: np.ndarray,
        *,
        content: str,
        kind: str,
        subject: str,
    ) -> MemoryItem | None:
        threshold = float(self.settings["dedupe_similarity_threshold"])
        backend = self.encoder if self._encoder_checked else None
        degraded = bool(backend is not None and getattr(backend, "degraded", False))
        # hashed-lexical 폴백은 유사도 분포가 낮으므로 임계치를 보정하고,
        # 형태소 변형(조사·어미 차이)을 토큰 Jaccard로 보완한다.
        effective = threshold * 0.85 if degraded else threshold
        jaccard_gate = 0.6 if degraded else 1.1
        best: tuple[float, MemoryItem] | None = None
        for item in self._store.items_with_embeddings():
            if item.kind != kind or item.status not in {"active", "compressed"}:
                continue
            if subject and item.subject and item.subject != subject:
                continue
            similarity = 0.0
            if item.vector is not None and item.vector.shape == vector.shape:
                similarity = float(np.dot(vector, item.vector))
            duplicate = similarity >= effective or self._token_jaccard(content, item.content) >= jaccard_gate
            if duplicate and (best is None or similarity > best[0]):
                best = (similarity, item)
        return best[1] if best else None

    # -- retrieval --------------------------------------------------------------

    @measured("memory_retrieve")
    def retrieve(
        self,
        query: str,
        *,
        kinds: Sequence[str] | None = None,
        budget_tokens: int | None = None,
        now: str | None = None,
    ) -> dict[str, Any]:
        """질문과 관련된 기억만 budget 안에서 선택한다.

        score = w_s·similarity + w_i·importance + w_r·recency (+ summary_boost)
        profile은 안정 선호이므로 profile 예산 안에서 먼저 포함하고, 나머지
        예산은 score 순으로 채운다. 예산을 넘는 후보는 점수가 낮은 것부터
        제외된다.
        """

        settings = self.settings
        budget = int(budget_tokens if budget_tokens is not None else 1500)
        allowed_kinds = set(kinds) if kinds else set(MEMORY_KINDS)
        timestamp = now or utc_now_iso()

        items = self._store.items_with_embeddings()
        query_vector = self.encode_texts([query])[0] if query and items else None
        scored: list[MemoryItem] = []
        for item in items:
            if item.kind not in allowed_kinds:
                continue
            similarity = 0.0
            if query_vector is not None and item.vector is not None and item.vector.shape == query_vector.shape:
                similarity = max(0.0, min(1.0, float(np.dot(query_vector, item.vector))))
            recency = self._recency(item, timestamp)
            score = (
                float(settings["similarity_weight"]) * similarity
                + float(settings["importance_weight"]) * float(item.importance)
                + float(settings["recency_weight"]) * recency
            )
            if item.summary_of:
                score += float(settings["summary_boost"])
            scored.append(replace(item, score=score, similarity=similarity))

        profile_budget = int(settings["profile_token_budget"])
        used = 0
        selected: list[MemoryItem] = []
        if "profile" in allowed_kinds and profile_budget > 0:
            profiles = sorted(
                (item for item in scored if item.kind == "profile"),
                key=lambda item: (-item.score, item.id),
            )
            for item in profiles[: int(settings["retrieval_top_k"])]:
                cost = estimate_tokens(f"{KIND_LABELS['profile']}: {item.content}")
                if used + cost > min(profile_budget, budget):
                    break
                selected.append(item)
                used += cost

        remaining_kinds = set(allowed_kinds) - {"profile"}
        rest = sorted(
            (item for item in scored if item.kind in remaining_kinds),
            key=lambda item: (-item.score, item.id),
        )
        for item in rest[: int(settings["retrieval_top_k"])]:
            cost = estimate_tokens(f"{KIND_LABELS.get(item.kind, item.kind)}: {item.content}")
            if used + cost > budget:
                continue
            selected.append(item)
            used += cost
            if used >= budget:
                break

        selected_ids = {item.id for item in selected}
        dropped = sum(1 for item in scored if item.id not in selected_ids)
        if selected_ids:
            self._store.touch_items(list(selected_ids), timestamp)
        selected.sort(key=lambda item: (-item.score, item.id))
        return {
            "items": selected,
            "used_tokens": used,
            "budget_tokens": budget,
            "dropped": dropped,
            "total_active": len(scored),
        }

    def _recency(self, item: MemoryItem, now_iso: str) -> float:
        half_life = float(self.settings["recency_half_life_days"])
        if item.kind in {"profile", "learning"}:
            half_life *= 3.0
        reference = item.updated_at or item.created_at or ""
        try:
            updated = datetime.fromisoformat(reference)
            current = datetime.fromisoformat(now_iso)
            age_days = max(0.0, (current - updated).total_seconds() / 86400.0)
        except (TypeError, ValueError):
            return 0.5
        return 0.5 ** (age_days / max(0.5, half_life))

    def render_memory_block(self, retrieval: Mapping[str, Any], *, budget_tokens: int | None = None) -> str:
        """검색 결과를 system prompt에 붙일 컴팩트 블록으로 렌더링한다."""

        items = list(retrieval.get("items") or [])
        if not items:
            return ""
        limit = int(budget_tokens if budget_tokens is not None else retrieval.get("budget_tokens", 1500))
        grouped: dict[str, list[str]] = {}
        used = 0
        for item in items:
            line = f"- {item.content}"
            cost = estimate_tokens(line)
            if used + cost > limit:
                break
            grouped.setdefault(item.kind, []).append(line)
            used += cost
        parts = []
        for kind in MEMORY_KINDS:
            lines = grouped.get(kind)
            if lines:
                parts.append(f"{KIND_LABELS[kind]}: " + " ".join(lines))
        if not parts:
            return ""
        return "[사용자 메모리] " + " ".join(parts)

    # -- observation -------------------------------------------------------------

    def observe_exchange(self, question: str, answer: str | None = None, *, now: str | None = None) -> dict[str, Any]:
        """채팅 턴이 끝난 뒤 장기 보존 가치가 있는 신호만 기억으로 반영한다."""

        timestamp = now or utc_now_iso()
        created: list[str] = []
        updated: list[str] = []
        confusion = self.observe_confusion(question, now=timestamp)
        if confusion:
            updated.append(f"mastery:{confusion[0]}:{confusion[1]}")
        for candidate in extract_memory_candidates(question, min_chars=int(self.settings["min_question_chars"])):
            try:
                item, action = self.remember(
                    candidate.content,
                    kind=candidate.kind,
                    importance=candidate.importance,
                    source="chat",
                    keywords=candidate.keywords,
                    now=timestamp,
                )
            except ValueError:
                continue
            (created if action == "created" else updated).append(item.id)
        return {
            "created": created,
            "updated": updated,
            "confusion": list(confusion) if confusion else None,
        }

    def observe_confusion(self, text: str, *, now: str | None = None) -> tuple[str, str] | None:
        """반복 혼동 신호를 mastery에 천천히 반영하고 learning 기억을 갱신한다."""

        value = str(text or "")
        if not _CONFUSION_RE.search(value):
            return None
        timestamp = now or utc_now_iso()
        normalized = value.casefold()
        match: MasteryRow | None = None
        for row in self._store.list_mastery():
            concept = str(row.concept or "").strip()
            if len(concept) >= 2 and concept.casefold() in normalized:
                match = row
                break
        if match is None:
            # 알려진 개념과 맞지 않으면 학습 기억만 갱신한다(무분별한 mastery 생성 방지).
            return None
        self.record_mastery_observation(match.subject, match.concept, correct=False, now=timestamp, step_scale=0.5)
        return match.subject, match.concept

    def observe_grading(
        self,
        subject: str,
        concepts: Sequence[str],
        correct: bool,
        *,
        confidence: float = 1.0,
        now: str | None = None,
    ) -> list[MasteryRow]:
        """문제 채점 결과(정답/오답)를 mastery에 반영한다."""

        timestamp = now or utc_now_iso()
        limit = int(self.settings["max_concepts_per_grading"])
        rows: list[MasteryRow] = []
        for concept in dict.fromkeys(str(item or "").strip() for item in concepts):
            if not concept or len(rows) >= limit:
                continue
            rows.append(self.record_mastery_observation(subject, concept, correct=correct, now=timestamp, step_scale=confidence))
        return rows

    def record_mastery_observation(
        self,
        subject: str,
        concept: str,
        *,
        correct: bool,
        now: str | None = None,
        step_scale: float = 1.0,
    ) -> MasteryRow:
        timestamp = now or utc_now_iso()
        settings = self.settings
        row = self._store.get_mastery(subject, concept) or MasteryRow(subject=subject, concept=concept)
        alpha = float(settings["mastery_step"]) * float(min(1.0, max(0.1, step_scale)))
        target = 1.0 if correct else 0.0
        row.mastery = min(1.0, max(0.0, row.mastery + (target - row.mastery) * alpha))
        if correct:
            row.correct_count += 1
        else:
            row.mistake_count += 1
        row.confidence = min(0.99, row.confidence + float(settings["mastery_confidence_gain"]))
        row.last_reviewed_at = timestamp
        stored = self._store.upsert_mastery(row)
        self._store.record_event(
            "mastery",
            f"{subject}:{concept}",
            {"mastery": stored.mastery, "correct": correct},
        )
        return stored

    # -- compression --------------------------------------------------------------

    def maybe_compress_episodic(self, *, subject: str = "", now: str | None = None) -> MemoryItem | None:
        """같은 주제의 episodic 기억이 임계치를 넘으면 summary 기억으로 압축한다.

        원본은 status='compressed'로 남아 삭제되지 않으며, retrieval은 active만
        읽으므로 이후부터 summary가 대신 검색된다. 군집은 subject가 같고 키워드가
        겹치는 기억끼리 만든다(서로 다른 경험도 관련이 있으면 한 요약으로 묶인다).
        """

        threshold = int(self.settings["summary_cluster_threshold"])
        if threshold < 2:
            return None
        candidates = [
            item
            for item in self._store.list_items(kind="episodic", statuses=("active",))
            if not item.summary_of and (not subject or item.subject == subject)
        ]
        groups: dict[str, list[Any]] = {}
        for item in candidates:
            groups.setdefault(item.subject, []).append(item)
        for group_subject, items in groups.items():
            if len(items) < threshold:
                continue
            items = sorted(items, key=lambda item: (item.updated_at, item.id))
            clusters: list[list[Any]] = []
            for item in items:
                placed = False
                for cluster in clusters:
                    centroid_keywords = {keyword for member in cluster for keyword in member.keywords}
                    shared = len(centroid_keywords & set(item.keywords))
                    if shared >= 2 or (shared >= 1 and self._token_jaccard(cluster[0].content, item.content) >= 0.3):
                        cluster.append(item)
                        placed = True
                        break
                if not placed:
                    clusters.append([item])
            cluster = next((cluster for cluster in clusters if len(cluster) >= threshold), None)
            if cluster is None:
                continue
            label = group_subject or "학습"
            keywords: list[str] = []
            for item in cluster:
                for keyword in item.keywords:
                    if keyword not in keywords:
                        keywords.append(keyword)
            digest = " · ".join(item.content[:80] for item in cluster[:6])
            summary_content = (
                f"사용자는 {label} 주제에서 비슷한 학습 경험을 {len(cluster)}번 기록했습니다. "
                f"반복 패턴: {digest}"
            )[:600]
            timestamp = now or utc_now_iso()
            vector = self.encode_texts([summary_content])[0]
            summary_item = MemoryItem(
                id=uuid.uuid4().hex,
                kind="episodic",
                subject=group_subject,
                content=summary_content,
                keywords=keywords[:12],
                importance=min(1.0, max(item.importance for item in cluster) + 0.05),
                status="active",
                source="summary",
                summary_of=[item.id for item in cluster],
                created_at=timestamp,
                updated_at=timestamp,
            )
            stored = self._store.add_item(summary_item, vector, self.encoder.model_key)
            for item in cluster:
                self._store.update_item(item.id, {"status": "compressed", "updated_at": timestamp})
            self._store.record_event(
                "compress",
                stored.id,
                {"subject": group_subject, "compressed_ids": [item.id for item in cluster]},
            )
            return stored
        return None

    # -- management (UI) -------------------------------------------------------------

    def list_items(self, kind: str | None = None) -> list[MemoryItem]:
        return self._store.list_items(kind=kind, statuses=("active", "compressed"))

    def create_or_update_manual(self, payload: Mapping[str, Any]) -> tuple[MemoryItem, str]:
        action = str(payload.get("action") or "create").strip().casefold()
        if action == "update":
            item_id = str(payload.get("id") or "")
            content = str(payload.get("content") or "").strip()
            item = self._store.get_item(item_id)
            if item is None:
                raise ValueError("수정할 기억을 찾을 수 없습니다.")
            fields: dict[str, Any] = {"updated_at": utc_now_iso()}
            if content:
                fields["content"] = content[:600]
            if str(payload.get("kind") or "") in MEMORY_KINDS:
                fields["kind"] = str(payload["kind"])
            fields["subject"] = str(payload.get("subject", item.subject) or "")[:120]
            if payload.get("importance") is not None:
                try:
                    fields["importance"] = min(1.0, max(0.05, float(payload["importance"])))
                except (TypeError, ValueError):
                    pass
            vector = self.encode_texts([fields["content"]])[0]
            updated = self._store.update_item(item_id, fields, vector=vector, model_key=self.encoder.model_key)
            if updated is None:
                raise ValueError("수정할 기억을 찾을 수 없습니다.")
            self._store.record_event("update", item_id, {"reason": "manual"})
            return updated, "updated"
        content = str(payload.get("content") or "").strip()
        if not content:
            raise ValueError("기억 내용을 입력하세요.")
        return self.remember(
            content,
            kind=str(payload.get("kind") or "episodic"),
            subject=str(payload.get("subject") or ""),
            importance=payload.get("importance"),
            source="manual",
            keywords=extract_keywords(content),
        )

    def delete_item(self, item_id: str) -> bool:
        deleted = self._store.delete_item(item_id)
        if deleted:
            self._store.record_event("delete", item_id, {"reason": "manual"})
        return deleted

    def snapshot(self) -> dict[str, Any]:
        items = self.list_items()
        backend = self.encoder if self._encoder_checked else None
        return {
            "items": [item.to_api(include_score=False) for item in items],
            "mastery": [row.to_api() for row in self._store.list_mastery()],
            "settings": dict(self.settings),
            "storage": {
                "backend": "sqlite-local",
                "path": getattr(self._store, "db_path", ""),
                "embedding_backend": getattr(backend, "name", "lazy"),
                "degraded": bool(getattr(backend, "degraded", False)) if backend is not None else False,
            },
            "kinds": list(MEMORY_KINDS),
        }

    def close(self) -> None:
        self._store.close()
