from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import threading
import uuid
from pathlib import Path
from typing import Callable

from common import resource_path


MODEL_FILE_SUFFIXES = frozenset({".bin", ".gguf", ".json", ".model", ".onnx", ".tokens", ".txt", ".vocab", ".yaml", ".yml"})
SAFE_SEGMENT_RE = re.compile(r"^[A-Za-z0-9._-]+$")
DOWNLOAD_CHUNK_SIZE = 1024 * 1024


class ModelUnavailableError(RuntimeError):
    pass


class ModelDownloadCancelled(ModelUnavailableError):
    pass


def default_model_store() -> Path:
    override = str(os.environ.get("AILS_MODEL_HOME", "") or "").strip()
    if override:
        return Path(override).expanduser().resolve()
    local_app_data = str(os.environ.get("LOCALAPPDATA", "") or "").strip()
    if local_app_data:
        return (Path(local_app_data) / "AILS" / "models").resolve()
    return (Path.home() / ".local" / "share" / "AILS" / "models").resolve()


class ModelManager:
    def __init__(
        self,
        manifest_dir: str | os.PathLike[str] | None = None,
        store_dir: str | os.PathLike[str] | None = None,
        open_url: Callable | None = None,
    ) -> None:
        self.manifest_dir = Path(
            manifest_dir or resource_path("model_manifests")
        ).resolve()
        self.store_dir = Path(store_dir).resolve() if store_dir else default_model_store()
        self._open_url = open_url
        self._locks: dict[str, threading.Lock] = {}
        self._locks_guard = threading.Lock()

    def manifest(self, model_id: str) -> dict:
        self._safe_segment(model_id, "model ID")
        path = (self.manifest_dir / f"{model_id}.json").resolve()
        if path.parent != self.manifest_dir:
            raise ModelUnavailableError("AI 모델 manifest 경로가 안전하지 않습니다.")
        if not path.is_file() and re.fullmatch(r"llmfit-[0-9a-f]{24}", model_id):
            from edition_manifest import require_feature
            require_feature("developer_tools")
            path = self._safe_child(self.store_dir, f".catalog/{model_id}.json")
        if not path.is_file():
            raise ModelUnavailableError(f"알 수 없는 AI 모델입니다: {model_id}")
        with path.open("r", encoding="utf-8") as handle:
            manifest = json.load(handle)
        self._validate_manifest(manifest, expected_model_id=model_id)
        return manifest

    def register_recommendation(self, manifest: dict) -> None:
        """Persist an exact, checksum-pinned GGUF in the existing model store."""
        from edition_manifest import require_feature
        require_feature("developer_tools")
        self._validate_manifest(manifest)
        model_id = manifest["model_id"]
        if not re.fullmatch(r"llmfit-[0-9a-f]{24}", model_id):
            raise ModelUnavailableError("추천 모델 ID가 올바르지 않습니다.")
        self._write_json_atomic(self._safe_child(self.store_dir, f".catalog/{model_id}.json"), manifest)

    def status(self, model_id: str) -> dict:
        available = self.manifest(model_id)
        current_version = self._read_current_version(model_id)
        installed_manifest = None
        installed_dir = None
        if current_version:
            candidate = self._version_dir(model_id, current_version)
            installed_manifest = self._read_installed_manifest(candidate, model_id)
            if installed_manifest and self._verify_files(candidate, installed_manifest):
                installed_dir = candidate
        if installed_dir is None:
            candidate = self._version_dir(model_id, available["version"])
            if self._verify_files(candidate, available):
                installed_manifest = available
                installed_dir = candidate
                current_version = available["version"]

        ready = installed_dir is not None
        return {
            "model_id": model_id,
            "ready": ready,
            "installed": ready,
            "download_required": not ready,
            "update_available": bool(
                ready and current_version != available["version"]
            ),
            "current_version": current_version or "",
            "available_version": available["version"],
            "file_size": available["file_size"],
            "required_files": list(available["required_files"]),
            "license": available["license"],
            "purpose": available["purpose"],
            "download_urls": list(available["download_urls"]),
            "install_path": str(installed_dir) if installed_dir else "",
        }

    def resolve(self, model_id: str) -> Path:
        status = self.status(model_id)
        if not status["ready"]:
            raise ModelUnavailableError(
                "이 기능을 사용하려면 AI 모델을 먼저 다운로드해야 합니다."
            )
        return Path(status["install_path"])

    def install(
        self,
        model_id: str,
        progress: Callable[[dict], None] | None = None,
        cancel_check: Callable[[], bool] | None = None,
    ) -> dict:
        manifest = self.manifest(model_id)
        with self._model_lock(model_id):
            current = self.status(model_id)
            if current["ready"] and not current["update_available"]:
                return current
            self._install_manifest(manifest, progress, cancel_check)
            return self.status(model_id)

    def _install_manifest(self, manifest: dict, progress, cancel_check) -> None:
        model_id = manifest["model_id"]
        version = manifest["version"]
        total = manifest["file_size"]
        stage = self.store_dir / ".downloads" / model_id / version
        stage.mkdir(parents=True, exist_ok=True)
        completed = 0
        for file_spec in manifest["files"]:
            target = self._safe_child(stage, file_spec["path"])
            target.parent.mkdir(parents=True, exist_ok=True)
            if self._verify_file(target, file_spec):
                completed += file_spec["size"]
                self._emit(progress, model_id, completed, total, file_spec["path"])
                continue
            part = target.with_name(f"{target.name}.part")
            completed += self._download_file(
                model_id,
                file_spec,
                part,
                completed,
                total,
                progress,
                cancel_check,
            )
            if not self._verify_file(part, file_spec):
                part.unlink(missing_ok=True)
                raise ModelUnavailableError(
                    f"AI 모델 무결성 검증에 실패했습니다: {file_spec['path']}"
                )
            os.replace(part, target)

        manifest_path = stage / "manifest.json"
        self._write_json_atomic(manifest_path, manifest)
        if not self._verify_files(stage, manifest):
            raise ModelUnavailableError("AI 모델 설치 전 최종 검증에 실패했습니다.")

        destination = self._version_dir(model_id, version)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            quarantine = destination.with_name(
                f"{destination.name}.corrupt-{uuid.uuid4().hex}"
            )
            os.replace(destination, quarantine)
        os.replace(stage, destination)
        self._write_json_atomic(
            destination.parent / "current.json",
            {"model_id": model_id, "version": version},
        )

    def _download_file(
        self,
        model_id: str,
        file_spec: dict,
        part: Path,
        completed_before: int,
        total: int,
        progress,
        cancel_check,
    ) -> int:
        expected_size = file_spec["size"]
        offset = part.stat().st_size if part.is_file() else 0
        if offset > expected_size:
            part.unlink()
            offset = 0
        elif offset == expected_size:
            if self._verify_file(part, file_spec):
                return expected_size
            part.unlink()
            offset = 0
        if cancel_check and cancel_check():
            raise ModelDownloadCancelled("AI 모델 다운로드가 취소되었습니다.")

        # Metadata/status and already present files do not need the HTTP client.
        import urllib.request
        request = urllib.request.Request(
            file_spec["url"],
            headers={
                "User-Agent": "AILS-ModelManager/1.0",
                **({"Range": f"bytes={offset}-"} if offset else {}),
            },
        )
        open_url = self._open_url if self._open_url is not None else urllib.request.urlopen
        with open_url(request, timeout=60) as response:
            status = int(getattr(response, "status", 200) or 200)
            if offset and status != 206:
                offset = 0
            mode = "ab" if offset else "wb"
            downloaded = offset
            with part.open(mode) as handle:
                while True:
                    if cancel_check and cancel_check():
                        raise ModelDownloadCancelled("AI 모델 다운로드가 취소되었습니다.")
                    chunk = response.read(DOWNLOAD_CHUNK_SIZE)
                    if not chunk:
                        break
                    handle.write(chunk)
                    downloaded += len(chunk)
                    if downloaded > expected_size:
                        raise ModelUnavailableError(
                            f"AI 모델 파일 크기가 manifest와 다릅니다: {file_spec['path']}"
                        )
                    self._emit(
                        progress,
                        model_id,
                        completed_before + downloaded,
                        total,
                        file_spec["path"],
                    )
        if downloaded != expected_size:
            raise ModelUnavailableError(
                f"AI 모델 다운로드가 완료되지 않았습니다: {file_spec['path']}"
            )
        return downloaded

    @staticmethod
    def _emit(progress, model_id: str, completed: int, total: int, file_path: str) -> None:
        if progress:
            progress(
                {
                    "type": "model_download",
                    "model_id": model_id,
                    "completed_bytes": completed,
                    "total_bytes": total,
                    "file": file_path,
                }
            )

    def _validate_manifest(self, manifest: dict, expected_model_id: str | None = None) -> None:
        if not isinstance(manifest, dict) or manifest.get("schema_version") != 1:
            raise ModelUnavailableError("지원하지 않는 AI 모델 manifest입니다.")
        model_id = str(manifest.get("model_id", "") or "")
        version = str(manifest.get("version", "") or "")
        self._safe_segment(model_id, "model ID")
        self._safe_segment(version, "model version")
        if expected_model_id and model_id != expected_model_id:
            raise ModelUnavailableError("AI 모델 manifest ID가 파일명과 다릅니다.")
        if not str(manifest.get("license", "") or "").strip():
            raise ModelUnavailableError("AI 모델 라이선스가 없습니다.")
        if not str(manifest.get("purpose", "") or "").strip():
            raise ModelUnavailableError("AI 모델 용도가 없습니다.")
        files = manifest.get("files")
        required = manifest.get("required_files")
        urls = manifest.get("download_urls")
        if not isinstance(files, list) or not files:
            raise ModelUnavailableError("AI 모델 파일 목록이 없습니다.")
        if not isinstance(required, list) or set(required) != {
            str(item.get("path", "") or "") for item in files
        }:
            raise ModelUnavailableError("AI 모델 필수 파일 목록이 올바르지 않습니다.")
        if not isinstance(urls, list) or not urls:
            raise ModelUnavailableError("AI 모델 다운로드 URL이 없습니다.")

        total = 0
        for item in files:
            relative = str(item.get("path", "") or "")
            url = str(item.get("url", "") or "")
            digest = str(item.get("sha256", "") or "").lower()
            size = item.get("size")
            if Path(relative).is_absolute() or ".." in Path(relative).parts:
                raise ModelUnavailableError("AI 모델 파일 경로가 안전하지 않습니다.")
            if Path(relative).suffix.lower() not in MODEL_FILE_SUFFIXES:
                raise ModelUnavailableError("실행 가능한 파일은 AI 모델로 다운로드할 수 없습니다.")
            if not url.startswith("https://"):
                raise ModelUnavailableError("AI 모델은 HTTPS로만 다운로드할 수 있습니다.")
            if not re.fullmatch(r"[0-9a-f]{64}", digest):
                raise ModelUnavailableError("AI 모델 SHA-256이 올바르지 않습니다.")
            if not isinstance(size, int) or size <= 0:
                raise ModelUnavailableError("AI 모델 파일 크기가 올바르지 않습니다.")
            total += size
        if manifest.get("file_size") != total:
            raise ModelUnavailableError("AI 모델 전체 크기가 파일 목록과 다릅니다.")

    def _verify_files(self, root: Path, manifest: dict) -> bool:
        if not root.is_dir():
            return False
        try:
            return all(
                self._verify_file(self._safe_child(root, item["path"]), item)
                for item in manifest["files"]
            )
        except (OSError, ValueError):
            return False

    @staticmethod
    def _verify_file(path: Path, file_spec: dict) -> bool:
        if not path.is_file() or path.stat().st_size != file_spec["size"]:
            return False
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(DOWNLOAD_CHUNK_SIZE), b""):
                digest.update(chunk)
        return digest.hexdigest() == file_spec["sha256"]

    def _read_current_version(self, model_id: str) -> str:
        path = self.store_dir / model_id / "current.json"
        try:
            with path.open("r", encoding="utf-8") as handle:
                payload = json.load(handle)
            version = str(payload.get("version", "") or "")
            self._safe_segment(version, "model version")
            return version
        except (OSError, ValueError, json.JSONDecodeError, AttributeError):
            return ""

    def _read_installed_manifest(self, root: Path, model_id: str) -> dict | None:
        try:
            with (root / "manifest.json").open("r", encoding="utf-8") as handle:
                manifest = json.load(handle)
            self._validate_manifest(manifest, expected_model_id=model_id)
            return manifest
        except (OSError, ValueError, json.JSONDecodeError, ModelUnavailableError):
            return None

    def _version_dir(self, model_id: str, version: str) -> Path:
        self._safe_segment(model_id, "model ID")
        self._safe_segment(version, "model version")
        return (self.store_dir / model_id / version).resolve()

    @staticmethod
    def _safe_child(root: Path, relative: str) -> Path:
        candidate = (root / relative).resolve()
        if root.resolve() not in candidate.parents:
            raise ValueError("path escape")
        return candidate

    @staticmethod
    def _safe_segment(value: str, label: str) -> None:
        if not SAFE_SEGMENT_RE.fullmatch(value):
            raise ModelUnavailableError(f"올바르지 않은 {label}입니다.")

    def _model_lock(self, model_id: str) -> threading.Lock:
        with self._locks_guard:
            return self._locks.setdefault(model_id, threading.Lock())

    @staticmethod
    def _write_json_atomic(path: Path, payload: dict) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(f"{path.name}.{uuid.uuid4().hex}.tmp")
        try:
            with temporary.open("w", encoding="utf-8") as handle:
                json.dump(payload, handle, ensure_ascii=False, indent=2)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)


_default_manager: ModelManager | None = None
_default_manager_lock = threading.Lock()


def get_model_manager() -> ModelManager:
    global _default_manager
    if _default_manager is None:
        with _default_manager_lock:
            if _default_manager is None:
                _default_manager = ModelManager()
    return _default_manager
