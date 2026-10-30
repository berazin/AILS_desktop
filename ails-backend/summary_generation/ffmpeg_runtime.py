from __future__ import annotations

import hashlib
import os
import shutil
import urllib.request
import zipfile
from pathlib import Path
from typing import Callable

from common import BASE_EXE_DIR, FFMPEG_EXE, FFPROBE_EXE, append_status_log, resource_path


FFMPEG_ARCHIVE_URL = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"


def _prepend_path(directory: Path) -> None:
    normalized = os.path.normcase(os.path.abspath(str(directory)))
    entries = [entry for entry in os.environ.get("PATH", "").split(os.pathsep) if entry]
    if any(os.path.normcase(os.path.abspath(entry)) == normalized for entry in entries):
        return
    os.environ["PATH"] = str(directory) + (os.pathsep + os.environ["PATH"] if os.environ.get("PATH") else "")


def _find_ffmpeg_pair() -> tuple[Path, Path] | None:
    local_app_data = os.environ.get("LOCALAPPDATA", "")
    candidates = [
        Path(resource_path(os.path.join("tools", "ffmpeg", "bin"))),
        Path(BASE_EXE_DIR) / "tools" / "ffmpeg" / "bin",
    ]
    if local_app_data:
        candidates.append(
            Path(local_app_data) / "Programs" / "AILS" / "resources" / "backend" / "AILSBackend" / "tools" / "ffmpeg" / "bin"
        )
        candidates.append(
            Path(local_app_data) / "AILS" / "tools" / "ffmpeg" / "bin"
        )
    dist_dir = Path(BASE_EXE_DIR) / "dist"
    if dist_dir.is_dir():
        try:
            for entry in dist_dir.iterdir():
                candidates.append(entry / "win-unpacked" / "resources" / "backend" / "AILSBackend" / "tools" / "ffmpeg" / "bin")
        except OSError:
            pass

    for directory in candidates:
        ffmpeg = directory / "ffmpeg.exe"
        ffprobe = directory / "ffprobe.exe"
        if ffmpeg.is_file() and ffprobe.is_file():
            _prepend_path(directory)
            return ffmpeg, ffprobe

    ffmpeg = shutil.which(FFMPEG_EXE) or shutil.which("ffmpeg")
    ffprobe = shutil.which(FFPROBE_EXE) or shutil.which("ffprobe")
    if ffmpeg and ffprobe:
        return Path(ffmpeg), Path(ffprobe)
    return None


def _download_and_extract_ffmpeg(target_dir: Path, log_list=None, cancel_check: Callable[[], None] | None = None) -> tuple[Path, Path] | None:
    target_bin = target_dir / "bin"
    target_bin.mkdir(parents=True, exist_ok=True)
    temp_zip = target_dir / "ffmpeg_temp.zip"

    append_status_log(log_list, "FFmpeg 바이너리 다운로드 중...")
    try:
        req = urllib.request.Request(FFMPEG_ARCHIVE_URL, headers={"User-Agent": "AILS-Downloader"})
        with urllib.request.urlopen(req, timeout=120) as resp, open(temp_zip, "wb") as out:
            while True:
                if cancel_check is not None:
                    cancel_check()
                chunk = resp.read(1024 * 1024)
                if not chunk:
                    break
                out.write(chunk)

        append_status_log(log_list, "FFmpeg 압축 해제 중...")
        with zipfile.ZipFile(temp_zip) as zf:
            for member in zf.infolist():
                norm = member.filename.replace("\\", "/")
                name = Path(norm).name
                if name in {"ffmpeg.exe", "ffprobe.exe"} and "/bin/" in norm:
                    out_path = target_bin / name
                    with zf.open(member) as src, open(out_path, "wb") as dst:
                        shutil.copyfileobj(src, dst)

        ffmpeg = target_bin / "ffmpeg.exe"
        ffprobe = target_bin / "ffprobe.exe"
        if ffmpeg.is_file() and ffprobe.is_file():
            _prepend_path(target_bin)
            return ffmpeg, ffprobe
    except Exception as e:
        append_status_log(log_list, f"FFmpeg 자동 다운로드 실패: {e}")
    finally:
        if temp_zip.is_file():
            temp_zip.unlink(missing_ok=True)
    return None


def ensure_ffmpeg_available(log_list=None, cancel_check: Callable[[], None] | None = None) -> str:
    """Resolve or auto-install the FFmpeg pair."""
    existing = _find_ffmpeg_pair()
    if existing:
        return str(existing[0])

    # Fallback: auto-download to tools/ffmpeg
    target_dir = Path(BASE_EXE_DIR) / "tools" / "ffmpeg"
    downloaded = _download_and_extract_ffmpeg(target_dir, log_list=log_list, cancel_check=cancel_check)
    if downloaded:
        return str(downloaded[0])

    append_status_log(log_list, "FFmpeg가 없어 정리본 처리를 시작할 수 없습니다.")
    raise RuntimeError("패키지에 필수 FFmpeg가 없습니다. 앱을 다시 설치해 주세요.")
