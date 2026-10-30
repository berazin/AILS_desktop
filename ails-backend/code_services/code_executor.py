from ide_policy import require_ide
import codecs
import glob
import ntpath
import os
import re
import signal
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import time
import uuid

from .language_profiles import resolve_language_profile, resolve_profile_commands
from .console_encoding import configure_console_runtime, java_encoding_options, normalize_console_encoding, resolve_console_encoding
import python_runtime
from system_storage import resolve_system_path, storage_write_base


CODE_PROJECT_MARKER = ".ails-code-project"
PROBLEM_STATE_FILE = ".ails-problem.json"
HIDDEN_PROBLEM_DIR = ".ails-problems"
IGNORED_CODE_DIRS = {".git", "__pycache__", "node_modules", HIDDEN_PROBLEM_DIR}
RESERVED_CODE_PROJECT_FILES = {CODE_PROJECT_MARKER, PROBLEM_STATE_FILE}
# Electron starts this backend with the per-run local API token in the
# environment. Code executed in the sandbox must not inherit it, or the
# executed code could call the local API as a trusted client.
BLOCKED_SANDBOX_ENV_KEYS = ("AILS_LOCAL_API_TOKEN",)
DEFAULT_CPP_MAIN = (
    '#include <iostream>\n\n'
    'int main() {\n'
    '    std::cout << "Hello C++!" << std::endl;\n'
    '    return 0;\n'
    '}\n'
)


def _safe_project_name(project_name: str) -> str:
    normalized = str(project_name or "").replace("\\", "/").strip().strip("/")
    parts = [part for part in normalized.split("/") if part not in ("", ".", "..")]
    if not parts:
        raise ValueError("project_name is empty")
    return os.path.join(*parts)


def _safe_file_name(file_name: str) -> str:
    normalized = str(file_name or "").replace("\\", "/").strip().lstrip("/")
    parts = [part for part in normalized.split("/") if part not in ("", ".", "..")]
    if not parts:
        raise ValueError("file name is empty")
    return os.path.join(*parts)


def _project_dir(base_dir: str, project_name: str, *, for_write: bool = False) -> str:
    if not base_dir:
        raise ValueError("base_dir is empty")
    base_path = storage_write_base(base_dir) if for_write else resolve_system_path(os.path.abspath(os.path.expanduser(str(base_dir))))
    target_dir = os.path.abspath(os.path.join(base_path, _safe_project_name(project_name)))
    if os.path.commonpath([base_path, target_dir]) != base_path:
        raise ValueError("invalid project path")
    return target_dir


def save_code_project(base_dir: str, project_name: str, files: list) -> dict:
    require_ide()
    try:
        target_dir = _project_dir(base_dir, project_name, for_write=True)
        os.makedirs(target_dir, exist_ok=True)
        marker_path = os.path.join(target_dir, CODE_PROJECT_MARKER)
        with open(marker_path, "w", encoding="utf-8") as handle:
            handle.write("")

        files_to_keep = {name.lower() for name in RESERVED_CODE_PROJECT_FILES}
        saved_paths = []
        for file_info in files or []:
            file_name = str(file_info.get("name", "")).strip()
            if not file_name:
                continue

            safe_name = _safe_file_name(file_name)
            if safe_name.replace("\\", "/").lower() in {name.lower() for name in RESERVED_CODE_PROJECT_FILES}:
                continue
            files_to_keep.add(safe_name.replace("\\", "/").lower())
            
            file_path = os.path.join(target_dir, safe_name)
            os.makedirs(os.path.dirname(file_path), exist_ok=True)

            with open(file_path, "w", encoding="utf-8") as handle:
                handle.write(str(file_info.get("code", "")))

            saved_paths.append(safe_name.replace("\\", "/"))

        # The selected project is one folder in the browser. Never prune files
        # inside its child folders while saving the current folder.
        for entry in os.scandir(target_dir):
            if not entry.is_file(follow_symlinks=False):
                continue
            if entry.name.lower() not in files_to_keep:
                try:
                    os.chmod(entry.path, stat.S_IWRITE)
                    os.remove(entry.path)
                except Exception:
                    pass

        return {"success": True, "saved_dir": target_dir, "files": saved_paths}
    except Exception as error:
        return {"success": False, "error": str(error)}


def get_code_projects(base_dir: str) -> dict:
    try:
        if not base_dir:
            return {"success": True, "projects": [], "managed_projects": []}
        base_path = resolve_system_path(os.path.abspath(os.path.expanduser(str(base_dir))))
        if not os.path.isdir(base_path):
            return {"success": True, "projects": [], "managed_projects": []}

        projects_set = set()
        managed_projects_set = set()
        ignored_dirs = {name.lower() for name in IGNORED_CODE_DIRS}
        for root, dirs, file_names in os.walk(base_path):
            relative_root = os.path.relpath(root, base_path).replace("\\", "/")
            normalized_file_names = {name.lower() for name in file_names}
            normalized_dir_names = {name.lower() for name in dirs}
            contains_problem_state = (
                PROBLEM_STATE_FILE.lower() in normalized_file_names
                or HIDDEN_PROBLEM_DIR.lower() in normalized_dir_names
            )
            if contains_problem_state and relative_root not in {"", "."}:
                path_parts = [part for part in relative_root.split("/") if part]
                for depth in range(1, len(path_parts) + 1):
                    managed_projects_set.add("/".join(path_parts[:depth]))

            dirs[:] = [name for name in dirs if name.lower() not in ignored_dirs]
            for name in dirs:
                folder_path = os.path.join(root, name)
                rel_path = os.path.relpath(folder_path, base_path).replace("\\", "/")
                projects_set.add(rel_path)
        projects = sorted(projects_set, key=str.lower)
        managed_projects = sorted(managed_projects_set, key=str.lower)
        return {"success": True, "projects": projects, "managed_projects": managed_projects}
    except Exception as error:
        return {"success": False, "projects": [], "managed_projects": [], "error": str(error)}


