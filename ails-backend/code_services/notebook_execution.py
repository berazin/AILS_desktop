"""Collect a Jupyter execution with progress and explicit terminal failures."""

from queue import Empty
import time


def execution_error(name, message):
    return {"output_type": "error", "ename": name, "evalue": str(message),
            "traceback": [f"{name}: {message}"]}


def execute_kernel_cell(kernel, code, timeout_seconds, emit, cancelled):
    outputs = []
    execution_count = None
    manager, client = kernel["manager"], kernel["client"]
    started = time.monotonic()
    last_progress = started
    displays = {}
    clear_pending = False

    def publish():
        # Stream chunks may be extended later; don't mutate an emitted snapshot.
        emit({"type": "output", "outputs": [dict(item) for item in outputs],
              "execution_count": execution_count})

    try:
        message_id = client.execute(code, store_history=True, allow_stdin=False, stop_on_error=True)
        emit({"type": "status", "phase": "running", "elapsed_seconds": 0,
              "timeout_seconds": timeout_seconds})
        while True:
            elapsed = time.monotonic() - started
            if cancelled.is_set():
                raise InterruptedError("셀 실행을 중단했습니다.")
            if elapsed >= timeout_seconds:
                raise TimeoutError(f"Cell execution exceeded {timeout_seconds}s")
            if not manager.is_alive():
                raise RuntimeError("Python 커널이 종료되었습니다. 커널을 재시작한 뒤 다시 실행해 주세요.")
            if time.monotonic() - last_progress >= 1:
                emit({"type": "status", "phase": "running", "elapsed_seconds": int(elapsed),
                      "timeout_seconds": timeout_seconds})
                last_progress = time.monotonic()
            try:
                message = client.get_iopub_msg(timeout=0.5)
            except Empty:
                continue
            if message.get("parent_header", {}).get("msg_id") != message_id:
                continue
            kind = message.get("msg_type")
            content = message.get("content", {})
            if kind == "status" and content.get("execution_state") == "idle":
                break
            if kind == "clear_output":
                clear_pending = bool(content.get("wait"))
                if not clear_pending:
                    outputs.clear()
                    displays.clear()
                    publish()
                continue
            if clear_pending and kind in ("stream", "execute_result", "display_data", "update_display_data", "error"):
                outputs.clear()
                displays.clear()
                clear_pending = False
            if kind == "execute_input":
                execution_count = content.get("execution_count")
                emit({"type": "execute_input", "execution_count": execution_count})
            elif kind == "stream":
                name, text = content.get("name", "stdout"), str(content.get("text", ""))
                if outputs and outputs[-1].get("output_type") == "stream" and outputs[-1].get("name") == name:
                    outputs[-1]["text"] += text
                else:
                    outputs.append({"output_type": "stream", "name": name, "text": text})
                publish()
            elif kind == "update_display_data":
                display_id = content.get("transient", {}).get("display_id")
                for output in displays.get(display_id, []):
                    output.update(data=content.get("data", {}), metadata=content.get("metadata", {}))
                publish()
            elif kind in ("execute_result", "display_data"):
                output = {"output_type": kind, "data": content.get("data", {}),
                          "metadata": content.get("metadata", {})}
                if kind == "execute_result":
                    execution_count = content.get("execution_count", execution_count)
                    output["execution_count"] = execution_count
                outputs.append(output)
                display_id = content.get("transient", {}).get("display_id")
                if display_id:
                    displays.setdefault(display_id, []).append(output)
                publish()
            elif kind == "error":
                outputs.append({"output_type": "error", "ename": content.get("ename", "Error"),
                                "evalue": content.get("evalue", ""), "traceback": content.get("traceback", [])})
                publish()
    except (BrokenPipeError, ConnectionResetError):
        manager.interrupt_kernel()
        raise
    except Exception as error:
        try:
            manager.interrupt_kernel()
        except Exception:
            pass
        outputs.append(execution_error(type(error).__name__, error))
        publish()
    return outputs, execution_count
