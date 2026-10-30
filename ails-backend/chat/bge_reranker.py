"""Measured BGE v2 M3 weight-only INT8 reranking, independent of benchmarks."""
from __future__ import annotations

import hashlib
import os
import tempfile
import threading
import time
from pathlib import Path

import numpy as np

from chat.retrieval_inference import RetrievalSession


MODEL_ID = "BAAI/bge-reranker-v2-m3"
MODEL_REVISION = "953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e"
MODEL_KEY = f"{MODEL_ID}@{MODEL_REVISION}:w8-batch1-2048-v1"
CANDIDATE_K = 20
EVIDENCE_K = 5
ASSET_HASHES = {
    "bge-w8.xml": "e58a39ea5a1bf967d589a4d4aa1873a739ed12bb056de1c14018d4e39cd8989e",
    "bge-w8.bin": "4528659e8892764a3c43fa6b551dd3e61a8f8227c5314a44657f68938470b1a4",
    "tokenizer.json": "8bf8afbfd11306bd872018c53bfdf2e160a56f8edbcf49933324404791c148d3",
}


def model_directory() -> Path:
    configured = os.environ.get("AILS_RERANKER_MODEL_DIR", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    base = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA") or tempfile.gettempdir()
    return Path(base) / "AILS/models/retrieval/bge-reranker-v2-m3-w8-v1"


def validate_assets(directory: Path) -> None:
    for name, expected in ASSET_HASHES.items():
        path = directory / name
        if not path.is_file():
            raise FileNotFoundError("BGE reranker assets are not provisioned: " + str(path))
        with path.open("rb") as stream:
            actual = hashlib.file_digest(stream, "sha256").hexdigest()
        if actual != expected:
            raise RuntimeError("BGE reranker asset hash mismatch: " + name)


class BgeReranker:
    model_key = MODEL_KEY

    def __init__(self, directory: Path | None = None, *, tokenizer=None, session=None):
        directory = directory or model_directory()
        if tokenizer is None or session is None:
            validate_assets(directory)
        if tokenizer is None:
            from tokenizers import Tokenizer
            tokenizer = Tokenizer.from_file(str(directory / "tokenizer.json"))
        self._tokenizer = tokenizer
        self._tokenizer.no_padding()
        self._tokenizer.enable_truncation(max_length=2048, strategy="only_second")
        self._session = session or RetrievalSession(str(directory / "bge-w8.xml"), max_tokens=2048,
                                                   cache_dir=str(directory / "engine-cache"))
        self._lock = threading.Lock()

    @property
    def evidence(self):
        metadata = dict(self._session.evidence)
        device = str(metadata.get("device", ""))
        return {**metadata, "model": self.model_key, "weight_precision": "INT8",
                "compute_precision": "W8A16" if device.startswith("GPU") else "W8 / CPU default",
                "batch": 1, "max_tokens": 2048}

    def rerank(self, query: str, documents: list[str], top_k: int = EVIDENCE_K):
        if top_k < 0:
            raise ValueError("top_k must be nonnegative")
        if not documents or top_k == 0:
            return []
        scores = []
        with self._lock:
            for document in documents:
                row = self._tokenizer.encode(str(query), str(document), add_special_tokens=True)
                values = {"input_ids": [row.ids], "attention_mask": [row.attention_mask],
                          "token_type_ids": [row.type_ids]}
                feed = {spec.name: np.asarray(values[spec.name], dtype=np.int64) for spec in self._session.get_inputs()}
                outputs = self._session.run(None, feed)
                logits = np.asarray(outputs[0])
                if logits.size != 1 or not np.isfinite(logits).all():
                    raise RuntimeError("BGE reranker must produce one finite logit per pair")
                scores.append(float(1 / (1 + np.exp(-np.clip(float(logits.reshape(-1)[0]), -700, 700)))))
        order = np.argsort(-np.asarray(scores), kind="stable")[:top_k]
        return [{"index": int(i), "score": scores[int(i)]} for i in order]


_lock = threading.RLock()
_backend = None
_retry_at = 0.0
_error = ""
_idle_timer = None


def unload_reranker():
    global _backend, _idle_timer
    with _lock:
        _backend = None
        if _idle_timer is not None:
            _idle_timer.cancel()
            _idle_timer = None


def _unload_if_idle(timer):
    with _lock:
        if _idle_timer is timer:
            unload_reranker()


def rerank_candidates(query: str, documents: list[str], top_k: int):
    """Return scores plus explicit fallback status. Never pretend dense is reranked."""
    global _backend, _retry_at, _error, _idle_timer
    if not documents:
        return [], {"status": "not_needed", "model": MODEL_KEY}
    with _lock:
        try:
            if _backend is None:
                if time.monotonic() < _retry_at:
                    return None, {"status": "unavailable", "model": MODEL_KEY, "reason": _error}
                _backend = BgeReranker()
            ranked = _backend.rerank(query, documents, top_k)
            metadata = {"status": "ready", **_backend.evidence}
            if _idle_timer is not None:
                _idle_timer.cancel()
            timer = threading.Timer(900, lambda: _unload_if_idle(timer))
            timer.daemon = True
            _idle_timer = timer
            timer.start()
            return ranked, metadata
        except Exception as error:
            _backend = None
            _error = f"{type(error).__name__}: {error}"[:500]
            _retry_at = time.monotonic() + 300
            return None, {"status": "unavailable", "model": MODEL_KEY, "reason": _error}