def get_code_project_files(base_dir: str, project_name: str) -> dict:
    try:
        target_dir = _project_dir(base_dir, project_name)
        if not os.path.isdir(target_dir):
            return {"success": False, "files": [], "error": "project not found"}

        files = []
        for entry in os.scandir(target_dir):
            if not entry.is_file(follow_symlinks=False) or entry.name in RESERVED_CODE_PROJECT_FILES:
                continue
            try:
                with open(entry.path, "r", encoding="utf-8", errors="replace") as handle:
                    code = handle.read()
            except Exception:
                continue
            files.append({"name": entry.name, "code": code})

        files.sort(key=lambda item: item["name"].lower())
        return {"success": True, "files": files}
    except Exception as error:
        return {"success": False, "files": [], "error": str(error)}


def create_code_project(base_dir: str, project_name: str) -> dict:
    require_ide()
    try:
        if not base_dir:
            return {"success": False, "error": "base_dir is empty"}
        base_path = resolve_system_path(os.path.abspath(os.path.expanduser(str(base_dir))))
        os.makedirs(base_path, exist_ok=True)
        target_dir = _project_dir(base_dir, project_name)
        parent_dir = os.path.dirname(target_dir)
        if not os.path.isdir(parent_dir):
            return {"success": False, "error": "parent project folder not found"}
        if os.path.exists(target_dir):
            return {"success": False, "error": "project folder already exists"}

        os.mkdir(target_dir)
        created_paths = []
        try:
            marker_path = os.path.join(target_dir, CODE_PROJECT_MARKER)
            created_paths.append(marker_path)
            with open(marker_path, "w", encoding="utf-8") as handle:
                handle.write("")

            created_files = []
            project_folder_name = os.path.basename(target_dir)
            if project_folder_name.isdigit():
                main_path = os.path.join(target_dir, "main.cpp")
                created_paths.append(main_path)
                with open(main_path, "w", encoding="utf-8") as handle:
                    handle.write(DEFAULT_CPP_MAIN)
                created_files.append("main.cpp")
        except Exception:
            for created_path in reversed(created_paths):
                try:
                    if os.path.isfile(created_path):
                        os.remove(created_path)
                except Exception:
                    pass
            try:
                os.rmdir(target_dir)
            except Exception:
                pass
            raise

        return {
            "success": True,
            "project_name": project_name,
            "project_dir": target_dir,
            "created_files": created_files,
        }
    except Exception as error:
        return {"success": False, "error": str(error)}


def delete_code_project(base_dir: str, project_name: str) -> dict:
    require_ide()
    import stat
    import time
    import random
    try:
        target_dir = _project_dir(base_dir, project_name)
        if not os.path.isdir(target_dir):
            return {"success": False, "error": "project not found"}
        
        def onerror(func, path, excinfo):
            try:
                os.chmod(path, stat.S_IWRITE)
                func(path)
            except Exception:
                pass

        # Pre-emptively make everything writable
        for root, dirs, file_names in os.walk(target_dir):
            for file_name in file_names:
                try:
                    os.chmod(os.path.join(root, file_name), stat.S_IWRITE)
                except Exception:
                    pass
            for d in dirs:
                try:
                    os.chmod(os.path.join(root, d), stat.S_IWRITE)
                except Exception:
                    pass
        try:
            os.chmod(target_dir, stat.S_IWRITE)
        except Exception:
            pass

        # Try up to 5 times with backoff
        last_error = None
        for attempt in range(5):
            # 1. Try shutil.rmtree
            try:
                shutil.rmtree(target_dir, onerror=onerror)
                if not os.path.exists(target_dir):
                    return {"success": True}
            except Exception as e:
                last_error = e

            # 2. Try rename and delete
            parent_dir = os.path.dirname(target_dir)
            temp_dir_name = f".deleting_{os.path.basename(target_dir)}_{int(time.time())}_{random.randint(1000, 9999)}"
            temp_dir_path = os.path.join(parent_dir, temp_dir_name)
            try:
                os.rename(target_dir, temp_dir_path)
                shutil.rmtree(temp_dir_path, onerror=onerror)
                return {"success": True}
            except Exception as e:
                last_error = e
                if os.path.exists(temp_dir_path):
                    return {"success": True}
            
            # Wait with exponential backoff: 0.1s, 0.2s, 0.4s, 0.8s
            time.sleep(0.1 * (2 ** attempt))

        err_msg = str(last_error or "알 수 없는 오류")
        if "WinError 5" in err_msg or "액세스가 거부되었습니다" in err_msg:
            friendly_msg = f"[WinError 5] 액세스가 거부되었습니다.\n\n안내: 파일이 구글 드라이브 동기화 등으로 인해 잠겨있거나 다른 프로그램(에디터, 탐색기 등)에서 사용 중일 수 있습니다.\n잠시 후 다시 시도하시거나, 해당 폴더를 사용 중인 프로그램을 종료한 후 시도해 주세요.\n\n대상 경로: {target_dir}"
            return {"success": False, "error": friendly_msg}
        return {"success": False, "error": f"{err_msg}\n\n대상 경로: {target_dir}"}
    except Exception as error:
        return {"success": False, "error": str(error)}


def delete_code_file(base_dir: str, project_name: str, file_name: str) -> dict:
    require_ide()
    try:
        target_dir = _project_dir(base_dir, project_name)
        safe_name = _safe_file_name(file_name)
        if safe_name.replace("\\", "/").lower() in {name.lower() for name in RESERVED_CODE_PROJECT_FILES}:
            return {"success": False, "error": "reserved project metadata cannot be deleted"}
        file_path = os.path.join(target_dir, safe_name)
        if os.path.isfile(file_path):
            last_error = None
            for attempt in range(5):
                try:
                    try:
                        os.chmod(file_path, stat.S_IWRITE)
                    except Exception:
                        pass
                    os.remove(file_path)
                    return {"success": True}
                except Exception as e:
                    last_error = e
                    time.sleep(0.1 * (2 ** attempt))
            
            err_msg = str(last_error or "알 수 없는 오류")
            if "WinError 5" in err_msg or "액세스가 거부되었습니다" in err_msg:
                friendly_msg = f"[WinError 5] 액세스가 거부되었습니다.\n\n안내: 파일이 구글 드라이브 동기화 등으로 인해 잠겨있거나 다른 프로그램에서 사용 중일 수 있습니다.\n잠시 후 다시 시도하시거나, 해당 파일을 사용 중인 프로그램을 종료한 후 시도해 주세요.\n\n대상 경로: {file_path}"
                return {"success": False, "error": friendly_msg}
            return {"success": False, "error": f"{err_msg}\n\n대상 경로: {file_path}"}
        return {"success": False, "error": "file not found"}
    except Exception as error:
        return {"success": False, "error": str(error)}


