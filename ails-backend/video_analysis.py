"""Compatibility alias for :mod:`summary_generation.video_analysis`."""

import sys as _sys

from summary_generation import video_analysis as _implementation

_sys.modules[__name__] = _implementation
