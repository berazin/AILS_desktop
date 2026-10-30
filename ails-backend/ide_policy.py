"""Edition boundary for IDE requests. Never deletes developer data."""
from pathlib import Path
from edition_manifest import feature_enabled, EditionFeatureDisabled, EDITION_MANIFEST

IDE_DISABLED_MESSAGE = "상업판에서는 IDE·코드·노트북 파일을 사용할 수 없습니다. 기존 파일과 기록은 보존되며 개발판에서 열 수 있습니다."
# Existing document/Office formats are preserved; this is not an Office removal.
DOCUMENT_EXTENSIONS = {".md", ".markdown", ".txt", ".pdf", ".ppt", ".pptx", ".docx", ".xlsx", ".csv", ".hwp", ".hwpx", ".html", ".htm", ".epub", ".mobi", ".azw", ".azw3", ".fb2", ".rtf"}
RESOURCE_EXTENSIONS = DOCUMENT_EXTENSIONS | {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico", ".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".wma", ".mp4", ".mov", ".mkv", ".webm"}
class IdeDisabled(EditionFeatureDisabled):
    def __init__(self):
        super().__init__("ide", EDITION_MANIFEST["id"])
        self.args = (IDE_DISABLED_MESSAGE,)

CODE_TEXT_NAMES = {"cmakelists.txt", "requirements.txt"}

def file_allowed(path, *, resource=False):
    if feature_enabled("ide"): return True
    name = str(path or "").replace("\\", "/").rsplit("/", 1)[-1].lower()
    return name not in CODE_TEXT_NAMES and Path(name).suffix in (RESOURCE_EXTENSIONS if resource else DOCUMENT_EXTENSIONS)

def require_document(path, *, resource=False):
    if not file_allowed(path, resource=resource): raise IdeDisabled()

def require_ide():
    if not feature_enabled("ide"): raise IdeDisabled()

def check_route(path):
    if any(path == prefix or path.startswith(prefix + "/") for prefix in ("/api/code", "/api/python", "/api/material-file/notebook")) or path == "/api/pdf/problems/code-draft":
        require_ide()
