"""Office routes share the normal authenticated local API boundary."""
import os
from pathlib import Path
from common import resolve_app_path
from documents import office_files


def office_request(state, action: str, payload: dict):
    if action == 'hwpx-automation':
        from documents.office_automation import automate
        return automate(payload)
    if action == 'studio':
        from bootstrap.service_adapter import service_call
        return {'url': service_call(state, 'office_studio', 'start')}
    storage = os.environ.get('AILS_RUNTIME_DATA_DIR') or str(Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'AILS')
    return office_files.request(action, payload, resolve_app_path(state.config.get('md_save_path', '')), storage)
