"""Bounded, optimistic and atomic persistence for local office editors.

Renderers send serialized bytes, never commands or arbitrary Python. Backups and
recovery drafts live separately from the user's document tree.
"""
from __future__ import annotations

import base64
import hashlib
import io
import mimetypes
import os
from pathlib import Path
import tempfile
import threading
import zipfile

EXTENSIONS = frozenset({'.docx', '.xlsx', '.csv', '.hwp', '.hwpx', '.html', '.htm'})
MAX_BYTES = 64 * 1024 * 1024
MAX_EXPANDED = 256 * 1024 * 1024
_lock = threading.RLock()


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def resolve_path(value: str, root: str, *, existing: bool = True) -> Path:
    from documents.external_documents import is_external_document
    if is_external_document(value, existing=existing):
        selected = Path(value).resolve(strict=existing)
        if selected.suffix.lower() in EXTENSIONS:
            return selected
    if not value or not root:
        raise ValueError('문서 경로와 작업공간이 필요합니다.')
    base = Path(root).resolve(strict=True)
    path = Path(value).resolve(strict=existing)
    if not path.is_relative_to(base) or path.suffix.lower() not in EXTENSIONS:
        raise ValueError('작업공간 안의 지원 문서만 열거나 저장할 수 있습니다.')
    if not path.parent.is_dir() or (existing and not path.is_file()):
        raise FileNotFoundError('문서 또는 저장 폴더를 찾을 수 없습니다.')
    return path


def validate(data: bytes, suffix: str) -> list[str]:
    if len(data) > MAX_BYTES:
        raise ValueError('문서 크기가 64 MiB 제한을 초과합니다.')
    warnings = []
    if suffix in {'.docx', '.xlsx', '.hwpx'}:
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                entries = archive.infolist()
                if len(entries) > 10000 or sum(e.file_size for e in entries) > MAX_EXPANDED:
                    raise ValueError('문서의 압축 해제 크기가 제한을 초과합니다.')
                names = set()
                for entry in entries:
                    name = entry.filename.replace('\\', '/')
                    if name.startswith('/') or '..' in name.split('/') or entry.flag_bits & 1:
                        raise ValueError('암호화되었거나 안전하지 않은 문서입니다.')
                    if name in names or (entry.file_size > 1024 * 1024 and entry.file_size > max(1, entry.compress_size) * 1000):
                        raise ValueError('중복 항목 또는 비정상 압축 문서입니다.')
                    names.add(name)
                required = {'.docx': 'word/document.xml', '.xlsx': 'xl/workbook.xml', '.hwpx': 'Contents/content.hpf'}[suffix]
                if required not in names:
                    raise ValueError('확장자와 문서 내용이 일치하지 않습니다.')
                if suffix == '.xlsx' and any(any(part in name for part in ('charts/', 'pivot', 'vbaProject', 'externalLinks/', 'slicer', 'connections.xml')) for name in names):
                    warnings.append('차트·피벗·매크로·외부 연결 등 일부 Excel 요소는 편집 후 보존되지 않을 수 있습니다.')
                for entry in entries:
                    if entry.filename.endswith(('.xml', '.rels', '.hpf')):
                        value = archive.read(entry)
                        normalized_xml = value.replace(b'\x00', b'').upper()
                        if b'<!DOCTYPE' in normalized_xml or b'<!ENTITY' in normalized_xml:
                            raise ValueError('외부 엔티티를 포함한 문서는 열 수 없습니다.')
        except zipfile.BadZipFile as error:
            raise ValueError('손상된 문서 ZIP입니다.') from error
    elif suffix == '.hwp':
        if not data.startswith(bytes.fromhex('D0CF11E0A1B11AE1')):
            raise ValueError('지원하는 바이너리 HWP 문서가 아닙니다.')
    if suffix in {'.docx', '.hwp', '.hwpx', '.xlsx'}:
        warnings.append('편집 엔진이 모든 원본 서식과 개체를 보존하지는 않습니다. 첫 저장은 사본으로 저장합니다.')
    return warnings


def read_bytes(path: Path) -> bytes:
    with path.open('rb') as handle:
        value = handle.read(MAX_BYTES + 1)
    if len(value) > MAX_BYTES:
        raise ValueError('문서 크기가 64 MiB 제한을 초과합니다.')
    return value


