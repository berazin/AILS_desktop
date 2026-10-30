"""Keep checking a caller's cancellation while an upstream socket is idle."""
import queue
import threading


def cancellable_items(source, cancel_check):
    if not callable(cancel_check):
        yield from source
        return
    pending = queue.Queue(maxsize=8)
    stopped = threading.Event()

    def publish(item):
        while not stopped.is_set():
            try:
                pending.put(item, timeout=0.1)
                return
            except queue.Full:
                pass

    def read():
        try:
            for item in source:
                if stopped.is_set():
                    return
                publish(("item", item))
        except BaseException as error:
            publish(("error", error))
        finally:
            publish(("end", None))

    cancel_check()
    threading.Thread(target=read, daemon=True, name="chat-stream-reader").start()
    try:
        while True:
            cancel_check()
            try:
                kind, value = pending.get(timeout=0.1)
            except queue.Empty:
                continue
            if kind == "end":
                return
            if kind == "error":
                raise value
            yield value
    finally:
        stopped.set()


def close_response(response, *, background=False):
    if not background:
        response.close()
        return
    # requests.close() can wait for a buffered reader. Shutdown its socket
    # first when available so an idle upstream also observes cancellation.
    def close():
        try:
            import socket
            connection = getattr(getattr(response, "raw", None), "_connection", None)
            sock = getattr(connection, "sock", None)
            if sock is None:
                raw = getattr(getattr(getattr(getattr(response, "raw", None), "_fp", None), "fp", None), "raw", None)
                sock = getattr(raw, "_sock", None)
            if sock is not None:
                try:
                    sock.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
            response.close()
        except Exception:
            pass
    threading.Thread(target=close, daemon=True, name="chat-stream-close").start()
