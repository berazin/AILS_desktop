"""Optional developer-only Phoenix tracing for AILS.

The Phoenix SDK is imported only when tracing is enabled.  This keeps the
common server path usable when the optional developer dependency is absent and
lets commercial packaging exclude this module and its dependencies entirely.
"""

from __future__ import annotations

import importlib.util
import re
from collections.abc import Mapping
from urllib.parse import urlparse

from edition_manifest import feature_enabled


DEFAULT_PHOENIX_ENDPOINT = "http://127.0.0.1:6006/v1/traces"
DEFAULT_PHOENIX_PROJECT_NAME = "AILS-dev"
PHOENIX_CONFIG_KEYS = frozenset(
    {"phoenix_enabled", "phoenix_endpoint", "phoenix_project_name"}
)
_PROJECT_NAME_RE = re.compile(r"[^A-Za-z0-9_. -]+")


def phoenix_enabled(config: Mapping | None, *, edition: str | None = None) -> bool:
    return feature_enabled("developer_tools", edition) and bool(
        isinstance(config, Mapping) and config.get("phoenix_enabled")
    )


def _normalize_endpoint(value: object) -> str:
    raw = str(value or "").strip().rstrip("/")
    parsed = urlparse(raw)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.netloc
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        return DEFAULT_PHOENIX_ENDPOINT
    if not parsed.path or parsed.path == "/":
        return f"{raw}/v1/traces"
    if parsed.path.rstrip("/") == "/v1/traces":
        return raw
    return DEFAULT_PHOENIX_ENDPOINT


def _normalize_project_name(value: object) -> str:
    project = _PROJECT_NAME_RE.sub("", str(value or "").strip())[:80].strip()
    return project or DEFAULT_PHOENIX_PROJECT_NAME


def normalize_phoenix_config(config: Mapping | None, *, edition: str | None = None) -> dict:
    normalized = dict(config) if isinstance(config, Mapping) else {}
    if not feature_enabled("developer_tools", edition):
        for key in PHOENIX_CONFIG_KEYS:
            normalized.pop(key, None)
        return normalized
    normalized["phoenix_enabled"] = bool(normalized.get("phoenix_enabled", False))
    normalized["phoenix_endpoint"] = _normalize_endpoint(
        normalized.get("phoenix_endpoint", DEFAULT_PHOENIX_ENDPOINT)
    )
    normalized["phoenix_project_name"] = _normalize_project_name(
        normalized.get("phoenix_project_name", DEFAULT_PHOENIX_PROJECT_NAME)
    )
    return normalized


def _sdk_available() -> bool:
    try:
        return importlib.util.find_spec("phoenix.otel") is not None
    except (ImportError, ModuleNotFoundError, ValueError):
        return False


class PhoenixTelemetry:
    """Small lazy wrapper around ``arize-phoenix-otel``."""

    def __init__(self) -> None:
        self._provider = None
        self._tracer = None
        self._signature: tuple[str, str] | None = None
        self._last_error = ""

    @staticmethod
    def enabled(config: Mapping | None) -> bool:
        return phoenix_enabled(config)

    def status(self, config: Mapping | None) -> dict:
        normalized = normalize_phoenix_config(config)
        enabled = phoenix_enabled(normalized)
        sdk_available = _sdk_available()
        last_error = self._last_error
        if enabled and not sdk_available and not last_error:
            last_error = "arize-phoenix-otel이 설치되지 않았습니다. 개발 환경에서 선택적으로 설치하세요."
        return {
            "enabled": enabled,
            "configured": bool(normalized.get("phoenix_endpoint")),
            "sdk_available": sdk_available,
            "endpoint": normalized.get("phoenix_endpoint", DEFAULT_PHOENIX_ENDPOINT),
            "project_name": normalized.get("phoenix_project_name", DEFAULT_PHOENIX_PROJECT_NAME),
            "last_error": last_error,
        }

    def _ensure_tracer(self, config: Mapping) -> object | None:
        normalized = normalize_phoenix_config(config)
        signature = (
            str(normalized["phoenix_endpoint"]),
            str(normalized["phoenix_project_name"]),
        )
        if self._tracer is not None and self._signature == signature:
            return self._tracer
        try:
            from phoenix.otel import register

            self._provider = register(
                endpoint=signature[0],
                project_name=signature[1],
                protocol="http/protobuf",
                batch=True,
            )
            self._tracer = self._provider.get_tracer("ails")
            self._signature = signature
            self._last_error = ""
            return self._tracer
        except Exception as error:  # optional telemetry must never break AILS
            self._tracer = None
            self._provider = None
            self._signature = None
            self._last_error = str(error)[:240]
            return None

    def record_event(
        self,
        config: Mapping | None,
        *,
        label: str,
        event_type: str,
        source: str = "",
        model: str = "",
        content_length: int = 0,
    ) -> bool:
        if not phoenix_enabled(config):
            return False
        # Token events are intentionally omitted; one span per token makes
        # tracing noisy and adds needless overhead without helping evaluation.
        if str(event_type or "").strip().casefold() == "token":
            return False
        tracer = self._ensure_tracer(config)
        if tracer is None:
            return False
        try:
            span_name = re.sub(r"[^A-Za-z0-9_.-]+", "-", str(label or "event")).strip("-")
            with tracer.start_as_current_span(f"ails.{span_name or 'event'}") as span:
                attributes = {
                    "ails.event_type": str(event_type or "info"),
                    "ails.source": str(source or ""),
                    "ails.model": str(model or ""),
                    "ails.content_length": max(0, int(content_length or 0)),
                }
                for key, value in attributes.items():
                    if value != "":
                        span.set_attribute(key, value)
            return True
        except Exception as error:  # telemetry failures are isolated from chat
            self._last_error = str(error)[:240]
            return False

    def shutdown(self) -> None:
        provider = self._provider
        self._provider = None
        self._tracer = None
        self._signature = None
        if provider is not None:
            try:
                provider.shutdown()
            except Exception:
                pass
