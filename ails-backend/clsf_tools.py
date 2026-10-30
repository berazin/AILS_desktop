"""Compatibility alias for :mod:`documents.clsf_tools`."""

import sys as _sys

from documents import clsf_tools as _implementation

_sys.modules[__name__] = _implementation
