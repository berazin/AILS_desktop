# DirectML Whisper commercial redistribution review

This checklist is evidence for a human release review. It does not approve a
bundle by itself and no tool may automatically change an approval flag to
`true`.

## Pinned inputs

- [ ] `onnxruntime-genai-directml==0.13.1` was obtained from the official PyPI
  release. The CPython 3.12 Windows x64 wheel is
  `onnxruntime_genai_directml-0.13.1-cp312-cp312-win_amd64.whl`, SHA-256
  `a7c6b87e8ab9fc7ab9644cc4a55358550284f72a064470904372c24501c45932`.
- [ ] `onnxruntime-directml==1.24.4` was obtained from the official PyPI
  release. The CPython 3.12 Windows x64 wheel is
  `onnxruntime_directml-1.24.4-cp312-cp312-win_amd64.whl`, SHA-256
  `f2ecb68b7b7b259d2ef3112ae760149f9b5a1e7c0fbb73d539da6250a648a614`.
- [ ] The model sources and full revisions for Tiny, Base, Small, Medium,
  Large-v3-turbo and Large-v3 exactly match `MODEL_SOURCES` in
  `tools/verify_directml_whisper_bundle.py`; each model card declares MIT.
- [ ] The ONNX bundle was produced by ONNX Runtime GenAI DirectML 0.13.1 at
  builder revision `db2baa9fd17fd2865c56c7a7ba8d6ebc73a2cf7c`, with `fp16`
  precision and the `dml` execution provider. The command template exactly
  matches `BUILDER_COMMAND` in `tools/verify_directml_whisper_bundle.py`.

## Distributed evidence

- [ ] The staged wheel contents include their original `LICENSE` and
  `ThirdPartyNotices.txt` files, and the approval manifests cover those files.
- [ ] The three approval manifests contain exactly every staged file in their
  respective component, with SHA-256 for each file and no extra entries.
- [ ] `audit/onnxruntime-genai-directml-runtime.json` is limited to the reviewed
  GenAI DirectML 0.13.1 wheel.
- [ ] `audit/onnxruntime-directml-runtime.json` is limited to the reviewed ONNX
  Runtime DirectML 1.24.4 wheel.
- [ ] `audit/directml-whisper-model.json` contains exactly the six approved
  directories under `models/whisper-directml/`, with no extra model.

## Commercial exclusions

- [ ] The commercial staging contains no CTranslate2, faster-whisper, cuDNN,
  Intel OpenMP, CUDA/cuBLAS, PyAV, Transformers or PyTorch runtime files.
- [ ] The commercial staging contains no legacy `models/whisper/` assets.
- [ ] The application does not download or replace the model at runtime.
- [ ] A strict notice/SBOM audit succeeds against the final staging directory.

## Human approval

- Reviewer:
- Review date (ISO-8601):
- Approval scope / release identifier:
- Result: NOT APPROVED
- Notes:

Only after every item is verified may the reviewer set
`approved_for_commercial_redistribution` to `true` in all three generated
approval manifests and fill `reviewed_by`, `reviewed_at`, and `approval_scope`.
