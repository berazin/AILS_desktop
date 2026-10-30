# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path
from importlib.util import find_spec
import os
import sys

from PyInstaller.utils.hooks import collect_all, collect_submodules, copy_metadata


ROOT = Path.cwd().resolve()
sys.path.insert(0, str(ROOT / "ails-backend"))
sys.path.insert(0, str(ROOT / "tools"))
from edition_manifest import canonical_edition_id, load_edition_manifest

EDITION = canonical_edition_id()
EDITION_MANIFEST = load_edition_manifest(EDITION)
ENTRY_NAME = "api_server.py"
ENTRY_SCRIPT = ROOT / "ails-backend" / ENTRY_NAME
ICON_PATH = ROOT / "assets" / "AILS.ico"

datas = []
binaries = []
hiddenimports = []
EXCLUDED_PACKAGES = set(EDITION_MANIFEST["packaging"].get("exclude_python_packages", []))
# Build-process PYTHONPATH customizations must never alter the shipped runtime.
EXCLUDED_PACKAGES.add("sitecustomize")
EXCLUDED_PACKAGES.add("usercustomize")
MEDIA_FILES_ENABLED = bool(EDITION_MANIFEST["features"].get("summary.media_files", False))

media_foundation_bridge = ROOT / "ails-backend" / "native" / "ails_media_foundation.dll"
if MEDIA_FILES_ENABLED:
    if not media_foundation_bridge.is_file():
        raise ValueError(
            "Media Foundation bridge is missing. Run: python tools/build_media_foundation.py"
        )
    binaries.append((str(media_foundation_bridge), "native"))


def safe_collect(package_name):
    try:
        return collect_all(package_name)
    except Exception:
        try:
            return [], [], collect_submodules(package_name)
        except Exception:
            return [], [], []


def safe_copy_metadata(distribution_name):
    try:
        return copy_metadata(distribution_name)
    except Exception:
        return []


def required_copy_metadata(distribution_name):
    metadata = safe_copy_metadata(distribution_name)
    if not metadata:
        raise ValueError(f"Required distribution metadata is missing: {distribution_name}")
    return metadata


def add_package_files(package_name, relative_dir):
    spec = find_spec(package_name)
    if not spec or not spec.submodule_search_locations:
        return
    source_dir = Path(next(iter(spec.submodule_search_locations))) / relative_dir
    if not source_dir.exists():
        return
    for source_path in source_dir.rglob("*"):
        if source_path.is_file():
            target_dir = str(Path(package_name) / relative_dir / source_path.parent.relative_to(source_dir))
            datas.append((str(source_path), target_dir))


if ICON_PATH.exists():
    datas.append((str(ICON_PATH), "."))

edition_manifest_path = Path(EDITION_MANIFEST["_source_path"])
datas.append((str(edition_manifest_path), "editions"))
if EDITION == "developer":
    datas.append((str(ROOT / "ails-backend" / "chatgpt_subscription" / "deployment.json"), "chatgpt_subscription"))
else:
    EXCLUDED_PACKAGES.add("chatgpt_subscription")
term_dictionary = ROOT / "Dictionary" / "words.txt"
if term_dictionary.is_file():
    datas.append((str(term_dictionary), "Dictionary"))
    term_dictionary_license = term_dictionary.with_name("LICENSE-DATA.txt")
    if term_dictionary_license.is_file():
        datas.append((str(term_dictionary_license), "Dictionary"))
for model_manifest in (ROOT / "ails-backend" / "model_manifests").glob("*.json"):
    datas.append((str(model_manifest), "model_manifests"))

problem_number_model_dir = ROOT / "ails-backend" / "models" / "problem_number"
if EDITION_MANIFEST["packaging"].get("include_problem_number_models", True) and problem_number_model_dir.exists():
    for model_asset in problem_number_model_dir.glob("*"):
        if model_asset.is_file() and model_asset.suffix.lower() in {".onnx", ".json"}:
            datas.append((str(model_asset), "models/problem_number"))

packages_to_collect = [
    "agents",
    "openai",
    "pypdfium2",
    "paddleocr",
    "paddlex",
    "sherpa_onnx",
    "yt_dlp",
    "playwright",
    "tokenizers",
    "kiwipiepy",
    "kiwipiepy_model",
]
packages_to_collect = [
    package_name for package_name in packages_to_collect
    if package_name.split(".", 1)[0] not in EXCLUDED_PACKAGES
]