def rename_code_project(base_dir: str, old_project_name: str, new_project_name: str) -> dict:
    require_ide()
    try:
        old_dir = _project_dir(base_dir, old_project_name)
        new_dir = _project_dir(base_dir, new_project_name)
        if not os.path.isdir(old_dir):
            return {"success": False, "error": "old project not found"}
        same_windows_path = os.path.normcase(old_dir) == os.path.normcase(new_dir)
        if os.path.exists(new_dir) and not same_windows_path:
            return {"success": False, "error": "target project directory already exists"}
        if old_dir == new_dir:
            return {"success": True}
        
        last_error = None
        for attempt in range(5):
            try:
                if same_windows_path:
                    temp_dir = os.path.join(
                        os.path.dirname(old_dir),
                        f".renaming_{os.path.basename(old_dir)}_{uuid.uuid4().hex}",
                    )
                    os.rename(old_dir, temp_dir)
                    try:
                        os.rename(temp_dir, new_dir)
                    except Exception:
                        if os.path.exists(temp_dir) and not os.path.exists(old_dir):
                            os.rename(temp_dir, old_dir)
                        raise
                else:
                    os.rename(old_dir, new_dir)
                return {"success": True}
            except Exception as e:
                last_error = e
                time.sleep(0.1 * (2 ** attempt))

        err_msg = str(last_error or "알 수 없는 오류")
        if "WinError 5" in err_msg or "액세스가 거부되었습니다" in err_msg:
            friendly_msg = f"[WinError 5] 액세스가 거부되었습니다.\n\n안내: 프로젝트 폴더가 구글 드라이브 동기화 등으로 인해 잠겨있거나 다른 프로그램에서 사용 중일 수 있습니다.\n잠시 후 다시 시도하시거나, 관련 프로그램을 종료한 후 시도해 주세요.\n\n대상 경로: {old_dir}"
            return {"success": False, "error": friendly_msg}
        return {"success": False, "error": f"{err_msg}\n\n대상 경로: {old_dir}"}
    except Exception as error:
        return {"success": False, "error": str(error)}


def _run_compile(command: list[str], work_dir: str, timeout_seconds: float, env: dict | None = None) -> subprocess.CompletedProcess:
    extra = {}
    compile_env = dict(os.environ if env is None else env)
    for key in BLOCKED_SANDBOX_ENV_KEYS:
        compile_env.pop(key, None)
    if os.name == "nt":
        extra["creationflags"] = 0x08000000  # CREATE_NO_WINDOW
    return subprocess.run(
        command,
        cwd=work_dir,
        env=compile_env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout_seconds,
        **extra
    )


def _clean_compiler_output(output: str, work_dir: str) -> str:
    """Hide the disposable sandbox path while preserving file/line diagnostics."""
    cleaned = str(output or "")
    if not cleaned or not work_dir:
        return cleaned

    # Diagnostic paths may come from a Windows execution host on another OS.
    path_module = ntpath if ntpath.splitdrive(work_dir)[0] else os.path
    normalized_dir = path_module.abspath(work_dir).rstrip("\\/")
    prefixes = {
        normalized_dir + os.sep,
        normalized_dir.replace("\\", "/") + "/",
        normalized_dir.replace("/", "\\") + "\\",
    }
    for prefix in sorted(prefixes, key=len, reverse=True):
        cleaned = cleaned.replace(prefix, "")
    return cleaned


def _find_executable(candidates: list[str]) -> str:
    for candidate in candidates:
        expanded = os.path.expandvars(os.path.expanduser(candidate))
        if os.path.isfile(expanded):
            return os.path.abspath(expanded)
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
    if os.name == "nt":
        program_files = os.environ.get("ProgramFiles", r"C:\Program Files")
        local_appdata = os.environ.get("LOCALAPPDATA", "")
        user_profile = os.environ.get("USERPROFILE", "")
        common_patterns = {
            "clang": [os.path.join(program_files, "LLVM", "bin", "clang.exe")],
            "clang++": [os.path.join(program_files, "LLVM", "bin", "clang++.exe")],
            "dotnet": [os.path.join(program_files, "dotnet", "dotnet.exe")],
            "rustc": [os.path.join(user_profile, ".cargo", "bin", "rustc.exe")],
            "javac": [os.path.join(program_files, "Eclipse Adoptium", "jdk-*", "bin", "javac.exe")],
            "java": [os.path.join(program_files, "Eclipse Adoptium", "jdk-*", "bin", "java.exe")],
            "node": [os.path.join(program_files, "nodejs", "node.exe")],
            "go": [os.path.join(program_files, "Go", "bin", "go.exe")],
            "lua": [
                os.path.join(program_files, "Lua", "lua.exe"),
                os.path.join(local_appdata, "Programs", "Lua", "lua.exe"),
            ],
        }
        for candidate in candidates:
            key = os.path.splitext(os.path.basename(candidate))[0].lower()
            for pattern in common_patterns.get(key, []):
                for match in sorted(glob.glob(pattern), reverse=True):
                    if os.path.isfile(match):
                        return os.path.abspath(match)
        search_roots = [
            os.environ.get("ProgramFiles", r"C:\Program Files"),
            os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"),
        ]
        for root in search_roots:
            jetbrains_root = os.path.join(root, "JetBrains")
            if not os.path.isdir(jetbrains_root):
                continue
            for candidate in candidates:
                names = [candidate]
                if not candidate.lower().endswith(".exe"):
                    names.append(f"{candidate}.exe")
                for name in names:
                    for exe_path in _iter_jetbrains_compiler_paths(jetbrains_root, name):
                        return exe_path
    return ""


