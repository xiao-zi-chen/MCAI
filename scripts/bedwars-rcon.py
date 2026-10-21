"""Send one administrative command to the dedicated localhost playtest server."""
import socket
import os
import struct
import sys
from pathlib import Path

def read_exact(conn, size):
    data = b""
    while len(data) < size:
        part = conn.recv(size - len(data))
        if not part:
            raise ConnectionError("RCON connection closed")
        data += part
    return data

def read_packet(conn):
    size, = struct.unpack('<i', read_exact(conn, 4))
    if not 10 <= size <= 1048576:
        raise ValueError('Invalid RCON packet size')
    data = read_exact(conn, size)
    request_id, kind = struct.unpack('<ii', data[:8])
    return request_id, kind, data[8:-2].decode('utf-8')

def send_packet(conn, request_id, kind, text):
    payload = struct.pack('<ii', request_id, kind) + text.encode('utf-8') + b'\x00\x00'
    conn.sendall(struct.pack('<i', len(payload)) + payload)

def command(text):
    props = {}
    for line in ((Path(__file__).resolve().parents[1] / os.environ.get('SKYDUEL_SERVER_ROOT','runs/bedwars-local')) / 'server.properties').read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            key, value = line.split('=', 1)
            props[key] = value
    with socket.create_connection(('127.0.0.1', int(props['rcon.port'])), timeout=8) as conn:
        send_packet(conn, 1, 3, props['rcon.password'])
        while True:
            request_id, kind, body = read_packet(conn)
            if request_id == -1: raise PermissionError('RCON authentication failed')
            if request_id == 1 and kind == 2: break
        send_packet(conn, 2, 2, text)
        request_id, kind, body = read_packet(conn)
        if request_id != 2: raise RuntimeError('Unexpected RCON response')
        return body

if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    print(command(' '.join(sys.argv[1:])))
