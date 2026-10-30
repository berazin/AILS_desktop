"""Remove disabled automatic work without losing completed document records."""


class DisabledWorkQueueMixin:
    WORK_ENABLE_SETTINGS = {
        "ocr": "ocr_enabled",
        "embedding": "embedding_enabled",
        "spacing": "spacing_enabled",
        "translation": "translation_enabled",
    }

    def _work_enabled_locked(self, kind):
        setting = self.WORK_ENABLE_SETTINGS.get(kind)
        return setting is None or bool(self._settings.get(setting))

    def _prune_disabled_work_locked(self, *, persist=True):
        changed = False
        for key, item in list(self._ledger["items"].items()):
            if self._work_enabled_locked(item["kind"]):
                continue
            # A live worker keeps its record until its safe completion/cancel
            # boundary. Public queues hide it immediately while switched off.
            if item["state"] in {"done", "skipped", "running"}:
                continue
            self._ledger["items"].pop(key, None)
            if item["kind"] == "spacing":
                self._spacing_passwords.pop(item["path"], None)
            changed = True
        if not self._work_enabled_locked("ocr"):
            self._eval_items.clear()
            self._eval_queue.clear()
        if not self._work_enabled_locked("spacing"):
            self._spacing_passwords.clear()
        if changed and persist:
            self._save_locked()
        return changed
