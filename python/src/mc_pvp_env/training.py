"""Stable public entry points for training workflows.

This facade keeps algorithm-facing imports stable while implementation modules
remain split by feature.
"""

from mc_pvp_env.collect_demos import main as collect_demos_main
from mc_pvp_env.demo_dataset import DemoDataset, load_demo_dataset
from mc_pvp_env.demo_writer import DemoWriter
from mc_pvp_env.env import MinecraftPvpEnv
from mc_pvp_env.expert import (
    CurriculumScriptedTargetPolicy,
    HeuristicExpertPolicy,
    MovementOnlyTargetPolicy,
    OpponentCurriculumPolicy,
    WeakScriptedTargetPolicy,
    make_opponent_policy,
)
from mc_pvp_env.opponent_pool import (
    PolicyPoolCandidate,
    PolicyPoolSampleOpponentPolicy,
    make_policy_pool_sample_opponent,
)
from mc_pvp_env.policy_pool import load_pool, promote_champion, register_policy, save_pool
from mc_pvp_env.train_bc import main as train_bc_main
from mc_pvp_env.train_ppo import main as train_ppo_main
from mc_pvp_env.vector_env import make_sb3_vec_env

__all__ = [
    "CurriculumScriptedTargetPolicy",
    "DemoDataset",
    "DemoWriter",
    "HeuristicExpertPolicy",
    "MinecraftPvpEnv",
    "MovementOnlyTargetPolicy",
    "OpponentCurriculumPolicy",
    "PolicyPoolCandidate",
    "PolicyPoolSampleOpponentPolicy",
    "WeakScriptedTargetPolicy",
    "collect_demos_main",
    "load_demo_dataset",
    "load_pool",
    "make_opponent_policy",
    "make_policy_pool_sample_opponent",
    "make_sb3_vec_env",
    "promote_champion",
    "register_policy",
    "save_pool",
    "train_bc_main",
    "train_ppo_main",
]
