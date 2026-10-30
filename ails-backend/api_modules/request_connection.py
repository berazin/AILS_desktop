"""Detect explicit HTTP cancellation after a long request has finished its upstream call."""
import select
import socket


def request_disconnected(connection) -> bool:
    try:
        readable, _, _ = select.select([connection], [], [], 0)
        return bool(readable) and connection.recv(1, socket.MSG_PEEK) == b""
    except (OSError, ValueError):
        return True
