"""Apply the shared generation policy to Gemini's text and media entrypoints."""
import json

from ai_request_limits import AIInputLimitExceeded, request_input_limit, without_output_limits


class _Models:
    def __init__(self, models):
        self._models = models

    def __getattr__(self, name):
        return getattr(self._models, name)

    def _prepare(self, kwargs):
        kwargs = dict(kwargs)
        config = kwargs.get("config")
        if hasattr(config, "model_dump"):
            config = config.model_dump(exclude_none=True)
        config = without_output_limits(config)
        if config:
            kwargs["config"] = config
        else:
            kwargs.pop("config", None)
        contents = kwargs["contents"]
        # The installed Developer API SDK cannot put system/tools in count
        # config. Include their serialized contents in this counting request.
        count_contents = list(contents) if isinstance(contents, list) else [contents]
        extras = {key: config[key] for key in ("system_instruction", "tools", "response_schema", "response_json_schema") if key in config}
        if extras:
            count_contents.append(json.dumps(extras, ensure_ascii=False, default=str))
        counted = self._models.count_tokens(model=kwargs["model"], contents=count_contents)
        count = getattr(counted, "total_tokens", None)
        if not isinstance(count, int) or count < 0:
            raise AIInputLimitExceeded("Gemini 입력 토큰 수를 확인하지 못했습니다.")
        limit = request_input_limit(kwargs["model"])
        if count + 64 > limit:
            raise AIInputLimitExceeded(f"Gemini 입력이 호출당 한도를 넘습니다: {count + 64:,} / {limit:,} 토큰.")
        return kwargs

    def generate_content(self, **kwargs):
        return self._models.generate_content(**self._prepare(kwargs))

    def generate_content_stream(self, **kwargs):
        return self._models.generate_content_stream(**self._prepare(kwargs))


class InputLimitedGeminiClient:
    def __init__(self, client):
        self._client = client
        self.models = _Models(client.models)

    def __getattr__(self, name):
        return getattr(self._client, name)

    def __enter__(self):
        self._client.__enter__()
        return self

    def __exit__(self, *args):
        return self._client.__exit__(*args)
