# PVPRobo Server Plugin

Paper plugin for the private local no-render PvP RL environment.

The plugin exposes a localhost-only persistent TCP JSONL control server. Network threads never touch Bukkit world or player state directly; all reads and mutations go through main-thread scheduling.

Episode state is isolated per `arena_id` through an arena registry. Hot-path control messages accept `arena_id`, snapshots include `arena_id`, and `default` remains an alias for `arena_0`.

Build from the repository root:

```powershell
.\scripts\build-plugin.ps1
```

The plugin jar is produced under `server-plugin\build\libs\`.
