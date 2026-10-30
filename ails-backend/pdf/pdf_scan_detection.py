"""비-AILS PDF 재OCR 판정용 일반 텍스트 PDF / searchable scan 구분.

백그라운드 OCR의 "AILS 메타데이터 없는 PDF" 판정은 텍스트 레이어 존재
여부만으로는 일반 텍스트 PDF와 searchable scan(페이지 대부분을 차지하는
래스터 이미지 + invisible 텍스트 레이어)을 구분하지 못한다. 이 모듈은
content stream을 직접 분석해 다음을 확인한다.

- 본문을 구성하는 텍스트가 실제로 visible native text인지
  (text render mode가 3/7이 아니고 본문 분량 이상 존재)
- 래스터 이미지가 페이지 대부분을 차지하는지 (image_bbox_area / page_area)
- 텍스트 bbox가 dominant image bbox 안에 포함되거나 교차하는 비율

판정은 보수적으로 동작한다. 분석에 실패하거나 확신이 없으면 False를
반환해 기존 재OCR 동작을 유지한다. 이미지·표·수식·벡터 그래픽의 존재
자체는 재OCR 사유가 되지 않는다.
"""

from __future__ import annotations

import os
import unicodedata

# --- 페이지 판정 임계값 ---
# dominant image 판정: 이미지 bbox가 페이지에서 차지하는 최소 비율.
DOMINANT_IMAGE_MIN_PAGE_RATIO = 0.5
# 텍스트 bbox가 dominant image와 겹친 것으로 보는 최소 면적 비율.
SPAN_IMAGE_CONTAINMENT_MIN_RATIO = 0.5
# 텍스트 레이어가 이미지 위에 "넓게" 겹쳐 있다고 보는 문자 비율.
TEXT_IMAGE_OVERLAP_MIN_RATIO = 0.6
# visible native 본문이 있다고 인정하는 페이지별 최소 문자 수.
NATIVE_PAGE_MIN_VISIBLE_CHARS = 40
# searchable scan 후보 페이지의 최소 텍스트 문자 수.
SCAN_PAGE_MIN_TEXT_CHARS = 24
# scan 후보에서 invisible/transparent 텍스트가 차지해야 하는 최소 비율.
SCAN_MIN_INVISIBLE_TEXT_RATIO = 0.5

# --- 문서 판정 임계값 ---
# 샘플링한 페이지 중 native 페이지 비율이 이 값을 초과하면 일반 텍스트 PDF.
DOC_NATIVE_MIN_PAGE_RATIO = 0.5
# 분석에 사용하는 기본 최대 페이지 수(균등 샘플링).
MAX_SAMPLE_PAGES = 8
# Form XObject 재귀 깊이 제한.
MAX_FORM_DEPTH = 4

# 텍스트 폭 추정용 평균 문자 폭(em 배수). CJK는 전각 1em으로 계산한다.
_LATIN_CHAR_WIDTH_EM = 0.5
_CJK_CHAR_WIDTH_EM = 1.0

Matrix = tuple[float, float, float, float, float, float]
BBox = tuple[float, float, float, float]


def _mat_identity() -> Matrix:
    return (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)


def _mat_mul(first: Matrix, second: Matrix) -> Matrix:
    """PDF 행렬 곱. 결과는 second 적용 후 first 적용과 동일하다."""
    a1, b1, c1, d1, e1, f1 = first
    a2, b2, c2, d2, e2, f2 = second
    return (
        a1 * a2 + b1 * c2,
        a1 * b2 + b1 * d2,
        c1 * a2 + d1 * c2,
        c1 * b2 + d1 * d2,
        e1 * a2 + f1 * c2 + e2,
        e1 * b2 + f1 * d2 + f2,
    )


def _mat_apply(matrix: Matrix, x: float, y: float) -> tuple[float, float]:
    a, b, c, d, e, f = matrix
    return (a * x + c * y + e, b * x + d * y + f)


