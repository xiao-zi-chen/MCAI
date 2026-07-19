# RL 训练接口

## Gymnasium API

`MinecraftPvpEnv` 兼容 Gymnasium：`reset()` 返回 `(obs, info)`，`step(action)` 返回 `(obs, reward, terminated, truncated, info)`。主观测是 flat `np.float32`，主动作是简单整数动作或整数数组，丰富快照保留在 `info`、测试、调试工具和协议日志里。

## Observation

快照由 `python/src/mc_pvp_env/observations.py` flatten。观测包含自身/对手位置、速度、朝向、血量、攻击冷却、hurt time、line of sight、hit counts、phase 和 elapsed tick features。

不要把大 dict observation 暴露为主 Gymnasium space。

## Curriculum discrete actions

当前默认 `action_mode=curriculum_discrete`，它会输出 legacy action vector。该路径用于保留现有 Mineflayer BC/PPO、policy pool、duel policy 和 champion 行为；不要把它当作真实键鼠动作标签。

```text
0 no-op
1 face enemy body
2 walk forward while facing enemy
3 sprint forward while facing enemy
4 attack while facing enemy body
5 walk and attack while facing enemy body
6 sprint and attack while facing enemy body
7 strafe left and attack while facing enemy body
8 strafe right and attack while facing enemy body
9 jump, sprint, and attack while facing enemy body
10 back up and attack while facing enemy body
```

离散动作会先映射为 [protocol action vector](protocol.md#action-vector)，再发送给 bot-controller。

受限动作路线会新增 opt-in 的 `SwordPvPActionV1`，策略只能输出基础键盘状态、相对鼠标计数、attack/use pulse 和 recenter request。新路线必须通过 [action-abi.md](action-abi.md) 和 [dataset-schema.md](dataset-schema.md) 记录 `action_requested`、`action_executed` 和 `action_execution_status`。在该路线接入前，`OBSERVATION_FIELDS`、`ACTION_NVECS` 和 BC checkpoint 兼容性保持不变。

## Reward and rules

当前主战斗模式是 hit count。长 PPO run 使用 `target_hits=50`；smoke 常用 2、5 或 25。比较 reward 改动时应看 win rate 和 hit count，不能只看 reward mean。

## Opponent policies

```text
neutral
movement_only
weak_scripted
curriculum_scripted
curriculum
controller_pvp
herobot_pvp
mineflayer_pvp
policy_pool_sample
```

`controller_pvp` 是当前通用的 controller-side benchmark/adversary mode。`mineflayer_pvp` 是旧 manifest 和旧脚本兼容别名，读入后归一为 `controller_pvp`。`herobot_pvp` 预留给 HeRoBot/Fabric worker；在 HeRoBot worker 未成为默认训练底层前，不应把它和当前 Mineflayer worker 的评估结果混为同一条 lineage。
