from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Any


def main() -> int:
    parser = argparse.ArgumentParser(description="Plot PVPRobo PPO training curves from SB3 monitor.csv files.")
    parser.add_argument("--run-dir", required=True, help="PPO run directory containing monitor/monitor.csv.")
    parser.add_argument("--out-dir", default=None, help="Output directory. Defaults to <run-dir>/plots.")
    parser.add_argument("--window", type=int, default=50, help="Rolling mean window in episodes.")
    args = parser.parse_args()

    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError as exc:
        raise SystemExit("Missing matplotlib. Run through scripts\\plot-training-curves.ps1 or install matplotlib.") from exc

    run_dir = Path(args.run_dir)
    monitor_path = run_dir / "monitor" / "monitor.csv"
    if not monitor_path.exists():
        raise FileNotFoundError(f"Missing monitor file: {monitor_path}")
    out_dir = Path(args.out_dir) if args.out_dir else run_dir / "plots"
    out_dir.mkdir(parents=True, exist_ok=True)

    rows = _read_monitor(monitor_path)
    if not rows:
        raise ValueError(f"No completed episodes found in {monitor_path}")
    episodes = list(range(1, len(rows) + 1))
    rewards = [float(row["r"]) for row in rows]
    lengths = [float(row["l"]) for row in rows]
    times = [float(row["t"]) for row in rows]
    reward_roll = _rolling_mean(rewards, args.window)
    length_roll = _rolling_mean(lengths, args.window)

    summary_rows = []
    for index, row in enumerate(rows):
        summary_rows.append({
            "episode": index + 1,
            "reward": rewards[index],
            "episode_length": lengths[index],
            "elapsed_seconds": times[index],
            "reward_rolling_mean": reward_roll[index],
            "length_rolling_mean": length_roll[index],
        })
    csv_path = out_dir / "training_curves.csv"
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(summary_rows[0].keys()))
        writer.writeheader()
        writer.writerows(summary_rows)

    _plot_series(
        out_dir / "reward.png",
        episodes,
        rewards,
        reward_roll,
        "Episode reward",
        "reward",
        args.window,
        plt,
    )
    _plot_series(
        out_dir / "episode_length.png",
        episodes,
        lengths,
        length_roll,
        "Episode length",
        "steps",
        args.window,
        plt,
    )
    metadata = {
        "run_dir": str(run_dir),
        "monitor": str(monitor_path),
        "episodes": len(rows),
        "window": args.window,
        "reward_png": str(out_dir / "reward.png"),
        "episode_length_png": str(out_dir / "episode_length.png"),
        "csv": str(csv_path),
    }
    with (out_dir / "training_curves.json").open("w", encoding="utf-8") as handle:
        json.dump(metadata, handle, indent=2, sort_keys=True)
    print("PVPRobo training curves complete")
    print(f"episodes={len(rows)}")
    print(f"out_dir={out_dir}")
    return 0


def _read_monitor(path: Path) -> list[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as handle:
        lines = [line for line in handle if not line.startswith("#")]
    if not lines:
        return []
    reader = csv.DictReader(lines)
    return [row for row in reader if row.get("r") not in (None, "")]


def _rolling_mean(values: list[float], window: int) -> list[float]:
    window = max(1, int(window))
    result: list[float] = []
    total = 0.0
    for index, value in enumerate(values):
        total += value
        if index >= window:
            total -= values[index - window]
            divisor = window
        else:
            divisor = index + 1
        result.append(total / divisor)
    return result


def _plot_series(path: Path, x_values: list[int], raw: list[float], smooth: list[float], title: str, ylabel: str, window: int, plt: Any) -> None:
    fig, ax = plt.subplots(figsize=(10, 5), dpi=140)
    ax.plot(x_values, raw, color="#9aa3ad", linewidth=0.8, alpha=0.45, label="episode")
    ax.plot(x_values, smooth, color="#1f77b4", linewidth=1.8, label=f"rolling mean ({window})")
    ax.set_title(title)
    ax.set_xlabel("episode")
    ax.set_ylabel(ylabel)
    ax.grid(True, color="#d8dde3", linewidth=0.6, alpha=0.8)
    ax.legend(loc="best")
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


if __name__ == "__main__":
    raise SystemExit(main())
