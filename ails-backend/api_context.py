"""API 서버 프로세스 수준 상수.

진입점(api_server), 요청 계층(api_modules, api_request_handler)이 함께 쓰는
토큰 헤더·환경변수 이름·스트리밍 청크 크기만 둔다. 기능 로직은 여기에
추가하지 않는다.
"""

from local_api_contract import (
    LOCAL_FILE_STREAM_CHUNK_SIZE, LOCAL_API_TOKEN_HEADER, LOCAL_API_TOKEN_ENV,
    UI_ORIGIN_ENV, TOKEN_EXEMPT_GET_PATHS,
)
# Local API access control: the Electron main process generates a per-run
# secret, passes it to this backend via AILS_LOCAL_API_TOKEN and to the
# renderer via the preload bridge. Every /api request must present it, so a
# random web page or unrelated local process cannot drive the backend.
# Compatibility export: no GET endpoint is exempt from token authentication.
# Electron attaches the header to trusted renderer media requests.
