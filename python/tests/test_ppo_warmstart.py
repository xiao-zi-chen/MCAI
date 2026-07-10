import tempfile
import unittest
from pathlib import Path

from mc_pvp_env.actions import CURRICULUM_ACTION_COUNT
from mc_pvp_env.observations import OBSERVATION_FIELDS
from mc_pvp_env.ppo_warmstart import (
    policy_kwargs_from_bc_checkpoint,
    warm_start_ppo_from_bc,
)


class PpoWarmStartTests(unittest.TestCase):
    def test_policy_kwargs_match_bc_hidden_size(self):
        torch = _require_torch()
        checkpoint_path = _write_bc_checkpoint(torch, hidden_size=32)
        kwargs, config = policy_kwargs_from_bc_checkpoint(checkpoint_path)
        self.assertEqual(config["hidden_size"], 32)
        self.assertEqual(kwargs["net_arch"]["pi"], [32, 32])
        self.assertEqual(kwargs["net_arch"]["vf"], [32, 32])

    def test_warm_start_copies_policy_and_action_layers(self):
        torch = _require_torch()
        checkpoint_path = _write_bc_checkpoint(torch, hidden_size=16)
        fake_model = _FakePpoModel(torch, hidden_size=16)
        checkpoint = torch.load(checkpoint_path, map_location="cpu")

        metadata = warm_start_ppo_from_bc(fake_model, checkpoint_path)

        state = checkpoint["model_state_dict"]
        self.assertEqual(metadata["bc_hidden_size"], 16)
        self.assertTrue(torch.equal(fake_model.policy.mlp_extractor.policy_net[0].weight, state["0.weight"]))
        self.assertTrue(torch.equal(fake_model.policy.mlp_extractor.policy_net[0].bias, state["0.bias"]))
        self.assertTrue(torch.equal(fake_model.policy.mlp_extractor.policy_net[2].weight, state["2.weight"]))
        self.assertTrue(torch.equal(fake_model.policy.mlp_extractor.policy_net[2].bias, state["2.bias"]))
        self.assertTrue(torch.equal(fake_model.policy.action_net.weight, state["4.weight"]))
        self.assertTrue(torch.equal(fake_model.policy.action_net.bias, state["4.bias"]))


class _FakePpoModel:
    def __init__(self, torch, hidden_size: int):
        import torch.nn as nn

        class MlpExtractor:
            def __init__(self):
                self.policy_net = nn.Sequential(
                    nn.Linear(len(OBSERVATION_FIELDS), hidden_size),
                    nn.ReLU(),
                    nn.Linear(hidden_size, hidden_size),
                    nn.ReLU(),
                )

        class Policy:
            def __init__(self):
                self.mlp_extractor = MlpExtractor()
                self.action_net = nn.Linear(hidden_size, CURRICULUM_ACTION_COUNT)

        self.policy = Policy()


def _write_bc_checkpoint(torch, hidden_size: int) -> Path:
    import torch.nn as nn

    model = nn.Sequential(
        nn.Linear(len(OBSERVATION_FIELDS), hidden_size),
        nn.ReLU(),
        nn.Linear(hidden_size, hidden_size),
        nn.ReLU(),
        nn.Linear(hidden_size, CURRICULUM_ACTION_COUNT),
    )
    for index, parameter in enumerate(model.parameters()):
        parameter.data.fill_(float(index + 1))
    temp_dir = Path(tempfile.mkdtemp())
    path = temp_dir / "bc_policy.pt"
    torch.save({
        "model_state_dict": model.state_dict(),
        "config": {
            "input_size": len(OBSERVATION_FIELDS),
            "hidden_size": hidden_size,
            "action_count": CURRICULUM_ACTION_COUNT,
            "observation_fields": list(OBSERVATION_FIELDS),
        },
    }, path)
    return path


def _require_torch():
    try:
        import torch
    except ImportError as exc:
        raise unittest.SkipTest("torch is not installed") from exc
    return torch


if __name__ == "__main__":
    unittest.main()
