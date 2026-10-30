from __future__ import annotations

import hashlib
import json
import math
import os
import re
import shutil
import sqlite3
import tempfile
import threading
import time
from collections import Counter
from contextlib import closing, contextmanager
from typing import Any, Iterable, Mapping, Sequence, TYPE_CHECKING

if TYPE_CHECKING:
    import numpy as np

from search.embedding_runtime import current_runtime
from search.embedding_process import EmbeddingCancelled
from ocr_runtime import load_onnxruntime
from pdf.pdf_ocr import detect_ocr_performance_profile, indexed_pdf_pages, pdf_ocr_status


EMBEDDING_WEIGHT = 0.55
KEYWORD_WEIGHT = 0.30
TITLE_WEIGHT = 0.10
PAGE_WEIGHT = 0.05

E5_REPOSITORY = "intfloat/multilingual-e5-small"
# Pin the revision that introduced the verified quantized ONNX export. This avoids
# silently changing retrieval results when the upstream main branch is updated.
E5_REVISION = "6a0d452a575215f80b8f66276dd4ee5d504942c6"
E5_MODEL_FILE = "onnx/model_qint8_avx512_vnni.onnx"
E5_TOKENIZER_FILE = "onnx/tokenizer.json"
E5_MODEL_KEY = f"{E5_REPOSITORY}@{E5_REVISION}:qint8-onnx"
E5_BACKEND_NAME = "multilingual-e5-small-onnx"
EMBEDDING_DIMENSIONS = 384
EMBEDDING_BATCH_SIZE = 16
EMBEDDING_COMMIT_SLICE = 96
EMBEDDING_RETRY_SECONDS = 300

E5_BASE_REPOSITORY = "intfloat/multilingual-e5-base"
E5_BASE_REVISION = "d128750597153bb5987e10b1c3493a34e5a4502a"
E5_BASE_MODEL_FILE = "onnx/model_qint8_avx512_vnni.onnx"
E5_BASE_MODEL_KEY = f"{E5_BASE_REPOSITORY}@{E5_BASE_REVISION}:qint8-onnx"

BGE_M3_REPOSITORY = "BAAI/bge-m3"
BGE_M3_REVISION = "5617a9f61b028005a4858fdac845db406aefb181"
BGE_M3_MODEL_FILE = "onnx/model.onnx"
BGE_M3_EXTERNAL_FILES = ("onnx/model.onnx_data", "onnx/Constant_7_attr__value")
BGE_M3_MODEL_KEY = f"{BGE_M3_REPOSITORY}@{BGE_M3_REVISION}:fp32-onnx"

CHUNK_TARGET_CHARS = 900
CHUNK_OVERLAP_CHARS = 140
SEMANTIC_CANDIDATE_LIMIT = 192
CURRENT_CHAPTER_CANDIDATE_LIMIT = 128
_OPEN_CHALLENGE_PATTERN = re.compile(r"^\s*open\s+challenge(?:\s|$)", re.IGNORECASE)

_TOKEN_PATTERN = re.compile(r"[가-힣]{2,}|[A-Za-z_][A-Za-z0-9_+#.-]*|\d+(?:\.\d+)+")
_ANSWER_TITLE_PATTERN = re.compile(r"^\s*(?:정답|해답|풀이|모범\s*답안|answer|solution)\b", re.IGNORECASE)
_EXERCISE_TITLE_PATTERN = re.compile(
    r"^\s*(?:연습|실습)\s*문제(?:\s|[•·]|$)|^\s*exercises?(?:\s|$)",
    re.IGNORECASE,
)

@contextmanager
def prioritize_chatbot():
    with current_runtime().activity(foreground=True):
        yield



def _wait_for_chatbot() -> None:
    current_runtime().wait_for_foreground()



def page_bonus(theory_page: int, exercise_page: int) -> float:
    distance = int(exercise_page) - int(theory_page)
    if 0 <= distance <= 30:
        return 1.0
    if 30 < distance <= 80:
        return 0.6
    if distance < 0:
        return 0.1
    return 0.3


def _normalized_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip().casefold()


def _tokens(value: Any) -> list[str]:
    return [token.casefold() for token in _TOKEN_PATTERN.findall(str(value or ""))]


def _unique_texts(values: Iterable[Any], limit: int = 32) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for raw in values:
        value = re.sub(r"\s+", " ", str(raw or "")).strip()[:160]
        key = value.casefold()
        if not value or key in seen:
            continue
        seen.add(key)
        result.append(value)
        if len(result) >= limit:
            break
    return result


def _feature_embedding(value: Any) -> np.ndarray:
    """Cheap lexical fallback used only when the real E5 runtime is unavailable."""

    import numpy as np
    normalized = _normalized_text(value)
    vector = np.zeros(EMBEDDING_DIMENSIONS, dtype=np.float32)
    if not normalized:
        return vector
    features: Counter[str] = Counter()
    for token in _tokens(normalized):
        features[f"w:{token}"] += 2.0
        compact = re.sub(r"[^0-9a-z가-힣+#_]", "", token)
        if len(compact) >= 3:
            for index in range(len(compact) - 2):
                features[f"g:{compact[index:index + 3]}"] += 0.45
    for feature, weight in features.items():
        digest = hashlib.blake2b(feature.encode("utf-8", errors="replace"), digest_size=8).digest()
        bucket = int.from_bytes(digest[:4], "little") % EMBEDDING_DIMENSIONS
        sign = 1.0 if digest[4] & 1 else -1.0
        vector[bucket] += sign * float(weight)
    norm = float(np.linalg.norm(vector))
    return vector / norm if norm else vector


