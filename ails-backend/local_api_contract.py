"""Local desktop transport names shared by clients and the HTTP adapter."""

LOCAL_FILE_STREAM_CHUNK_SIZE = 1024 * 1024
LOCAL_API_TOKEN_HEADER = "X-AILS-Token"
LOCAL_API_TOKEN_ENV = "AILS_LOCAL_API_TOKEN"
UI_ORIGIN_ENV = "AILS_UI_ORIGIN"
TOKEN_EXEMPT_GET_PATHS = frozenset()
