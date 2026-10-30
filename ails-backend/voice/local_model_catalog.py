"""The existing llama.cpp catalog plus developer-installed recommendation manifests."""
import re

MODEL_4B_ID = "qwen3-4b-instruct-2507-q4-k-m"
MODEL_8B_ID = "qwen3-8b-q4-k-m"
MODEL_SPECS = {
    MODEL_4B_ID: {"alias": "qwen3-4b-instruct-2507", "filename": "Qwen3-4B-Instruct-2507-Q4_K_M.gguf", "label": "Qwen3 4B Instruct 2507"},
    MODEL_8B_ID: {"alias": "qwen3-8b", "filename": "Qwen3-8B-Q4_K_M.gguf", "label": "Qwen3 8B"},
}
RECOMMENDED_MODEL_ID = re.compile(r"^llmfit-[0-9a-f]{24}$")
LOCAL_CONTEXT = 8192
LOCAL_PROBLEM_REVIEW_MODEL_AUTO = "auto"
LOCAL_PROBLEM_REVIEW_MODEL_IDS = frozenset(MODEL_SPECS)


def normalize_local_problem_review_model(value) -> str:
    selected = str(value or LOCAL_PROBLEM_REVIEW_MODEL_AUTO).strip().casefold()
    return selected if selected in LOCAL_PROBLEM_REVIEW_MODEL_IDS else LOCAL_PROBLEM_REVIEW_MODEL_AUTO


def model_spec(model_id):
    if model_id in MODEL_SPECS:
        return MODEL_SPECS[model_id]
    import edition_manifest
    edition_manifest.require_feature("developer_tools")
    if not RECOMMENDED_MODEL_ID.fullmatch(str(model_id)):
        raise ValueError("지원하지 않는 로컬 모델입니다.")
    from model_manager import get_model_manager, ModelUnavailableError
    from local_ai.model_role import ensure_model_body

    try:
        manifest = get_model_manager().manifest(model_id)
    except (ModelUnavailableError, OSError) as error:
        raise ValueError("저장된 로컬 모델을 찾지 못했습니다. 로컬 AI 영역에서 다시 선택해 주세요.") from error
    spec = manifest.get("local_llm", {})
    if spec.get("filename") not in manifest["required_files"] or spec.get("context") != LOCAL_CONTEXT:
        raise ValueError("로컬 모델 실행 설정을 확인하지 못했습니다.")
    for filename in manifest["required_files"]:
        ensure_model_body(filename=filename)
    return {**spec, "alias": model_id}
