"""Incrementally validate complete result objects inside a batch JSON response."""
from __future__ import annotations

import json
import re
from collections.abc import Mapping

from code_services.code_grading import GradingResponseError, MAX_RESPONSE_CHARS, parse_grading_response


class BatchGradingCancelled(RuntimeError):
    pass


class BatchResultStream:
    def __init__(self, problem_ids: list[str]):
        self.expected = set(problem_ids)
        self.seen = set()
        self.limit = MAX_RESPONSE_CHARS * max(1, len(problem_ids))
        self.text = ""
        self.position = 0
        self.array_started = False
        self.object_start = None
        self.depth = 0
        self.in_string = False
        self.escaped = False
        self.need_separator = False
        self.array_finished = False

    def validate(self, item):
        if not isinstance(item, Mapping):
            raise GradingResponseError("Every batch grading result must be an object.")
        problem_id = item.get("problem_id")
        if not isinstance(problem_id, str) or problem_id not in self.expected or problem_id in self.seen:
            raise GradingResponseError("Batch grading returned an unknown or duplicate problem ID.")
        grading = parse_grading_response(json.dumps(item, ensure_ascii=False))
        self.seen.add(problem_id)
        return problem_id, grading

    def feed(self, delta: str):
        self.text += str(delta or "")
        if len(self.text) > self.limit:
            raise GradingResponseError("Batch grading response is too large.")
        if not self.array_started:
            prefix = re.match(r'\s*(?:```(?i:json)?\s*)?\{\s*"results"\s*:\s*\[', self.text)
            if not prefix:
                # Providers that add envelope metadata are still validated at
                # EOF; the requested results-first format can apply immediately.
                return
            self.array_started = True
            self.position = prefix.end()
        while self.position < len(self.text) and not self.array_finished:
            char = self.text[self.position]
            if self.object_start is None:
                self.position += 1
                if char.isspace():
                    continue
                if char == "]":
                    self.array_finished = True
                    break
                if self.need_separator:
                    if char != ",":
                        raise GradingResponseError("Batch result objects require a comma separator.")
                    self.need_separator = False
                    continue
                if char != "{":
                    raise GradingResponseError("Every batch grading result must be an object.")
                self.object_start = self.position - 1
                self.depth = 1
                self.in_string = False
                self.escaped = False
                continue
            self.position += 1
            if self.in_string:
                if self.escaped:
                    self.escaped = False
                elif char == "\\":
                    self.escaped = True
                elif char == '"':
                    self.in_string = False
            elif char == '"':
                self.in_string = True
            elif char in "{[":
                self.depth += 1
            elif char in "}]":
                self.depth -= 1
                if self.depth == 0:
                    try:
                        item = json.loads(self.text[self.object_start:self.position])
                    except ValueError as error:
                        raise GradingResponseError("Invalid complete batch result JSON.") from error
                    yield self.validate(item)
                    self.object_start = None
                    self.need_separator = True