def _iter_jetbrains_compiler_paths(jetbrains_root: str, executable_name: str):
    try:
        products = sorted(os.listdir(jetbrains_root), reverse=True)
    except Exception:
        return
    for product in products:
        product_dir = os.path.join(jetbrains_root, product)
        if not os.path.isdir(product_dir):
            continue
        direct_candidates = [
            os.path.join(product_dir, "bin", "mingw", "bin", executable_name),
            os.path.join(product_dir, "bin", "MinGW", "bin", executable_name),
        ]
        for exe_path in direct_candidates:
            if os.path.isfile(exe_path):
                yield exe_path


def _resolve_node_runtime() -> tuple[str, bool]:
    node = _find_executable(["node", "node.exe"])
    if node:
        return node, False
    electron_value = os.environ.get("AILS_ELECTRON_NODE_EXE", "").strip()
    electron = os.path.abspath(os.path.expandvars(electron_value)) if electron_value else ""
    if electron and os.path.isfile(electron):
        return electron, True
    return "", False


def _missing_compiler_message(language: str, candidates: list[str]) -> str:
    names = ", ".join(candidates)
    return (
        f"{language} compiler not found. Install one of these compilers or add it to PATH: {names}.\n"
        "On Windows, MinGW-w64 GCC or LLVM Clang is recommended."
    )


def _compile_c_family(active_path: str, work_dir: str, language: str, timeout_seconds: float) -> tuple[list[str] | None, str, str, str]:
    exe_path = os.path.join(work_dir, "main.exe" if os.name == "nt" else "main")
    if language == "cpp":
        compiler = _find_executable(["g++", "clang++", "cl"])
        if not compiler:
            return None, "", _missing_compiler_message("C++", ["g++", "clang++", "cl"]), ""
        if os.path.basename(compiler).lower() == "cl.exe":
            command = [compiler, "/nologo", "/EHsc", active_path, f"/Fe:{exe_path}"]
        else:
            command = [compiler, active_path, "-std=c++17", "-O2", "-o", exe_path]
    else:
        compiler = _find_executable(["gcc", "clang", "cl"])
        if not compiler:
            return None, "", _missing_compiler_message("C", ["gcc", "clang", "cl"]), ""
        if os.path.basename(compiler).lower() == "cl.exe":
            command = [compiler, "/nologo", active_path, f"/Fe:{exe_path}"]
        else:
            command = [compiler, active_path, "-std=c11", "-O2", "-o", exe_path]

    try:
        compile_env = os.environ.copy()
        compiler_dir = os.path.dirname(compiler)
        if compiler_dir:
            compile_env["PATH"] = compiler_dir + os.pathsep + compile_env.get("PATH", "")
        compile_result = _run_compile(command, work_dir, timeout_seconds, compile_env)
    except FileNotFoundError:
        return None, "", _missing_compiler_message("C++" if language == "cpp" else "C", command[:1]), ""
    compile_stdout = _clean_compiler_output(compile_result.stdout, work_dir)
    compile_stderr = _clean_compiler_output(compile_result.stderr, work_dir)
    if compile_result.returncode != 0:
        stderr = compile_stderr
        if not stderr:
            stderr = f"Compile failed with code {compile_result.returncode}"
        return None, compile_stdout, stderr, ""
    return [exe_path], compile_stdout, compile_stderr, os.path.dirname(compiler)


def _compile_csharp(work_dir: str, timeout_seconds: float) -> tuple[list[str] | None, str, str, str]:
    dotnet = _find_executable(["dotnet", "dotnet.exe"])
    if not dotnet:
        return None, "", "C# compiler not found. Install the .NET SDK in Code Settings > Toolchains.", ""
    try:
        version_result = _run_compile([dotnet, "--version"], work_dir, min(timeout_seconds, 10))
        major_match = re.match(r"\s*(\d+)", version_result.stdout or "")
        target_major = max(6, int(major_match.group(1))) if major_match else 8
    except Exception:
        target_major = 8
    project_path = os.path.join(work_dir, "AILSSandbox.csproj")
    with open(project_path, "w", encoding="utf-8", newline="") as handle:
        handle.write(
            "<Project Sdk=\"Microsoft.NET.Sdk\">\n"
            "  <PropertyGroup>\n"
            "    <OutputType>Exe</OutputType>\n"
            f"    <TargetFramework>net{target_major}.0</TargetFramework>\n"
            "    <ImplicitUsings>enable</ImplicitUsings>\n"
            "    <Nullable>enable</Nullable>\n"
            "  </PropertyGroup>\n"
            "</Project>\n"
        )
    return [dotnet, "run", "--project", project_path, "--configuration", "Release", "--nologo"], "", "", os.path.dirname(dotnet)


def _compile_rust(active_path: str, work_dir: str, timeout_seconds: float) -> tuple[list[str] | None, str, str, str]:
    rustc = _find_executable(["rustc", "rustc.exe"])
    if not rustc:
        return None, "", "Rust compiler not found. Install Rustup in Code Settings > Toolchains.", ""
    exe_path = os.path.join(work_dir, "main.exe" if os.name == "nt" else "main")
    result = _run_compile([rustc, active_path, "-O", "-o", exe_path], work_dir, timeout_seconds)
    if result.returncode != 0:
        return None, result.stdout, result.stderr or f"Compile failed with code {result.returncode}", ""
    return [exe_path], result.stdout, result.stderr, os.path.dirname(rustc)


def _compile_java(active_path: str, work_dir: str, code: str, timeout_seconds: float) -> tuple[list[str] | None, str, str, str]:
    javac = _find_executable(["javac", "javac.exe"])
    java = _find_executable(["java", "java.exe"])
    if not javac or not java:
        return None, "", "Java compiler not found. Install Temurin JDK in Code Settings > Toolchains.", ""
    java_files = []
    for root, _dirs, names in os.walk(work_dir):
        java_files.extend(os.path.join(root, name) for name in names if name.lower().endswith(".java"))
    result = _run_compile([javac, *java_encoding_options(compiler=True), "-encoding", "UTF-8", *java_files], work_dir, timeout_seconds)
    if result.returncode != 0:
        return None, result.stdout, result.stderr or f"Compile failed with code {result.returncode}", ""
    class_match = re.search(r"\bpublic\s+(?:final\s+)?class\s+([A-Za-z_$][\w$]*)", code)
    class_name = class_match.group(1) if class_match else os.path.splitext(os.path.basename(active_path))[0]
    class_dir = os.path.dirname(active_path)
    return [java, "-cp", class_dir, class_name], result.stdout, result.stderr, os.path.dirname(java)


