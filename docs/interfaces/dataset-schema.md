# Dataset Schema

PVPRobo currently has legacy demo datasets and duel records. Restricted keyboard/mouse datasets are planned as a versioned extension, not as a reinterpretation of old data.

## Demo schema v1

Current BC demo files use `DEMO_SCHEMA_VERSION=1` and store one `.npz` per episode plus `manifest.json`.

Episode arrays:

```text
obs
action
action_vector
next_obs
reward
terminated
truncated
tick
arena_id
episode_id
```

The manifest records observation fields, curriculum action names, action count, policy names, env config, seed, git commit, and episode list.

v1 means legacy curriculum/Mineflayer data. It does not prove that actions came from a real keyboard/mouse path.

## Duel record schema v1

Duel records are documented in [duel-records.md](duel-records.md). They include `action_vector`, `action_id`, and `action_source`, with human actions inferred from server state in v1.

## Restricted dataset schema v2

The first active v2 implementation is in `python/src/mc_pvp_env/restricted_dataset.py`. It uses one JSONL episode file per episode plus `manifest.json`.

Restricted datasets must add explicit action execution records. Minimum required metadata:

```text
schema_version: 2
action_abi_version: "SwordPvPActionV1"
executed_action_abi_version: "VirtualHIDFrameV1"
backend: "mineflayer" | "herobot" | "real_client" | "robot_emulator" | "physical_robot"
minecraft_version
server_runtime
visual_profile_id
mouse_profile_id
env_config
git_commit
episodes
```

Minimum per-step JSONL fields:

```text
tick
observation_tick
policy_time_ms
action_requested
action_executed
action_execution_status
action_execution_status_reasons
mouse_device_state
action_queue_depth
reward
terminated
truncated
episode_id
arena_id
```

Required compatibility behavior:

- v1 loaders must continue to read existing demo datasets.
- v2 loaders must reject missing `action_requested`, `action_executed`, or `backend`.
- Old `LegacyActionVectorV1` data must be clearly labeled as legacy and must not be silently promoted to `SwordPvPActionV1`.
- BC defaults stay on v1 curriculum data until a later opt-in loader is implemented.

Current status: `bot-controller` exposes `action_requested`, `action_executed`, `action_execution_status`, and `action_execution_status_reasons` in the `apply_restricted_action` ack. The v2 writer/loader can persist those records as JSONL, but demo schema v1 remains the default BC/PPO data path.

`RestrictedEpisodeBuffer.append_action_result(...)` records a decoded `mc_pvp_env.restricted_client.RestrictedActionResult` without dropping requested/executed/status fields. `python -m mc_pvp_env.restricted_rollout` uses that path as an explicit smoke/collection command for restricted acks; it is not a BC/PPO training loader.

Planned phase 15 adds an explicit restricted BC loader. Its default target is `action_executed`, because this is the action that survived backend clipping, delay, queueing, recenter state, or device constraints. `action_requested` must still be loaded and reported for diagnostics so the project can measure requested/executed divergence. The loader must not accept demo schema v1 as restricted action data.

## Profile identifiers

`visual_profile_id` and `mouse_profile_id` may initially point to documented profile names instead of large profile objects. The default mouse profile id is `mineflayer_default_v1`; the full profile can be stored in the manifest once visual capture and mouse workspace emulation become active.

Phase 16 should populate `mouse_device_state` with real workspace/recenter values. Until that phase lands, empty `{}` mouse state in smoke datasets means "not modeled yet", not "mouse workspace verified".
