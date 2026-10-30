"""Own downloaded video folders across retries and remove only completed work."""

from __future__ import annotations

import json
import os
import re
import shutil
import stat
import tempfile
import time
from pathlib import Path


COMPLETED_MARKER = '.ails-completed-media.json'
_DOWNLOAD_NAME = re.compile(r'(youtube|eclass_vod)_\d+_\d+_\d+')


def owned_download_dir(path, temp_root, task_type=None):
    """Accept only a direct, non-linked task directory under temp_segments."""
    if not path:
        return None
    root = Path(os.path.abspath(temp_root))
    candidate = Path(os.path.abspath(path))
    match = _DOWNLOAD_NAME.fullmatch(candidate.name)
    if candidate.parent != root or not match or (task_type and match[1] != task_type):
        return None
    for parent in (candidate, *candidate.parents):
        if parent.is_symlink() or (hasattr(parent, 'is_junction') and parent.is_junction()):
            return None
    return candidate


def prepare_download_dir(run, temp_root, new_path):
    """Record the directory before downloading, including incomplete fragments."""
    previous = owned_download_dir((run.resume_state or {}).get('download_dir'), temp_root, run.task_type)
    directory = previous if previous and previous.is_dir() and not (previous / COMPLETED_MARKER).exists() else None
    directory = directory or owned_download_dir(new_path, temp_root, run.task_type)
    if directory is None:
        raise ValueError('임시 영상 폴더가 작업별 저장 경로를 벗어났습니다.')
    directory.mkdir(parents=True, exist_ok=True)
    run.download_dir = str(directory)
    run.media_temp_dirs.append(str(directory))
    run.persist_partial_progress()
    return str(directory)


def keep_media_file(run, file_path):
    """Never remove originals, checkpoint media, or retry input in final cleanup."""
    path = Path(os.path.abspath(file_path))
    originals = [run.task.get(key) for key in ('source_video_path', 'video_path', 'source_audio_path', 'source_pdf_path')]
    originals.append((run.resume_media or {}).get('path'))
    if any(path == Path(os.path.abspath(value)) for value in originals if value):
        return True
    # Folder cleanup owns these files, so per-file cleanup must not bypass it.
    if any(path.is_relative_to(Path(os.path.abspath(directory))) for directory in run.media_temp_dirs):
        return True
    return not run.media_work_completed and run.task_type in {'youtube', 'eclass_vod', 'url'} and (
        file_path == run.ts_f or file_path in run.segment_files
    )


def _remove_readonly(function, path, error):
    if not isinstance(error, PermissionError):
        raise error
    os.chmod(path, stat.S_IREAD | stat.S_IWRITE)
    function(path)


def _mark_completed(directory):
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=directory, delete=False) as handle:
            temporary = Path(handle.name)
            handle.write('{"version":1,"completed":true}')
        os.replace(temporary, directory / COMPLETED_MARKER)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def _remove_completed_dir(directory, log):
    for attempt in range(3):
        try:
            # Refuse directory links even if one was inserted after registration.
            for current, directories, files in os.walk(directory, followlinks=False):
                for name in directories + files:
                    child = Path(current) / name
                    if child.is_symlink() or (hasattr(child, 'is_junction') and child.is_junction()):
                        raise OSError('임시 영상 폴더에 외부 경로 링크가 있습니다.')
            shutil.rmtree(directory, onexc=_remove_readonly)
            return True
        except OSError as error:
            if not directory.exists():
                return True
            if attempt == 2:
                # rmtree can remove the marker before encountering a locked video.
                try:
                    if directory.is_dir():
                        _mark_completed(directory)
                except OSError:
                    pass
                log(f'완료된 임시 영상 정리 보류: {directory.name} ({error})')
            else:
                time.sleep(0.1 * (attempt + 1))
    return False


def cleanup_completed_downloads(run, temp_root, log):
    if not run.media_work_completed:
        return
    for path in set(run.media_temp_dirs + ([run.download_dir] if run.download_dir else [])):
        directory = owned_download_dir(path, temp_root, run.task_type)
        if directory is None or not directory.is_dir():
            continue
        try:
            _mark_completed(directory)
            _remove_completed_dir(directory, log)
        except OSError as error:
            log(f'완료된 임시 영상 정리 보류: {directory.name} ({error})')


def cleanup_pending_downloads(temp_root, log):
    """Retry locked successful folders at startup; unmarked folders are untouched."""
    root = Path(temp_root)
    if not root.is_dir():
        return
    try:
        candidates = list(root.iterdir())
    except OSError as error:
        log(f'완료된 임시 영상 정리 확인 실패: {error}')
        return
    for path in candidates:
        directory = owned_download_dir(path, temp_root)
        if directory is None or not directory.is_dir():
            continue
        marker = directory / COMPLETED_MARKER
        try:
            if marker.stat().st_size > 256 or json.loads(marker.read_text(encoding='utf-8')) != {'version': 1, 'completed': True}:
                continue
        except (OSError, ValueError):
            continue
        _remove_completed_dir(directory, log)
