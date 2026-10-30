"""Incrementally hide the local model's cloud recommendation control marker."""

import re

_PREFIX = "[[CLOUD_RECOMMENDED:"
_MARKER = re.compile(re.escape(_PREFIX) + r".{1,300}?\]\]", re.DOTALL)


class LocalAnswerStream:
    def __init__(self):
        self._pending = ""

    def feed(self, token: str) -> str:
        self._pending += token
        visible = []
        while self._pending:
            start = self._pending.find(_PREFIX)
            if start >= 0:
                visible.append(self._pending[:start])
                self._pending = self._pending[start:]
                marker = _MARKER.match(self._pending)
                if marker:
                    self._pending = self._pending[marker.end():]
                    continue
                if len(self._pending) <= len(_PREFIX) + 302:
                    break
                # A malformed marker is ordinary text; do not buffer it forever.
                visible.append(self._pending[0])
                self._pending = self._pending[1:]
                continue
            keep = next((size for size in range(min(len(self._pending), len(_PREFIX) - 1), 0, -1)
                         if self._pending.endswith(_PREFIX[:size])), 0)
            visible.append(self._pending[:-keep] if keep else self._pending)
            self._pending = self._pending[-keep:] if keep else ""
            break
        return "".join(visible)

    def finish(self) -> str:
        pending, self._pending = self._pending, ""
        return pending
