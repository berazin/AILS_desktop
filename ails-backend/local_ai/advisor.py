"""Keep llmfit rankings; resolve exact GGUFs for the existing AILS runtime."""
import math
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from common import resource_path
from model_manager import get_model_manager, ModelUnavailableError
from voice.local_model_catalog import LOCAL_CONTEXT, MODEL_SPECS, model_spec
from . import host_platform, llmfit
from .catalog import BUILTIN_CATALOG, resolve_manifest
from .gguf import normalized_quant

_LOCK = threading.Lock()
_CACHE = None
_MANIFESTS = {}


def number(value, default=0.0):
    try:
        result = float(value)
        return result if math.isfinite(result) and result >= 0 else default
    except (TypeError, ValueError):
        return default


def inventory():
    manager = get_model_manager()
    ids = list(MODEL_SPECS)
    ids.extend(path.stem for path in (manager.store_dir / ".catalog").glob("llmfit-*.json"))
    installed = []
    for model_id in ids:
        try:
            state = manager.status(model_id)
            if state["ready"]:
                model_spec(model_id)
                name = MODEL_SPECS.get(model_id, {}).get("label") or manager.manifest(model_id).get("local_llm", {}).get("label", model_id)
                installed.append({"id": model_id, "name": name, "size": state["file_size"]})
        except (ValueError, OSError, ModelUnavailableError):
            continue
    return installed


def status():
    ready = Path(resource_path("tools/llamacpp-vulkan/llama-server.exe")).is_file()
    return {"tool": llmfit.status(), "runtime": {"ready": ready, "name": "llama.cpp Vulkan",
            "error": "" if ready else "AILS의 llama.cpp 실행 파일이 없습니다. 앱 설치 상태를 확인해 주세요."}, "installed": inventory()}


def execution_path(system, plan):
    paths = {p.get("path"): p for p in plan.get("run_paths", []) if isinstance(p, dict)}
    for key in ("gpu", "cpu_offload", "cpu_only"):
        required = number(plan.get("minimum", {}).get("vram_gb"), float("inf"))
        if system.get("shared_memory_detected") and required > number(system.get("available_ram_gb")):
            continue
        if paths.get(key, {}).get("feasible"):
            return paths[key]
    return None


def candidates(rows):
    result = []
    for rank, row in enumerate(rows, 1):
        if not isinstance(row, dict) or row.get("runtime") != "llama.cpp":
            continue
        if str(row.get("category", "")).lower() in {"embedding", "vision", "audio", "tts"}:
            continue
        if number(row.get("context_length")) < LOCAL_CONTEXT or not row.get("best_quant"):
            continue
        if not row.get("gguf_sources") and "gguf" not in str(row.get("name", "")).lower() and row.get("name") not in BUILTIN_CATALOG:
            continue
        result.append({**row, "_llmfit_rank": rank})
    return result


def evaluate(row, system, overrides=()):
    quant = normalized_quant(row["best_quant"])
    plan = llmfit.run(*overrides, "plan", row["name"], "--context", str(LOCAL_CONTEXT), "--quant", quant, "--json")
    if plan.get("model_name") != row["name"] or plan.get("quantization") != quant or plan.get("context") != LOCAL_CONTEXT:
        raise ValueError("llmfit의 모델·양자화·컨텍스트 조건이 일치하지 않습니다.")
    path = execution_path(system, plan)
    if not path:
        return None
    manifest = resolve_manifest(row)
    speed = number(path.get("estimated_tps"))
    memory = number(plan.get("minimum", {}).get("vram_gb"))
    mode = {"gpu": "GPU", "cpu_offload": "GPU + CPU", "cpu_only": "CPU"}[path["path"]]
    return {"id": manifest["model_id"], "name": manifest["local_llm"]["label"], "catalog_id": row["name"],
            "quantization": quant, "filename": manifest["required_files"][0], "context": LOCAL_CONTEXT,
            "download_bytes": manifest["file_size"], "memory_gb": round(memory, 2), "estimated_tps": round(speed, 1),
            "execution": mode, "max_context": row.get("context_length"), "llmfit_rank": row["_llmfit_rank"],
            "scores": {"balanced": number(row.get("score")), "quality": number(row.get("score_components", {}).get("quality")), "speed": speed},
            "license": manifest["license"], "model_url": manifest["download_urls"][0],
            "reasons": [f"llmfit 추천 {row['_llmfit_rank']}위 · 점수 {number(row.get('score')):.1f}", f"{quant} · {LOCAL_CONTEXT:,} 토큰 · {mode} 추정 (실행 확인 전)"], "_manifest": manifest}


