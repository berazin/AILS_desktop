"""Compatibility alias for :mod:`code_services.language_profiles`."""

import sys as _sys

from code_services import language_profiles as _implementation

_sys.modules[__name__] = _implementation
