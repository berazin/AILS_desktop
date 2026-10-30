"""Opt-in process phases without paths, document contents or credentials."""
import os
import time


def mark_startup_phase(name: str):
    if os.environ.get("AILS_STARTUP_DIAGNOSTICS"):
        print(f"[AILS startup] {name}={time.time_ns() // 1_000_000}", flush=True)