def analyze(refresh=False):
    global _CACHE, _MANIFESTS
    with _LOCK:
        if not refresh and _CACHE and time.monotonic() - _CACHE[0] < 120:
            return _CACHE[1]
        result = {**status(), "system": {"os": host_platform.description()}, "models": [], "warnings": [], "context": LOCAL_CONTEXT}
        if not result["tool"]["ready"]:
            result["warnings"].append("자동 추천을 위해 llmfit 분석 도구를 먼저 준비해 주세요.")
            return result
        try:
            args = ("--max-context", str(LOCAL_CONTEXT), "recommend", "--json", "--limit", "9999", "--force-runtime", "llamacpp")
            report = llmfit.run(*args)
            system = report.get("system")
            if not isinstance(system, dict) or not number(system.get("total_ram_gb")) or not number(system.get("available_ram_gb")):
                raise ValueError("하드웨어 메모리를 정확히 확인하지 못해 추천을 보류했습니다.")
            overrides, note = verified_hardware_overrides(system)
            if overrides:
                report = llmfit.run(*overrides, *args)
                system = {**report["system"], "shared_memory_detected": True}
            result["system"].update(system)
            if note:
                result["warnings"].append(note)
            result["warnings"].append("llmfit 순위와 점수를 유지합니다. 속도·메모리·GPU 가속은 실행 테스트 전까지 추정입니다. 설치 버튼을 누르면 실제 GGUF 양자화를 확인한 뒤 다운로드합니다.")
            rows = candidates(report.get("models", []))
            checked, failures = {}, []

            def check(row):
                try:
                    return evaluate(row, system, overrides)
                except Exception:
                    failures.append(row["name"])
                    return None

            # Refill after unavailable GGUFs in llmfit order; no AILS scoring.
            orders = [rows, sorted(rows, key=lambda r: number(r.get("score_components", {}).get("quality")), reverse=True), sorted(rows, key=lambda r: number(r.get("estimated_tps")), reverse=True)]
            with ThreadPoolExecutor(max_workers=3) as pool:
                for order in orders:
                    valid = set()
                    for offset in range(0, min(18, len(order)), 3):
                        batch = order[offset:offset + 3]
                        unseen = [r for r in batch if r["name"] not in checked]
                        checked.update((r["name"], value) for r, value in zip(unseen, pool.map(check, unseen)))
                        valid.update(checked[r["name"]]["id"] for r in batch if checked[r["name"]] is not None)
                        if len(valid) >= 6:
                            break
            unique = {}
            for model in sorted((v for v in checked.values() if v), key=lambda m: m["llmfit_rank"]):
                unique.setdefault(model["id"], model)
            models = list(unique.values())
            _MANIFESTS = {m["id"]: m["_manifest"] for m in models}
            result["models"] = [{k: v for k, v in m.items() if k != "_manifest"} for m in models]
            if failures:
                result["warnings"].append(f"정확한 GGUF·양자화 또는 실행 조건을 확인할 수 없는 후보 {len(failures)}개를 제외했습니다.")
            if not models:
                result["warnings"].append("설치 가능한 추천 모델을 확인하지 못했습니다. 기존 설치 모델은 아래에서 사용할 수 있습니다.")
        except (ValueError, OSError) as error:
            result["warnings"].append(str(error))
        _CACHE = (time.monotonic(), result)
        return result


def verified_hardware_overrides(system):
    if not host_platform.is_windows():
        return (), ""
    try:
        from hardware_capabilities import detect_vulkan_capabilities
        devices = detect_vulkan_capabilities().get("devices", [])
    except Exception:
        return (), "GPU 메모리 교차 확인에 실패했습니다. 실제 가속은 실행 테스트로 확인해 주세요."
    if len(devices) != 1 or devices[0].get("device_type") != 1 or devices[0].get("name") != system.get("gpu_name"):
        return (), ""
    shared = number(devices[0].get("device_memory_bytes")) / 1024 ** 3
    available = number(system.get("available_ram_gb"))
    if not shared or not available:
        return (), "공유 GPU 메모리 용량을 확인하지 못했습니다."
    return ("--memory", f"{min(shared, available):.3f}G"), f"Vulkan 공유 메모리 {shared:.1f} GB와 현재 가용 RAM {available:.1f} GB 중 작은 값으로 llmfit을 재평가합니다. 두 메모리를 합산하지 않으며, GPU 가속 여부는 실행으로 확인합니다."


def selected_manifest(model_id):
    manifest = _MANIFESTS.get(model_id)
    if manifest is None:
        raise ValueError("추천 목록을 다시 분석한 뒤 모델을 선택해 주세요.")
    return manifest


def invalidate():
    global _CACHE
    _CACHE = None
