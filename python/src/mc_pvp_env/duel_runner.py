from __future__ import annotations

import argparse
from dataclasses import dataclass, replace
from pathlib import Path
import threading
import time
import traceback
from typing import Any, Callable

import numpy as np

from mc_pvp_env.actions import curriculum_action_to_vector
from mc_pvp_env.config import EnvConfig
from mc_pvp_env.duel_policy_manifest import DuelPolicy, resolve_difficulty
from mc_pvp_env.expert import CurriculumScriptedTargetPolicy, WeakScriptedTargetPolicy
from mc_pvp_env.observations import flatten_snapshot
from mc_pvp_env.protocol import JsonlClient, PROTOCOL_VERSION
from mc_pvp_env.train_bc import load_bc_policy, predict_action


TERMINAL_PHASES = {"self_win", "opponent_win", "draw"}


@dataclass(frozen=True)
class DuelRunSummary:
    steps: int
    phase: str
    winner: str
    hit_counts: dict[str, int]
    reason: str


@dataclass(frozen=True)
class AutoDuelSummary:
    sessions: int
    reason: str


@dataclass(frozen=True)
class AiBattleParticipant:
    name: str
    difficulty: str
    predictor: Callable[[np.ndarray], int]


def run_bc_duel(
    policy_path: str | Path,
    config: EnvConfig,
    *,
    player_name: str,
    robo_name: str = "ROBO",
    arena_id: str | None = None,
    max_steps: int | None = None,
    wait_timeout_seconds: float = 120.0,
    predictor: Callable[[np.ndarray], int] | None = None,
) -> DuelRunSummary:
    if predictor is None:
        predictor = make_policy_predictor(DuelPolicy("bc", "bc", Path(policy_path)))
    return run_policy_duel(
        config,
        player_name=player_name,
        robo_name=robo_name,
        arena_id=arena_id,
        max_steps=max_steps,
        wait_timeout_seconds=wait_timeout_seconds,
        predictor=predictor,
    )


def run_policy_duel(
    config: EnvConfig,
    *,
    player_name: str,
    robo_name: str = "ROBO",
    arena_id: str | None = None,
    max_steps: int | None = None,
    wait_timeout_seconds: float = 120.0,
    predictor: Callable[[np.ndarray], int],
) -> DuelRunSummary:

    arena = arena_id or config.arena
    duel_config = replace(config, arena=arena, self_name=robo_name, opponent_name=player_name)
    plugin = JsonlClient(duel_config.host, duel_config.plugin_port, duel_config.request_timeout_seconds, "plugin")
    bot = JsonlClient(duel_config.host, duel_config.bot_port, duel_config.request_timeout_seconds, "bot-controller")
    steps = 0
    last_snapshot: dict[str, Any] = {}

    try:
        _request(plugin, "hello", role="duel-runner")
        _request(bot, "hello", role="duel-runner")
        ensure_robo_spawned(bot, robo_name=robo_name, arena_id=arena)

        deadline = time.monotonic() + wait_timeout_seconds
        snapshot = _wait_for_duel_snapshot(plugin, arena, robo_name, player_name, deadline)
        limit = max_steps or duel_config.max_episode_ticks
        while steps < limit:
            last_snapshot = snapshot
            phase = str(snapshot.get("phase", ""))
            if phase in TERMINAL_PHASES:
                break
            obs = flatten_snapshot(snapshot, robo_name, player_name, duel_config.max_episode_ticks)
            action_id = int(predictor(obs))
            action = curriculum_action_to_vector(action_id).astype(int).tolist()
            _request(
                bot,
                "apply_action",
                agent_id=robo_name,
                target_username=player_name,
                arena_id=arena,
                repeat_ticks=duel_config.action_repeat_ticks,
                action=action,
            )
            snapshot = _request(
                plugin,
                "wait_tick",
                arena_id=arena,
                after_tick=int(snapshot.get("tick", 0)),
            )
            steps += 1
        return _summary(last_snapshot or snapshot, steps, "step_limit" if steps >= limit else "terminal")
    finally:
        try:
            _request(bot, "clear_controls", agent_id=robo_name)
        except Exception:
            pass
        plugin.close()
        bot.close()


