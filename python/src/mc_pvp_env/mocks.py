from __future__ import annotations

import socket
import threading
from typing import Any

from mc_pvp_env.protocol import decode_jsonl, encode_jsonl, PROTOCOL_VERSION


def make_snapshot(tick: int = 0, phase: str = "running", self_name: str = "ROBO-A0", opponent_name: str = "SCRIPT-A0") -> dict[str, Any]:
    return {
        "v": PROTOCOL_VERSION,
        "id": "snapshot",
        "type": "snapshot",
        "arena_id": "arena_0",
        "tick": tick,
        "phase": phase,
        "combat_mode": "hit_count",
        "target_hits": 5,
        "hit_counts": {self_name: tick // 4, opponent_name: tick // 8},
        "hit_deltas": {self_name: 1 if tick > 0 else 0, opponent_name: 0},
        "last_hitter": self_name if tick > 0 else "",
        "winner": "",
        "done_reason": "running",
        "players": [
            {
                "name": self_name,
                "hp": 20.0,
                "pos": [-1.0, 64.0, 0.0],
                "vel": [0.0, 0.0, 0.0],
                "yaw": 90.0,
                "pitch": 0.0,
                "attack_cooldown": 1.0,
                "hurt_time": 0.0,
                "on_ground": True,
                "line_of_sight": True,
            },
            {
                "name": opponent_name,
                "hp": max(0.0, 20.0 - tick),
                "pos": [1.0, 64.0, 0.0],
                "vel": [0.0, 0.0, 0.0],
                "yaw": 270.0,
                "pitch": 0.0,
                "attack_cooldown": 1.0,
                "hurt_time": 0.0,
                "on_ground": True,
                "line_of_sight": True,
            },
        ],
        "events": [],
    }


class _JsonlMockServer:
    def __init__(self, handler):
        self._handler = handler
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._sock.bind(("127.0.0.1", 0))
        self.host, self.port = self._sock.getsockname()
        self._sock.listen(1)
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._serve, daemon=True)
        self._thread.start()

    def close(self) -> None:
        self._stop.set()
        try:
            socket.create_connection((self.host, self.port), timeout=0.2).close()
        except OSError:
            pass
        self._sock.close()
        self._thread.join(timeout=1.0)

    def _serve(self) -> None:
        while not self._stop.is_set():
            try:
                conn, _ = self._sock.accept()
            except OSError:
                return
            threading.Thread(target=self._serve_connection, args=(conn,), daemon=True).start()

    def _serve_connection(self, conn: socket.socket) -> None:
        with conn:
            file = conn.makefile("rwb")
            while not self._stop.is_set():
                try:
                    line = file.readline()
                except OSError:
                    break
                if not line:
                    break
                request = decode_jsonl(line)
                response = self._handler(request)
                file.write(encode_jsonl(response))
                file.flush()