for package_name in packages_to_collect:
    pkg_datas, pkg_binaries, pkg_hiddenimports = safe_collect(package_name)
    if package_name == "paddlex":
        pkg_datas = [
            item for item in pkg_datas
            if "paddlex/inference/models/common/transformers" not in item[1].replace("\\", "/")
        ]
        pkg_hiddenimports = [
            name for name in pkg_hiddenimports
            if not name.startswith("paddlex.inference.models.common.transformers")
        ]
    datas += pkg_datas
    binaries += pkg_binaries
    hiddenimports += pkg_hiddenimports

datas = [
    item for item in datas
    if not item[1].replace("\\", "/").lower().split("/", 1)[0].startswith("pip-")
]

if "paddlex" not in EXCLUDED_PACKAGES:
    for distribution_name in (
        "imagesize",
        "opencv-contrib-python",
        "pyclipper",
        "python-bidi",
        "shapely",
    ):
        datas += required_copy_metadata(distribution_name)
if "sherpa_onnx" not in EXCLUDED_PACKAGES:
    datas += required_copy_metadata("sherpa-onnx")
    datas += required_copy_metadata("sherpa-onnx-core")
hiddenimports += [
    # Public compatibility adapters resolve these modules through __getattr__.
    # PyInstaller cannot infer their import_module targets from those adapters.
    "chat.evidence_service",
    "documents.grading_context",
    # tiktoken discovers its encoding constructors through pkgutil at runtime.
    "tiktoken_ext",
    "tiktoken_ext.openai_public",
    "browser_cookie3",
    "pypdf",
    "pypdfium2",
    "PIL.Image",
    "keyring.backends.Windows",
    "jupyter_client",
    "jupyter_client.blocking",
    "jupyter_client.manager",
    "jupyter_client.kernelspec",
    "ipykernel",
    "ipykernel_launcher",
    "matplotlib",
    "matplotlib.pyplot",
    "playwright.sync_api",
    "tkinter",
    "tkinter.filedialog",
    "safetensors",
    "huggingface_hub",
    "paddleocr",
    "paddlex",
    "reportlab",
    "sherpa_onnx",
]
hiddenimports = [
    package_name for package_name in hiddenimports
    if package_name.split(".", 1)[0] not in EXCLUDED_PACKAGES
]

excludes = [
    "av",
    "aistudio_sdk",
    "ctranslate2",
    "faster_whisper",
    "noav_faster_whisper",
    "torch",
    "onnxruntime",
    "openvino",
    "optimum",
    "transformers",
    "paddlex.inference.models.common.transformers",
    "onnx",
    "scipy",
    "sklearn",
    "altair",
    "pydeck",
    "pyarrow",
    "Cython",
    "PyInstaller",
    "gevent",
    "debugpy",
    "debugpy._vendored",
    "matplotlib.tests",
    "matplotlib.sphinxext",
    "pytest",
    "sphinx",
    "PySide6",
    "shiboken6",
    "qtpy",
]
excludes.extend(sorted(EXCLUDED_PACKAGES))
excludes.extend(("directml_whisper", "onnxruntime_genai"))
if not EDITION_MANIFEST["features"].get("developer_tools", False):
    excludes.extend(("developer_tools", "language_registry"))
    excludes.extend(("phoenix_observability", "phoenix", "opentelemetry", "openinference"))
    excludes.append("pip")
if not any(
    EDITION_MANIFEST["features"].get(feature, False)
    for feature in ("summary.audio_pdf", "summary.media_files", "summary.web_inputs")
):
    excludes.append("summary_generation")

if EDITION_MANIFEST["packaging"].get("ffmpeg_policy") == "excluded":
    binaries = [
        entry for entry in binaries
        if not Path(str(entry[0])).name.lower().startswith("opencv_videoio_ffmpeg")
        and not Path(str(entry[1])).name.lower().startswith("opencv_videoio_ffmpeg")
    ]
    datas = [
        entry for entry in datas
        if not Path(str(entry[0])).name.lower().startswith("opencv_videoio_ffmpeg")
        and not Path(str(entry[1])).name.lower().startswith("opencv_videoio_ffmpeg")
    ]

a = Analysis(
    [str(ENTRY_SCRIPT)],
    pathex=[str(ROOT / "ails-backend"), str(ROOT)],
    binaries=binaries,
    datas=datas,
    hiddenimports=sorted(set(hiddenimports)),
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    noarchive=False,
)
# The transformers hook copies metadata for optional dependencies even when the
# dependency itself is excluded. Keep the excluded torch distribution out too.
a.datas = [entry for entry in a.datas if not str(entry[0]).lower().startswith("torch-")]
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="AILSBackend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    icon=str(ICON_PATH) if ICON_PATH.exists() else None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="AILSBackend",
)
