"""Authenticated local recommendation routes; existing manager/runtime do the work."""
import threading

import edition_manifest
from local_ai import advisor, lifecycle, llmfit

_OPERATION_LOCK = threading.Lock()


def handle_local_ai_request(handler, method, path, payload=None):
    import personal_mode
    if not personal_mode.enabled():
        edition_manifest.require_feature("developer_tools")
    payload = payload or {}
    if method == "GET" and path == "/api/local-ai/status":
        return handler.send_json(advisor.status())
    if method == "POST" and path == "/api/local-ai/analyze":
        return handler.send_json(advisor.analyze(refresh=payload.get("refresh") is True))
    if method == "POST" and path == "/api/local-ai/select":
        return handler.send_json(lifecycle.select(payload.get("model")))
    actions = {"/api/local-ai/tool/stream": llmfit.install, "/api/local-ai/pull/stream": lifecycle.install,
               "/api/local-ai/verify/stream": lifecycle.verify}
    if method == "POST" and path in actions:
        if payload.get("confirmed") is not True:
            raise ValueError("설치 또는 실행 확인 버튼으로 시작해 주세요.")
        def produce(emit):
            if not _OPERATION_LOCK.acquire(blocking=False):
                raise ValueError("로컬 AI 작업이 이미 진행 중입니다.")
            try:
                if path == "/api/local-ai/tool/stream":
                    llmfit.install(emit)
                else:
                    actions[path](payload.get("model"), emit)
            finally:
                _OPERATION_LOCK.release()
        return handler.send_ndjson_stream(produce)
    raise ValueError("지원하지 않는 로컬 AI 요청입니다.")