def _number(value: object) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _bbox_area(bbox: BBox) -> float:
    left, bottom, right, top = bbox
    return max(0.0, right - left) * max(0.0, top - bottom)


def _bbox_intersection(first: BBox, second: BBox) -> float:
    width = min(first[2], second[2]) - max(first[0], second[0])
    height = min(first[3], second[3]) - max(first[1], second[1])
    return max(0.0, width) * max(0.0, height)


def _text_width_em(text: str) -> float:
    width = 0.0
    for char in text:
        if unicodedata.east_asian_width(char) in {"F", "W"}:
            width += _CJK_CHAR_WIDTH_EM
        else:
            width += _LATIN_CHAR_WIDTH_EM
    return width


def _byte_string_metrics(data: bytes) -> tuple[int, float]:
    """CID/인코딩 미지정 바이트 문자열의 (문자 수, 폭 em) 근사.

    Identity-H 등 2바이트 CID 폰트가 일반적이므로 글리프당 2바이트,
    전각 1em으로 추정한다. 정확한 글자 수가 아니라 분량·폭 근사만
    필요하다.
    """
    glyphs = max(1, len(data) // 2)
    return glyphs, glyphs * _CJK_CHAR_WIDTH_EM


class _PageTextImageStats:
    """한 페이지의 텍스트/이미지 배치 통계. 좌표는 mediabox 기준으로 정규화한다."""

    def __init__(self, page_area: float, offset: tuple[float, float]) -> None:
        self.page_area = page_area
        self.offset = offset
        self.image_bbox: BBox | None = None
        self.image_ratio = 0.0
        self.total_chars = 0
        self.visible_chars = 0
        self.invisible_chars = 0
        self.visible_over_image_chars = 0
        self.over_image_chars = 0

    def _shift(self, bbox: BBox) -> BBox:
        offset_x, offset_y = self.offset
        return (bbox[0] - offset_x, bbox[1] - offset_y, bbox[2] - offset_x, bbox[3] - offset_y)

    def note_image(self, bbox: BBox) -> None:
        ratio = _bbox_area(bbox) / self.page_area if self.page_area > 0 else 0.0
        if ratio > self.image_ratio:
            self.image_ratio = ratio
            self.image_bbox = bbox

    def note_text(self, bbox: BBox, chars: int, invisible: bool) -> None:
        if chars <= 0:
            return
        self.total_chars += chars
        if invisible:
            self.invisible_chars += chars
        else:
            self.visible_chars += chars
        if self.dominant_image and self.image_bbox:
            containment = _bbox_intersection(bbox, self.image_bbox) / max(_bbox_area(bbox), 1e-9)
            if containment >= SPAN_IMAGE_CONTAINMENT_MIN_RATIO:
                self.over_image_chars += chars
                if not invisible:
                    self.visible_over_image_chars += chars

    @property
    def dominant_image(self) -> bool:
        return self.image_ratio >= DOMINANT_IMAGE_MIN_PAGE_RATIO

    def _visible_text_lies_on_image(self) -> bool:
        """visible 텍스트가 dominant image 위에 깔린 OCR 오버레이인지."""
        if not self.dominant_image or not self.visible_chars:
            return False
        return self.visible_over_image_chars >= TEXT_IMAGE_OVERLAP_MIN_RATIO * self.visible_chars

    @property
    def kind(self) -> str:
        """페이지 분류: "native" / "scan" / "other"."""
        if (
            self.visible_chars >= NATIVE_PAGE_MIN_VISIBLE_CHARS
            and not self._visible_text_lies_on_image()
        ):
            return "native"
        if (
            self.dominant_image
            and self.total_chars >= SCAN_PAGE_MIN_TEXT_CHARS
            and self.invisible_chars >= SCAN_MIN_INVISIBLE_TEXT_RATIO * self.total_chars
            and self.over_image_chars >= TEXT_IMAGE_OVERLAP_MIN_RATIO * self.total_chars
        ):
            return "scan"
        return "other"


def _transformed_bbox(corners: tuple[tuple[float, float], ...], matrix: Matrix) -> BBox:
    points = [_mat_apply(matrix, x, y) for x, y in corners]
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    return (min(xs), min(ys), max(xs), max(ys))


def _operand_metrics(operand: object) -> tuple[int, float]:
    """show-text 연산 문자열의 (문자 수, 폭 em) 근사."""
    if isinstance(operand, bytes):
        return _byte_string_metrics(operand)
    if isinstance(operand, str):
        text = str(operand)
        return len(text), _text_width_em(text)
    return 0, 0.0


def _extract_show_text(op: str, operands: list) -> tuple[int, float]:
    """show-text 연산의 (문자 수, 폭 em) 근사치."""
    from pypdf.generic import ArrayObject

    if op == "TJ" and operands and isinstance(operands[0], ArrayObject):
        chars = 0
        width = 0.0
        for item in operands[0]:
            item_chars, item_width = _operand_metrics(item)
            chars += item_chars
            width += item_width
        return chars, width
    if op == '"' and len(operands) >= 3:
        return _operand_metrics(operands[2])
    if operands:
        return _operand_metrics(operands[0])
    return 0, 0.0


def _resolve_xobject(resources: object, name: str):
    if not isinstance(resources, dict):
        return None
    xobjects = resources.get("/XObject")
    if xobjects is None:
        return None
    try:
        return xobjects.get_object().get(name).get_object()
    except Exception:
        return None


def _walk_content(
    operations: list,
    resources: object,
    base_ctm: Matrix,
    stats: _PageTextImageStats,
    *,
    depth: int = 0,
    visited: set[int] | None = None,
) -> None:
    """content stream 연산자를 순회하며 텍스트/이미지 배치를 수집한다.

    텍스트 bbox는 폰트 메트릭 없이 근사한다(라틴 0.5em, CJK 1em). 재OCR
    판정은 정확한 글자 위치가 아니라 이미지와의 겹침 비율만 필요하다.
    """
    from pypdf.generic import ContentStream

    if depth > MAX_FORM_DEPTH:
        return
    visited = visited if visited is not None else set()
    ctm = base_ctm
    ctm_stack: list[Matrix] = []
    text_matrix = _mat_identity()
    line_matrix = _mat_identity()
    font_size = 0.0
    render_mode = 0
    leading = 0.0

    for operands, operator in operations:
        op = operator.decode("latin-1") if isinstance(operator, bytes) else str(operator)
        if op == "q":
            ctm_stack.append(ctm)
        elif op == "Q":
            ctm = ctm_stack.pop() if ctm_stack else ctm
        elif op == "cm" and len(operands) >= 6:
            matrix = tuple(_number(value) for value in operands[:6])
            ctm = _mat_mul(matrix, ctm)
        elif op == "BT":
            text_matrix = _mat_identity()
            line_matrix = _mat_identity()
        elif op == "Tm" and len(operands) >= 6:
            matrix = tuple(_number(value) for value in operands[:6])
            text_matrix = matrix
            line_matrix = matrix
        elif op == "Td" and len(operands) >= 2:
            step = (_number(operands[0]), _number(operands[1]))
            line_matrix = _mat_mul((1.0, 0.0, 0.0, 1.0, step[0], step[1]), line_matrix)
            text_matrix = line_matrix
        elif op == "TD" and len(operands) >= 2:
            leading = -_number(operands[1])
            step = (_number(operands[0]), _number(operands[1]))
            line_matrix = _mat_mul((1.0, 0.0, 0.0, 1.0, step[0], step[1]), line_matrix)
            text_matrix = line_matrix
        elif op == "T*":
            line_matrix = _mat_mul((1.0, 0.0, 0.0, 1.0, 0.0, -leading), line_matrix)
            text_matrix = line_matrix
        elif op == "TL" and operands:
            leading = _number(operands[0])
        elif op == "Tf" and len(operands) >= 2:
            font_size = _number(operands[1])
        elif op == "Tr" and operands:
            render_mode = int(_number(operands[0]))
        elif op in {"Tj", "TJ", "'", '"'}:
            chars, width_em = _extract_show_text(op, operands)
            if chars > 0:
                total = _mat_mul(text_matrix, ctm)
                width = width_em * font_size
                corners = (
                    (0.0, 0.0),
                    (width, 0.0),
                    (0.0, 0.8 * font_size),
                    (width, 0.8 * font_size),
                )
                bbox = _transformed_bbox(corners, total)
                stats.note_text(bbox, chars, render_mode in {3, 7})
        elif op == "Do" and operands:
            xobject = _resolve_xobject(resources, str(operands[0]))
            if xobject is None:
                continue
            subtype = str(xobject.get("/Subtype") or "")
            if subtype == "/Image":
                # 이미지 XObject는 단위 사각형을 CTM에 맞춰 배치한다.
                bbox = _transformed_bbox(
                    ((0.0, 0.0), (1.0, 0.0), (0.0, 1.0), (1.0, 1.0)), ctm
                )
                stats.note_image(bbox)
            elif subtype == "/Form":
                marker = id(xobject)
                if marker in visited:
                    continue
                visited.add(marker)
                form_ctm = ctm
                form_matrix = xobject.get("/Matrix")
                if form_matrix is not None:
                    matrix = tuple(_number(value) for value in form_matrix)
                    form_ctm = _mat_mul(matrix, ctm)
                try:
                    form_operations = ContentStream(xobject, None).operations
                except Exception:
                    continue
                form_resources = xobject.get("/Resources")
                if form_resources is not None:
                    form_resources = form_resources.get_object()
                if form_resources is None:
                    form_resources = resources
                _walk_content(
                    form_operations,
                    form_resources,
                    form_ctm,
                    stats,
                    depth=depth + 1,
                    visited=visited,
                )


def _analyze_page(page) -> _PageTextImageStats:
    mediabox = page.mediabox
    page_area = _number(mediabox.width) * _number(mediabox.height)
    offset = (_number(mediabox.left), _number(mediabox.bottom))
    stats = _PageTextImageStats(page_area, offset)
    if page_area <= 0:
        return stats
    content = page.get_contents()
    if content is None:
        return stats
    resources = page.get("/Resources")
    resources = resources.get_object() if resources is not None else None
    _walk_content(content.operations, resources, _mat_identity(), stats)
    return stats


def _sample_page_indices(page_count: int, max_pages: int) -> list[int]:
    if page_count <= max_pages:
        return list(range(page_count))
    step = (page_count - 1) / (max_pages - 1)
    indices = sorted({round(index * step) for index in range(max_pages)})
    return [index for index in indices if 0 <= index < page_count]


def pdf_has_visible_native_body(path: str, *, max_pages: int = MAX_SAMPLE_PAGES) -> bool:
    """본문이 visible native text로 구성된 일반 텍스트 PDF인지 판정한다.

    샘플링한 페이지의 과반수가 "native"(이미지 위 오버레이가 아닌 visible
    텍스트로 본문 구성)이면 True를 반환한다. searchable scan(invisible
    텍스트 레이어 + 페이지 대부분을 덮는 래스터 이미지), 분석 실패, 텍스트
    부족 등 확신이 없는 경우는 False를 반환해 기존 재OCR 판정을 유지한다.
    """
    from pypdf import PdfReader

    try:
        reader = PdfReader(os.fspath(path))
        if reader.is_encrypted:
            return False
        page_count = len(reader.pages)
        if page_count <= 0:
            return False
        native = 0
        analyzed = 0
        for index in _sample_page_indices(page_count, max(1, int(max_pages))):
            try:
                stats = _analyze_page(reader.pages[index])
            except Exception:
                continue
            analyzed += 1
            if stats.kind == "native":
                native += 1
        if analyzed <= 0:
            return False
        return native / analyzed > DOC_NATIVE_MIN_PAGE_RATIO
    except Exception:
        return False
