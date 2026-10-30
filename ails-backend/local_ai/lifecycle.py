"""Use ModelManager and the one existing llama.cpp runtime for the full lifecycle."""
import json
import time
from datetime import datetime, timezone
from pathlib import Path


from model_manager import get_model_manager, ModelUnavailableError
from voice.local_model_catalog import LOCAL_CONTEXT, MODEL_SPECS, model_spec
from voice.llama_cpp_voice_agent import VOICE_AGENT_RUNTIME
from . import advisor
from .gguf import verify_quantization
from .catalog import verify_remote_quantization
from .model_role import ensure_model_body


def install(model_id, emit):
    manifest = advisor.selected_manifest(model_id)
    for filename in manifest["required_files"]:
        ensure_model_body(filename=filename)
    manager = get_model_manager()
    quantization = manifest["local_llm"]["quantization"]
    same_files = False
    try:
        existing = manager.manifest(model_id)
        same_files = existing["files"] and [f["sha256"] for f in existing["files"]] == [f["sha256"] for f in manifest["files"]]
    except ModelUnavailableError:
        pass
    reuse = same_files and manager.status(model_id)["ready"]
    if model_id not in MODEL_SPECS and not reuse:
        manager.register_recommendation(manifest)
    if not manager.status(model_id)["ready"]:
        emit({"type": "progress", "status": "다운로드할 GGUF의 실제 양자화 확인 중"})
        verify_remote_quantization(manifest)
    def progress(event):
        emit({"type": "progress", "status": "GGUF 다운로드 및 무결성 검사", "completed": event["completed_bytes"], "total": event["total_bytes"]})
    state = manager.install(model_id, progress=progress)
    for filename in manager.manifest(model_id)["required_files"]:
        verify_quantization(Path(state["install_path"]) / filename, quantization)
    advisor.invalidate()
    emit({"type": "done", "model": model_id})


def verify(model_id, emit):
    import requests
    manager = get_model_manager()
    spec = model_spec(model_id)
    manifest = manager.manifest(model_id)
    emit({"type": "progress", "status": "설치 파일과 실제 GGUF 양자화 확인 중"})
    root = manager.resolve(model_id)
    (root / "ails-execution-check.json").unlink(missing_ok=True)
    quant = spec.get("quantization", "Q4_K_M")
    for filename in manifest["required_files"]:
        verify_quantization(root / filename, quant)
    started = time.monotonic()
    with VOICE_AGENT_RUNTIME.session(model_id, cancel_check=lambda: emit({"type": "progress", "status": "llama.cpp 모델 실행 준비 중"})) as (endpoint, _alias):
        base = endpoint.rsplit("/v1/", 1)[0]
        with requests.Session() as client:
            client.trust_env = False
            response = client.get(base + "/props", timeout=(3, 10), allow_redirects=False)
            response.raise_for_status()
            props = response.json()
            if Path(props.get("model_path", "")).resolve() != (root / spec["filename"]).resolve():
                raise ValueError("실행된 GGUF 파일이 선택한 모델과 다릅니다.")
            actual_context = props.get("default_generation_settings", {}).get("n_ctx")
            if actual_context != LOCAL_CONTEXT:
                raise ValueError("llama.cpp 실행 컨텍스트가 추천 조건과 일치하지 않습니다.")
            emit({"type": "progress", "status": "짧은 실행 테스트로 실제 속도 측정 중"})
            response = client.post(base + "/completion", json={"prompt": "Write a short greeting.", "n_predict": 32, "temperature": 0,
                "cache_prompt": False, "stream": False}, timeout=(5, 120), allow_redirects=False)
            response.raise_for_status()
            data = response.json()
            speed = advisor.number(data.get("timings", {}).get("predicted_per_second"))
            if not speed or not str(data.get("content", "")).strip() or data.get("truncated"):
                raise ValueError("정상적인 모델 실행 응답과 측정값을 확인하지 못했습니다.")
        result = {"ok": True, "model_id": model_id, "source_model": spec["label"], "quantization": quant,
                  "measured_tps": round(speed, 2), "runtime_context": actual_context,
                  "runtime_build": props.get("build_info"),
                  "file_sha256": [f["sha256"] for f in manifest["files"]],
                  "duration_seconds": round(time.monotonic() - started, 2), "measured_at": datetime.now(timezone.utc).isoformat(),
                  **VOICE_AGENT_RUNTIME.execution_info()}
    manager._write_json_atomic(root / "ails-execution-check.json", result)
    advisor.invalidate()
    emit({"type": "done", "verification": result})
    return result


def select(model_id):
    manager = get_model_manager()
    spec = model_spec(model_id)
    root = manager.resolve(model_id)
    manifest = manager.manifest(model_id)
    for filename in manifest["required_files"]:
        verify_quantization(root / filename, spec.get("quantization", "Q4_K_M"))
    try:
        evidence = json.loads((root / "ails-execution-check.json").read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise ValueError("먼저 모델 실행 테스트를 완료해 주세요.") from error
    if (not evidence.get("ok") or evidence.get("model_id") != model_id or evidence.get("runtime_context") != LOCAL_CONTEXT
            or evidence.get("file_sha256") != [f["sha256"] for f in manifest["files"]]):
        raise ValueError("설치 모델이 변경되었습니다. 실행 테스트를 다시 해 주세요.")
    return {"model_id": model_id, "source_model": spec["label"], "context": LOCAL_CONTEXT}
