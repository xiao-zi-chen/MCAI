"""Stable public entry points for local duel and AI Battle workflows."""

from mc_pvp_env.duel_policy_manifest import (
    DuelPolicy,
    load_manifest,
    main as duel_policy_manifest_main,
    register_difficulty,
    resolve_difficulty,
)
from mc_pvp_env.duel_runner import (
    AutoDuelSummary,
    DuelRunSummary,
    main as duel_runner_main,
    make_policy_predictor,
    run_ai_battle,
    run_auto_duel_daemon,
    run_bc_duel,
    run_policy_duel,
)

__all__ = [
    "AutoDuelSummary",
    "DuelPolicy",
    "DuelRunSummary",
    "duel_policy_manifest_main",
    "duel_runner_main",
    "load_manifest",
    "make_policy_predictor",
    "register_difficulty",
    "resolve_difficulty",
    "run_ai_battle",
    "run_auto_duel_daemon",
    "run_bc_duel",
    "run_policy_duel",
]