def atomic_write(path: Path, data: bytes) -> None:
    fd, temporary = tempfile.mkstemp(prefix='.ails-save-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def recovery_path(path: Path, storage: Path) -> Path:
    key = digest(str(path).casefold().encode())
    return storage / (key + '.draft')


def request(action: str, payload: dict, root: str, storage: str) -> dict:
    with _lock:
        source = resolve_path(str(payload.get('path') or ''), root)
        data = read_bytes(source)
        revision = digest(data)
        store = Path(storage) / 'office-recovery'
        draft = recovery_path(source, store)
        receipt = draft.with_suffix('.saved')
        generated = receipt.is_file() and receipt.read_text(encoding='ascii') == revision
        if action == 'open':
            warnings = validate(data, source.suffix.lower())
            return {'path': str(source), 'revision': revision, 'data': base64.b64encode(data).decode(),
                    'warnings': warnings, 'requires_copy': bool(warnings) and not generated, 'has_recovery': draft.is_file()}
        if action == 'resource':
            if source.suffix.lower() not in {'.html', '.htm'}:
                raise ValueError('HTML 문서의 리소스만 읽을 수 있습니다.')
            relative = str(payload.get('relative') or '')
            asset = (source.parent / relative).resolve(strict=True)
            if not asset.is_relative_to(source.parent) or asset.suffix.lower() not in {'.css', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.woff', '.woff2'}:
                raise ValueError('문서 폴더 안의 CSS·이미지·글꼴만 읽을 수 있습니다.')
            if asset.stat().st_size > 10 * 1024 * 1024:
                raise ValueError('리소스 크기가 제한을 초과합니다.')
            return {'data': base64.b64encode(asset.read_bytes()).decode(), 'mime': mimetypes.guess_type(asset.name)[0] or 'application/octet-stream'}
        if action == 'recovery':
            return {'data': base64.b64encode(read_bytes(draft)).decode() if draft.is_file() else None}
        if action == 'discard-recovery':
            draft.unlink(missing_ok=True)
            return {'ok': True}
        if action == 'backups':
            prefix = digest(str(source).casefold().encode())
            return {'backups': [{'revision': p.name.split('.')[1], 'modified': p.stat().st_mtime}
                                for p in sorted(store.glob(prefix + '.*.backup'), key=lambda p: p.stat().st_mtime, reverse=True)[:20]]}
        if action == 'restore-backup':
            value = str(payload.get('backup_revision', ''))
            if len(value) != 64 or any(c not in '0123456789abcdef' for c in value):
                raise ValueError('잘못된 백업 식별자입니다.')
            backup = store / (digest(str(source).casefold().encode()) + '.' + value + '.backup')
            content = read_bytes(backup)
            validate(content, source.suffix.lower())
            atomic_write(draft, content)
            return {'ok': True}
        encoded = payload.get('data')
        if not isinstance(encoded, str) or len(encoded) > (MAX_BYTES * 4 // 3 + 8):
            raise ValueError('잘못된 문서 데이터입니다.')
        content = base64.b64decode(encoded, validate=True)
        validate(content, source.suffix.lower())
        if action == 'draft':
            store.mkdir(parents=True, exist_ok=True)
            atomic_write(draft, content)
            return {'ok': True}
        if action != 'save':
            raise ValueError('지원하지 않는 문서 작업입니다.')
        if payload.get('revision') != revision:
            raise ValueError('문서가 외부에서 변경되었습니다. 다시 열거나 변경 내용을 복구 사본으로 보존하세요.')
        target = resolve_path(str(payload.get('target') or source), root, existing=False)
        if target.suffix.lower() != source.suffix.lower():
            raise ValueError('같은 파일 형식으로 저장하세요.')
        same = target == source
        if not same and target.exists():
            raise ValueError('같은 이름의 파일이 있습니다. 다른 이름을 선택하세요.')
        if same and validate(data, source.suffix.lower()) and not generated:
            raise ValueError('원본 보존을 위해 다른 이름으로 저장하세요.')
        backup = store / (digest(str(source).casefold().encode()) + '.' + revision + '.backup')
        if not backup.exists():
            store.mkdir(parents=True, exist_ok=True)
            atomic_write(backup, data)
        if digest(read_bytes(source)) != revision:
            raise ValueError('저장 준비 중 문서가 외부에서 변경되었습니다. 원본을 다시 확인하세요.')
        atomic_write(target, content)
        atomic_write(recovery_path(target, store).with_suffix('.saved'), digest(content).encode('ascii'))
        draft.unlink(missing_ok=True)
        return {'path': str(target), 'revision': digest(content), 'backup': str(backup)}