def _custom_profile_commands(
    profile: dict,
    active_path: str,
    work_dir: str,
    action: str = "run",
) -> tuple[list[list[str]] | None, str]:
    return resolve_profile_commands(
        profile,
        action,
        active_path=active_path,
        work_dir=work_dir,
    )


def _timeout_seconds(value: int | float) -> float:
    try:
        return max(1.0, min(float(value or 15), 60.0))
    except (TypeError, ValueError):
        return 15.0


def _write_code_workspace(work_dir: str, code: str, active_name: str, files: list | None) -> str:
    wrote_active = False
    for file_info in files or []:
        try:
            safe_name = _safe_file_name(file_info.get("name", ""))
        except Exception:
            continue
        file_code = str(file_info.get("code", ""))
        if safe_name == active_name:
            file_code = str(code or file_code)
            wrote_active = True

        file_path = os.path.join(work_dir, safe_name)
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        with open(file_path, "w", encoding="utf-8", newline="") as handle:
            handle.write(file_code)

    if not wrote_active:
        file_path = os.path.join(work_dir, active_name)
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        with open(file_path, "w", encoding="utf-8", newline="") as handle:
            handle.write(str(code or ""))
    return os.path.join(work_dir, active_name)


def _prepare_code_sandbox(
    work_dir: str,
    code: str,
    language: str,
    file_name: str,
    files: list | None,
    timeout: int | float,
    action: str,
    source_path: str | None = None,
    console_encoding: str = "auto",
) -> dict:
    require_ide()
    normalize_console_encoding(console_encoding)
    language = str(language or "").lower()
    active_name = _safe_file_name(file_name or "main.py")
    timeout_seconds = _timeout_seconds(timeout)
    active_path = source_path or _write_code_workspace(work_dir, code, active_name, files)
    run_path_prefix = ""
    compile_stdout = ""
    compile_stderr = ""
    profile_prepare_commands: list[list[str]] = []
    node_is_electron = False
    custom_profile = resolve_language_profile(language, active_name)
    normalized_action = str(action or "run").strip().lower()

    if custom_profile and normalized_action != "run":
        profile_commands, profile_error = _custom_profile_commands(
            custom_profile, active_path, work_dir, normalized_action
        )
        if not profile_commands:
            return {"success": False, "stdout": "", "stderr": profile_error}
        profile_prepare_commands = profile_commands[:-1]
        command = profile_commands[-1]
    elif normalized_action != "run":
        return {
            "success": False,
            "stdout": "",
            "stderr": f"The {normalized_action} action is only available for language profiles.",
        }
    elif language == "python" or active_name.endswith(".py"):
        python_exe, _python_source = python_runtime.resolve_execution_python(active_path=active_path)
        command = [python_exe, "-u", active_path]
    elif language == "cpp" or active_name.endswith((".cpp", ".cc", ".cxx")):
        command, compile_stdout, compile_stderr, run_path_prefix = _compile_c_family(
            active_path, work_dir, "cpp", timeout_seconds
        )
        if command is None:
            return {"success": False, "stdout": compile_stdout, "stderr": compile_stderr}
    elif language == "c" or active_name.endswith(".c"):
        command, compile_stdout, compile_stderr, run_path_prefix = _compile_c_family(
            active_path, work_dir, "c", timeout_seconds
        )
        if command is None:
            return {"success": False, "stdout": compile_stdout, "stderr": compile_stderr}
    elif language == "csharp" or active_name.endswith(".cs"):
        command, compile_stdout, compile_stderr, run_path_prefix = _compile_csharp(work_dir, timeout_seconds)
        if command is None:
            return {"success": False, "stdout": compile_stdout, "stderr": compile_stderr}
    elif language == "rust" or active_name.endswith(".rs"):
        command, compile_stdout, compile_stderr, run_path_prefix = _compile_rust(
            active_path, work_dir, timeout_seconds
        )
        if command is None:
            return {"success": False, "stdout": compile_stdout, "stderr": compile_stderr}
    elif language == "java" or active_name.endswith(".java"):
        command, compile_stdout, compile_stderr, run_path_prefix = _compile_java(
            active_path, work_dir, str(code or ""), timeout_seconds
        )
        if command is None:
            return {"success": False, "stdout": compile_stdout, "stderr": compile_stderr}
    elif language == "lua" or active_name.endswith(".lua"):
        lua = _find_executable(["lua", "lua54", "lua.exe", "lua54.exe"])
        if not lua:
            return {
                "success": False,
                "stdout": "",
                "stderr": "Lua runtime not found. Install Lua in Code Settings > Toolchains.",
            }
        command = [lua, active_path]
    elif language == "go" or active_name.endswith(".go"):
        go = _find_executable(["go", "go.exe"])
        if not go:
            return {
                "success": False,
                "stdout": "",
                "stderr": "Go compiler not found. Install Go in Code Settings > Toolchains.",
            }
        command = [go, "run", active_path]
    elif language == "javascript" or active_name.endswith((".js", ".jsx")):
        node, node_is_electron = _resolve_node_runtime()
        if not node:
            return {
                "success": False,
                "stdout": "",
                "stderr": "Node.js not found. Install Node.js LTS in Code Settings > Toolchains.",
            }
        command = [node, active_path]
    elif language == "typescript" or active_name.endswith((".ts", ".tsx")):
        node, node_is_electron = _resolve_node_runtime()
        if not node:
            return {
                "success": False,
                "stdout": "",
                "stderr": "Node.js not found. Install Node.js LTS in Code Settings > Toolchains.",
            }
        if active_name.lower().endswith(".tsx"):
            return {
                "success": False,
                "stdout": "",
                "stderr": "TSX execution requires a project build profile. Plain .ts files can run with Node.js type stripping.",
            }
        command = [node, "--experimental-strip-types", active_path]
    elif custom_profile:
        profile_commands, profile_error = _custom_profile_commands(
            custom_profile, active_path, work_dir, normalized_action
        )
        if not profile_commands:
            return {"success": False, "stdout": "", "stderr": profile_error}
        profile_prepare_commands = profile_commands[:-1]
        command = profile_commands[-1]
    else:
        return {
            "success": False,
            "stdout": "",
            "stderr": f"Unsupported language: {language or active_name}",
        }

    run_env = os.environ.copy()
    for blocked_key in BLOCKED_SANDBOX_ENV_KEYS:
        run_env.pop(blocked_key, None)
    run_env["PYTHONUNBUFFERED"] = "1"
    if node_is_electron:
        run_env["ELECTRON_RUN_AS_NODE"] = "1"
    if run_path_prefix:
        run_env["PATH"] = run_path_prefix + os.pathsep + run_env.get("PATH", "")
    command, run_env, encoding = configure_console_runtime(command, run_env, console_encoding)
    for prepare_command in profile_prepare_commands:
        prepare_result = _run_compile(prepare_command, work_dir, timeout_seconds, run_env)
        compile_stdout += prepare_result.stdout or ""
        compile_stderr += prepare_result.stderr or ""
        if prepare_result.returncode != 0:
            return {
                "success": False,
                "stdout": compile_stdout,
                "stderr": compile_stderr or f"Prepare command failed with code {prepare_result.returncode}",
            }
    return {
        "success": True,
        "command": command,
        "env": run_env,
        "stdout": compile_stdout,
        "stderr": compile_stderr,
        "timeout": timeout_seconds,
        "console_encoding": encoding,
    }


