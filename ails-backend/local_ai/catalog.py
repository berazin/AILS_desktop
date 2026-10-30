"""Resolve llmfit's GGUF sources into existing AILS download manifests."""
import hashlib
import re
from functools import lru_cache
from urllib.parse import quote


from model_manager import get_model_manager
from voice.local_model_catalog import LOCAL_CONTEXT, MODEL_4B_ID, MODEL_8B_ID
from .gguf import HEADER_LIMIT, normalized_quant, read_quantization
from .model_role import ensure_model_body, is_auxiliary_gguf

BUILTIN_CATALOG = {
    "Qwen/Qwen3-4B-Instruct-2507": MODEL_4B_ID,
    "Qwen/Qwen3-8B": MODEL_8B_ID,
}
REPO = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*$")


def file_group(files, quantization):
    quant = re.escape(normalized_quant(quantization))
    matches = [f for f in files if isinstance(f, dict)
               and re.search(rf"(?i)(?:^|[._/-]){quant}(?:[.-]|$)", f.get("rfilename", ""))
               and f.get("rfilename", "").lower().endswith(".gguf")
               and not is_auxiliary_gguf(f.get("rfilename", ""))]
    groups = {}
    for file in matches:
        name = file["rfilename"]
        if ".." in name.split("/") or name.startswith("/") or "\\" in name:
            raise ValueError("GGUF 파일 경로가 안전하지 않습니다.")
        shard = re.search(r"-(\d{5})-of-(\d{5})\.gguf$", name)
        key = name[:shard.start()] if shard else name
        groups.setdefault(key, []).append(file)
    if len(groups) != 1:
        raise ValueError("추천 양자화와 정확히 일치하는 GGUF 파일을 하나로 식별하지 못했습니다.")
    group = sorted(next(iter(groups.values())), key=lambda f: f["rfilename"])
    first = re.search(r"-(\d{5})-of-(\d{5})\.gguf$", group[0]["rfilename"])
    if first:
        count = int(first[2])
        expected = [f"{next(iter(groups))}-{i:05d}-of-{count:05d}.gguf" for i in range(1, min(count, 64) + 1)]
        if count > 64 or [f["rfilename"] for f in group] != expected:
            raise ValueError("분할 GGUF 파일이 모두 준비되지 않았습니다.")
    return group


@lru_cache(maxsize=128)
def repository_manifest(repo, quantization):
    import requests
    if not REPO.fullmatch(repo):
        raise ValueError("GGUF 저장소 식별자가 올바르지 않습니다.")
    with requests.get(f"https://huggingface.co/api/models/{repo}?blobs=true", timeout=(5, 15)) as response:
        response.raise_for_status()
        metadata = response.json()
    revision = metadata.get("sha", "")
    if metadata.get("id") != repo or not re.fullmatch(r"[a-f0-9]{40}", revision):
        raise ValueError("GGUF 저장소의 고정 버전을 확인하지 못했습니다.")
    files = []
    for item in file_group(metadata.get("siblings", []), quantization):
        lfs = item.get("lfs") or {}
        digest, size = lfs.get("sha256", ""), lfs.get("size", 0)
        if not re.fullmatch(r"[a-f0-9]{64}", digest) or not isinstance(size, int) or size <= 0:
            raise ValueError("GGUF 파일의 SHA-256과 크기를 확인하지 못했습니다.")
        url = f"https://huggingface.co/{repo}/resolve/{revision}/{quote(item['rfilename'], safe='/')}"
        files.append({"path": item["rfilename"], "url": url, "sha256": digest, "size": size})
    identity = "\n".join(f["sha256"] for f in files)
    model_id = "llmfit-" + hashlib.sha256(identity.encode()).hexdigest()[:24]
    return {"schema_version": 1, "model_id": model_id, "version": revision, "files": files,
            "required_files": [f["path"] for f in files], "file_size": sum(f["size"] for f in files),
            "download_urls": [f"https://huggingface.co/{repo}"],
            "license": str((metadata.get("cardData") or {}).get("license") or "라이선스는 모델 페이지에서 확인"),
            "purpose": "Local AILS chatbot with the existing llama.cpp runtime"}


def verify_remote_quantization(manifest):
    # Inspect only the explicitly selected download. Fetching every candidate's
    # CDN header makes recommendation listing slow and needlessly transfers data.
    import requests
    for file in manifest["files"]:
        ensure_model_body(filename=file["path"])
        with requests.get(file["url"], headers={"Range": f"bytes=0-{HEADER_LIMIT - 1}"}, stream=True, timeout=(5, 20)) as response:
            response.raise_for_status()
            if read_quantization(response.raw) != normalized_quant(manifest["local_llm"]["quantization"]):
                raise ValueError("추천 양자화와 실제 GGUF 파일이 다릅니다. 다운로드를 중단했습니다.")


def resolve_manifest(row):
    import requests
    quant = normalized_quant(row.get("best_quant"))
    builtin_id = BUILTIN_CATALOG.get(row["name"])
    if builtin_id and quant == "Q4_K_M":
        manifest = get_model_manager().manifest(builtin_id)
    else:
        repos = [s["repo"] for s in row.get("gguf_sources", []) if isinstance(s, dict) and isinstance(s.get("repo"), str)]
        if "gguf" in row["name"].lower():
            repos.insert(0, row["name"])
        manifest = None
        for repo in dict.fromkeys(repos):
            try:
                manifest = repository_manifest(repo, quant)
                break
            except (ValueError, requests.RequestException):
                continue
        if manifest is None:
            raise ValueError("llmfit이 제공한 GGUF 출처에서 추천 양자화를 확인할 수 없습니다.")
    # Different source repositories can publish identical weights. Reuse the
    # bundled catalog entry instead of creating a second managed copy.
    for existing_id in BUILTIN_CATALOG.values():
        existing = get_model_manager().manifest(existing_id)
        if [f["sha256"] for f in existing["files"]] == [f["sha256"] for f in manifest["files"]]:
            manifest = existing
            break
    return {**manifest, "local_llm": {"filename": manifest["required_files"][0], "context": LOCAL_CONTEXT,
            "quantization": quant, "label": row["name"].split("/")[-1], "catalog_id": row["name"],
            "tools": "tool_use" in row.get("capability_ids", [])}}
