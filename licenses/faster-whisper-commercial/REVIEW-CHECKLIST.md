# Faster-whisper commercial approval checklist

The generated packet is a draft until both JSON manifests contain
`approved_for_commercial_redistribution: true` and complete reviewer fields.

- [ ] `ctranslate2==4.7.1` and `faster-whisper==1.2.1` match the release lock.
- [ ] The official CPython 3.12 Windows CTranslate2 wheel name and SHA-256 match the packet.
- [ ] The official `faster_whisper-1.2.1-py3-none-any.whl` SHA-256 is `79a66ad50688c0b794dd501dc340a736992a6342f7f95e5811be60b5224a26a7`.
- [ ] The staged CTranslate2 Python package and dist-info files are all present in `ctranslate2-python-runtime.json` with exact SHA-256 values.
- [ ] The staged faster-whisper Python package and dist-info files are all present in `faster-whisper-runtime.json` with exact SHA-256 values.
- [ ] `silero_vad_v6.onnx` is separately covered by `silero-vad-model.json`, uses the Silero Team MIT notice, and has SHA-256 `4cbf549b8326f60f80f2536d9eefeb450a9abe83365a098031c89719f1be17d2`.
- [ ] CTranslate2 MIT and faster-whisper MIT notices are included in the final notices bundle.
- [ ] `cudnn64_9.dll` has SHA-256 `9edbcdff73b0af070eb160b2ce66e59feca04aa017351d8eedcc5e8e149967d2`, version 9.10.2.21, and a valid NVIDIA Authenticode signature.
- [ ] The app installs cuDNN only in its private application directory.
- [ ] The AILS customer agreement has been reviewed against the NVIDIA cuDNN distribution requirements.
- [ ] `libiomp5md.dll` has SHA-256 `982233366b0afcda1e0f55a0b134097e35b779613f54ddb69e685e6cd06b755f`, version 20250910, and a valid Intel Authenticode signature.
- [ ] Intel OpenMP redistribution has been reviewed under the applicable Intel Simplified Software License.
- [ ] The release scope states that `cublas64_12.dll`, `cublasLt64_12.dll`, and `nvcuda.dll` are not bundled and the approved package is not a self-contained NVIDIA GPU runtime.
- [ ] If cuBLAS is later bundled, a separate pinned CUDA redistributable archive, license, hash, and application-EULA review is completed.
- [ ] The Hugging Face model repository, MIT tag, origin, and full Git revision have been reviewed.
- [ ] Every runtime and model file hash matches the files that will be packaged.
- [ ] All seven staged approval manifests remain fail-closed until a human reviewer changes the packet approval fields; no tool or build script auto-approves them.
- [ ] No PyAV, x264, x265, executable, script, or pickle file is present in the approved model bundle.
- [ ] `reviewed_by`, `reviewed_at`, and `approval_scope` identify the responsible release review.
- [ ] Legal counsel has reviewed any remaining jurisdiction-specific or marketplace terms.
