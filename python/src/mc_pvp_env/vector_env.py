from __future__ import annotations

from mc_pvp_env.config import EnvConfig
from mc_pvp_env.env import MinecraftPvpEnv
from mc_pvp_env.expert import make_opponent_policy


def make_sb3_vec_env(
    config: EnvConfig,
    *,
    opponent_policy: str = "neutral",
    seed: int = 0,
    opponent_curriculum_steps: tuple[int, int] = (5_000, 15_000),
    policy_pool_manifest: str | None = None,
    policy_pool_weights: tuple[float, float, float] = (0.5, 0.3, 0.2),
):
    from stable_baselines3.common.vec_env import DummyVecEnv

    arena_count = max(1, int(config.arena_count))
    shared_step_counter = {"calls": 0}

    def make_one(index: int):
        def _factory():
            policy = make_opponent_policy(
                opponent_policy,
                seed=seed + index,
                curriculum_steps=opponent_curriculum_steps,
                shared_step_counter=shared_step_counter,
                policy_pool_manifest=policy_pool_manifest,
                policy_pool_weights=policy_pool_weights,
            )
            return MinecraftPvpEnv(config=config.for_arena(index), opponent_policy=policy)

        return _factory

    return DummyVecEnv([make_one(index) for index in range(arena_count)])
