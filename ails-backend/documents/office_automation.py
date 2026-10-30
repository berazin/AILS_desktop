"""HWPX automation produces proposals in memory, never writes the open file."""
import base64
import io
from documents.office_files import validate, MAX_BYTES


def automate(payload: dict) -> dict:
    from hwpx import HwpxDocument
    action = payload.get('operation')
    encoded = payload.get('data', '')
    if not isinstance(encoded, str) or len(encoded) > MAX_BYTES * 4 // 3 + 8:
        raise ValueError('잘못된 HWPX 데이터입니다.')
    if action == 'create':
        document = HwpxDocument.new()
        paragraphs = payload.get('paragraphs', [])
        if not isinstance(paragraphs, list) or len(paragraphs) > 1000:
            raise ValueError('문단은 최대 1000개입니다.')
        for text in paragraphs:
            if not isinstance(text, str) or len(text) > 100000:
                raise ValueError('문단이 너무 큽니다.')
            document.add_paragraph(text)
        rows = payload.get('table', [])
        if rows:
            if not isinstance(rows, list) or len(rows) > 1000 or not all(isinstance(row, list) and len(row) <= 100 for row in rows):
                raise ValueError('표는 최대 1000행, 100열입니다.')
            width = max(map(len, rows))
            if not width or len(rows) * width > 10000:
                raise ValueError('표는 1~10000개 셀로 구성해야 합니다.')
            table = document.add_table(len(rows), width)
            for r, row in enumerate(rows):
                for c, value in enumerate(row):
                    if not isinstance(value, str) or len(value) > 10000:
                        raise ValueError('표의 텍스트가 너무 큽니다.')
                    table.set_cell_text(r, c, value)
    else:
        data = base64.b64decode(encoded, validate=True)
        validate(data, '.hwpx')
        document = HwpxDocument.open(data)
        if action == 'extract':
            return {'text': document.text.plain()}
        if action != 'replace':
            raise ValueError('지원하지 않는 자동화 작업입니다.')
        before, after = payload.get('before'), payload.get('after')
        if not isinstance(before, str) or not before or not isinstance(after, str) or len(after) > 100000:
            raise ValueError('교체할 원문과 새 텍스트가 필요합니다.')
        if document.text.plain().count(before) != 1:
            raise ValueError('원문이 없거나 여러 곳에 있습니다. 영역을 명확히 지정하세요.')
        document.text.replace(before, after)
    stream = io.BytesIO()
    document.save_to_stream(stream)
    output = stream.getvalue()
    validate(output, '.hwpx')
    return {'data': base64.b64encode(output).decode(), 'text': document.text.plain(), 'requires_approval': True}