def run_code_sandbox(
    code: str,
    language: str,
    file_name: str,
    files: list | None = None,
    stdin: str = "",
    timeout: int | float = 5,
    action: str = "run",
    console_encoding: str = "auto",
) -> dict:
    require_ide()
    try:
        with tempfile.TemporaryDirectory(prefix="ails_code_") as work_dir:
            prepared = _prepare_code_sandbox(
                work_dir, code, language, file_name, files, timeout, action, console_encoding=console_encoding
            )
            if not prepared.get("success"):
                return {
                    "success": False,
                    "stdout": prepared.get("stdout", ""),
                    "stderr": prepared.get("stderr", ""),
                }
            extra = {}
            if os.name == "nt":
                extra["creationflags"] = 0x08000000  # CREATE_NO_WINDOW
            result = subprocess.run(
                prepared["command"],
                cwd=work_dir,
                env=prepared["env"],
                input=str(stdin or ""),
                capture_output=True,
                text=True,
                encoding=prepared["console_encoding"],
                errors="replace",
                timeout=prepared["timeout"],
                **extra,
            )
            stderr = f"{prepared.get('stderr', '')}{result.stderr}"
            if result.returncode != 0 and not stderr:
                stderr = f"Process exited with code {result.returncode}"
            return {
                "success": result.returncode == 0,
                "stdout": f"{prepared.get('stdout', '')}{result.stdout}",
                "stderr": stderr,
            }
    except subprocess.TimeoutExpired:
        return {"success": False, "stdout": "", "stderr": "Execution timed out"}
    except Exception as error:
        return {"success": False, "stdout": "", "stderr": str(error), "error": str(error)}


class _BoundedTextBuffer:
    def __init__(self, max_chars: int):
        self.max_chars = max(1024, int(max_chars))
        self.data = ""
        self.start_offset = 0
        self.end_offset = 0

    def append(self, value: str) -> None:
        if not value:
            return
        self.data += value
        self.end_offset += len(value)
        overflow = len(self.data) - self.max_chars
        if overflow > 0:
            self.data = self.data[overflow:]
            self.start_offset += overflow

    def read(self, offset: int, limit: int) -> tuple[str, int, bool, bool]:
        try:
            requested = max(0, int(offset))
        except (TypeError, ValueError):
            requested = 0
        truncated = requested < self.start_offset
        current = max(self.start_offset, min(requested, self.end_offset))
        relative = current - self.start_offset
        chunk = self.data[relative : relative + max(1, int(limit))]
        next_offset = current + len(chunk)
        return chunk, next_offset, truncated, next_offset < self.end_offset


def _remove_work_dir(work_dir: str) -> None:
    for attempt in range(4):
        try:
            shutil.rmtree(work_dir)
            return
        except FileNotFoundError:
            return
        except Exception:
            if attempt < 3:
                time.sleep(0.05 * (2 ** attempt))