class MockPluginServer(_JsonlMockServer):
    def __init__(
        self,
        self_name: str = "ROBO-A0",
        opponent_name: str = "SCRIPT-A0",
        difficulty: str = "bc",
        mode: str = "player_duel",
        phase: str = "running",
        participants: list[dict[str, str]] | None = None,
    ):
        self.tick = 0
        self.self_name = self_name
        self.opponent_name = opponent_name
        self.difficulty = difficulty
        self.mode = mode
        self.phase = phase
        self.participants = participants or [{"name": self_name, "difficulty": difficulty}]
        self.episode_id = "mock-episode"
        self.ready_requests: list[dict[str, Any]] = []
        super().__init__(self._handle)

    def _handle(self, request: dict[str, Any]) -> dict[str, Any]:
        req_type = request["type"]
        if req_type == "reset":
            self.tick = 0
            snapshot = make_snapshot(self.tick, self_name=self.self_name, opponent_name=self.opponent_name)
            return {"v": 1, "id": request["id"], "type": "reset_ack", "tick": self.tick, "snapshot": snapshot}
        if req_type in ("snapshot_request", "observe", "wait_tick", "tick_snapshot"):
            self.tick += 2
            return make_snapshot(self.tick, self_name=self.self_name, opponent_name=self.opponent_name)
        if req_type == "ping":
            return {"v": 1, "id": request["id"], "type": "pong", "ok": True}
        if req_type == "status":
            phase = self.phase if self.tick < 8 else "self_win"
            return {
                "v": 1,
                "id": request["id"],
                "type": "status",
                "ok": True,
                "registered_players": [self.self_name, self.opponent_name],
                "episode_active": self.tick < 8,
                "duel": {
                    "active": self.tick < 8,
                    "mode": self.mode,
                    "arena_id": "arena_0",
                    "player": "" if self.mode == "ai_battle" else self.opponent_name,
                    "robo": self.self_name,
                    "difficulty": self.difficulty,
                    "participants": self.participants,
                    "viewers": ["Viewer"] if self.mode == "ai_battle" else [],
                    "phase": phase,
                    "episode_id": self.episode_id,
                },
                "duels": [
                    {
                        "active": self.tick < 8,
                        "mode": self.mode,
                        "arena_id": "arena_0",
                        "player": "" if self.mode == "ai_battle" else self.opponent_name,
                        "robo": self.self_name,
                        "difficulty": self.difficulty,
                        "participants": self.participants,
                        "viewers": ["Viewer"] if self.mode == "ai_battle" else [],
                        "phase": phase,
                        "episode_id": self.episode_id,
                    }
                ],
            }
        if req_type == "duel_participants_ready":
            self.ready_requests.append(request)
            self.phase = "running"
            return {"v": 1, "id": request["id"], "type": "duel_participants_ready_ack", "ok": True}
        if req_type == "register_players":
            return {"v": 1, "id": request["id"], "type": "register_players_ack", "ok": True, "registered_players": request.get("players", [])}
        if req_type == "list_players":
            return {"v": 1, "id": request["id"], "type": "players", "registered_players": [self.self_name, self.opponent_name]}
        if req_type == "start_episode":
            self.tick = 0
            return {"v": 1, "id": request["id"], "type": "start_episode_ack", "ok": True, "tick": self.tick}
        if req_type == "reward_snapshot":
            return {"v": 1, "id": request["id"], "type": "reward", "reward": 0.0, "self_hp": 20.0, "opponent_hp": 20.0}
        if req_type == "done":
            return {"v": 1, "id": request["id"], "type": "done", "terminated": False, "truncated": False, "reason": "running"}
        if req_type == "cleanup":
            return {"v": 1, "id": request["id"], "type": "cleanup_ack", "ok": True}
        if req_type == "hello":
            return {"v": 1, "id": request["id"], "type": "hello_ack", "server": "mock-plugin"}
        return {"v": 1, "id": request["id"], "type": "error", "error": "unsupported"}


class MockBotController(_JsonlMockServer):
    def __init__(self):
        self.actions: list[dict[str, Any]] = []
        self.bots: list[dict[str, Any]] = []
        super().__init__(self._handle)

    def _handle(self, request: dict[str, Any]) -> dict[str, Any]:
        req_type = request["type"]
        if req_type == "ready_request":
            return {"v": 1, "id": request["id"], "type": "ready", "bots": ["ROBO-A0", "SCRIPT-A0"]}
        if req_type == "status":
            return {"v": 1, "id": request["id"], "type": "status", "ok": True, "bots": self.bots}
        if req_type == "spawn":
            for bot in request.get("bots", []):
                if isinstance(bot, dict):
                    self.bots.append({
                        "agent_id": bot.get("agent_id"),
                        "username": bot.get("username"),
                        "arena_id": bot.get("arena_id", "arena_0"),
                        "role": bot.get("role", "learner"),
                        "connected": True,
                    })
            return {"v": 1, "id": request["id"], "type": "spawn_ack", "ok": True, "bots": [bot.get("agent_id") for bot in request.get("bots", [])]}
        if req_type == "act":
            self.actions.append(request)
            return {"v": 1, "id": request["id"], "type": "act_ack", "accepted": True}
        if req_type == "apply_action":
            self.actions.append(request)
            return {"v": 1, "id": request["id"], "type": "apply_action_ack", "accepted": True}
        if req_type == "clear_controls":
            return {"v": 1, "id": request["id"], "type": "clear_controls_ack", "ok": True}
        if req_type == "despawn":
            raw_agent_ids = request.get("agent_ids")
            if not isinstance(raw_agent_ids, list):
                raw_agent_ids = [request.get("agent_id")]
            agent_ids = {str(agent_id) for agent_id in raw_agent_ids if agent_id}
            self.bots = [bot for bot in self.bots if str(bot.get("agent_id")) not in agent_ids]
            return {"v": 1, "id": request["id"], "type": "despawn_ack", "ok": True, "bots": sorted(agent_ids)}
        if req_type == "hello":
            return {"v": 1, "id": request["id"], "type": "hello_ack", "server": "mock-bot-controller"}
        return {"v": 1, "id": request["id"], "type": "error", "error": "unsupported"}
