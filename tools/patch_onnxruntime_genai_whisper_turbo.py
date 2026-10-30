from pathlib import Path

from onnxruntime_genai.models.builders import base, whisper


DECODER_COUNT_OLD = """        self.num_mel_bins = config.num_mel_bins
        self.max_source_positions = config.max_source_positions

        extra_options[\"include_hidden_states\"]"""
DECODER_COUNT_NEW = """        self.num_mel_bins = config.num_mel_bins
        self.max_source_positions = config.max_source_positions
        self.num_decoder_layers = config.decoder_layers

        extra_options[\"include_hidden_states\"]"""
PACKED_OLD = """    def is_gqa_supported(self):
        # GQA is not supported in Whisper since there is no attention mask input
        return False

    def make_inputs_and_outputs(self):"""
PACKED_NEW = """    def is_gqa_supported(self):
        # GQA is not supported in Whisper since there is no attention mask input
        return False

    def is_packed_attn_supported(self):
        # The packed attention builder is invalid for Whisper DirectML and INT4.
        return False

    def make_inputs_and_outputs(self):"""
LOOP_OLD = "        for i in range(self.num_layers):\n            for proj_type in [\"k_proj\", \"v_proj\"]:"
LOOP_INTERMEDIATE = "        for i in range(len(self.weights.model.decoder.layers)):\n            for proj_type in [\"k_proj\", \"v_proj\"]:"
LOOP_NEW = "        for i in range(self.num_decoder_layers):\n            for proj_type in [\"k_proj\", \"v_proj\"]:"
OUTPUTS_OLD = """            \"present_key_cross\": [f\"present_key_cross_{i}\" for i in range(self.num_layers)],
            \"present_value_cross\": [f\"present_value_cross_{i}\" for i in range(self.num_layers)],"""
OUTPUTS_INTERMEDIATE = """            \"present_key_cross\": [f\"present_key_cross_{i}\" for i in range(len(self.weights.model.decoder.layers))],
            \"present_value_cross\": [f\"present_value_cross_{i}\" for i in range(len(self.weights.model.decoder.layers))],"""
OUTPUTS_NEW = """            \"present_key_cross\": [f\"present_key_cross_{i}\" for i in range(self.num_decoder_layers)],
            \"present_value_cross\": [f\"present_value_cross_{i}\" for i in range(self.num_decoder_layers)],"""
BASE_OLD = "        if not os.listdir(self.cache_dir):\n            os.rmdir(self.cache_dir)"
BASE_NEW = "        if os.path.isdir(self.cache_dir) and not os.listdir(self.cache_dir):\n            os.rmdir(self.cache_dir)"
SEARCH_OLD = '                "past_present_share_buffer": True,'
SEARCH_NEW = '                "past_present_share_buffer": False,'


def main() -> None:
    whisper_path = Path(whisper.__file__).resolve()
    replacements = (
        (whisper_path, (DECODER_COUNT_OLD,), DECODER_COUNT_NEW),
        (whisper_path, (PACKED_OLD,), PACKED_NEW),
        (whisper_path, (LOOP_OLD, LOOP_INTERMEDIATE), LOOP_NEW),
        (whisper_path, (OUTPUTS_OLD, OUTPUTS_INTERMEDIATE), OUTPUTS_NEW),
        (whisper_path, (SEARCH_OLD,), SEARCH_NEW),
        (Path(base.__file__).resolve(), (BASE_OLD,), BASE_NEW),
    )
    for path, old_variants, new in replacements:
        source = path.read_text(encoding="utf-8")
        if new in source:
            continue
        matches = [old for old in old_variants if source.count(old) == 1]
        if len(matches) != 1:
            raise RuntimeError(f"Unexpected ONNX Runtime GenAI builder source: {path}")
        path.write_text(source.replace(matches[0], new), encoding="utf-8")


if __name__ == "__main__":
    main()