def _terminate_process_tree(process: subprocess.Popen, grace_seconds: float = 1.0) -> None:
    if process.poll() is not None:
        return
    if os.name == "nt":
        try:
            subprocess.run(
                ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=max(1.0, grace_seconds + 1.0),
                creationflags=0x08000000,
                check=False,
            )
        except Exception:
            try:
                process.terminate()
            except Exception:
                pass
    else:
        try:
            os.killpg(os.getpgid(process.pid), signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            pass
        except Exception:
            try:
                process.terminate()
            except Exception:
                pass
    try:
        process.wait(timeout=grace_seconds)
        return
    except subprocess.TimeoutExpired:
        pass
    try:
        if os.name == "nt":
            process.kill()
        else:
            os.killpg(os.getpgid(process.pid), signal.SIGKILL)
    except Exception:
        try:
            process.kill()
        except Exception:
            pass


class CodeExecutionSession:
    TERMINAL_STATUSES = {"exited", "stopped", "timed_out", "failed"}

    def __init__(
        self,
        session_id: str,
        process: subprocess.Popen,
        work_dir: str,
        timeout_seconds: float,
        max_output_chars: int,
        initial_stdout: str = "",
        initial_stderr: str = "",
        console_encoding: str = "auto",
    ):
        self.session_id = session_id
        self.process = process
        self.work_dir = work_dir
        self.console_encoding = resolve_console_encoding(console_encoding)
        self.timeout_seconds = timeout_seconds
        self.created_at = time.monotonic()
        self.ended_at: float | None = None
        self.returncode: int | None = None
        self._status = "running"
        self._requested_status: str | None = None
        self._condition = threading.Condition(threading.RLock())
        self._stdin_lock = threading.Lock()
        self._done = threading.Event()
        self._stdout = _BoundedTextBuffer(max_output_chars)
        self._stderr = _BoundedTextBuffer(max_output_chars)
        self._max_read_chars = max_output_chars
        self._stdout.append(initial_stdout)
        self._stderr.append(initial_stderr)
        self._reader_threads = [
            threading.Thread(
                target=self._read_pipe,
                args=(process.stdout, self._stdout),
                daemon=True,
                name=f"ails-code-stdout-{session_id[:8]}",
            ),
            threading.Thread(
                target=self._read_pipe,
                args=(process.stderr, self._stderr),
                daemon=True,
                name=f"ails-code-stderr-{session_id[:8]}",
            ),
        ]
        for thread in self._reader_threads:
            thread.start()
        threading.Thread(
            target=self._watch_process,
            daemon=True,
            name=f"ails-code-watch-{session_id[:8]}",
        ).start()
        threading.Thread(
            target=self._watch_timeout,
            daemon=True,
            name=f"ails-code-timeout-{session_id[:8]}",
        ).start()

    @property
    def status(self) -> str:
        with self._condition:
            return self._status

    @property
    def start_offsets(self) -> tuple[int, int]:
        with self._condition:
            return self._stdout.start_offset, self._stderr.start_offset

    def _read_pipe(self, pipe, buffer: _BoundedTextBuffer) -> None:
        if pipe is None:
            return
        decoder = codecs.getincrementaldecoder(self.console_encoding)(errors="replace")
        try:
            while True:
                raw = pipe.read(4096)
                if not raw:
                    break
                decoded = decoder.decode(raw)
                if decoded:
                    with self._condition:
                        buffer.append(decoded)
                        self._condition.notify_all()
            tail = decoder.decode(b"", final=True)
            if tail:
                with self._condition:
                    buffer.append(tail)
                    self._condition.notify_all()
        except (OSError, ValueError):
            pass
        finally:
            try:
                pipe.close()
            except Exception:
                pass

    def _watch_process(self) -> None:
        try:
            returncode = self.process.wait()
        except Exception:
            returncode = self.process.poll()
        for thread in self._reader_threads:
            thread.join(timeout=1.0)
        with self._condition:
            self.returncode = returncode
            if self._status == "running":
                self._status = self._requested_status or "exited"
            self.ended_at = time.monotonic()
            self._done.set()
            self._condition.notify_all()
        try:
            if self.process.stdin:
                self.process.stdin.close()
        except Exception:
            pass
        _remove_work_dir(self.work_dir)

    def _watch_timeout(self) -> None:
        if not self._done.wait(self.timeout_seconds):
            self.stop("timed_out")

    def read(self, stdout_offset=0, stderr_offset=0, wait_seconds=0, limit=None) -> dict:
        try:
            wait_seconds = max(0.0, min(float(wait_seconds or 0), 1.0))
        except (TypeError, ValueError):
            wait_seconds = 0.0
        try:
            stdout_requested = max(0, int(stdout_offset or 0))
        except (TypeError, ValueError):
            stdout_requested = 0
        try:
            stderr_requested = max(0, int(stderr_offset or 0))
        except (TypeError, ValueError):
            stderr_requested = 0
        try:
            read_limit = max(1, min(int(limit or self._max_read_chars), self._max_read_chars))
        except (TypeError, ValueError):
            read_limit = self._max_read_chars
        with self._condition:
            has_update = (
                self._stdout.end_offset > stdout_requested
                or self._stderr.end_offset > stderr_requested
                or self._status in self.TERMINAL_STATUSES
            )
            if wait_seconds and not has_update:
                self._condition.wait(wait_seconds)
            stdout, next_stdout, stdout_truncated, stdout_pending = self._stdout.read(
                stdout_requested, read_limit
            )
            stderr, next_stderr, stderr_truncated, stderr_pending = self._stderr.read(
                stderr_requested, read_limit
            )
            status = self._status
            returncode = self.returncode
        return {
            "success": True,
            "session_id": self.session_id,
            "status": status,
            "stdout": stdout,
            "stderr": stderr,
            "stdout_offset": next_stdout,
            "stderr_offset": next_stderr,
            "returncode": returncode,
            "done": status in self.TERMINAL_STATUSES,
            "process_success": status == "exited" and returncode == 0,
            "truncated": stdout_truncated or stderr_truncated,
            "stdout_truncated": stdout_truncated,
            "stderr_truncated": stderr_truncated,
            "more_output": stdout_pending or stderr_pending,
        }

    def write(self, value: str, eof: bool = False) -> dict:
        data = str(value or "").encode(self.console_encoding)
        with self._stdin_lock:
            if self.status != "running" or self.process.poll() is not None:
                return {
                    "success": False,
                    "session_id": self.session_id,
                    "status": self.status,
                    "error": "Execution session is not running",
                }
            try:
                if data:
                    self.process.stdin.write(data)
                    self.process.stdin.flush()
                if eof:
                    self.process.stdin.close()
            except (BrokenPipeError, OSError, ValueError) as error:
                return {
                    "success": False,
                    "session_id": self.session_id,
                    "status": self.status,
                    "error": str(error) or "Unable to write to process input",
                }
        return {
            "success": True,
            "session_id": self.session_id,
            "status": self.status,
            "accepted": len(data),
            "eof": bool(eof),
        }

    def stop(self, reason: str = "stopped") -> dict:
        reason = reason if reason in {"stopped", "timed_out"} else "stopped"
        with self._condition:
            if self._status in self.TERMINAL_STATUSES:
                return {
                    "success": True,
                    "session_id": self.session_id,
                    "status": self._status,
                    "already_done": True,
                }
            if self._requested_status:
                requested_status = self._requested_status
                already_requested = True
            else:
                self._requested_status = reason
                requested_status = reason
                already_requested = False
            if self.process.poll() is not None:
                already_requested = True
        if not already_requested:
            _terminate_process_tree(self.process)
        self._done.wait(2.0)
        return {
            "success": True,
            "session_id": self.session_id,
            "status": self.status if self._done.is_set() else requested_status,
            "already_done": already_requested,
        }

    def close(self) -> None:
        self.stop("stopped")
        try:
            self.process.wait(timeout=2.0)
        except Exception:
            pass
        _remove_work_dir(self.work_dir)


class CodeExecutionManager:
    def __init__(
        self,
        max_sessions: int = 4,
        max_output_chars: int = 1_000_000,
        retention_seconds: float = 120.0,
    ):
        self.max_sessions = max(1, int(max_sessions))
        self.max_output_chars = max(1024, int(max_output_chars))
        self.retention_seconds = max(1.0, float(retention_seconds))
        self._sessions: dict[str, CodeExecutionSession] = {}
        self._starting = 0
        self._lock = threading.RLock()
        self._closed = threading.Event()
        threading.Thread(
            target=self._reap_loop,
            daemon=True,
            name="ails-code-session-reaper",
        ).start()

    def _reap_loop(self) -> None:
        while not self._closed.wait(min(5.0, self.retention_seconds)):
            self._prune_finished()

    def _prune_finished(self) -> None:
        now = time.monotonic()
        with self._lock:
            expired = [
                session_id
                for session_id, session in self._sessions.items()
                if session.ended_at is not None and now - session.ended_at >= self.retention_seconds
            ]
            for session_id in expired:
                self._sessions.pop(session_id, None)

    def start(
        self,
        code: str,
        language: str,
        file_name: str,
        files: list | None = None,
        stdin: str = "",
        timeout: int | float = 5,
        action: str = "run",
        workspace_root: str | None = None,
        console_encoding: str = "auto",
    ) -> dict:
        require_ide()
        if self._closed.is_set():
            return {"success": False, "status": "failed", "error": "Execution manager is closed"}
        self._prune_finished()
        with self._lock:
            active_count = self._starting + sum(
                session.status == "running" for session in self._sessions.values()
            )
            if active_count >= self.max_sessions:
                return {
                    "success": False,
                    "status": "failed",
                    "error": f"Too many active execution sessions (limit: {self.max_sessions})",
                }
            self._starting += 1

        work_dir = tempfile.mkdtemp(prefix="ails_code_stream_")
        process = None
        try:
            if workspace_root:
                from .workspace_execution import prepare_workspace_execution
                prepared = prepare_workspace_execution(workspace_root, file_name, language, action, timeout, work_dir, console_encoding=console_encoding)
            else:
                prepared = _prepare_code_sandbox(work_dir, code, language, file_name, files, timeout, action, console_encoding=console_encoding)
            prepared_diagnostics = "\n".join(
                str(prepared.get(stream, "") or "").rstrip("\r\n")
                for stream in ("stdout", "stderr")
                if prepared.get(stream)
            )
            if not prepared.get("success"):
                _remove_work_dir(work_dir)
                return {
                    "success": False,
                    "status": "failed",
                    "stdout": prepared.get("stdout", ""),
                    "stderr": prepared.get("stderr", ""),
                    "diagnostics": prepared_diagnostics,
                    "error": prepared.get("stderr", "") or "Unable to prepare execution",
                }
            if self._closed.is_set():
                _remove_work_dir(work_dir)
                return {
                    "success": False,
                    "status": "failed",
                    "error": "Execution manager is closed",
                }
            popen_extra = {}
            if os.name == "nt":
                popen_extra["creationflags"] = 0x08000000 | 0x00000200
            else:
                popen_extra["start_new_session"] = True
            process = subprocess.Popen(
                prepared["command"],
                cwd=workspace_root or work_dir,
                env=prepared["env"],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                bufsize=0,
                **popen_extra,
            )
            session_id = uuid.uuid4().hex
            session = CodeExecutionSession(
                session_id=session_id,
                process=process,
                work_dir=work_dir,
                timeout_seconds=prepared["timeout"],
                max_output_chars=self.max_output_chars,
                initial_stdout="",
                initial_stderr="",
                console_encoding=prepared.get("console_encoding", "auto"),
            )
            with self._lock:
                manager_closed = self._closed.is_set()
                if not manager_closed:
                    self._sessions[session_id] = session
            if manager_closed:
                session.close()
                return {
                    "success": False,
                    "status": "failed",
                    "error": "Execution manager is closed",
                }
            if stdin:
                session.write(str(stdin))
            return {
                "success": True,
                "session_id": session_id,
                "status": session.status,
                "stdout_offset": 0,
                "stderr_offset": 0,
                "diagnostics": prepared_diagnostics,
            }
        except Exception as error:
            if process is not None:
                _terminate_process_tree(process)
            _remove_work_dir(work_dir)
            return {
                "success": False,
                "status": "failed",
                "stdout": "",
                "stderr": str(error),
                "error": str(error),
            }
        finally:
            with self._lock:
                self._starting = max(0, self._starting - 1)

    def _get(self, session_id: str) -> CodeExecutionSession | None:
        with self._lock:
            return self._sessions.get(str(session_id or ""))

    def read(self, session_id: str, stdout_offset=0, stderr_offset=0, wait_seconds=0) -> dict:
        session = self._get(session_id)
        if not session:
            return {
                "success": False,
                "status": "failed",
                "error": "Execution session not found",
            }
        return session.read(stdout_offset, stderr_offset, wait_seconds)

    def write(self, session_id: str, value: str, eof: bool = False) -> dict:
        session = self._get(session_id)
        if not session:
            return {
                "success": False,
                "status": "failed",
                "error": "Execution session not found",
            }
        return session.write(value, eof=eof)

    def stop(self, session_id: str) -> dict:
        session = self._get(session_id)
        if not session:
            return {
                "success": False,
                "status": "failed",
                "error": "Execution session not found",
            }
        return session.stop("stopped")

    def close(self) -> None:
        if self._closed.is_set():
            return
        self._closed.set()
        with self._lock:
            sessions = list(self._sessions.values())
            self._sessions.clear()
        for session in sessions:
            session.close()
