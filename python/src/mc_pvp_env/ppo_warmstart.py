from __future__ import annotations

from pathlib import Path
from typing import Any

from mc_pvp_env.actions import CURRICULUM_ACTION_COUNT
from mc_pvp_env.observations import OBSERVATION_FIELDS


def load_bc_checkpoint(path: str | Path) -> tuple[dict[str, Any], dict[str, Any]]:
    import torch

    checkpoint = torch.load(Path(path), map_location="cpu")
    if not isinstance(checkpoint, dict):
        raise ValueError("BC checkpoint must be a dictionary")
    config = checkpoint.get("config")
    state_dict = checkpoint.get("model_state_dict")
    if not isinstance(config, dict) or not isinstance(state_dict, dict):
        raise ValueError("BC checkpoint must contain config and model_state_dict")
    validate_bc_config(config)
    return config, state_dict


def validate_bc_config(config: dict[str, Any]) -> None:
    input_size = int(config.get("input_size", -1))
    action_count = int(config.get("action_count", -1))
    hidden_size = int(config.get("hidden_size", -1))
    fields = list(config.get("observation_fields", []))
    if input_size != len(OBSERVATION_FIELDS):
        raise ValueError(f"BC input_size {input_size} does not match observation size {len(OBSERVATION_FIELDS)}")
    if action_count != CURRICULUM_ACTION_COUNT:
        raise ValueError(f"BC action_count {action_count} does not match curriculum action count {CURRICULUM_ACTION_COUNT}")
    if fields != list(OBSERVATION_FIELDS):
        raise ValueError("BC observation_fields do not match current observation contract")
    if hidden_size <= 0:
        raise ValueError("BC hidden_size must be positive")


def policy_kwargs_for_hidden_size(hidden_size: int) -> dict[str, Any]:
    import torch.nn as nn

    hidden = int(hidden_size)
    if hidden <= 0:
        raise ValueError("policy hidden size must be positive")
    return {
        "activation_fn": nn.ReLU,
        "net_arch": {
            "pi": [hidden, hidden],
            "vf": [hidden, hidden],
        },
    }


def policy_kwargs_from_bc_checkpoint(path: str | Path) -> tuple[dict[str, Any], dict[str, Any]]:
    config, _state_dict = load_bc_checkpoint(path)
    return policy_kwargs_for_hidden_size(int(config["hidden_size"])), config


def warm_start_ppo_from_bc(model: Any, checkpoint_path: str | Path) -> dict[str, Any]:
    import torch
    import torch.nn as nn

    config, state_dict = load_bc_checkpoint(checkpoint_path)
    policy_net = model.policy.mlp_extractor.policy_net
    policy_linears = [module for module in policy_net if isinstance(module, nn.Linear)]
    if len(policy_linears) < 2:
        raise ValueError("SB3 policy_net must expose at least two Linear layers")
    action_net = model.policy.action_net
    if not isinstance(action_net, nn.Linear):
        raise ValueError("SB3 action_net must be a Linear layer")

    mapping = [
        (policy_linears[0].weight, state_dict["0.weight"], "policy_net.0.weight"),
        (policy_linears[0].bias, state_dict["0.bias"], "policy_net.0.bias"),
        (policy_linears[1].weight, state_dict["2.weight"], "policy_net.2.weight"),
        (policy_linears[1].bias, state_dict["2.bias"], "policy_net.2.bias"),
        (action_net.weight, state_dict["4.weight"], "action_net.weight"),
        (action_net.bias, state_dict["4.bias"], "action_net.bias"),
    ]
    copied: list[str] = []
    with torch.no_grad():
        for target, source, name in mapping:
            source_tensor = source.detach().to(device=target.device, dtype=target.dtype)
            if tuple(target.shape) != tuple(source_tensor.shape):
                raise ValueError(f"Shape mismatch for {name}: SB3 {tuple(target.shape)} vs BC {tuple(source_tensor.shape)}")
            target.copy_(source_tensor)
            copied.append(name)

    return {
        "bc_checkpoint": str(Path(checkpoint_path)),
        "bc_hidden_size": int(config["hidden_size"]),
        "copied_tensors": copied,
        "value_net_initialized": "random",
    }