class _LexicalFallbackBackend:
    name = "hashed-lexical-fallback"
    model_key = "hashed-lexical-v1"
    dimensions = EMBEDDING_DIMENSIONS
    degraded = True

    def __init__(self, reason: str):
        self.error = re.sub(r"\s+", " ", str(reason or "E5 backend unavailable")).strip()[:500]

    def encode(self, texts: Sequence[str], input_type: str) -> np.ndarray:
        import numpy as np
        del input_type
        if not texts:
            return np.empty((0, self.dimensions), dtype=np.float32)
        return np.stack([_feature_embedding(text) for text in texts]).astype(np.float32, copy=False)


class _E5OnnxBackend:
    """Minimal E5 encoder that does not require transformers or torch.

    Optional tokenizer/session injection keeps the pooling and prefix contract
    independently testable without downloading the model.
    """

    name = E5_BACKEND_NAME
    model_key = E5_MODEL_KEY
    dimensions = EMBEDDING_DIMENSIONS
    degraded = False
    error = ""

    def __init__(
        self,
        model_path: str = "",
        tokenizer_path: str = "",
        *,
        tokenizer=None,
        session=None,
        name: str = E5_BACKEND_NAME,
        model_key: str = E5_MODEL_KEY,
        dimensions: int = EMBEDDING_DIMENSIONS,
    ):
        self.name = name
        self.model_key = model_key
        self.dimensions = dimensions
        if tokenizer is None:
            from tokenizers import Tokenizer

            tokenizer = Tokenizer.from_file(tokenizer_path)
        if session is None:
            ort = load_onnxruntime()

            options = ort.SessionOptions()
            options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            if model_key == BGE_M3_MODEL_KEY:
                options.intra_op_num_threads = min(4, os.cpu_count() or 1)
            session = ort.InferenceSession(
                model_path,
                sess_options=options,
                providers=["CPUExecutionProvider"],
            )

        self._tokenizer = tokenizer
        self._session = session
        self._encode_lock = threading.RLock()
        self._tokenizer.enable_truncation(max_length=512)
        pad_token = "<pad>"
        pad_id = self._tokenizer.token_to_id(pad_token)
        if pad_id is None:
            pad_id = 1
        self._tokenizer.enable_padding(pad_id=int(pad_id), pad_token=pad_token, pad_type_id=0)
        self._input_specs = {item.name: item for item in self._session.get_inputs()}
        if "input_ids" not in self._input_specs:
            raise RuntimeError("E5 ONNX model does not expose input_ids.")

    @staticmethod
    def _input_dtype(spec):
        import numpy as np
        return np.int32 if "int32" in str(getattr(spec, "type", "")).lower() else np.int64

    def _encode_batch(self, texts: Sequence[str], input_type: str) -> np.ndarray:
        import numpy as np
        prefix = "query" if input_type == "query" else "passage"
        prefixed = [f"{prefix}: {str(text or '').strip()}" for text in texts]
        encodings = self._tokenizer.encode_batch(prefixed, add_special_tokens=True)
        if not encodings:
            return np.empty((0, self.dimensions), dtype=np.float32)

        values = {
            "input_ids": [encoding.ids for encoding in encodings],
            "attention_mask": [encoding.attention_mask for encoding in encodings],
            "token_type_ids": [encoding.type_ids for encoding in encodings],
        }
        feed = {
            name: np.asarray(values[name], dtype=self._input_dtype(spec))
            for name, spec in self._input_specs.items()
            if name in values
        }
        outputs = self._session.run(None, feed)
        hidden = next((np.asarray(output) for output in outputs if np.asarray(output).ndim == 3), None)
        if hidden is None:
            pooled = next((np.asarray(output) for output in outputs if np.asarray(output).ndim == 2), None)
            if pooled is None:
                raise RuntimeError("E5 ONNX model returned no token or sentence embeddings.")
        else:
            mask = np.asarray(values["attention_mask"], dtype=np.float32)
            if hidden.shape[1] != mask.shape[1]:
                common_length = min(hidden.shape[1], mask.shape[1])
                hidden = hidden[:, :common_length, :]
                mask = mask[:, :common_length]
            expanded_mask = mask[:, :, None]
            pooled = (hidden.astype(np.float32, copy=False) * expanded_mask).sum(axis=1)
            pooled /= np.maximum(expanded_mask.sum(axis=1), 1e-9)

        pooled = np.asarray(pooled, dtype=np.float32)
        norms = np.linalg.norm(pooled, axis=1, keepdims=True)
        pooled = pooled / np.maximum(norms, 1e-12)
        if pooled.ndim != 2 or pooled.shape[1] <= 0 or not np.isfinite(pooled).all():
            raise RuntimeError("E5 ONNX model produced invalid embeddings.")
        self.dimensions = int(pooled.shape[1])
        return pooled

    def encode(self, texts: Sequence[str], input_type: str) -> np.ndarray:
        import numpy as np
        if input_type not in {"query", "passage"}:
            raise ValueError("input_type must be query or passage.")
        if not texts:
            return np.empty((0, self.dimensions), dtype=np.float32)
        batches = []
        with self._encode_lock:
            for start in range(0, len(texts), EMBEDDING_BATCH_SIZE):
                batches.append(self._encode_batch(texts[start:start + EMBEDDING_BATCH_SIZE], input_type))
        return np.concatenate(batches, axis=0)


