"""AILS writer staging files are never user background-work inputs."""

import os


def is_pdf_work_temp(path):
    name = os.path.basename(str(path)).casefold()
    return (name.startswith(".") and ".ails-" in name) or name.endswith(".ails-unlocked.tmp.pdf")
