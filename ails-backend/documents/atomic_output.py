"""Publish a sibling output despite brief Windows sharing violations."""
import os
import time


def replace_output(temporary, destination, cancel_check=None):
    for attempt in range(8):
        if cancel_check is not None:
            cancel_check()
        try:
            os.replace(temporary, destination)
            return
        except OSError as error:
            if getattr(error, "winerror", None) not in {5, 32, 33} or attempt == 7:
                raise
            time.sleep(.025 * (attempt + 1))
