"""Small adapters around standard package tools and the PyPI metadata API."""
from __future__ import annotations

import json
import queue
import re
import subprocess
import threading
import time
import urllib.error
import urllib.request

from packaging.requirements import Requirement, InvalidRequirement
from common import CREATE_NO_WINDOW
from code_services.notebook_bundle import data_root
from code_services.notebook_environments import environment_activity
from code_services.notebook_process import child_environment, run_python, independent_python_spawn, stop_process_tree


def search_package(query: str) -> dict:
    # PyPI has no supported full-text search API. Lookup the supplied project name.
    name = query.strip()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,199}", name):
        raise ValueError("PyPI 패키지 이름을 입력해 주세요. 예: seaborn")
    try:
        with urllib.request.urlopen(f"https://pypi.org/pypi/{name}/json", timeout=15) as response:
            metadata = json.loads(response.read(4 * 1024 * 1024))
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return {"packages": [], "message": "해당 이름의 PyPI 패키지를 찾을 수 없습니다."}
        raise RuntimeError(f"PyPI 조회 실패 (HTTP {error.code})") from error
    except (OSError, ValueError) as error:
        raise RuntimeError("PyPI에 연결할 수 없습니다. 네트워크 연결을 확인해 주세요.") from error
    info = metadata["info"]
    return {"packages": [{"name": info["name"], "version": info["version"],
                           "summary": info.get("summary", ""), "requires_python": info.get("requires_python", "")}],
            "message": "PyPI의 정확한 패키지 이름으로 검색합니다."}


def list_packages(environment: dict) -> dict:
    if not environment.get("python"):
        return {"packages": [], "message": "첫 실행 또는 기본 환경 선택 시 오프라인으로 준비됩니다."}
    result = run_python(environment["python"], ["-I", "-m", "pip", "list", "--format=json"], data_root(), timeout=30)
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout)[-4000:])
    return {"packages": json.loads(result.stdout)}


def package_requirements(value: object) -> list[str]:
    values = value if isinstance(value, list) else [value]
    if not 1 <= len(values) <= 20:
        raise ValueError("한 번에 1~20개 패키지를 지정해 주세요.")
    requirements = []
    for item in values:
        if not isinstance(item, str) or not item.strip():
            raise ValueError("설치하거나 삭제할 패키지 이름이 필요합니다.")
        text = item.strip()
        try:
            requirement = Requirement(text)
        except InvalidRequirement as error:
            raise ValueError("패키지 이름과 버전을 입력해 주세요. 예: seaborn==0.13.2") from error
        if len(text) > 300 or requirement.url or requirement.marker:
            raise ValueError("UI에서는 PyPI 패키지 이름과 버전만 지원합니다.")
        requirements.append(str(requirement))
    return requirements


def change_packages(environment: dict, payload: dict, emit) -> dict:
    if not environment.get("managed"):
        raise ValueError("외부 Python은 조회만 지원합니다. 패키지를 변경하려면 AILS 프로젝트 환경을 만들어 주세요.")
    action = payload.get("action")
    if action not in ("install", "uninstall"):
        raise ValueError("Unknown package action")
    requirements = package_requirements(payload.get("packages"))
    if action == "uninstall":
        for value in requirements:
            requirement = Requirement(value)
            if requirement.specifier or requirement.extras:
                raise ValueError("삭제할 때는 패키지 이름만 입력해 주세요.")
            if re.sub(r"[-_.]+", "-", requirement.name.lower()) in {"ipykernel", "ipython", "pip", "uv"}:
                raise ValueError("커널 실행에 필요한 기본 패키지는 UI에서 삭제할 수 없습니다.")
    python, root = environment["python"], data_root()
    # uv is in the offline wheel set. Older/external environments can still use pip.
    probe = run_python(python, ["-I", "-c", "import uv"], root, timeout=15)
    manager = "uv" if probe.returncode == 0 else "pip"
    if manager == "uv":
        args = [python, "-I", "-m", "uv", "--no-config", "--no-progress", "pip", action, "--python", python]
    else:
        args = [python, "-I", "-m", "pip", action]
        if action == "uninstall":
            args.append("--yes")
    if action == "install":
        args += ["--index-url", "https://pypi.org/simple", "--only-binary=:all:"]
    args += requirements
    with environment_activity(python, mutate=True):
        emit({"type": "status", "message": f"{manager}: {action}", "manager": manager})
        result = _run_stream(args, root, emit)
        check = run_python(python, ["-I", "-m", "pip", "check"], root, timeout=30)
        conflicts = (check.stdout + check.stderr).strip() if check.returncode else ""
        return {"ok": result["returncode"] == 0 and not conflicts, "manager": manager,
                "restart_required": True, "conflicts": conflicts, **result,
                "packages": list_packages(environment)["packages"]}


def _run_stream(args, root, emit, timeout=900):
    with independent_python_spawn():
        process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                   encoding="utf-8", errors="replace", text=True,
                                   creationflags=CREATE_NO_WINDOW, env=child_environment(args[0], root), cwd=str(root))
    messages = queue.Queue()

    def drain():
        try:
            for line in process.stdout:
                messages.put(line)
        finally:
            messages.put(None)

    threading.Thread(target=drain, daemon=True).start()
    started, log, last_status = time.monotonic(), "", 0
    try:
        while True:
            elapsed = time.monotonic() - started
            if elapsed > timeout:
                raise TimeoutError("패키지 작업 시간이 초과되었습니다. 설치 상태를 새로고침해 주세요.")
            try:
                line = messages.get(timeout=0.5)
            except queue.Empty:
                if elapsed - last_status > 2:
                    emit({"type": "status", "message": "패키지 작업 진행 중", "elapsed_seconds": int(elapsed)})
                    last_status = elapsed
                continue
            if line is None:
                break
            log = (log + line)[-32000:]
            emit({"type": "log", "text": line[-8000:]})
        return {"returncode": process.wait(timeout=10), "log": log}
    finally:
        stop_process_tree(process)
        process.stdout.close()
