"""Compatibility alias for :mod:`summary_generation.video_profiling`."""

import sys as _sys

from summary_generation import video_profiling as _implementation

_sys.modules[__name__] = _implementation