class _BgeM3OnnxBackend(_E5OnnxBackend):
    def __init__(self, model_path: str = "", tokenizer_path: str = "", *, tokenizer=None, session=None):
        if session is None:
            from chat.retrieval_inference import RetrievalSession
            session = RetrievalSession(model_path, max_tokens=512,
                                       cache_dir=os.path.join(_model_cache_dir(), "engine-cache", "bge-m3"))
        super().__init__(
            model_path,
            tokenizer_path,
            tokenizer=tokenizer,
            session=session,
            name="bge-m3-onnx",
            model_key=BGE_M3_MODEL_KEY,
            dimensions=1024,
        )
        # Engine/precision contracts get independent vectors; previous FP32 and
        # E5 caches remain readable by their own backends and are never relabeled.
        self.model_key = BGE_M3_MODEL_KEY + ":cls512-batch1-v2:" + getattr(session, "cache_tag", "injected")
        self.evidence = getattr(session, "evidence", {})

    def encode(self, texts: Sequence[str], input_type: str) -> np.ndarray:
        import numpy as np
        if input_type not in {"query", "passage"}:
            raise ValueError("input_type must be query or passage.")
        if not texts:
            return np.empty((0, self.dimensions), dtype=np.float32)
        with self._encode_lock:
            return np.concatenate([self._encode_batch([text], input_type) for text in texts], axis=0)

    def _encode_batch(self, texts: Sequence[str], input_type: str) -> np.ndarray:
        import numpy as np
        del input_type
        encodings = self._tokenizer.encode_batch(
            [str(text or "").strip() for text in texts],
            add_special_tokens=True,
        )
        if not encodings:
            return np.empty((0, self.dimensions), dtype=np.float32)
        values = {
            "input_ids": [encoding.ids for encoding in encodings],
            "attention_mask": [encoding.attention_mask for encoding in encodings],
            "token_type_ids": [encoding.type_ids for encoding in encodings],
        }
        feed = {
            name: np.asarray(values[name], dtype=self._input_dtype(spec))
            for name, spec in self._input_specs.items()
            if name in values
        }
        outputs = self._session.run(None, feed)
        hidden = next((np.asarray(output) for output in outputs if np.asarray(output).ndim == 3), None)
        pooled = hidden[:, 0, :] if hidden is not None else next(
            (np.asarray(output) for output in outputs if np.asarray(output).ndim == 2),
            None,
        )
        if pooled is None:
            raise RuntimeError("BGE-M3 ONNX model returned no dense embeddings.")
        pooled = np.asarray(pooled, dtype=np.float32)
        if pooled.ndim != 2 or pooled.shape != (len(texts), 1024) or not np.isfinite(pooled).all():
            raise RuntimeError("BGE-M3 ONNX model produced invalid embeddings.")
        norms = np.linalg.norm(pooled, axis=1, keepdims=True)
        if np.any(norms <= 1e-12):
            raise RuntimeError("BGE-M3 ONNX model produced zero embeddings.")
        pooled /= norms
        self.dimensions = int(pooled.shape[1])
        return pooled


def _model_cache_dir() -> str:
    appdata = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA") or tempfile.gettempdir()
    path = os.environ.get("AILS_EMBEDDING_MODEL_DIR") or os.path.join(appdata, "AILS", "models", "huggingface")
    os.makedirs(path, exist_ok=True)
    return path


def _download_model_file(
    filename: str,
    *,
    repository: str = E5_REPOSITORY,
    revision: str = E5_REVISION,
) -> str:
    from huggingface_hub import hf_hub_download

    arguments = {
        "repo_id": repository,
        "filename": filename,
        "revision": revision,
        "cache_dir": _model_cache_dir(),
    }
    try:
        return hf_hub_download(**arguments, local_files_only=True)
    except Exception:
        return hf_hub_download(**arguments)


def _embedding_model_tiers() -> list[str]:
    try:
        profile = detect_ocr_performance_profile()
        total = float(profile.total_memory_gb)
        available = float(profile.available_memory_gb)
    except Exception:
        total = available = 0.0
    try:
        free_disk = shutil.disk_usage(_model_cache_dir()).free
    except OSError:
        free_disk = 0
    tiers = []
    if total >= 24.0 and free_disk >= 4 * 1024 ** 3:
        tiers.append("bge-m3")
    if total >= 16.0 and available >= 4.0:
        tiers.append("e5-base")
    tiers.append("e5-small")
    return tiers


def _create_model_backend(tier: str):
    if tier == "bge-m3":
        tokenizer_path = _download_model_file(
            E5_TOKENIZER_FILE,
            repository=BGE_M3_REPOSITORY,
            revision=BGE_M3_REVISION,
        )
        model_path = _download_model_file(
            BGE_M3_MODEL_FILE,
            repository=BGE_M3_REPOSITORY,
            revision=BGE_M3_REVISION,
        )
        for filename in BGE_M3_EXTERNAL_FILES:
            _download_model_file(
                filename,
                repository=BGE_M3_REPOSITORY,
                revision=BGE_M3_REVISION,
            )
        return _BgeM3OnnxBackend(model_path, tokenizer_path)
    if tier == "e5-base":
        tokenizer_path = _download_model_file(
            E5_TOKENIZER_FILE,
            repository=E5_BASE_REPOSITORY,
            revision=E5_BASE_REVISION,
        )
        model_path = _download_model_file(
            E5_BASE_MODEL_FILE,
            repository=E5_BASE_REPOSITORY,
            revision=E5_BASE_REVISION,
        )
        return _E5OnnxBackend(
            model_path,
            tokenizer_path,
            name="multilingual-e5-base-onnx",
            model_key=E5_BASE_MODEL_KEY,
            dimensions=768,
        )
    tokenizer_path = _download_model_file(E5_TOKENIZER_FILE)
    model_path = _download_model_file(E5_MODEL_FILE)
    return _E5OnnxBackend(model_path, tokenizer_path)