def run_ai_battle(
    config: EnvConfig,
    *,
    participants: list[AiBattleParticipant],
    arena_id: str | None = None,
    max_steps: int | None = None,
    wait_timeout_seconds: float = 120.0,
) -> DuelRunSummary:
    if len(participants) != 2:
        raise ValueError("AI battle requires exactly two participants")
    arena = arena_id or config.arena
    plugin = JsonlClient(config.host, config.plugin_port, config.request_timeout_seconds, "plugin")
    bot = JsonlClient(config.host, config.bot_port, config.request_timeout_seconds, "bot-controller")
    steps = 0
    last_snapshot: dict[str, Any] = {}
    left, right = participants

    try:
        _request(plugin, "hello", role="ai-battle-runner")
        _request(bot, "hello", role="ai-battle-runner")
        ensure_bot_spawned(bot, bot_name=left.name, arena_id=arena)
        ensure_bot_spawned(bot, bot_name=right.name, arena_id=arena)

        deadline = time.monotonic() + wait_timeout_seconds
        snapshot = _wait_for_duel_snapshot(plugin, arena, left.name, right.name, deadline)
        limit = max_steps or config.max_episode_ticks
        while steps < limit:
            last_snapshot = snapshot
            phase = str(snapshot.get("phase", ""))
            if phase in TERMINAL_PHASES:
                break
            for self_participant, opponent in ((left, right), (right, left)):
                obs = flatten_snapshot(snapshot, self_participant.name, opponent.name, config.max_episode_ticks)
                action_id = int(self_participant.predictor(obs))
                action = curriculum_action_to_vector(action_id).astype(int).tolist()
                _request(
                    bot,
                    "apply_action",
                    agent_id=self_participant.name,
                    target_username=opponent.name,
                    arena_id=arena,
                    repeat_ticks=config.action_repeat_ticks,
                    action=action,
                )
            snapshot = _request(
                plugin,
                "wait_tick",
                arena_id=arena,
                after_tick=int(snapshot.get("tick", 0)),
            )
            steps += 1
        return _summary(last_snapshot or snapshot, steps, "step_limit" if steps >= limit else "terminal")
    finally:
        for participant in participants:
            try:
                _request(bot, "clear_controls", agent_id=participant.name)
            except Exception:
                pass
        try:
            _request(bot, "despawn", agent_ids=[participant.name for participant in participants])
        except Exception:
            pass
        plugin.close()
        bot.close()


