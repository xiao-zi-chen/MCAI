from __future__ import annotations

import argparse
from pathlib import Path
import json

import numpy as np

from mc_pvp_env.actions import CURRICULUM_ACTIONS, CURRICULUM_ACTION_COUNT
from mc_pvp_env.demo_dataset import load_demo_dataset, load_file_arrays, split_episode_files
from mc_pvp_env.observations import OBSERVATION_FIELDS


def train_behavior_cloning(
    data_dir: str | Path,
    out_dir: str | Path,
    *,
    epochs: int = 20,
    batch_size: int = 256,
    learning_rate: float = 3e-4,
    hidden_size: int = 128,
    val_fraction: float = 0.2,
    seed: int = 123,
) -> dict:
    import torch
    import torch.nn as nn
    from torch.utils.data import DataLoader, TensorDataset

    torch.manual_seed(seed)
    dataset = load_demo_dataset(data_dir)
    train_files, val_files = split_episode_files(dataset, val_fraction=val_fraction, seed=seed)
    train_obs, train_actions = load_file_arrays(dataset, train_files)
    val_obs, val_actions = load_file_arrays(dataset, val_files)

    model = BcMlp(len(OBSERVATION_FIELDS), CURRICULUM_ACTION_COUNT, hidden_size=hidden_size)
    counts = np.bincount(train_actions, minlength=CURRICULUM_ACTION_COUNT).astype(np.float32)
    weights = counts.sum() / np.maximum(counts, 1.0)
    weights = weights / weights.mean()
    criterion = nn.CrossEntropyLoss(weight=torch.as_tensor(weights, dtype=torch.float32))
    optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate)

    train_loader = DataLoader(
        TensorDataset(
            torch.as_tensor(train_obs, dtype=torch.float32),
            torch.as_tensor(train_actions, dtype=torch.long),
        ),
        batch_size=batch_size,
        shuffle=True,
    )
    val_x = torch.as_tensor(val_obs, dtype=torch.float32)
    val_y = torch.as_tensor(val_actions, dtype=torch.long)

    history = []
    for epoch in range(1, epochs + 1):
        model.train()
        train_loss = 0.0
        train_total = 0
        train_correct = 0
        for batch_x, batch_y in train_loader:
            optimizer.zero_grad()
            logits = model(batch_x)
            loss = criterion(logits, batch_y)
            loss.backward()
            optimizer.step()
            train_loss += float(loss.item()) * int(batch_y.numel())
            train_total += int(batch_y.numel())
            train_correct += int((logits.argmax(dim=1) == batch_y).sum().item())

        model.eval()
        with torch.no_grad():
            val_logits = model(val_x)
            val_loss = float(criterion(val_logits, val_y).item())
            val_pred = val_logits.argmax(dim=1)
            val_correct = int((val_pred == val_y).sum().item())
        history.append({
            "epoch": epoch,
            "train_loss": train_loss / max(train_total, 1),
            "train_accuracy": train_correct / max(train_total, 1),
            "val_loss": val_loss,
            "val_accuracy": val_correct / max(int(val_y.numel()), 1),
        })

    model.eval()
    with torch.no_grad():
        train_pred = model(torch.as_tensor(train_obs, dtype=torch.float32)).argmax(dim=1).numpy()
        val_pred = model(val_x).argmax(dim=1).numpy()

    metrics = {
        "epochs": epochs,
        "train_transitions": int(train_obs.shape[0]),
        "val_transitions": int(val_obs.shape[0]),
        "train_episodes": len(train_files),
        "val_episodes": len(val_files),
        "history": history,
        "train_accuracy": float((train_pred == train_actions).mean()),
        "val_accuracy": float((val_pred == val_actions).mean()),
        "action_distribution": np.bincount(train_actions, minlength=CURRICULUM_ACTION_COUNT).astype(int).tolist(),
        "per_action_accuracy": _per_action_accuracy(val_actions, val_pred),
    }

    out_path = Path(out_dir)
    out_path.mkdir(parents=True, exist_ok=True)
    config = {
        "input_size": len(OBSERVATION_FIELDS),
        "hidden_size": hidden_size,
        "action_count": CURRICULUM_ACTION_COUNT,
        "action_names": list(CURRICULUM_ACTIONS),
        "observation_fields": list(OBSERVATION_FIELDS),
        "source_data": str(Path(data_dir)),
    }
    torch.save({"model_state_dict": model.state_dict(), "config": config}, out_path / "bc_policy.pt")
    with (out_path / "bc_config.json").open("w", encoding="utf-8") as handle:
        json.dump(config, handle, indent=2, sort_keys=True)
    with (out_path / "metrics.json").open("w", encoding="utf-8") as handle:
        json.dump(metrics, handle, indent=2, sort_keys=True)
    return metrics


class BcMlp:  # replaced with nn.Module at construction time to keep torch optional at import
    def __new__(cls, input_size: int, action_count: int, hidden_size: int = 128):
        import torch.nn as nn

        return nn.Sequential(
            nn.Linear(input_size, hidden_size),
            nn.ReLU(),
            nn.Linear(hidden_size, hidden_size),
            nn.ReLU(),
            nn.Linear(hidden_size, action_count),
        )


def load_bc_policy(path: str | Path):
    import torch

    checkpoint = torch.load(Path(path), map_location="cpu")
    config = checkpoint["config"]
    model = BcMlp(config["input_size"], config["action_count"], hidden_size=config["hidden_size"])
    model.load_state_dict(checkpoint["model_state_dict"])
    model.eval()
    return model, config


def predict_action(model, obs: np.ndarray) -> int:
    import torch

    with torch.no_grad():
        tensor = torch.as_tensor(np.asarray(obs, dtype=np.float32)[None, :], dtype=torch.float32)
        return int(model(tensor).argmax(dim=1).item())


def _per_action_accuracy(labels: np.ndarray, predictions: np.ndarray) -> list[float | None]:
    values: list[float | None] = []
    for action in range(CURRICULUM_ACTION_COUNT):
        mask = labels == action
        if not np.any(mask):
            values.append(None)
        else:
            values.append(float((predictions[mask] == labels[mask]).mean()))
    return values


def main() -> int:
    parser = argparse.ArgumentParser(description="Train a behavior cloning policy from PVPRobo demonstrations.")
    parser.add_argument("--data", required=True, help="Demo dataset directory.")
    parser.add_argument("--out", required=True, help="Output checkpoint directory.")
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--learning-rate", type=float, default=3e-4)
    parser.add_argument("--hidden-size", type=int, default=128)
    parser.add_argument("--val-fraction", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=123)
    args = parser.parse_args()
    metrics = train_behavior_cloning(
        args.data,
        args.out,
        epochs=args.epochs,
        batch_size=args.batch_size,
        learning_rate=args.learning_rate,
        hidden_size=args.hidden_size,
        val_fraction=args.val_fraction,
        seed=args.seed,
    )
    print("PVPRobo BC training summary")
    print(f"train_transitions={metrics['train_transitions']}")
    print(f"val_transitions={metrics['val_transitions']}")
    print(f"train_accuracy={metrics['train_accuracy']:.6f}")
    print(f"val_accuracy={metrics['val_accuracy']:.6f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
