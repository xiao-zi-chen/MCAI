# Protocol

Transport is persistent localhost TCP JSON Lines:

- Host defaults to `127.0.0.1`.
- One JSON object per line.
- Every request has `v`, `id`, and `type`.
- Current `v` is `1`.
- Hot loop must not use HTTP per step.

## Plugin Control

Common requests:

```json
{"v":1,"id":"p-1","type":"hello","role":"python-env"}
{"v":1,"id":"p-2","type":"status"}
{"v":1,"id":"p-3","type":"register_players","arena_id":"arena_0","players":["ROBO-A0","SCRIPT-A0"]}
{"v":1,"id":"p-4","type":"reset","episode_id":"ep-0001","seed":123,"arena_id":"arena_0","combat_mode":"hit_count","target_hits":50}
{"v":1,"id":"p-5","type":"start_episode","episode_id":"ep-0001","arena_id":"arena_0"}
{"v":1,"id":"p-6","type":"observe","arena_id":"arena_0"}
{"v":1,"id":"p-7","type":"wait_tick","arena_id":"arena_0","after_tick":20}
{"v":1,"id":"p-8","type":"done","arena_id":"arena_0"}
```

Duel control helpers:

```json
{"v":1,"id":"d-1","type":"start_ai_battle","left_difficulty":"champion","right_difficulty":"script_hard","target_hits":2}
{"v":1,"id":"d-2","type":"duel_participants_ready","arena_id":"arena_0","episode_id":"ai-battle-123"}
{"v":1,"id":"d-3","type":"stop_duel"}
```

`status` returns `duel` and `duels`. Today `duel` is the primary singleton state and `duels` contains the same single object. For the planned six-arena player-facing server, `duels` becomes the authoritative session list while `duel` remains a compatibility alias for the oldest active or first active session.

Important duel fields:

```text
active
mode: player_duel | ai_battle
arena_id
player
robo
difficulty
difficulty_name
participants
viewers
target_hits
phase
winner
episode_id
hit_counts
```

`phase="loading"` means the daemon must spawn required AI accounts, verify bot-controller `connected=true`, then send `duel_participants_ready`. The plugin rechecks online participants before resetting the arena and starting countdown.

Backward-compatible aliases:

- `snapshot_request` is equivalent to `observe`.
- `tick_snapshot` is equivalent to `wait_tick`.

## Bot Controller

Common requests:

```json
{"v":1,"id":"b-1","type":"hello","role":"python-env"}
{"v":1,"id":"b-2","type":"spawn","bots":[{"agent_id":"ROBO-A0","username":"ROBO-A0","arena_id":"arena_0","role":"learner"}]}
{"v":1,"id":"b-3","type":"status"}
{"v":1,"id":"b-4","type":"act","tick":0,"arena_id":"arena_0","repeat_ticks":2,"actions":{"ROBO-A0":[1,0,0,0,0,1,0,1,0,0,3,2,0]}}
{"v":1,"id":"b-5","type":"apply_action","agent_id":"ROBO-A0","target_username":"SCRIPT-A0","repeat_ticks":2,"action":[1,0,0,0,0,1,0,1,0,0,3,2,0]}
{"v":1,"id":"b-6","type":"clear_controls","agent_id":"ROBO-A0"}
{"v":1,"id":"b-7","type":"despawn","agent_ids":["ROBO_D0","SCRIPT_H0"]}
```

`despawn` cleanly ends selected Mineflayer runtimes while keeping the controller and other bots online. The duel daemon uses it for temporary AI Battle participants. `disconnect` remains full-controller shutdown.

Bot-controller `scripted_opponent` modes:

- `none`: Python controls all action vectors.
- `random`: random legal actions for scripted-role bots.
- `mineflayer_pvp`: private local autonomous PvP loop for scripted-role bots.

## Action Vector

```text
[forward, back, left, right, jump, sprint, sneak, attack, use, hotbar_slot, yaw_delta_bin, pitch_delta_bin, look_primitive]
```

Bounds:

- Binary fields: `0` or `1`.
- `hotbar_slot`: `0..8`.
- `yaw_delta_bin`: `0..6`, center/no-op `3`.
- `pitch_delta_bin`: `0..4`, center/no-op `2`.
- `look_primitive`: `0` none, `1` enemy head, `2` enemy body, `3` enemy feet.

## Snapshot Shape

Snapshots are rich control/debug messages and are flattened before reaching the main Gymnasium observation:

```json
{
  "arena_id": "arena_0",
  "tick": 12,
  "phase": "running",
  "combat_mode": "hit_count",
  "target_hits": 50,
  "hit_counts": {"ROBO-A0": 2, "SCRIPT-A0": 1},
  "hit_deltas": {"ROBO-A0": 1, "SCRIPT-A0": 0},
  "last_hitter": "ROBO-A0",
  "winner": "",
  "done_reason": "running",
  "players": [
    {"name":"ROBO-A0","hp":20.0,"pos":[-1.0,64.0,0.0],"vel":[0.0,0.0,0.0],"yaw":90.0,"pitch":0.0,"attack_cooldown":1.0,"hurt_time":0.0,"on_ground":true,"line_of_sight":true}
  ],
  "events": []
}
```

Hit-count semantics:

- Only registered players count.
- Configured spectators never count as attackers, victims, targets, or episode participants.
- First registered player to reach `target_hits` wins.
- Timeouts remain truncations/draws according to Python env configuration.

## Arena IDs

Single-worker multi-arena uses stable IDs:

```text
arena_0
arena_1
arena_2
...
```

`arena_id` is preferred on hot-path messages. `default` is treated as `arena_0` for compatibility.

Player-facing multi-duel arena ids should stay stable and distinct from training ids, for example `duel_0` through `duel_5`. Daemons should not assume only one active duel once `status.duels` returns more than one element.
