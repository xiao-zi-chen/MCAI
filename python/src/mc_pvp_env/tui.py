from __future__ import annotations

import time
from typing import Any


class ArenaTuiCallback:
    def __init__(self, arena_count: int):
        from stable_baselines3.common.callbacks import BaseCallback

        class _Callback(BaseCallback):
            def __init__(self, count: int):
                super().__init__()
                self.count = count
                self.started = time.perf_counter()
                self.snapshots: dict[str, dict[str, Any]] = {}
                self.console = None
                self.live = None

            def _on_training_start(self) -> None:
                from rich.console import Console
                from rich.live import Live

                self.console = Console()
                self.live = Live(_render(self.snapshots, self.num_timesteps, self.started), console=self.console, refresh_per_second=6)
                self.live.start()

            def _on_step(self) -> bool:
                infos = self.locals.get("infos", [])
                for info in infos:
                    snapshot = info.get("snapshot") if isinstance(info, dict) else None
                    if isinstance(snapshot, dict):
                        arena_id = str(snapshot.get("arena_id", f"arena_{len(self.snapshots)}"))
                        self.snapshots[arena_id] = snapshot
                if self.live is not None:
                    self.live.update(_render(self.snapshots, self.num_timesteps, self.started))
                return True

            def _on_training_end(self) -> None:
                if self.live is not None:
                    self.live.stop()

        self.callback = _Callback(arena_count)


def _render(snapshots: dict[str, dict[str, Any]], timesteps: int, started: float):
    from rich.panel import Panel
    from rich.table import Table
    from rich.text import Text

    elapsed = max(time.perf_counter() - started, 1e-6)
    table = Table.grid(expand=True)
    table.add_column(ratio=1)
    header = Text(f"PVPRobo MATRIX // arenas={max(1, len(snapshots))} // timesteps={timesteps} // fps={timesteps / elapsed:.1f}", style="bold bright_green")
    arena_table = Table(expand=True, show_header=True, header_style="bold green", border_style="green")
    for column in ("arena", "phase", "tick", "ROBO", "SCRIPT", "hits", "winner", "reason"):
        arena_table.add_column(column, overflow="fold")
    for arena_id in sorted(snapshots):
        snapshot = snapshots[arena_id]
        players = snapshot.get("players", [])
        names = [str(player.get("name", "")) for player in players if isinstance(player, dict)]
        robo = next((name for name in names if name.startswith("ROBO-")), names[0] if names else "")
        script = next((name for name in names if name.startswith("SCRIPT-") or name.startswith("SCRIPT_")), names[1] if len(names) > 1 else "")
        counts = snapshot.get("hit_counts", {})
        if isinstance(counts, dict):
            hits = f"{counts.get(robo, 0)}:{counts.get(script, 0)}"
        else:
            hits = "0:0"
        arena_table.add_row(
            arena_id,
            str(snapshot.get("phase", "")),
            str(snapshot.get("tick", "")),
            robo,
            script,
            hits,
            str(snapshot.get("winner", "")),
            str(snapshot.get("done_reason", "")),
            style="bright_green" if snapshot.get("phase") == "running" else "green",
        )
    table.add_row(header)
    table.add_row(arena_table)
    return Panel(table, title="[bright_green]ROBO TRAINING UPLINK[/bright_green]", border_style="bright_green")