def _create_e5_backend():
    errors = []
    for tier in _embedding_model_tiers():
        try:
            return _create_model_backend(tier)
        except Exception as error:
            errors.append(f"{tier}: {error}")
    raise RuntimeError("; ".join(errors))


def _get_embedding_backend():
    return current_runtime().get_backend()





def unload_embedding_backend() -> bool:
    return current_runtime().unload()





def embedding_backend_status() -> dict[str, Any]:
    return current_runtime().status()



def warm_embedding_backend() -> dict[str, Any]:
    return current_runtime().warm()



def _reset_embedding_backend_for_tests():
    return current_runtime().unload()



def shared_embedding_backend():
    """공용 로컬 임베딩 백엔드를 반환한다.

    문서 RAG(theory_search)와 User Memory RAG(user_memory)가 동일한 E5/BGE-M3
    ONNX 런타임을 재사용하되, 인덱스·캐시는 완전히 분리된다. 모델을 쓸 수
    없으면 hashed-lexical 폴백이 반환되므로 오프라인에서도 검색이 동작한다.
    """

    return _get_embedding_backend()


def _keyword_score(text: str, keywords: list[str]) -> tuple[float, list[str]]:
    normalized = _normalized_text(text)
    text_tokens = set(_tokens(normalized))
    if not normalized or not keywords:
        return 0.0, []
    scores: list[float] = []
    matched: list[str] = []
    for keyword in keywords:
        normalized_keyword = _normalized_text(keyword)
        keyword_tokens = set(_tokens(normalized_keyword))
        exact = bool(normalized_keyword and normalized_keyword in normalized)
        coverage = len(keyword_tokens & text_tokens) / len(keyword_tokens) if keyword_tokens else 0.0
        score = 1.0 if exact else coverage * 0.75
        scores.append(score)
        if score >= 0.5:
            matched.append(keyword)
    strongest = sorted(scores, reverse=True)[: min(5, len(scores))]
    return (sum(strongest) / len(strongest) if strongest else 0.0), matched