def run_auto_duel_daemon(
    config: EnvConfig,
    manifest_path: str | Path,
    *,
    robo_name: str = "ROBO",
    arena_id: str | None = None,
    poll_seconds: float = 0.5,
    wait_timeout_seconds: float = 120.0,
    max_steps: int | None = None,
    max_sessions: int | None = None,
    idle_timeout_seconds: float | None = None,
) -> AutoDuelSummary:
    arena = arena_id or config.arena
    plugin = JsonlClient(config.host, config.plugin_port, config.request_timeout_seconds, "plugin")
    bot = JsonlClient(config.host, config.bot_port, config.request_timeout_seconds, "bot-controller")
    sessions = 0
    handled_episode_ids: set[str] = set()
    active_threads: dict[str, threading.Thread] = {}
    failed_episode_ids: set[str] = set()
    start_time = time.monotonic()
    try:
        _request(plugin, "hello", role="duel-daemon")
        _request(bot, "hello", role="duel-daemon")
        ensure_robo_spawned(bot, robo_name=robo_name, arena_id=arena)
        while True:
            finished = [thread_key for thread_key, thread in active_threads.items() if not thread.is_alive()]
            for thread_key in finished:
                active_threads.pop(thread_key, None)
                handled_episode_ids.add(thread_key)
                sessions += 1
                if max_sessions is not None and sessions >= max_sessions:
                    return AutoDuelSummary(sessions=sessions, reason="max_sessions")
            status = _request(plugin, "status")
            duel_items = status.get("duels", [])
            if not isinstance(duel_items, list) or not duel_items:
                duel_items = [status.get("duel", {})]
            for duel in duel_items:
                if not isinstance(duel, dict):
                    continue
                active = bool(duel.get("active"))
                mode = str(duel.get("mode", "player_duel"))
                player_name = str(duel.get("player", ""))
                current_robo = str(duel.get("robo", robo_name))
                difficulty = str(duel.get("difficulty", "bc"))
                episode_id = str(duel.get("episode_id", ""))
                current_arena = str(duel.get("arena_id", arena))
                phase = str(duel.get("phase", ""))
                participants_raw = duel.get("participants", [])
                key = episode_id or f"{mode}:{current_arena}:{player_name}:{difficulty}:{phase}:{sessions}"
                if active and mode == "ai_battle" and phase in {"loading", "countdown", "running"}:
                    ai_participants = _parse_ai_participants(participants_raw)
                    all_connected = True
                    for participant_name, _participant_difficulty in ai_participants:
                        all_connected = (
                            ensure_bot_spawned(
                                bot,
                                bot_name=participant_name,
                                arena_id=current_arena,
                                wait_timeout_seconds=min(wait_timeout_seconds, 5.0),
                            )
                            and all_connected
                        )
                    if phase == "loading":
                        if len(ai_participants) == 2 and all_connected:
                            _request(plugin, "duel_participants_ready", arena_id=current_arena, episode_id=episode_id)
                        continue
                    if (
                        len(ai_participants) == 2
                        and key not in handled_episode_ids
                        and key not in active_threads
                        and key not in failed_episode_ids
                    ):
                        try:
                            battle_participants = []
                            for participant_name, participant_difficulty in ai_participants:
                                policy = resolve_difficulty(manifest_path, participant_difficulty)
                                battle_participants.append(AiBattleParticipant(participant_name, participant_difficulty, make_policy_predictor(policy)))
                        except Exception as exc:
                            failed_episode_ids.add(key)
                            print(
                                "PVPRobo AI battle policy load failed "
                                f"episode={episode_id} participants={ai_participants} error={exc}",
                                flush=True,
                            )
                            continue
                        print(
                            "PVPRobo AI battle start "
                            f"episode={episode_id} arena={current_arena} participants={ai_participants}",
                            flush=True,
                        )
                        thread = threading.Thread(
                            target=_run_ai_battle_session_guarded,
                            kwargs={
                                "config": config,
                                "participants": battle_participants,
                                "arena_id": current_arena,
                                "max_steps": max_steps,
                                "wait_timeout_seconds": wait_timeout_seconds,
                                "episode_id": episode_id,
                            },
                            daemon=True,
                        )
                        active_threads[key] = thread
                        thread.start()
                    continue
                if active and phase in {"loading", "countdown", "running"} and current_robo:
                    connected = ensure_robo_spawned(
                        bot,
                        robo_name=current_robo,
                        arena_id=current_arena,
                        wait_timeout_seconds=min(wait_timeout_seconds, 5.0),
                    )
                    if mode != "ai_battle" and phase == "loading" and player_name and connected:
                        _request(plugin, "duel_participants_ready", arena_id=current_arena, episode_id=episode_id)
                        continue
                if (
                    active
                    and mode != "ai_battle"
                    and phase in {"countdown", "running"}
                    and player_name
                    and current_robo
                    and key not in handled_episode_ids
                    and key not in active_threads
                    and key not in failed_episode_ids
                ):
                    try:
                        policy = resolve_difficulty(manifest_path, difficulty)
                        predictor = make_policy_predictor(policy)
                    except Exception as exc:
                        failed_episode_ids.add(key)
                        print(
                            "PVPRobo auto duel policy load failed "
                            f"episode={episode_id} difficulty={difficulty} error={exc}",
                            flush=True,
                        )
                        continue
                    print(
                        "PVPRobo auto duel start "
                        f"episode={episode_id} player={player_name} robo={current_robo} "
                        f"difficulty={difficulty} policy_type={policy.policy_type} checkpoint={policy.checkpoint}",
                        flush=True,
                    )
                    thread = threading.Thread(
                        target=_run_policy_session_guarded,
                        kwargs={
                            "config": config,
                            "player_name": player_name,
                            "robo_name": current_robo,
                            "arena_id": current_arena,
                            "max_steps": max_steps,
                            "wait_timeout_seconds": wait_timeout_seconds,
                            "predictor": predictor,
                            "episode_id": episode_id,
                        },
                        daemon=True,
                    )
                    active_threads[key] = thread
                    thread.start()
            if idle_timeout_seconds is not None and time.monotonic() - start_time >= idle_timeout_seconds:
                return AutoDuelSummary(sessions=sessions, reason="idle_timeout")
            time.sleep(max(0.05, poll_seconds))
    finally:
        plugin.close()
        bot.close()


def ensure_robo_spawned(bot: JsonlClient, *, robo_name: str, arena_id: str, wait_timeout_seconds: float = 30.0) -> bool:
    return ensure_bot_spawned(bot, bot_name=robo_name, arena_id=arena_id, wait_timeout_seconds=wait_timeout_seconds)


