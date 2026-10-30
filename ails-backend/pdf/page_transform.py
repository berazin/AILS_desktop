from __future__ import annotations

import math
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from numbers import Real
from typing import Any, ClassVar, TYPE_CHECKING

if TYPE_CHECKING:
    from pypdf import PageObject


Point = tuple[float, float]
BBox = tuple[float, float, float, float]
Matrix = tuple[float, float, float, float, float, float]


def _finite(value: Any, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, Real):
        raise ValueError(f"{name} must be a finite number")
    try:
        result = float(value)
    except (OverflowError, ValueError) as error:
        raise ValueError(f"{name} must be a finite number") from error
    if not math.isfinite(result):
        raise ValueError(f"{name} must be a finite number")
    return result


def _coordinates(values: Sequence[float], count: int) -> tuple[float, ...]:
    if not isinstance(values, Sequence) or len(values) != count:
        raise ValueError(f"Expected {count} coordinates")
    return tuple(_finite(value, "Coordinate") for value in values)


def _bbox(values: Sequence[float]) -> BBox:
    left, bottom, right, top = _coordinates(values, 4)
    if right < left or top < bottom:
        raise ValueError("BBox coordinates must be ordered")
    return left, bottom, right, top


def _map_bbox(bbox: Sequence[float], transform: Callable[[Point], Point]) -> BBox:
    left, bottom, right, top = _bbox(bbox)
    points = [transform((x, y)) for x, y in
              ((left, bottom), (left, top), (right, bottom), (right, top))]
    return (min(p[0] for p in points), min(p[1] for p in points),
            max(p[0] for p in points), max(p[1] for p in points))


