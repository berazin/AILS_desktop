"""Persistent environment selection; package resolution is delegated to Python/uv/pip."""
from __future__ import annotations

from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import sys
import threading
import uuid

import python_runtime
from code_services.notebook_bundle import data_root, seed_environment, bundle_root
from code_services.notebook_process import checked_python

_registry_lock = threading.RLock()
_activity_lock = threading.Lock()
_activity: dict[str, dict] = {}


def canonical(path) -> str:
    return os.path.normcase(os.path.realpath(path))


@contextmanager
def environment_activity(python: str, *, mutate: bool = False):
    key = canonical(python)
    with _activity_lock:
        state = _activity.setdefault(key, {"readers": 0, "writer": False})
        if state["writer"] or (mutate and state["readers"]):
            raise RuntimeError("이 환경에서 실행 또는 패키지 변경이 진행 중입니다. 완료 후 다시 시도해 주세요.")
        state["writer" if mutate else "readers"] += 1
    try:
        yield
    finally:
        with _activity_lock:
            state["writer" if mutate else "readers"] -= 1


def _read(root: Path) -> dict:
    file = root / "environments.json"
    return json.loads(file.read_text(encoding="utf-8")) if file.exists() else {"environments": {}, "bindings": {}}


def _write(root: Path, registry: dict):
    temporary = root / f"environments.{uuid.uuid4().hex}.tmp"
    temporary.write_text(json.dumps(registry, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, root / "environments.json")


def _external(python: str, name: str = "외부 Python") -> dict:
    return {"id": "external-" + hashlib.sha256(canonical(python).encode()).hexdigest()[:16],
            "name": name, "python": str(Path(python).resolve()), "managed": False}


def validate_external(python: str) -> dict:
    path = Path(python).resolve()
    if not path.is_file():
        raise ValueError("Python 실행 파일을 찾을 수 없습니다.")
    if path.is_relative_to(Path(sys.prefix).resolve()) or canonical(path) == canonical(sys.executable):
        raise ValueError("AILS 백엔드 Python은 노트북 환경으로 사용할 수 없습니다. 기본 학습 환경을 선택해 주세요.")
    root = data_root()
    result = json.loads(checked_python(str(path), ["-I", "-c", "import json,sys,ipykernel; print(json.dumps({'version':sys.version.split()[0],'prefix':sys.prefix,'base_prefix':sys.base_prefix,'paths':sys.path}))"], root, timeout=20))
    if canonical(result["prefix"]) == canonical(sys.prefix):
        raise ValueError("AILS 백엔드 환경은 선택할 수 없습니다.")
    if any(Path(item).resolve().is_relative_to(Path(sys.prefix).resolve()) for item in result.pop("paths") if item):
        raise ValueError("이 환경은 AILS 백엔드 라이브러리를 공유합니다. 독립 환경을 만들어 주세요.")
    return result


def _selected(registry: dict, notebook_path: str, config: dict) -> dict:
    path = Path(notebook_path).resolve()
    for scope in [path, *path.parents]:
        env_id = registry["bindings"].get(canonical(scope))
        if env_id:
            if env_id not in registry["environments"]:
                if env_id == "shared":
                    return {"id": "shared", "name": "기본 학습 환경", "managed": True, "python": ""}
                raise ValueError("선택한 Python 환경을 찾을 수 없습니다.")
            return registry["environments"][env_id]
    configured = python_runtime.configured_executable(config)
    if configured:
        return _external(configured, "설정된 Python")
    return registry["environments"].get("shared", {"id": "shared", "name": "기본 학습 환경", "managed": True, "python": ""})


def resolve_environment(notebook_path: str, config: dict | None = None, *, prepare: bool = True) -> dict:
    root = data_root()
    with _registry_lock:
        registry = _read(root)
        selected = _selected(registry, notebook_path, config or {})
        if selected["id"] == "shared" and not selected.get("python") and prepare:
            selected = _create(root, registry, "shared", "기본 학습 환경")
        if prepare:
            python = selected.get("python", "")
            if not Path(python).is_file():
                raise RuntimeError("선택한 Python 환경이 없습니다. Python 환경 메뉴에서 다른 환경을 선택해 주세요.")
            if not selected["managed"]:
                selected = {**selected, **validate_external(python)}
        return dict(selected)


def _create(root: Path, registry: dict, env_id: str, name: str) -> dict:
    destination = root / "envs" / env_id
    if destination.exists():
        raise RuntimeError("완료되지 않은 환경 폴더가 있습니다. 별도 환경을 생성해 주세요: " + str(destination))
    seeded = seed_environment(destination, root)
    record = {"id": env_id, "name": name[:100], "managed": True, **seeded}
    registry["environments"][env_id] = record
    _write(root, registry)
    return record


def environment_status(notebook_path: str, config: dict) -> dict:
    root = data_root()
    with _registry_lock:
        registry = _read(root)
        selected = _selected(registry, notebook_path, config)
        records = list(registry["environments"].values())
        if not any(e["id"] == "shared" for e in records):
            records.insert(0, {"id": "shared", "name": "기본 학습 환경", "managed": True, "python": ""})
        if not any(e["id"] == selected["id"] for e in records):
            records.append(selected)
        legacy = python_runtime.find_project_venv_python(str(Path(notebook_path).resolve().parent))
        if legacy:
            legacy_record = _external(legacy, "기존 프로젝트 Python")
            if not any(e["id"] == legacy_record["id"] for e in records):
                records.append(legacy_record)
        return {"selected_id": selected["id"], "environments": records, "data_root": str(root),
                "bundle_available": (bundle_root() / "manifest.json").is_file()}


def change_environment(notebook_path: str, config: dict, payload: dict) -> dict:
    root = data_root()
    action = payload.get("action")
    with _registry_lock:
        registry = _read(root)
        scope = canonical(notebook_path)
        if action == "create":
            env_id = "project-" + uuid.uuid4().hex[:16]
            record = _create(root, registry, env_id, str(payload.get("name") or "프로젝트 환경"))
            scope = canonical(Path(notebook_path).parent)
        elif action == "register":
            python = str(payload.get("python", "")).strip().strip('"')
            details = validate_external(python)
            record = {**_external(python), **details}
            env_id = record["id"]
            registry["environments"][env_id] = record
        elif action == "select":
            env_id = str(payload.get("environment_id", ""))
            records = environment_status(notebook_path, config)["environments"]
            record = next((e for e in records if e["id"] == env_id), None)
            if record is None:
                raise ValueError("등록된 환경을 선택해 주세요.")
            if env_id == "shared" and not record.get("python"):
                record = _create(root, registry, env_id, "기본 학습 환경")
            elif not record["managed"]:
                validate_external(record["python"])
            registry["environments"][env_id] = record
        else:
            raise ValueError("Unknown environment action")
        registry["bindings"][scope] = env_id
        if action == "create":
            registry["bindings"].pop(canonical(notebook_path), None)
        _write(root, registry)
    return {**environment_status(notebook_path, config), "restart_required": True}
