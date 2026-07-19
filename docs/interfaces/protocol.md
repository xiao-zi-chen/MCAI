# 通信协议

PVPRobo 热循环使用持久 localhost TCP JSON Lines。

```text
host: 127.0.0.1
format: one JSON object per line
required request fields: v, id, type
current v: 1
```

热循环不能使用每步 HTTP。

## Plugin control

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

Duel helpers：

```json
{"v":1,"id":"d-1","type":"start_ai_battle","left_difficulty":"champion","right_difficulty":"script_hard","target_hits":2}
{"v":1,"id":"d-2","type":"duel_participants_ready","arena_id":"arena_0","episode_id":"ai-battle-123"}
{"v":1,"id":"d-3","type":"stop_duel"}
```

`status` 返回 `duel` 和 `duels`。`duels` 是玩家可见 session 列表的权威来源；`duel` 保留为兼容 alias。

## Bot controller

```json
{"v":1,"id":"b-1","type":"hello","role":"python-env"}
{"v":1,"id":"b-2","type":"spawn","bots":[{"agent_id":"ROBO-A0","username":"ROBO-A0","arena_id":"arena_0","role":"learner"}]}
{"v":1,"id":"b-3","type":"status"}
{"v":1,"id":"b-4","type":"act","tick":0,"arena_id":"arena_0","repeat_ticks":2,"actions":{"ROBO-A0":[1,0,0,0,0,1,0,1,0,0,3,2,0]}}
{"v":1,"id":"b-5","type":"apply_action","agent_id":"ROBO-A0","target_username":"SCRIPT-A0","repeat_ticks":2,"action":[1,0,0,0,0,1,0,1,0,0,3,2,0]}
{"v":1,"id":"b-6","type":"apply_restricted_action","agent_id":"ROBO-A0","action":{"abi_version":"SwordPvPActionV1","sequence_id":1,"observation_tick":100,"policy_time_ms":123456,"control_step_ticks":1,"move_forward":1,"move_strafe":-1,"jump_hold":false,"sprint_hold":true,"sneak_hold":false,"attack_pulse":true,"use_pulse":false,"mouse_dx":4,"mouse_dy":-2,"recenter_request":false,"recenter_target_x":0,"recenter_target_y":0}}
{"v":1,"id":"b-7","type":"clear_controls","agent_id":"ROBO-A0"}
{"v":1,"id":"b-8","type":"despawn","agent_ids":["ROBO_D0","SCRIPT_H0"]}
```

`despawn` 只清理指定 bot runtime；`disconnect` 是 full-controller shutdown。

`bot_backend` 是 controller 配置项，不是热循环消息字段。当前支持值：

```text
mineflayer   当前生产 backend
herobot      HeRoBot/Fabric worker 预留 backend；当前仅有命令 transport 适配切片
```

`scripted_opponent` 当前支持 `none`、`random`、`controller_pvp`。旧配置值 `mineflayer_pvp` 会在 controller 配置入口归一为 `controller_pvp`。

`duel.bot-combat-backend` 是 server-plugin 配置项，用于决定 bot 名字命中的攻击是否还运行过渡期合成几何校验。默认值为 `mineflayer`，因此现有 worker1/Mineflayer 路径保持原行为。HeRoBot/Fabric 或未来真实客户端 lineage 应显式设置为 `herobot`、`real_client` 等非 Mineflayer 值，让攻击命中注册回到原生 damage event 和 MONITOR positive final damage 计分。

hit-count duel reset 不再通过 server-plugin 配置给双方发默认武器；AI Battle 或其他 combat mode 若需要装备，应由对应模式自己的装备流程处理。

Snapshot `events` 可能包含 `damage_ignored:<reason>:...` 诊断事件，用于解释 Paper damage event 为什么没有增加 hit-count。该字段仍是调试事件流，不改变协议请求/响应结构。

受限鼠标执行使用 controller 配置中的 `restricted_mouse_profile`。现有配置文件可以不写该字段，默认值为：

```json
{"id":"mineflayer_default_v1","radians_per_count":0.0025,"max_dx_per_step":64,"max_dy_per_step":64}
```

如果自定义该字段，JSON key 使用 snake_case；TypeScript runtime 内部字段名使用 camelCase。

## Action vector

当前 action vector 是 legacy 训练接口，保留用于 Mineflayer BC/PPO 和现有 champion 兼容。

```text
[forward, back, left, right, jump, sprint, sneak, attack, use, hotbar_slot, yaw_delta_bin, pitch_delta_bin, look_primitive]
```

Binary fields 为 `0/1`；`hotbar_slot` 是 `0..8`；`yaw_delta_bin` 是 `0..6`，中心为 `3`；`pitch_delta_bin` 是 `0..4`，中心为 `2`；`look_primitive` 为 `0` none、`1` head、`2` body、`3` feet。

`look_primitive` 会让 controller/backend 自动选择或对准目标，因此只能用于 legacy 数据和 legacy policy。未来受限动作协议必须使用 [action-abi.md](action-abi.md) 中的 `SwordPvPActionV1` 和 `VirtualHIDFrameV1`，并记录 requested/executed 差异。受限协议不得接受 `target_username`、entity id、lookAt、绝对 yaw/pitch 或自动攻击目标字段。

`apply_restricted_action` 是 opt-in protocol v1 extension。它不接受 `target_username`、entity id、target id、`look_primitive`、`lookAt`、绝对 yaw/pitch 或 `attack_entity`。这些字段出现在顶层或 `action` 内都会被拒绝。该路径使用 `action.control_step_ticks`，不读取 legacy `repeat_ticks`。

成功 ack 会回传 normalized requested/executed 记录：

```json
{
  "v": 1,
  "id": "b-6",
  "type": "apply_restricted_action_ack",
  "accepted": true,
  "action_requested": {"abi_version": "SwordPvPActionV1", "sequence_id": 1},
  "action_executed": {"abi_version": "VirtualHIDFrameV1", "source_sequence_id": 1, "status": "executed"},
  "action_execution_status": "executed",
  "action_execution_status_reasons": []
}
```

`action_requested` 和 `action_executed` 在实际响应中是完整 normalized object；上例只展示关键字段。`act` / `apply_action` 仍是 legacy action vector 路径，行为保持不变。

Python 可通过 `mc_pvp_env.restricted_client.apply_restricted_action` 显式发送该消息并解码 ack。该 helper 不改变 `MinecraftPvpEnv.step`、`step_pair`、BC/PPO 或默认 action mode。

## Monitoring HTTP

```text
GET /
GET /api/summary
GET /api/player-history
GET /api/recordings
GET /api/status
```

监控 HTTP 是只读 operator/dashboard 接口，不属于训练热循环。如果配置 `monitoring.auth-token`，客户端必须通过 `X-PVPRobo-Token` 或 `?token=...` 传入。
