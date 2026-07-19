from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
import time
from typing import Any

from mc_pvp_env.action_abi import SwordPvPActionV1
from mc_pvp_env.config import EnvConfig
from mc_pvp_env.protocol import JsonlClient, PROTOCOL_VERSION
from mc_pvp_env.restricted_client import apply_restricted_action
from mc_pvp_env.restricted_dataset import RestrictedDatasetWriter, RestrictedEpisodeBuffer, load_restricted_dataset


@dataclass(frozen=True)
class HeroBotFabricSmokeSummary:
    dataset_path: Path
    dataset_steps: int
    damage_events: int
    final_hit_counts: dict[str, int]


def run_herobot_fabric_smoke(
    *,
    config: EnvConfig,
    plugin_client: JsonlClient,
    bot_client: JsonlClient,
    out_dir: str | Path,
    episode_id: str = "herobot-fabric-smoke",
    require_damage: bool = True,
) -> HeroBotFabricSmokeSummary:
    _request(plugin_client, "hello", role="herobot-fabric-smoke")
    _request(bot_client, "hello", role="herobot-fabric-smoke")
    _spawn_or_reuse_registered_players(bot_client, config)
    _request(plugin_client, "register_players", arena_id=config.arena, players=[config.self_name, config.opponent_name])
    _wait_for_registered_players(plugin_client, bot_client, config)
    _request(
        plugin_client,
        "reset",
        arena_id=config.arena,
        episode_id=episode_id,
        combat_mode=config.combat_mode,
        target_hits=config.target_hits,
        spawn_distance=2.8,
        player_a_yaw=-94.0,
        player_b_yaw=90.0,
    )
    _request(plugin_client, "start_episode", arena_id=config.arena, episode_id=episode_id)
    _wait_ticks(plugin_client, config.arena, 30)

    writer = RestrictedDatasetWriter(
        out_dir,
        config=config,
        backend="herobot",
        minecraft_version="1.21.11",
        server_runtime="fabric-1.21.11",
        visual_profile_id="none",
        mouse_profile_id="herobot_relative_v1",
    )
    buffer = RestrictedEpisodeBuffer(episode_id, config.arena)
    actions = [
        SwordPvPActionV1(sequence_id=1, observation_tick=0, policy_time_ms=_now_ms(), control_step_ticks=1, mouse_dx=4),
        SwordPvPActionV1(sequence_id=2, observation_tick=1, policy_time_ms=_now_ms(), control_step_ticks=1, attack_pulse=True),
    ]

    final_snapshot: dict[str, Any] = {}
    damage_events = 0
    for index, action in enumerate(actions):
        result = apply_restricted_action(
            bot_client=bot_client,
            agent_id=config.self_name,
            action=action,
            request_id=f"{episode_id}-{index}",
        )
        final_snapshot = _request(
            plugin_client,
            "wait_tick",
            arena_id=config.arena,
            after_tick=int(final_snapshot.get("tick", 0)) if final_snapshot else 0,
        )
        damage_events += _damage_event_count(final_snapshot, config.self_name)
        buffer.append_action_result(
            tick=max(result.executed.execute_tick, int(final_snapshot.get("tick", 0))),
            result=result,
            mouse_device_state={},
            action_queue_depth=0,
            reward=0.0,
            terminated=False,
            truncated=False,
        )
        if action.attack_pulse and damage_events <= 0:
            for _ in range(10):
                final_snapshot = _request(
                    plugin_client,
                    "wait_tick",
                    arena_id=config.arena,
                    after_tick=int(final_snapshot.get("tick", 0)) if final_snapshot else 0,
                )
                damage_events += _damage_event_count(final_snapshot, config.self_name)
                if damage_events > 0 or _hit_counts(final_snapshot).get(config.self_name, 0) > 0:
                    break

    retry_count = 0
    while require_damage and damage_events <= 0 and _hit_counts(final_snapshot).get(config.self_name, 0) <= 0 and retry_count < 1:
        _wait_ticks(plugin_client, config.arena, 20)
        retry_action = SwordPvPActionV1(
            sequence_id=3 + retry_count,
            observation_tick=2 + retry_count,
            policy_time_ms=_now_ms(),
            control_step_ticks=1,
            attack_pulse=True,
        )
        result = apply_restricted_action(
            bot_client=bot_client,
            agent_id=config.self_name,
            action=retry_action,
            request_id=f"{episode_id}-retry-{retry_count}",
        )
        final_snapshot = _request(
            plugin_client,
            "wait_tick",
            arena_id=config.arena,
            after_tick=int(final_snapshot.get("tick", 0)) if final_snapshot else 0,
        )
        damage_events += _damage_event_count(final_snapshot, config.self_name)
        buffer.append_action_result(
            tick=max(result.executed.execute_tick, int(final_snapshot.get("tick", 0))),
            result=result,
            mouse_device_state={},
            action_queue_depth=0,
            reward=0.0,
            terminated=False,
            truncated=False,
        )
        for _ in range(10):
            final_snapshot = _request(
                plugin_client,
                "wait_tick",
                arena_id=config.arena,
                after_tick=int(final_snapshot.get("tick", 0)) if final_snapshot else 0,
            )
            damage_events += _damage_event_count(final_snapshot, config.self_name)
            if damage_events > 0 or _hit_counts(final_snapshot).get(config.self_name, 0) > 0:
                break
        retry_count += 1

    dataset_path = writer.write_episode(buffer)
    dataset = load_restricted_dataset(out_dir)
    rows = dataset.load_episode(dataset_path)
    if len(rows) != len(buffer):
        raise RuntimeError(f"restricted smoke wrote {len(rows)} rows, expected {len(buffer)}")
    final_hit_counts = _hit_counts(final_snapshot)
    if require_damage and damage_events <= 0 and final_hit_counts.get(config.self_name, 0) <= 0:
        raise RuntimeError(
            "restricted smoke did not observe native damage or hit-count evidence; "
            f"final_snapshot={_snapshot_debug(final_snapshot)}"
        )
    return HeroBotFabricSmokeSummary(
        dataset_path=dataset_path,
        dataset_steps=len(rows),
        damage_events=max(damage_events, final_hit_counts.get(config.self_name, 0)),
        final_hit_counts=final_hit_counts,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run a worker0 HeRoBot/Fabric restricted-action smoke.")
    parser.add_argument("--config", required=True, help="Path to worker env config JSON.")
    parser.add_argument("--out-dir", required=True, help="Restricted dataset v2 output directory.")
    parser.add_argument("--episode-id", default="herobot-fabric-smoke")
    parser.add_argument("--allow-no-damage", action="store_true")
    args = parser.parse_args(argv)

    config = EnvConfig.from_json(Path(args.config))
    plugin = JsonlClient(config.host, config.plugin_port, config.request_timeout_seconds, "fabric-bridge")
    bot = JsonlClient(config.host, config.bot_port, config.request_timeout_seconds, "bot-controller")
    try:
        summary = run_herobot_fabric_smoke(
            config=config,
            plugin_client=plugin,
            bot_client=bot,
            out_dir=args.out_dir,
            episode_id=args.episode_id,
            require_damage=not args.allow_no_damage,
        )
    finally:
        plugin.close()
        bot.close()
    print("PVPRobo HeRoBot/Fabric smoke summary")
    print(f"dataset_path={summary.dataset_path}")
    print(f"dataset_steps={summary.dataset_steps}")
    print(f"damage_events={summary.damage_events}")
    print(f"final_hit_counts={summary.final_hit_counts}")
    return 0


def _spawn_spec(agent_id: str, arena_id: str, role: str, *, x: float, yaw: float) -> dict[str, Any]:
    return {
        "agent_id": agent_id,
        "username": agent_id,
        "arena_id": arena_id,
        "role": role,
        "x": x,
        "y": 90.0,
        "z": 0.0,
        "yaw": yaw,
        "pitch": 0.0,
    }


def _request(client: JsonlClient, msg_type: str, **fields: Any) -> dict[str, Any]:
    payload = {"v": PROTOCOL_VERSION, "id": f"herobot-smoke-{time.time_ns()}", "type": msg_type}
    payload.update(fields)
    reply = client.request(payload)
    if reply.get("type") == "error":
        raise RuntimeError(str(reply.get("error", "protocol error")))
    return reply


def _wait_for_registered_players(plugin_client: JsonlClient, bot_client: JsonlClient, config: EnvConfig) -> dict[str, Any]:
    expected = {config.self_name, config.opponent_name}
    spawn_specs = {
        config.self_name: _spawn_spec(config.self_name, config.arena, "learner", x=-1.0, yaw=-94.0),
        config.opponent_name: _spawn_spec(config.opponent_name, config.arena, "scripted", x=1.0, yaw=90.0),
    }
    last_snapshot: dict[str, Any] = {}
    after_tick = 0
    for attempt in range(120):
        last_snapshot = _request(plugin_client, "wait_tick", arena_id=config.arena, after_tick=after_tick)
        after_tick = int(last_snapshot.get("tick", after_tick))
        players = last_snapshot.get("players", [])
        if not isinstance(players, list):
            continue
        names = {str(player.get("name")) for player in players if isinstance(player, dict)}
        if expected.issubset(names):
            return last_snapshot
        if attempt > 0 and attempt % 20 == 0:
            missing = [spawn_specs[name] for name in sorted(expected - names)]
            if missing:
                try:
                    _request(bot_client, "spawn", bots=missing)
                except RuntimeError as exc:
                    if "returned 0" not in str(exc):
                        raise
    raise RuntimeError(
        "HeRoBot fake players did not appear in Fabric snapshot; "
        f"expected={sorted(expected)} final_snapshot={_snapshot_debug(last_snapshot)}"
    )


def _spawn_or_reuse_registered_players(bot_client: JsonlClient, config: EnvConfig) -> None:
    try:
        _request(
            bot_client,
            "spawn",
            bots=[
                _spawn_spec(config.self_name, config.arena, "learner", x=-1.0, yaw=-94.0),
                _spawn_spec(config.opponent_name, config.arena, "scripted", x=1.0, yaw=90.0),
            ],
        )
    except RuntimeError as exc:
        # HeRoBot returns command_result=0 when the fake player already exists
        # or is still finishing its async spawn. Snapshot polling below decides
        # whether this was recoverable.
        if "returned 0" not in str(exc):
            raise


def _wait_ticks(plugin_client: JsonlClient, arena_id: str, ticks: int) -> dict[str, Any]:
    snapshot: dict[str, Any] = {}
    after_tick = 0
    for _ in range(ticks):
        snapshot = _request(plugin_client, "wait_tick", arena_id=arena_id, after_tick=after_tick)
        after_tick = int(snapshot.get("tick", after_tick))
    return snapshot


def _now_ms() -> int:
    return int(time.time() * 1000)


def _damage_event_count(snapshot: dict[str, Any], attacker: str) -> int:
    events = snapshot.get("events", [])
    if not isinstance(events, list):
        return 0
    return sum(1 for event in events if isinstance(event, str) and (event.startswith(f"native_damage:{attacker}:") or event.startswith(f"hit:{attacker}:")))


def _hit_counts(snapshot: dict[str, Any]) -> dict[str, int]:
    raw = snapshot.get("hit_counts", {})
    if not isinstance(raw, dict):
        return {}
    return {str(key): int(value) for key, value in raw.items()}


def _snapshot_debug(snapshot: dict[str, Any]) -> dict[str, Any]:
    return {
        "tick": snapshot.get("tick"),
        "hit_counts": snapshot.get("hit_counts"),
        "events": snapshot.get("events"),
        "players": snapshot.get("players"),
    }


if __name__ == "__main__":
    raise SystemExit(main())