@dataclass(frozen=True, slots=True)
class PageTransform:
    media_box: BBox
    crop_box: BBox
    rotation: int = 0
    user_unit: float = 1.0

    VERSION: ClassVar[int] = 1
    COORDINATE_SPACE: ClassVar[str] = "displayed_crop_top_left_physical_points"

    def __post_init__(self) -> None:
        media = _bbox(self.media_box)
        crop = _bbox(self.crop_box)
        visible = (max(media[0], crop[0]), max(media[1], crop[1]),
                   min(media[2], crop[2]), min(media[3], crop[3]))
        if visible[2] <= visible[0] or visible[3] <= visible[1]:
            raise ValueError("MediaBox and CropBox must have a positive-area intersection")
        rotation = _finite(self.rotation, "Rotate")
        if rotation % 90 != 0:
            raise ValueError("Rotate must be a multiple of 90 degrees")
        unit = _finite(self.user_unit, "UserUnit")
        if unit <= 0 or not math.isfinite(1.0 / unit):
            raise ValueError("UserUnit must be positive with a finite inverse")
        object.__setattr__(self, "media_box", media)
        object.__setattr__(self, "crop_box", crop)
        object.__setattr__(self, "rotation", int(rotation) % 360)
        object.__setattr__(self, "user_unit", unit)
        if not all(math.isfinite(size) and size > 0 for size in (self.width, self.height)):
            raise ValueError("Physical page dimensions must be finite and positive")

    @classmethod
    def from_page(cls, page: PageObject) -> PageTransform:
        media = page.get("/MediaBox")
        if media is None:
            raise ValueError("Page must have a MediaBox")
        crop = page.get("/CropBox", media)
        rotation = page.get("/Rotate", 0)
        unit = page.get("/UserUnit", 1)
        return cls(*(value.get_object() if hasattr(value, "get_object") else value
                     for value in (media, crop, rotation, unit)))

    @property
    def visible_box(self) -> BBox:
        media, crop = self.media_box, self.crop_box
        return (max(media[0], crop[0]), max(media[1], crop[1]),
                min(media[2], crop[2]), min(media[3], crop[3]))

    @property
    def width(self) -> float:
        left, bottom, right, top = self.visible_box
        return (top - bottom if self.rotation in (90, 270) else right - left) * self.user_unit

    @property
    def height(self) -> float:
        left, bottom, right, top = self.visible_box
        return (right - left if self.rotation in (90, 270) else top - bottom) * self.user_unit

    def pdf_to_canonical(self, point: Sequence[float]) -> Point:
        x, y = _coordinates(point, 2)
        left, bottom, right, top = self.visible_box
        if self.rotation == 0:
            result = (x - left, top - y)
        elif self.rotation == 90:
            result = (y - bottom, x - left)
        elif self.rotation == 180:
            result = (right - x, y - bottom)
        else:
            result = (top - y, right - x)
        return (_finite(result[0] * self.user_unit, "Transformed coordinate"),
                _finite(result[1] * self.user_unit, "Transformed coordinate"))

    def canonical_to_pdf(self, point: Sequence[float]) -> Point:
        x, y = _coordinates(point, 2)
        x, y = x / self.user_unit, y / self.user_unit
        left, bottom, right, top = self.visible_box
        if self.rotation == 0:
            result = (left + x, top - y)
        elif self.rotation == 90:
            result = (left + y, bottom + x)
        elif self.rotation == 180:
            result = (right - x, bottom + y)
        else:
            result = (right - y, top - x)
        return (_finite(result[0], "Transformed coordinate"),
                _finite(result[1], "Transformed coordinate"))

    def pdf_bbox_to_canonical(self, bbox: Sequence[float]) -> BBox:
        return _map_bbox(bbox, self.pdf_to_canonical)

    def canonical_bbox_to_pdf(self, bbox: Sequence[float]) -> BBox:
        return _map_bbox(bbox, self.canonical_to_pdf)

    def image_bbox_to_canonical(
        self, bbox: Sequence[float], image_width: float, image_height: float,
    ) -> BBox:
        width, height = self._image_size(image_width, image_height)
        return _map_bbox(bbox, lambda p: (
            _finite(p[0] / width * self.width, "Transformed coordinate"),
            _finite(p[1] / height * self.height, "Transformed coordinate"),
        ))

    def canonical_bbox_to_image(
        self, bbox: Sequence[float], image_width: float, image_height: float,
    ) -> BBox:
        width, height = self._image_size(image_width, image_height)
        return _map_bbox(bbox, lambda p: (
            _finite(p[0] / self.width * width, "Transformed coordinate"),
            _finite(p[1] / self.height * height, "Transformed coordinate"),
        ))

    @staticmethod
    def _image_size(image_width: float, image_height: float) -> Point:
        width = _finite(image_width, "Image width")
        height = _finite(image_height, "Image height")
        if width <= 0 or height <= 0:
            raise ValueError("Image dimensions must be positive")
        return width, height

    def normalized_bbox_to_canonical(self, bbox: Sequence[float]) -> BBox:
        return self.image_bbox_to_canonical(bbox, 1.0, 1.0)

    @property
    def overlay_to_pdf(self) -> Matrix:
        left, bottom, right, top = self.visible_box
        inverse_unit = 1.0 / self.user_unit
        return {
            0: (inverse_unit, 0.0, 0.0, inverse_unit, left, bottom),
            90: (0.0, inverse_unit, -inverse_unit, 0.0, right, bottom),
            180: (-inverse_unit, 0.0, 0.0, -inverse_unit, right, top),
            270: (0.0, -inverse_unit, inverse_unit, 0.0, left, top),
        }[self.rotation]

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": self.VERSION,
            "coordinate_space": self.COORDINATE_SPACE,
            "media_box": list(self.media_box),
            "crop_box": list(self.crop_box),
            "rotation": self.rotation,
            "user_unit": self.user_unit,
            "width": self.width,
            "height": self.height,
        }

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> PageTransform:
        if not isinstance(value, Mapping):
            raise ValueError("Page transform must be a mapping")
        if (type(value.get("version")) is not int or value["version"] != cls.VERSION
                or value.get("coordinate_space") != cls.COORDINATE_SPACE):
            raise ValueError("Unsupported page transform contract")
        try:
            result = cls(value["media_box"], value["crop_box"], value["rotation"], value["user_unit"])
            if (_finite(value["width"], "Width") != result.width
                    or _finite(value["height"], "Height") != result.height):
                raise ValueError("Serialized dimensions do not match page geometry")
        except KeyError as error:
            raise ValueError(f"Missing page transform field: {error.args[0]}") from error
        return result
