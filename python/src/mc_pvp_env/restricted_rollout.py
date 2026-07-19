from __future__ import annotations

import argparse
import time
from pathlib import Path
from typing import Iterable

from mc_pvp_env.action_abi import SwordPvPActionV1
from mc_pvp_env.config import EnvConfig
from mc_pvp_env.protocol import JsonlClient
from mc_pvp_env.restricted_client import apply_restricted_action
from mc_pvp_env.restricted_dataset import RestrictedDatasetWriter, RestrictedEpisodeBuffer


def collect_restricted_rollout(
    *,
    bot_client: JsonlClient,
    writer: RestrictedDatasetWriter,
    agent_id: str,
    episode_id: str,
    arena_id: str,
    actions: Iterable[SwordPvPActionV1],
) -> Path:
    buffer = RestrictedEpisodeBuffer(episode_id, arena_id)
    for index, action in enumerate(actions):
        result = apply_restricted_action(
            bot_client=bot_client,
            agent_id=agent_id,
            action=action,
            request_id=f"restricted-rollout-{episode_id}-{index}",
        )
        buffer.append_action_result(
            tick=max(result.executed.execute_tick, result.requested.observation_tick),
            result=result,
            mouse_device_state={},
            action_queue_depth=0,
            reward=0.0,
            terminated=False,
            truncated=False,
        )
    return writer.write_episode(buffer)


def neutral_restricted_actions(count: int, control_step_ticks: int) -> list[SwordPvPActionV1]:
    if count <= 0:
        raise ValueError("count must be positive")
    return [
        SwordPvPActionV1(
            sequence_id=index,
            observation_tick=index * control_step_ticks,
            policy_time_ms=int(time.time() * 1000),
            control_step_ticks=control_step_ticks,
        )
        for index in range(count)
    ]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Collect opt-in restricted action ack records into dataset schema v2.")
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--agent-id", default="ROBO-A0")
    parser.add_argument("--episode-id", default="restricted-0001")
    parser.add_argument("--arena-id", default="arena_0")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--bot-port", type=int, default=25581)
    parser.add_argument("--steps", type=int, default=64)
    parser.add_argument("--control-step-ticks", type=int, default=1)
    parser.add_argument("--backend", choices=("mineflayer", "herobot", "real_client", "robot_emulator", "physical_robot"), default="mineflayer")
    parser.add_argument("--minecraft-version", default="auto")
    parser.add_argument("--server-runtime", default="paper-1.21")
    parser.add_argument("--visual-profile-id", default="none")
    parser.add_argument("--mouse-profile-id", default="mineflayer_default_v1")
    args = parser.parse_args(argv)

    config = EnvConfig(host=args.host, bot_port=args.bot_port)
    writer = RestrictedDatasetWriter(
        args.out_dir,
        config=config,
        backend=args.backend,
        minecraft_version=args.minecraft_version,
        server_runtime=args.server_runtime,
        visual_profile_id=args.visual_profile_id,
        mouse_profile_id=args.mouse_profile_id,
    )
    client = JsonlClient(args.host, args.bot_port, config.request_timeout_seconds, "bot-controller")
    try:
        collect_restricted_rollout(
            bot_client=client,
            writer=writer,
            agent_id=args.agent_id,
            episode_id=args.episode_id,
            arena_id=args.arena_id,
            actions=neutral_restricted_actions(args.steps, args.control_step_ticks),
        )
    finally:
        client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
