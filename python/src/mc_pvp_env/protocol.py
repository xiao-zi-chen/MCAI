from __future__ import annotations

from dataclasses import dataclass
import json
import socket
from typing import Any


PROTOCOL_VERSION = 1


def encode_jsonl(message: dict[str, Any]) -> bytes:
    return (json.dumps(message, separators=(",", ":"), sort_keys=True) + "\n").encode("utf-8")


def decode_jsonl(line: bytes) -> dict[str, Any]:
    message = json.loads(line.decode("utf-8"))
    if not isinstance(message, dict):
        raise ValueError("JSONL message must be an object")
    if message.get("v") != PROTOCOL_VERSION:
        raise ValueError("unsupported protocol version")
    if "type" not in message:
        raise ValueError("message missing type")
    return message


@dataclass
class JsonlClient:
    host: str
    port: int
    timeout_seconds: float = 2.0
    name: str = "client"

    def __post_init__(self) -> None:
        if self.host not in ("127.0.0.1", "localhost"):
            raise ValueError("control connections must be localhost-only")
        self._sock: socket.socket | None = None
        self._file = None

    def connect(self) -> None:
        self._sock = socket.create_connection((self.host, self.port), timeout=self.timeout_seconds)
        self._sock.settimeout(self.timeout_seconds)
        self._file = self._sock.makefile("rwb")

    def close(self) -> None:
        if self._file is not None:
            self._file.close()
        if self._sock is not None:
            self._sock.close()
        self._file = None
        self._sock = None

    def request(self, message: dict[str, Any]) -> dict[str, Any]:
        if self._file is None:
            self.connect()
        assert self._file is not None
        self._file.write(encode_jsonl(message))
        self._file.flush()
        line = self._file.readline()
        if not line:
            raise ConnectionError("%s connection closed" % self.name)
        return decode_jsonl(line)

