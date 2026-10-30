"""Keep the legacy shared requests binding without importing HTTP dependencies.

Local file browsing does not use requests. Existing callers and test patches can
still access requests.get/Session/exceptions through this module-shaped binding.
Import failures are not cached, so a subsequent feature call can retry.
"""
from importlib import import_module
from types import ModuleType


class _Requests(ModuleType):
    def __getattr__(self, name):
        return getattr(import_module("requests"), name)


requests = _Requests("requests")
