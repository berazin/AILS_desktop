"""One-shot, read-only text previews. Never start the API or background services."""
from __future__ import annotations

import json
import re
import struct
import sys
import zipfile
import zlib
from pathlib import Path
from xml.etree import ElementTree


def zipped_text(path: Path, pattern: str, tag: str) -> str:
    with zipfile.ZipFile(path) as archive:
        if sum(item.file_size for item in archive.infolist()) > 256 * 1024 * 1024:
            raise ValueError('압축 해제 크기가 너무 큽니다.')
        names = sorted((name for name in archive.namelist() if re.fullmatch(pattern, name)),
                       key=lambda name: int(re.search(r'(\d+)\.xml$', name).group(1)))
        sections = []
        for name in names:
            root = ElementTree.fromstring(archive.read(name))
            sections.append('\n'.join(element.text or '' for element in root.iter() if element.tag.split('}')[-1] == tag))
        return '\n\n---\n\n'.join(sections)


def hwp_text(path: Path) -> str:
    import olefile
    with olefile.OleFileIO(path) as archive:
        header = archive.openstream('FileHeader').read()
        flags = struct.unpack_from('<I', header, 36)[0]
        if flags & (2 | 4):
            raise ValueError('암호화 또는 배포용 HWP는 작업공간에서 열어 주세요.')
        sections = sorted((name for name in archive.listdir() if name[0] == 'BodyText' and name[-1].startswith('Section')), key=lambda name: int(name[-1][7:]))
        result = []
        for name in sections:
            data = archive.openstream(name).read()
            if flags & 1:
                decoder = zlib.decompressobj(-15)
                data = decoder.decompress(data, 32 * 1024 * 1024 + 1)
                if len(data) > 32 * 1024 * 1024 or decoder.unconsumed_tail:
                    raise ValueError('HWP 구역이 너무 큽니다.')
            offset = 0
            while offset + 4 <= len(data):
                record = struct.unpack_from('<I', data, offset)[0]; offset += 4
                tag, size = record & 1023, record >> 20
                if size == 4095:
                    size = struct.unpack_from('<I', data, offset)[0]; offset += 4
                content = data[offset:offset + size]; offset += size
                if tag != 67:
                    continue
                units = struct.unpack('<' + 'H' * (len(content) // 2), content[:len(content) // 2 * 2])
                chars, index = [], 0
                while index < len(units):
                    code = units[index]
                    if code in (10, 13): chars.append('\n')
                    elif code == 9: chars.append('\t')
                    elif code >= 32: chars.append(chr(code))
                    index += 8 if code in (1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23) else 1
                result.append(''.join(chars))
        return '\n'.join(result)


def main(argv=None):
    path = Path((argv or sys.argv[1:])[0]).resolve(strict=True)
    if not path.is_file() or path.stat().st_size > 128 * 1024 * 1024:
        raise ValueError('파일이 없거나 128MB를 넘습니다.')
    kind = path.suffix.lower()
    if kind == '.pptx':
        content = zipped_text(path, r'ppt/slides/slide\d+\.xml', 't')
    elif kind == '.hwpx':
        content = zipped_text(path, r'Contents/section\d+\.xml', 't')
    elif kind == '.hwp':
        content = hwp_text(path)
    elif kind == '.ppt':
        import olefile
        with olefile.OleFileIO(path) as archive:
            data = archive.openstream('PowerPoint Document').read()
        # PPT text atoms can occur within nested containers. Walk record bounds.
        def records(data):
            texts, offset = [], 0
            while offset + 8 <= len(data):
                info, kind, size = struct.unpack_from('<HHI', data, offset); offset += 8
                payload = data[offset:offset + size]; offset += size
                if len(payload) != size: break
                if kind in (4000, 4008): texts.append(payload.decode('utf-16le' if kind == 4000 else 'cp1252', errors='replace'))
                elif info & 15 == 15: texts.extend(records(payload))
            return texts
        content = '\n\n'.join(records(data))
    else:
        if kind not in {'.epub', '.mobi', '.azw', '.azw3', '.fb2', '.rtf'}:
            raise ValueError('지원하지 않는 형식입니다.')
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from documents.paperback_document import read_paperback_document
        _, content = read_paperback_document(str(path))
    if not content.strip():
        raise ValueError('읽을 수 있는 텍스트가 없습니다. 원본은 AILS 작업공간에서 열어 주세요.')
    print(json.dumps({'content': content}, ensure_ascii=True))


if __name__ == '__main__':
    main()
