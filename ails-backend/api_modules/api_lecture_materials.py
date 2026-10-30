"""Compatibility exports. Implementation belongs to documents.material_workspace_service."""
from __future__ import annotations
from importlib import import_module as _import_module

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module("documents.material_workspace_service"), name)

from bootstrap.service_adapter import service_call as _service_call


class LectureMaterialsMixin:
    """Stable API methods delegating to the materials service."""
    def migrate_material_system_storage(self):
        return _service_call(self, "materials", 'migrate_material_system_storage')

    def lecture_material_directory(self, directory: str='', *, include_problem_progress: bool=False):
        return _service_call(self, "materials", 'lecture_material_directory', directory, include_problem_progress=include_problem_progress)

    def invalidate_lecture_materials_cache(self):
        return _service_call(self, "materials", 'invalidate_lecture_materials_cache')

    def lecture_materials(self):
        return _service_call(self, "materials", 'lecture_materials')

    def material_trash_dir(self, base_dir: str) -> str:
        return _service_call(self, "materials", 'material_trash_dir', base_dir)

    def material_trash_items(self, base_dir: str | None=None) -> list[dict]:
        return _service_call(self, "materials", 'material_trash_items', base_dir)

    def ensure_material_trash_entry_path(self, raw_path: str, base_dir: str) -> str:
        return _service_call(self, "materials", 'ensure_material_trash_entry_path', raw_path, base_dir)

    def remove_material_trash_path(self, target_path: str):
        return _service_call(self, "materials", 'remove_material_trash_path', target_path)

    def delete_material_trash_item(self, payload: dict):
        return _service_call(self, "materials", 'delete_material_trash_item', payload)

    def empty_material_trash(self):
        return _service_call(self, "materials", 'empty_material_trash')

    def restore_material_trash_item(self, payload: dict):
        return _service_call(self, "materials", 'restore_material_trash_item', payload)

    def unique_material_trash_path(self, source_path: str, base_dir: str) -> str:
        return _service_call(self, "materials", 'unique_material_trash_path', source_path, base_dir)

    def _create_material_file_service(self):
        return _service_call(self, "materials", '_create_material_file_service')

    def _material_file_service(self):
        return _service_call(self, "materials", '_material_file_service')

    def read_material_file(self, file_path: str):
        return _service_call(self, "materials", 'read_material_file', file_path)

    def save_material_file(self, payload: dict):
        return _service_call(self, "materials", 'save_material_file', payload)

    def material_file_siblings(self, file_path: str) -> dict:
        return _service_call(self, "materials", 'material_file_siblings', file_path)

    def unlock_material_pdf(self, payload: dict):
        return _service_call(self, "materials", 'unlock_material_pdf', payload)

    def rename_material_file(self, payload: dict):
        return _service_call(self, "materials", 'rename_material_file', payload)

    def delete_material_file(self, payload: dict):
        return _service_call(self, "materials", 'delete_material_file', payload)

    def create_material_file(self, payload: dict):
        return _service_call(self, "materials", 'create_material_file', payload)

    def create_material_folder(self, payload: dict):
        return _service_call(self, "materials", 'create_material_folder', payload)

    def rename_material_folder(self, payload: dict):
        return _service_call(self, "materials", 'rename_material_folder', payload)

    def delete_material_folder(self, payload: dict):
        return _service_call(self, "materials", 'delete_material_folder', payload)

    def transfer_material_entries(self, payload: dict):
        return _service_call(self, "materials", 'transfer_material_entries', payload)

    def move_material_file(self, payload: dict):
        return _service_call(self, "materials", 'move_material_file', payload)

    def move_material_entry(self, payload: dict):
        return _service_call(self, "materials", 'move_material_entry', payload)

    def _material_practice_events(self):
        return _service_call(self, "materials", '_material_practice_events')

    def cancel_material_practice_generation(self, payload: dict):
        return _service_call(self, "materials", 'cancel_material_practice_generation', payload)

    def cancel_all_material_practice_generations(self):
        return _service_call(self, "materials", 'cancel_all_material_practice_generations')

    def generate_material_practice(self, payload: dict):
        return _service_call(self, "materials", 'generate_material_practice', payload)

    def _generate_material_practice_impl(self, payload: dict, generation_id: str, cancel_event: threading.Event):
        return _service_call(self, "materials", '_generate_material_practice_impl', payload, generation_id, cancel_event)
