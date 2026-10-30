"""Dependency direction lint; runs without importing application dependencies."""
from __future__ import annotations

import ast
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "ails-backend"
OUTER_LAYERS = {"api_server", "api_modules", "api_request_handler", "api_get_routes",
                "api_post_routes", "api_post_stream_routes", "bootstrap"}


def import_targets(tree):
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                yield node.lineno, alias.name
        elif isinstance(node, ast.ImportFrom):
            yield node.lineno, node.module or ""
        elif (isinstance(node, ast.Call) and node.args
              and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str)):
            name = node.func.id if isinstance(node.func, ast.Name) else node.func.attr if isinstance(node.func, ast.Attribute) else ""
            if name in {"import_module", "__import__"}:
                yield node.lineno, node.args[0].value


def violations(relative: Path, tree):
    """API adapters/composition may depend inward; domains never depend outward."""
    if relative.parts[0] in {"bootstrap", "api_modules", "tools", "tests"} or relative.stem.startswith("api_"):
        return []
    errors = []
    for line, target in import_targets(tree):
        target = target.lstrip(".")
        if target.split(".")[0] in OUTER_LAYERS or target.startswith("api_"):
            errors.append(f"{relative.as_posix()}:{line}: domain imports outer layer {target}")
    return errors


def check(root=BACKEND):
    errors = []
    count = 0
    for path in root.rglob("*.py"):
        relative = path.relative_to(root)
        if any(part in {"__pycache__", "node_modules", ".venv", "tools", "notebook-runtime"} for part in relative.parts):
            continue
        try:
            tree = ast.parse(path.read_text(encoding="utf-8-sig"), filename=str(path))
        except SyntaxError as error:
            errors.append(f"{relative}:{error.lineno}: {error.msg}")
            continue
        errors.extend(violations(relative, tree))
        count += 1
    if errors:
        raise SystemExit("\n".join(errors))
    print(f"Backend architecture: {count} modules passed domain-to-adapter/composition checks.")


if __name__ == "__main__":
    check()
