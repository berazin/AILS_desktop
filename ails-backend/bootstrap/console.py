"""Safe streams for the windowed packaged Python executable."""
import sys

class DummyStream:
    def __init__(self, original):
        self.original = original
        self.encoding = 'utf-8'
    def write(self, *args, **kwargs):
        pass
    def flush(self, *args, **kwargs):
        pass
    def isatty(self):
        return False
    def close(self):
        pass
    def fileno(self):
        raise OSError("fileno")

def configure_console():
    if getattr(sys, "frozen", False):
        sys.stdout = DummyStream(sys.stdout)
        sys.stderr = DummyStream(sys.stderr)