def _looks_like_toc(text: str) -> bool:
    lines = [line.strip() for line in str(text or "").splitlines() if line.strip()]
    numbered = sum(1 for line in lines if re.search(r"\s\d{1,4}\s*$", line))
    return numbered >= 4 and numbered >= max(1, len(lines) // 3)


def _looks_like_answer(title: str, text: str) -> bool:
    if _ANSWER_TITLE_PATTERN.search(str(title or "")):
        return True
    first_line = next((line.strip() for line in str(text or "").splitlines() if line.strip()), "")
    return bool(_ANSWER_TITLE_PATTERN.search(first_line))


def _looks_like_exercise(title: str, text: str) -> bool:
    if _EXERCISE_TITLE_PATTERN.search(str(title or "")) or _OPEN_CHALLENGE_PATTERN.search(str(title or "")):
        return True
    first_lines = [
        re.sub(r"\s+", " ", line).strip()
        for line in str(text or "").splitlines()[:4]
        if line.strip()
    ]
    return any(
        _EXERCISE_TITLE_PATTERN.search(line) or _OPEN_CHALLENGE_PATTERN.search(line)
        for line in first_lines
    )


def _outline_items(raw_outline: Any) -> list[dict[str, Any]]:
    items = []
    if not isinstance(raw_outline, list):
        return items
    for raw in raw_outline:
        if not isinstance(raw, Mapping):
            continue
        try:
            page = max(1, int(raw.get("page") or 1))
        except (TypeError, ValueError, OverflowError):
            continue
        title = re.sub(r"\s+", " ", str(raw.get("title") or "")).strip()
        if not title:
            continue
        try:
            level = max(1, int(raw.get("level") or 1))
        except (TypeError, ValueError, OverflowError):
            level = 1
        items.append({"title": title, "page": page, "level": level})
    items.sort(key=lambda item: (item["page"], item["level"]))
    return items


def _page_outline_title(page: int, outline: list[dict[str, Any]]) -> str:
    title = ""
    for item in outline:
        if item["page"] > page:
            break
        title = item["title"]
    return title


def _chapter_boundaries(outline: list[dict[str, Any]], page_count: int) -> list[dict[str, Any]]:
    chapters = [item for item in outline if int(item.get("level", 1)) == 1]
    result = []
    for index, item in enumerate(chapters):
        end = chapters[index + 1]["page"] - 1 if index + 1 < len(chapters) else page_count
        result.append({**item, "end": max(item["page"], end), "index": index})
    return result


def _exercise_chapter(
    chapters: list[dict[str, Any]],
    exercise_page: int,
    problem_chapter: str,
) -> dict[str, Any] | None:
    wanted = _normalized_text(problem_chapter)
    if wanted:
        direct = next(
            (
                chapter
                for chapter in chapters
                if wanted in _normalized_text(chapter["title"])
                or _normalized_text(chapter["title"]) in wanted
            ),
            None,
        )
        if direct:
            return direct
    return next(
        (chapter for chapter in reversed(chapters) if chapter["page"] <= exercise_page),
        None,
    )


def _chapter_bucket(page: int, chapters: list[dict[str, Any]], current: dict[str, Any] | None) -> int:
    del chapters
    if current is None:
        return 0
    if current["page"] <= page <= current["end"]:
        return 0
    if page < current["page"]:
        return 1
    return 2


def _snippet(text: str, keywords: list[str], limit: int = 240) -> str:
    lines = [re.sub(r"\s+", " ", line).strip() for line in str(text or "").splitlines() if line.strip()]
    lowered_keywords = [_normalized_text(keyword) for keyword in keywords]
    selected = next(
        (
            line
            for line in lines
            if any(keyword and keyword in _normalized_text(line) for keyword in lowered_keywords)
        ),
        lines[0] if lines else "",
    )
    return selected[:limit]


def _split_text_chunks(text: str) -> list[str]:
    value = str(text or "").strip()
    if not value:
        return []
    chunks: list[str] = []
    start = 0
    while start < len(value):
        proposed_end = min(len(value), start + CHUNK_TARGET_CHARS)
        end = proposed_end
        if proposed_end < len(value):
            minimum_break = start + int(CHUNK_TARGET_CHARS * 0.6)
            line_break = value.rfind("\n", minimum_break, proposed_end)
            space_break = value.rfind(" ", minimum_break, proposed_end)
            selected_break = max(line_break, space_break)
            if selected_break > start:
                end = selected_break
        chunk = value[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(value):
            break
        next_start = max(start + 1, end - CHUNK_OVERLAP_CHARS)
        start = next_start
    return chunks


def _build_chunks(pages: list[dict], outline: list[dict[str, Any]]) -> list[dict[str, Any]]:
    chunks: list[dict[str, Any]] = []
    for page in pages:
        page_number = int(page.get("page") or 0)
        text = str(page.get("text") or "")
        title = _page_outline_title(page_number, outline)
        for chunk_index, chunk_text in enumerate(_split_text_chunks(text)):
            embedding_text = f"{title}\n{chunk_text}" if title else chunk_text
            chunks.append({
                "page": page_number,
                "chunk_index": chunk_index,
                "title": title,
                "text": chunk_text,
                "embedding_text": embedding_text,
                "text_hash": hashlib.sha256(embedding_text.encode("utf-8", errors="replace")).hexdigest(),
            })
    return chunks


def _document_pages(path: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    normalized = os.path.abspath(str(path or ""))
    if not os.path.isfile(normalized):
        raise FileNotFoundError("학습자료 파일을 찾을 수 없습니다.")
    extension = os.path.splitext(normalized)[1].casefold()
    if extension == ".pdf":
        status = pdf_ocr_status(normalized, rebuild_native_index=True)
        if not status.get("has_text") or status.get("index_repair_required"):
            return [], _outline_items(status.get("outline"))
        from documents.answer_key_visibility import redact_page
        return [redact_page(normalized, page) for page in indexed_pdf_pages(normalized, status=status)], _outline_items(status.get("outline"))
    if extension in {".md", ".txt"}:
        from documents.answer_key_visibility import hidden
        if hidden(normalized):
            return [], []
        with open(normalized, "r", encoding="utf-8", errors="replace") as handle:
            return [{"page": 1, "text": handle.read()}], []
    if extension == ".ipynb":
        return [{"page": 1, "text": _notebook_plain_text(normalized)}], []
    raise ValueError("벡터 검색은 PDF, Markdown, TXT, Notebook 파일만 지원합니다.")


def _notebook_plain_text(path: str) -> str:
    """Notebook 셀(마크다운/코드)을 검색 가능한 단일 텍스트로 변환한다."""

    try:
        with open(path, "r", encoding="utf-8", errors="replace") as handle:
            notebook = json.load(handle)
    except (OSError, ValueError):
        return ""
    if not isinstance(notebook, dict):
        return ""
    parts: list[str] = []
    cells = notebook.get("cells")
    for cell in cells if isinstance(cells, list) else []:
        if not isinstance(cell, dict):
            continue
        source = cell.get("source")
        if isinstance(source, list):
            source_text = "".join(str(item) for item in source)
        else:
            source_text = str(source or "")
        source_text = source_text.strip()
        if not source_text:
            continue
        cell_type = str(cell.get("cell_type") or "")
        if cell_type == "code":
            parts.append(f"```python\n{source_text}\n```")
        else:
            parts.append(source_text)
    return "\n\n".join(parts)


def _generic_document_chunks(path: str) -> tuple[list[dict[str, Any]], str]:
    pages, outline = _document_pages(path)
    chunks = _build_chunks(pages, outline)
    return chunks, _source_digest(chunks)


def _document_revision(path: str, digest: str, model_key: str) -> str:
    value = f"{os.path.abspath(path)}\0{digest}\0{model_key}\0{CHUNK_TARGET_CHARS}:{CHUNK_OVERLAP_CHARS}"
    return hashlib.sha256(value.encode("utf-8", errors="replace")).hexdigest()


def _no_text_reason(path: str) -> str:
    if os.path.splitext(path)[1].casefold() == ".pdf":
        return "OCR 필요"
    return "문서에서 검색 가능한 텍스트를 찾지 못했습니다."


def index_document(path: str) -> dict[str, Any]:
    """Populate the existing persistent embedding cache for one local document."""

    normalized = os.path.abspath(str(path or ""))
    chunks, digest = _generic_document_chunks(normalized)
    if not chunks:
        return {"status": "unavailable", "document_id": normalized, "reason": _no_text_reason(normalized)}
    backend = _get_embedding_backend()
    _vectors, cache = _cached_passage_vectors(normalized, chunks, backend, document_digest=digest, background=True)
    return {
        "status": "ready",
        "document_id": normalized,
        "index_revision": _document_revision(normalized, digest, backend.model_key),
        "chunk_count": len(chunks),
        "embedding_backend": backend.name,
        "embedding_model_key": backend.model_key,
        "degraded": bool(backend.degraded),
        "embedding_cache": cache,
    }




def enqueue_document_index(path: str) -> bool:
    return current_runtime().enqueue(path)



def document_index_status(path: str) -> dict[str, Any]:
    return current_runtime().index_status(path)



@prioritize_chatbot()
def search_document_context(
    path: str,
    *,
    action: str = "search",
    query: str = "",
    textbook_terms: str = "",
    top_k: int = 5,
    retrieval_state: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    from chat.document_retrieval import search
    import sys
    return search(sys.modules[__name__], path, action=action, query=query,
                  textbook_terms=textbook_terms, top_k=top_k, retrieval_state=retrieval_state)


def _source_digest(chunks: list[dict[str, Any]]) -> str:
    digest = hashlib.sha256()
    for chunk in chunks:
        digest.update(f"{chunk['page']}:{chunk['chunk_index']}:".encode("ascii"))
        digest.update(chunk["text_hash"].encode("ascii"))
        digest.update(b"\0")
    return digest.hexdigest()


@prioritize_chatbot()
def search_materials_semantic(root: str, query: str, limit: int = 20) -> dict[str, Any]:
    from chat.material_semantic_search import search
    import sys
    return search(sys.modules[__name__], root, query, limit)


def _embedding_database_path() -> str:
    appdata = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA") or tempfile.gettempdir()
    directory = os.path.join(appdata, "AILS", "search")
    os.makedirs(directory, exist_ok=True)
    return os.path.join(directory, "pdf_theory_embeddings.sqlite3")


def _connect_embedding_cache() -> sqlite3.Connection:
    connection = sqlite3.connect(_embedding_database_path(), timeout=30)
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA synchronous=NORMAL")
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS pdf_theory_embeddings (
            path TEXT NOT NULL,
            source_digest TEXT NOT NULL,
            page INTEGER NOT NULL,
            chunk_index INTEGER NOT NULL,
            model TEXT NOT NULL,
            text_hash TEXT NOT NULL,
            dimensions INTEGER NOT NULL,
            vector BLOB NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY(path, source_digest, page, chunk_index, model)
        )
        """
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_pdf_theory_embedding_lookup "
        "ON pdf_theory_embeddings(path, model, source_digest)"
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_pdf_theory_embedding_model_path "
        "ON pdf_theory_embeddings(model, path)"
    )
    return connection


def _cached_passage_vectors(
    path: str,
    chunks: list[dict[str, Any]],
    backend,
    document_digest: str | None = None,
    background: bool = False,
) -> tuple[np.ndarray, dict[str, Any]]:
    """Load stable page chunks from SQLite and encode only cache misses."""

    import numpy as np
    if not chunks:
        return np.empty((0, backend.dimensions), dtype=np.float32), {
            "persistent": not backend.degraded,
            "hits": 0,
            "misses": 0,
        }
    if backend.degraded:
        return backend.encode([chunk["embedding_text"] for chunk in chunks], "passage"), {
            "persistent": False,
            "hits": 0,
            "misses": len(chunks),
        }

    normalized_path = os.path.abspath(str(path or ""))
    digest = document_digest or _source_digest(chunks)
    expected = {
        (int(chunk["page"]), int(chunk["chunk_index"])): chunk
        for chunk in chunks
    }
    cached: dict[tuple[int, int], np.ndarray] = {}
    cache_available = True
    try:
        with current_runtime().cache_lock, closing(_connect_embedding_cache()) as connection:
            rows = connection.execute(
                "SELECT page, chunk_index, text_hash, dimensions, vector "
                "FROM pdf_theory_embeddings WHERE path = ? AND model = ? AND source_digest = ?",
                (normalized_path, backend.model_key, digest),
            ).fetchall()
            for page, chunk_index, text_hash, dimensions, blob in rows:
                key = (int(page), int(chunk_index))
                chunk = expected.get(key)
                if not chunk or text_hash != chunk["text_hash"]:
                    continue
                vector = np.frombuffer(blob, dtype="<f4")
                if vector.size != int(dimensions) or vector.size <= 0 or not np.isfinite(vector).all():
                    continue
                cached[key] = vector.astype(np.float32, copy=True)
    except Exception:
        cache_available = False
        cached = {}

    missing = [
        chunk
        for chunk in chunks
        if (int(chunk["page"]), int(chunk["chunk_index"])) not in cached
    ]
    if missing:
        # 슬라이스 단위로 인코딩·저장해 대형 문서 도중 중단(프로그램 종료 등) 시
        # 이미 저장한 청크는 다음 실행에서 캐시 적중으로 이어진다.
        stale_digest_deleted = False
        slice_size = min(EMBEDDING_COMMIT_SLICE, EMBEDDING_BATCH_SIZE) if background else EMBEDDING_COMMIT_SLICE
        for start in range(0, len(missing), slice_size):
            current_runtime().check_cancelled()
            if background:
                _wait_for_chatbot()
            batch = missing[start:start + slice_size]
            encoded = backend.encode([chunk["embedding_text"] for chunk in batch], "passage")
            current_runtime().check_cancelled()
            if len(encoded) != len(batch):
                raise RuntimeError("E5 returned a different number of embeddings than requested.")
            for chunk, vector in zip(batch, encoded):
                cached[(int(chunk["page"]), int(chunk["chunk_index"]))] = np.asarray(vector, dtype=np.float32)

            if cache_available:
                try:
                    with current_runtime().cache_lock, closing(_connect_embedding_cache()) as connection:
                        if not stale_digest_deleted:
                            connection.execute(
                                "DELETE FROM pdf_theory_embeddings WHERE path = ? AND model = ? AND source_digest <> ?",
                                (normalized_path, backend.model_key, digest),
                            )
                            stale_digest_deleted = True
                        connection.executemany(
                            "INSERT OR REPLACE INTO pdf_theory_embeddings"
                            "(path, source_digest, page, chunk_index, model, text_hash, dimensions, vector, updated_at) "
                            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
                            [
                                (
                                    normalized_path,
                                    digest,
                                    int(chunk["page"]),
                                    int(chunk["chunk_index"]),
                                    backend.model_key,
                                    chunk["text_hash"],
                                    int(np.asarray(vector).size),
                                    sqlite3.Binary(np.asarray(vector, dtype="<f4").tobytes()),
                                )
                                for chunk, vector in zip(batch, encoded)
                            ],
                        )
                        current_runtime().check_cancelled()
                        connection.commit()
                except EmbeddingCancelled:
                    raise
                except Exception:
                    cache_available = False

    vectors = np.stack([
        cached[(int(chunk["page"]), int(chunk["chunk_index"]))]
        for chunk in chunks
    ]).astype(np.float32, copy=False)
    return vectors, {
        "persistent": cache_available,
        "hits": len(chunks) - len(missing),
        "misses": len(missing),
    }


def _encode_search_material(
    backend,
    path: str,
    query: str,
    concepts: list[str],
    chunks: list[dict],
    document_digest: str | None = None,
):
    query_texts = [query, *concepts]
    query_vectors = backend.encode(query_texts, "query")
    if len(query_vectors) != len(query_texts):
        raise RuntimeError("E5 returned a different number of query embeddings than requested.")
    passage_vectors, cache_info = _cached_passage_vectors(
        path,
        chunks,
        backend,
        document_digest=document_digest,
    )
    return query_vectors[0], query_vectors[1:], passage_vectors, cache_info


def _semantic_candidate_chunks(
    chunks: list[dict[str, Any]],
    *,
    query: str,
    keywords: list[str],
    exercise_page: int,
    chapters: list[dict[str, Any]],
    current_chapter: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    import numpy as np
    if len(chunks) <= SEMANTIC_CANDIDATE_LIMIT:
        return chunks

    query_feature = _feature_embedding(query)
    ranked = []
    for chunk in chunks:
        page = int(chunk["page"])
        keyword_score, _matched = _keyword_score(chunk["text"], keywords)
        title_score, _title_matches = _keyword_score(chunk.get("title", ""), keywords)
        feature_score = max(
            0.0,
            min(1.0, float(np.dot(query_feature, _feature_embedding(chunk["embedding_text"])))),
        )
        prefilter_score = (
            feature_score * EMBEDDING_WEIGHT
            + keyword_score * KEYWORD_WEIGHT
            + title_score * TITLE_WEIGHT
            + page_bonus(page, exercise_page) * PAGE_WEIGHT
        )
        ranked.append((
            chunk,
            prefilter_score,
            keyword_score,
            _chapter_bucket(page, chapters, current_chapter),
        ))

    ranked.sort(
        key=lambda item: (
            item[3],
            -item[1],
            abs(exercise_page - int(item[0]["page"])),
        )
    )
    selected: list[dict[str, Any]] = []
    selected_keys: set[tuple[int, int]] = set()

    def add(item) -> None:
        chunk = item[0]
        key = (int(chunk["page"]), int(chunk["chunk_index"]))
        if key in selected_keys or len(selected) >= SEMANTIC_CANDIDATE_LIMIT:
            return
        selected_keys.add(key)
        selected.append(chunk)

    current_candidates = [
        item
        for item in ranked
        if item[3] == 0 and int(item[0]["page"]) <= exercise_page
    ]
    for item in current_candidates[:CURRENT_CHAPTER_CANDIDATE_LIMIT]:
        add(item)
    for item in ranked:
        if item[2] >= 0.5:
            add(item)
    for item in ranked:
        add(item)
        if len(selected) >= SEMANTIC_CANDIDATE_LIMIT:
            break
    return selected


def _semantic_cutoff(scores: list[float], degraded: bool) -> float:
    if not scores:
        return 1.0
    strongest = max(scores)
    if degraded:
        return min(strongest, max(0.035, strongest - 0.12))
    # E5 cosine scores naturally occupy a narrow high range. Relative distance
    # from the best page is therefore more useful than a hard universal cutoff.
    return min(strongest, max(0.68, strongest - 0.075))


def _retrieval_stage(
    page: int,
    exercise_page: int,
    exercise_page_end: int,
    chapter_priority: int,
    looks_like_answer: bool,
) -> int:
    if page > exercise_page_end:
        return 4 if looks_like_answer else 3
    if chapter_priority == 0:
        return 0
    if chapter_priority == 1:
        return 1
    return 2


def hybrid_search_pdf(
    path: str,
    *,
    core_concepts: Iterable[Any],
    search_keywords: Iterable[Any],
    exercise_page: int,
    exercise_page_end: int | None = None,
    problem_chapter: str = "",
    limit: int = 6,
) -> dict[str, Any]:
    import numpy as np
    concepts = _unique_texts(core_concepts, limit=12)
    keywords = _unique_texts([*search_keywords, *concepts], limit=32)
    if not keywords:
        return {
            "query": "",
            "results": [],
            "embedding_backend": "not-used",
            "degraded": False,
        }

    first_exercise_page = max(1, int(exercise_page))
    last_exercise_page = max(first_exercise_page, int(exercise_page_end or first_exercise_page))
    status = pdf_ocr_status(path)
    pages = indexed_pdf_pages(path, status=status)
    from documents.answer_key_visibility import redact_page
    pages = [redact_page(path, page) for page in pages]
    outline = _outline_items(status.get("outline"))
    chapters = _chapter_boundaries(outline, len(pages))
    current_chapter = _exercise_chapter(chapters, first_exercise_page, problem_chapter)
    query = " ".join(keywords)

    searchable_pages = []
    for page in pages:
        page_number = int(page.get("page") or 0)
        text = str(page.get("text") or "")
        if page_number <= 0 or first_exercise_page <= page_number <= last_exercise_page:
            continue
        if not text.strip() or _looks_like_toc(text):
            continue
        if _looks_like_exercise(_page_outline_title(page_number, outline), text):
            continue
        searchable_pages.append(page)
    all_chunks = _build_chunks(searchable_pages, outline)
    if not all_chunks:
        return {
            "query": query,
            "results": [],
            "embedding_backend": "not-used",
            "degraded": False,
        }
    document_digest = _source_digest(all_chunks)
    chunks = _semantic_candidate_chunks(
        all_chunks,
        query=query,
        keywords=keywords,
        exercise_page=first_exercise_page,
        chapters=chapters,
        current_chapter=current_chapter,
    )

    backend = _get_embedding_backend()
    try:
        query_vector, concept_vectors, passage_vectors, cache_info = _encode_search_material(
            backend,
            path,
            query,
            concepts,
            chunks,
            document_digest=document_digest,
        )
    except Exception as error:
        if backend.degraded:
            raise
        backend = _LexicalFallbackBackend(str(error))
        query_vector, concept_vectors, passage_vectors, cache_info = _encode_search_material(
            backend,
            path,
            query,
            concepts,
            chunks,
            document_digest=document_digest,
        )
    cache_info = {
        **cache_info,
        "candidate_chunks": len(chunks),
        "total_chunks": len(all_chunks),
    }

    chunk_vectors_by_page: dict[int, list[np.ndarray]] = {}
    for chunk, vector in zip(chunks, passage_vectors):
        chunk_vectors_by_page.setdefault(int(chunk["page"]), []).append(vector)

    candidates: list[dict[str, Any]] = []
    for page in searchable_pages:
        page_number = int(page.get("page") or 0)
        text = str(page.get("text") or "")
        page_vectors = chunk_vectors_by_page.get(page_number, [])
        if not page_vectors:
            continue
        semantic_score = max(
            0.0,
            min(1.0, max(float(np.dot(query_vector, vector)) for vector in page_vectors)),
        )
        keyword_score, matched_keywords = _keyword_score(text, keywords)
        outline_title = _page_outline_title(page_number, outline)
        title_score, _title_matches = _keyword_score(outline_title, keywords)
        location_score = page_bonus(page_number, first_exercise_page)
        final_score = (
            semantic_score * EMBEDDING_WEIGHT
            + keyword_score * KEYWORD_WEIGHT
            + title_score * TITLE_WEIGHT
            + location_score * PAGE_WEIGHT
        )
        concept = ""
        if len(concept_vectors):
            concept_index = max(
                range(len(concepts)),
                key=lambda index: max(
                    float(np.dot(concept_vectors[index], vector)) for vector in page_vectors
                ),
            )
            concept = concepts[concept_index]
        chapter_priority = _chapter_bucket(page_number, chapters, current_chapter)
        candidates.append({
            "page": page_number,
            "title": outline_title or (concept if concept else f"{page_number}페이지"),
            "concept": concept,
            "snippet": _snippet(text, matched_keywords or keywords),
            "score": round(final_score, 6),
            "semantic_score": round(semantic_score, 6),
            "keyword_score": round(keyword_score, 6),
            "title_score": round(title_score, 6),
            "page_bonus": round(location_score, 6),
            "chapter_priority": chapter_priority,
            "matched_keywords": matched_keywords[:8],
            "looks_like_answer": _looks_like_answer(outline_title, text),
        })

    cutoff = _semantic_cutoff([item["semantic_score"] for item in candidates], backend.degraded)
    relevant = [
        item
        for item in candidates
        if item["keyword_score"] >= 0.1
        or item["title_score"] >= 0.1
        or item["semantic_score"] >= cutoff
    ]
    # Relevance is decided before chapter staging. A weak same-chapter page must
    # not displace a strongly related page from an earlier chapter.
    for item in relevant:
        item["retrieval_stage"] = _retrieval_stage(
            item["page"],
            first_exercise_page,
            last_exercise_page,
            item["chapter_priority"],
            bool(item.pop("looks_like_answer", False)),
        )
    relevant.sort(key=lambda item: (item["retrieval_stage"], -item["score"], abs(first_exercise_page - item["page"])))

    result_limit = max(1, min(int(limit), 12))
    selected: list[dict[str, Any]] = []
    used_pages: set[int] = set()
    before_problem = [item for item in relevant if item["retrieval_stage"] <= 2]
    # Preserve one useful page per concept, but never select a later answer page
    # merely to satisfy concept diversity while relevant theory exists up front.
    for concept in concepts:
        candidate = next(
            (item for item in before_problem if item["concept"] == concept and item["page"] not in used_pages),
            None,
        )
        if candidate:
            selected.append(candidate)
            used_pages.add(candidate["page"])
            if len(selected) >= result_limit:
                break
    for item in relevant:
        if len(selected) >= result_limit:
            break
        if item["page"] in used_pages:
            continue
        selected.append(item)
        used_pages.add(item["page"])
    selected.sort(key=lambda item: (item["retrieval_stage"], -item["score"]))

    response = {
        "query": query,
        "weights": {
            "semantic": EMBEDDING_WEIGHT,
            "keyword": KEYWORD_WEIGHT,
            "title": TITLE_WEIGHT,
            "page": PAGE_WEIGHT,
        },
        "chapter": current_chapter["title"] if current_chapter else "",
        "embedding_backend": backend.name,
        "degraded": bool(backend.degraded),
        "embedding_cache": cache_info,
        "results": selected,
    }
    if backend.degraded:
        response["embedding_error"] = backend.error
    return response


__all__ = [
    "document_index_status",
    "enqueue_document_index",
    "hybrid_search_pdf",
    "index_document",
    "page_bonus",
    "search_document_context",
]
