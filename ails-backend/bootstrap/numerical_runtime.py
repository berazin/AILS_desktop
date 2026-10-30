"""Initialize packaged Windows numerical DLLs before request threads exist."""
from __future__ import annotations

import importlib
import os
import sys
import threading


def prepare_numerical_runtime() -> bool:
    if os.name != "nt" or not getattr(sys, "frozen", False):
        return False
    if threading.current_thread() is not threading.main_thread():
        raise RuntimeError("Packaged numerical libraries must initialize on the main thread.")
    # NumPy's first native load on a request thread can hold the Windows DLL
    # loader lock while another request waits for Thread.start(). Do this before
    # creating API/background workers; model loading remains application-owned.
    importlib.import_module("numpy")
    return True