def ensure_bot_spawned(bot: JsonlClient, *, bot_name: str, arena_id: str, wait_timeout_seconds: float = 30.0) -> bool:
    if _bot_connected(bot, bot_name):
        return True
    _request(
        bot,
        "spawn",
        bots=[{"agent_id": bot_name, "username": bot_name, "arena_id": arena_id, "role": "learner"}],
    )
    deadline = time.monotonic() + max(0.0, wait_timeout_seconds)
    while time.monotonic() <= deadline:
        if _bot_connected(bot, bot_name):
            return True
        time.sleep(0.25)
    return False


def _bot_connected(bot: JsonlClient, bot_name: str) -> bool:
    status = _request(bot, "status")
    bots = status.get("bots", [])
    if isinstance(bots, list):
        for item in bots:
            if isinstance(item, dict) and str(item.get("agent_id", "")) == bot_name and bool(item.get("connected", False)):
                return True
    return False


def _run_policy_session_guarded(**kwargs: Any) -> None:
    episode_id = str(kwargs.pop("episode_id", ""))
    try:
        summary = run_policy_duel(**kwargs)
        print(
            "PVPRobo auto duel finished "
            f"episode={episode_id} phase={summary.phase} winner={summary.winner} steps={summary.steps} reason={summary.reason}",
            flush=True,
        )
    except Exception as exc:
        print(f"PVPRobo auto duel session failed episode={episode_id} error={exc}", flush=True)
        traceback.print_exc()


def _run_ai_battle_session_guarded(**kwargs: Any) -> None:
    episode_id = str(kwargs.pop("episode_id", ""))
    try:
        summary = run_ai_battle(**kwargs)
        print(
            "PVPRobo AI battle finished "
            f"episode={episode_id} phase={summary.phase} winner={summary.winner} steps={summary.steps} reason={summary.reason}",
            flush=True,
        )
    except Exception as exc:
        print(f"PVPRobo AI battle session failed episode={episode_id} error={exc}", flush=True)
        traceback.print_exc()


def make_policy_predictor(policy: DuelPolicy) -> Callable[[np.ndarray], int]:
    if policy.policy_type == "bc":
        if policy.checkpoint is None:
            raise ValueError(f"BC duel policy '{policy.difficulty}' is missing a checkpoint")
        model, _policy_config = load_bc_policy(policy.checkpoint)
        return lambda obs: predict_action(model, obs)
    if policy.policy_type == "ppo":
        if policy.checkpoint is None:
            raise ValueError(f"PPO duel policy '{policy.difficulty}' is missing a checkpoint")
        try:
            from stable_baselines3 import PPO
        except ImportError as exc:
            raise RuntimeError("Missing stable-baselines3. Run through uv or install python[sb3] to use PPO duel policies.") from exc
        model = PPO.load(str(policy.checkpoint), device="cpu")

        def _predict(obs: np.ndarray) -> int:
            action, _state = model.predict(obs, deterministic=True)
            return int(np.asarray(action).item())

        return _predict
    if policy.policy_type == "scripted":
        policy_id = policy.policy_id or {
            "script_easy": "weak_scripted",
            "script_hard": "curriculum_scripted",
        }.get(policy.difficulty, "")
        scripted = {
            "weak_scripted": WeakScriptedTargetPolicy(seed=0),
            "curriculum_scripted": CurriculumScriptedTargetPolicy(seed=0),
        }.get(policy_id)
        if scripted is None:
            raise ValueError(f"Unsupported scripted duel policy_id: {policy_id}")
        tick = 0

        def _predict(obs: np.ndarray) -> int:
            nonlocal tick
            action = int(scripted.action(obs, {"tick": tick}))
            tick += 1
            return action

        return _predict
    raise ValueError(f"Unsupported duel policy type: {policy.policy_type}")


def _wait_for_duel_snapshot(
    plugin: JsonlClient,
    arena: str,
    robo_name: str,
    player_name: str,
    deadline: float,
) -> dict[str, Any]:
    last_error = ""
    while time.monotonic() < deadline:
        snapshot = _request(plugin, "snapshot_request", arena_id=arena)
        names = {str(player.get("name")) for player in snapshot.get("players", []) if isinstance(player, dict)}
        phase = str(snapshot.get("phase", ""))
        if robo_name in names and player_name in names and phase == "running":
            return snapshot
        last_error = f"phase={phase} players={sorted(names)}"
        time.sleep(0.25)
    raise TimeoutError(f"Timed out waiting for active duel with {robo_name} and {player_name}; last snapshot: {last_error}")


