def normalize_retry_candidate_logs(entry):
    if not isinstance(entry, dict):
        return []

    for key in ("last_logs", "logs"):
        raw_logs = entry.get(key)
        if isinstance(raw_logs, list):
            logs = [str(log).rstrip() for log in raw_logs if str(log).strip()]
            if logs:
                return logs

    content = str(entry.get("content", "") or "").strip()
    if content:
        return [line.rstrip() for line in content.replace("\r\n", "\n").replace("\r", "\n").split("\n")]

    last_error = str(entry.get("last_error", "") or "").strip()
    if last_error:
        return [f"오류: {last_error}"]

    return []
