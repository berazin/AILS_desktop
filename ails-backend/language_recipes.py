"""Compatibility alias for :mod:`code_services.language_recipes`."""

import sys as _sys

from code_services import language_recipes as _implementation

_sys.modules[__name__] = _implementation
