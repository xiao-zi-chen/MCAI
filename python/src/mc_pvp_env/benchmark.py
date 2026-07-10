"""Stable public entry points for evaluation and benchmark workflows."""

from mc_pvp_env.eval_league import (
    LeagueCandidate,
    LeaguePolicy,
    evaluate_league,
    load_league_manifest,
    main as eval_league_main,
    write_league_outputs,
)
from mc_pvp_env.eval_policy import main as eval_policy_main
from mc_pvp_env.eval_ppo import main as eval_ppo_main
from mc_pvp_env.eval_ppo_matrix import main as eval_ppo_matrix_main
from mc_pvp_env.plot_training_curves import main as plot_training_curves_main

__all__ = [
    "LeagueCandidate",
    "LeaguePolicy",
    "eval_league_main",
    "eval_policy_main",
    "eval_ppo_main",
    "eval_ppo_matrix_main",
    "evaluate_league",
    "load_league_manifest",
    "plot_training_curves_main",
    "write_league_outputs",
]
