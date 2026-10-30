"""Compatibility alias for :mod:`summary_generation.video_segmentation`."""

import sys as _sys

from summary_generation import video_segmentation as _implementation

_sys.modules[__name__] = _implementation
