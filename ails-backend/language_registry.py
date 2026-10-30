"""Compatibility alias for :mod:`code_services.language_registry`."""

import sys as _sys

from code_services import language_registry as _implementation

_sys.modules[__name__] = _implementation
