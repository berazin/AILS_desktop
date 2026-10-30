"""Host labels and helper eligibility without Windows WMI queries.

Python 3.12's platform.uname() can raise KeyError('Architecture') when WMI
omits a requested field. These checks do not supply llmfit hardware values.
"""
import os
import platform
import sys
import sysconfig


def is_windows():
    return sys.platform == "win32"


def supports_bundled_helper():
    if not is_windows():
        return False
    architecture = (os.environ.get("PROCESSOR_ARCHITEW6432")
                    or os.environ.get("PROCESSOR_ARCHITECTURE")
                    or sysconfig.get_platform()).lower()
    return architecture in {"amd64", "x86_64", "win-amd64"}


def description():
    return "Windows" if is_windows() else platform.platform()