def _summary(snapshot: dict[str, Any], steps: int, fallback_reason: str) -> DuelRunSummary:
    hit_counts = snapshot.get("hit_counts", {})
    if not isinstance(hit_counts, dict):
        hit_counts = {}
    return DuelRunSummary(
        steps=steps,
        phase=str(snapshot.get("phase", "unknown")),
        winner=str(snapshot.get("winner", "")),
        hit_counts={str(key): int(value) for key, value in hit_counts.items()},
        reason=str(snapshot.get("done_reason", fallback_reason)),
    )


def _parse_ai_participants(raw: Any) -> list[tuple[str, str]]:
    participants: list[tuple[str, str]] = []
    if not isinstance(raw, list):
        return participants
    for item in raw:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name", ""))
        difficulty = str(item.get("difficulty", "bc"))
        if name:
            participants.append((name, difficulty))
    return participants


def _request(client: JsonlClient, msg_type: str, **fields):
    message = {"v": PROTOCOL_VERSION, "id": f"duel-{time.time_ns()}", "type": msg_type}
    message.update(fields)
    reply = client.request(message)
    if reply.get("type") == "error":
        raise RuntimeError(reply.get("error", "protocol error"))
    return reply


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a BC policy sidecar for a human-vs-ROBO duel.")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--policy", help="Path to bc_policy.pt. Kept for backwards-compatible BC runs.")
    source.add_argument("--manifest", help="Path to duel-policies.json.")
    parser.add_argument("--difficulty", default="bc", choices=("bc", "ppo_mid", "ppo_high", "script_easy", "script_hard", "champion"))
    parser.add_argument("--config", required=True, help="Path to worker env config JSON.")
    parser.add_argument("--player", default="", help="Minecraft username of the human duel target.")
    parser.add_argument("--robo-name", default="ROBO")
    parser.add_argument("--arena-id", default=None)
    parser.add_argument("--max-steps", type=int, default=None)
    parser.add_argument("--wait-timeout-seconds", type=float, default=120.0)
    parser.add_argument("--auto", action="store_true", help="Run as a daemon and auto-attach to server-started duels.")
    parser.add_argument("--poll-seconds", type=float, default=0.5)
    parser.add_argument("--max-sessions", type=int, default=None)
    parser.add_argument("--idle-timeout-seconds", type=float, default=None)
    args = parser.parse_args()

    config = EnvConfig.from_json(Path(args.config))
    if args.auto:
        if not args.manifest:
            raise SystemExit("--auto requires --manifest so server difficulty labels can resolve to AI policies.")
        summary = run_auto_duel_daemon(
            config,
            args.manifest,
            robo_name=args.robo_name,
            arena_id=args.arena_id,
            poll_seconds=args.poll_seconds,
            wait_timeout_seconds=args.wait_timeout_seconds,
            max_steps=args.max_steps,
            max_sessions=args.max_sessions,
            idle_timeout_seconds=args.idle_timeout_seconds,
        )
        print("PVPRobo auto duel daemon summary")
        print(f"sessions={summary.sessions}")
        print(f"reason={summary.reason}")
        return 0
    if not args.player:
        raise SystemExit("--player is required unless --auto is used.")
    if args.manifest:
        policy = resolve_difficulty(args.manifest, args.difficulty)
    else:
        policy = DuelPolicy(args.difficulty, "bc", Path(args.policy))
    predictor = make_policy_predictor(policy)
    summary = run_policy_duel(
        config,
        player_name=args.player,
        robo_name=args.robo_name,
        arena_id=args.arena_id,
        max_steps=args.max_steps,
        wait_timeout_seconds=args.wait_timeout_seconds,
        predictor=predictor,
    )
    print("PVPRobo duel summary")
    print(f"difficulty={policy.difficulty}")
    print(f"policy_type={policy.policy_type}")
    print(f"checkpoint={policy.checkpoint}")
    print(f"steps={summary.steps}")
    print(f"phase={summary.phase}")
    print(f"winner={summary.winner}")
    print(f"reason={summary.reason}")
    print(f"hit_counts={summary.hit_counts}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
