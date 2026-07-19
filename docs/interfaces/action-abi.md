# Action ABI

This file defines action contracts for PVPRobo backend migration. Legacy interfaces remain stable; new restricted interfaces are opt-in until a later phase wires them into the bot-controller hot loop.

Schema-only code exists in:

- `python/src/mc_pvp_env/action_abi.py`
- `python/src/mc_pvp_env/action_codec.py`
- `bot-controller/src/actionAbi.ts`

Phase 2 wires `SwordPvPActionV1` into the bot-controller as the opt-in `apply_restricted_action` protocol path. This does not change `MinecraftPvpEnv`, legacy `act`, legacy `apply_action`, Mineflayer BC/PPO checkpoints, or worker1 defaults. Python support is explicit opt-in through schema/codec helpers plus a restricted client helper; the default Gym action path is still legacy.

## Compatibility rule

`LegacyActionVectorV1` must keep its existing field order and semantics. Do not reinterpret old Mineflayer datasets, BC checkpoints, PPO checkpoints, or duel records as restricted keyboard/mouse data.

New datasets that claim restricted action labels must explicitly record:

- `action_abi_version`
- `action_requested`
- `action_executed`
- `action_execution_status`
- `backend`
- `minecraft_version`
- `mouse_profile_id`
- `visual_profile_id`

## LegacyActionVectorV1

Legacy vector:

```text
[forward, back, left, right, jump, sprint, sneak, attack, use, hotbar_slot, yaw_delta_bin, pitch_delta_bin, look_primitive]
```

This vector is still the default Gym action path. `look_primitive` may make the backend aim at an enemy head/body/feet target, so it is not allowed in future real keyboard/mouse policies.

## SwordPvPActionV1

`SwordPvPActionV1` is the task-level policy output for restricted sword PvP. It describes intent, not guaranteed execution.

Required fields:

```text
abi_version: "SwordPvPActionV1"
sequence_id: integer >= 0
observation_tick: integer >= 0
observation_time_ms: integer >= 0
policy_time_ms: integer >= 0
control_step_ticks: integer >= 1
move_forward: -1 | 0 | 1
move_strafe: -1 | 0 | 1
jump_hold: bool
sprint_hold: bool
sneak_hold: bool
attack_pulse: bool
use_pulse: bool
mouse_dx: bounded integer relative mouse count
mouse_dy: bounded integer relative mouse count
recenter_request: bool
recenter_target_x: normalized float in [-1.0, 1.0]
recenter_target_y: normalized float in [-1.0, 1.0]
```

Movement signs:

- `move_forward=+1`: hold forward.
- `move_forward=-1`: hold back.
- `move_strafe=-1`: hold left.
- `move_strafe=+1`: hold right.

Forbidden in this ABI:

- entity id or target id
- `attack(entity)`
- `lookAt(enemy)`
- automatic target selection
- absolute yaw or pitch
- backend-side click timing helpers such as combo, auto aim, W-tap, critical attack, or attack-when-ready

## VirtualHIDFrameV1

`VirtualHIDFrameV1` is the backend/device execution description. It records what the runtime attempted after rate limits, queues, mouse workspace limits, and recenter state are applied.

Required fields:

```text
abi_version: "VirtualHIDFrameV1"
sequence_id: integer >= 0
source_sequence_id: integer >= 0
execute_tick: integer >= 0
execute_time_ms: integer >= 0
control_step_ticks: integer >= 1
keys: object with forward/back/left/right/jump/sprint/sneak booleans
mouse_buttons: object with attack/use booleans
mouse_dx: integer executed relative count
mouse_dy: integer executed relative count
wheel_dy: integer
recenter: object with requested/busy/phase/target_x/target_y
status: "executed" | "clipped" | "delayed" | "dropped" | "modified"
status_reasons: list of strings
```

`action_requested` and `action_executed` must both be recorded when a restricted policy is used. Training may choose to imitate executed actions, but it must not lose the requested action.

## Initial defaults

- Default restricted control frequency: 20 Hz.
- Legacy `action_repeat_ticks=2` remains unchanged until a later migration stage.
- `mouse_dx` and `mouse_dy` limits are profile-driven; no real hardware radius is hard-coded.
- Default bot-controller restricted mouse profile id is `mineflayer_default_v1`.
- Default Mineflayer restricted mouse scale is `0.0025` radians per mouse count, with max `64` counts per axis per control step.
- If the requested mouse counts exceed the active profile workspace, execution clips the counts and returns status `clipped` with `mouse_dx_clipped` and/or `mouse_dy_clipped`.
- Recenter has time cost and exposes `recenter_busy`; it is never an instant teleport.

## Bot-controller restricted execution v1

The restricted bot-controller path converts `SwordPvPActionV1` into `VirtualHIDFrameV1` before touching a backend.

- Mineflayer restricted execution sets keyboard state, applies relative yaw/pitch through `bot.look(current + delta)`, and uses attack/use pulses only when they can be expressed without targeting an entity.
- HeRoBot restricted execution emits relative look commands only, for example `player ROBO-A0 look relative ~4 ~-2`; it must not emit `look upon`. Its restricted `attack_pulse` maps to `player <bot> attack once`, not `attack continuous`, so the command remains click-like for entity combat.
- If an attack pulse cannot be represented safely without target/entity semantics, execution returns a non-`executed` status with a reason instead of falling back to `attack(entity)`.

## Python opt-in restricted client

`python/src/mc_pvp_env/restricted_client.py` provides `apply_restricted_action(...)`, which sends an `apply_restricted_action` JSONL request and decodes the ack into requested/executed/status objects. It is not called by `MinecraftPvpEnv.step`, `step_pair`, BC, PPO, champion, or worker1 defaults.

`python -m mc_pvp_env.restricted_rollout` is an opt-in collection helper for neutral restricted action smoke/ack capture. It writes restricted dataset schema v2 rows from `apply_restricted_action` acks and does not alter the default Gym or training paths.

## Migration phases

Phase 11 freezes the ABI and smoke path only. Phase 14 has added lineage-safe worker0 short eval so Paper/Mineflayer and Fabric/HeRoBot results stay separated. The next planned steps are:

- Phase 15: add an explicit restricted dataset v2 BC loader. The default supervised label is `action_executed`; `action_requested` remains available for diagnostics and optional auxiliary losses.
- Phase 16: implement MouseWorkspaceModel, ActionQueue, and non-instant recenter semantics. Until then, recenter fields are schema-compatible but not verified hardware behavior.

These phases must not reinterpret `LegacyActionVectorV1`, change `MinecraftPvpEnv.step()`, or switch worker1 away from Mineflayer.
