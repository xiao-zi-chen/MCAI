# Duel 轨迹记录契约

PowerShell duel runner wrappers 默认写入每局轨迹记录。worker1 默认目录：`runs\worker_001\duel-records`。热循环期间记录缓存在内存中，session 结束后一次性写盘。

## 文件

每个 episode 生成：`<episode_id>.npz`、`<episode_id>.jsonl`、`manifest.json`。

## Schema v1 arrays

```text
tick [T]
actor_names [N]
actor_roles [N]
obs [T,N,F]
next_obs [T,N,F]
state [T,N,S]
action_vector [T,N,13]
action_id [T,N]
action_source [T,N]
reward [T,N]
terminated [T]
truncated [T]
```

`state` 字段顺序由 manifest `state_fields` 固定，包含 hp、max hp、position、velocity、yaw、pitch、attack cooldown、hurt time、on-ground、line-of-sight、sprinting、sneaking、selected hotbar slot 和 food level。

人类玩家动作在 v1 中由服务器状态推断，`action_source="human_inferred"`。未来 raw keyboard/mouse capture 应填充 sidecar `raw_input`，不改变主 Gym API。

真实玩家记录是私有研究数据，不要提交 `.npz`、`.jsonl`、manifest、leaderboard 或 worker runtime state。
