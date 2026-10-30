"""Configure a preloaded development backend through its private parent pipe."""
from __future__ import annotations

import json
import os
import sys

ENVIRONMENT_KEYS = frozenset({"AILS_LOCAL_API_TOKEN", "AILS_UI_ORIGIN", "AILS_EXTERNAL_DOCUMENTS"})


def accept_desktop_start(stream=None) -> bool:
    stream = sys.stdin if stream is None else stream
    line = stream.readline(65537)
    if not line or line.strip() == "shutdown":
        return False
    try:
        message = json.loads(line)
        args, environment = message["args"], message["environment"]
        valid_args = (isinstance(args, list) and len(args) == 6
                      and all(isinstance(value, str) and "\0" not in value for value in args)
                      and args[:2] == ["--host", "127.0.0.1"]
                      and args[2] == "--port" and 0 < int(args[3]) < 65536
                      and args[4] == "--frontend" and os.path.isabs(args[5]))
        valid_environment = (isinstance(environment, dict)
                             and set(environment) == ENVIRONMENT_KEYS
                             and all(isinstance(value, str) and "\0" not in value
                                     for value in environment.values())
                             and bool(environment["AILS_LOCAL_API_TOKEN"]))
        if len(line) > 65536 or not valid_args or not valid_environment:
            raise ValueError
    except (KeyError, TypeError, ValueError):
        # Never echo the private message or its token in startup errors.
        raise ValueError("Invalid desktop startup handshake") from None
    os.environ.update(environment)
    sys.argv[1:] = args
    return True
