# 策略合同 skyduel-strategy-0.2

本文件规定未来参赛程序的输入和输出。当前样例机器人是本地验收工具；AGX 的投稿驱动器尚未接通此合同。训练由参赛者负责，主办方提供规则、环境和一致的执行程序。

## 文件与入口

一个 UTF-8 `agent.js`，包含同步 `function act(o)`，返回 JSON 可序列化对象。允许本局使用全局变量记忆；下一局重建运行时。不能导入 Node 模块、联网、读取宿主文件或访问墙钟。模型参数可内嵌源码，同样计入大小与执行预算。随机数由比赛运行时为每席提供独立随机流。

## 输入

| 字段 | 约定 |
| --- | --- |
| `v` | 固定为 1 |
| `rulesVersion` | 本局冻结的规则版本，如 `skyduel-0.3.0` |
| `tick, phase` | 游戏刻度和 `waiting/playing/finished` 阶段 |
| `seat, team` | 席位 0 或 1，实际分配的 `Red/Blue` |
| `me` | `position{x,y,z}, velocity{x,y,z}, health, eliminated, inventory, hotbar, selectedSlot, attackCooldown, armor, effects, atOwnShop, atOwnUpgradeShop` |
| `allies` | 1v1 时为空数组 |
| `visibleEnemies` | 当前16格内且无遮挡的敌方 `{id,position,appearance}`；不提供精确HP、库存、冷却或不可见位置 |
| `map` | `id, ownSpawn, ownShop, ownIronGenerator, enemyApproach` 等公开坐标，以及固定初始地图数据。初始地图可缓存 |
| `teams` | 各队 `id, bedAlive, eliminated`；己方额外提供团队升级等级 的公共状态 |
| `nearbyBlocks` | 当前可见的动态方块 `{position,kind}`，不可见变化不推送 |
| `visibleMineTargets` | 当前可见且规则允许挖掘的 `{position,kind}`；`enemy_bed` 只在实际能看见该床时出现 |
| `events` | 公共床/淘汰事件、自身购买/操作结果；不含隐藏信息 |
| `orderStatus` | 当前任务的 `idle/running/done/rejected` 与公开失败原因 |

`inventory` 使用商店中的规范物品ID，如 `wool`，资源使用 `iron/gold/diamond/emerald`；数值为持有数量。初始地图坐标与自身状态是世界坐标，距离单位为格。方块位置是整数，玩家与目标位置可以是有限小数。选手可以记住最后看到的信息，平台不能替它继续刷新隐藏敌人的位置。

## 输出

统一为 `{v:1, order:{type:..., ...}}`。结构严格校验，额外字段、未知动作、非有限数值及越界坐标均不接受。详见 `action.schema.json`。

- `wait`：清空持续操作。
- `move + target`：在已知可走地形上寻路，不自动花费方块或挖掘。
- `bridge + target`：使用背包中的队伍羊毛逐格搭路，遵守库存、支撑面、放置距离与碰撞；没有方块时失败。
- `place + block + item`：放置一个指定建筑方块。
- `mine + block`：持续挖掘一个可见且可达的目标，使用当前工具和真实挖掘时间。
- `buy + item + quantity`：总购买数量，必须为商店每包数量的整数倍，单次最多64件；需处于商店范围且有足够资源和空间。
- `attack + targetId`：攻击当前可见敌人，使用统一公开的瞄准、距离和攻击冷却规则；目标不可见时停止追踪。
- `equip + slot`：选择快捷栏0至8格；也可用 `equip + item` 按规范物品 ID 选择并切换已持有物品。`me.hotbar` 给出槽位到物品的映射。
- `look + target`：朝向可见目标位置，为弓箭、投掷物和水桶指定方向。
- `upgrade + id`：在己方升级商人范围内购买下一等级；不足资源或达到上限时拒绝。
- `use`：使用当前持有物品；也可给出 `target` 与 `durationTicks`（1–40）指定瞄准点和持续使用刻度，适用于弓箭与投掷物。释放、消耗和冷却由固定执行器与游戏规则处理。
- `deposit/withdraw + container + item + quantity`：在实际可交互范围存取 `team_chest/ender_chest` 中的铁、金、钻石、绿宝石，每次 1–64 个。永久装备不能存箱，末影箱信息只向本人提供。

重复同一任务应继续执行，不能不断重置挖掘或寻路进度。任务切换取消旧任务。底层执行器不得利用未授予该席的信息；例如寻路不能通过未知路障提前泄漏对手的建筑。

## 时间与故障

每4个游戏刻度冻结各席观察；两席行动在统一后续刻度应用，不按谁先计算完决定先手。游戏主线程不等待选手程序。

类型/结构非法：记录一次协议故障，本次执行 `wait`。合法但当下做不到：返回 `rejected`，原因仅限公开可知的信息，不据此泄漏隐藏对象。代码抛错、超时、内存或累计计算超限：停用该席并判负；同一时点两席均失格，该局没有有效赢家。平台故障：作废并重赛。正式排名不把平台故障或双方失格当作普通平局积分。

单次20ms、累计CPU30秒等数值目前是候选预算，需要在AGX实际执行器中测试后冻结。平台应记录规则哈希、地图版本、两份不可变策略版本、座位、结果与完整故障证据。

可听事件：策略可以使用 Minecraft 实际发给该玩家、距离不超过 16 格的方块音效。音效只提供种类与声源位置，不提供不可见敌人的身份、背包或实时位置。末影箱按玩家身份共享，任何基地的末影箱都访问同一份个人储物；普通箱不保证对敌方保密。
