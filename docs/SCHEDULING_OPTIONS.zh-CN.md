# 多竞技场持续补位：开源调度选型

核对日期：2026-10-21。本文是调研与接入设计，尚未部署调度系统；当前 Minecraft 演示仍是单场。目标是很多参赛者排队、多个竞技场独立开赛，一场结束并恢复后立即接下一组。

## 选型结论

本地和少量机器阶段采用 **BullMQ 开源版 + Redis + Minecraft 竞技场适配层**。队列、并发领取、锁续期和失败重试复用成熟组件。只用 BullMQ 开源功能，不以 Pro 功能为前提。

多机集群阶段可由 **Agones** 管理 Minecraft 服务器进程、分配容量和扩缩容。它的官方 Counters and Lists 文档直接给出了“先补入已分配服务器的空房间，再分配 Ready 服务器”的例子，和本项目需求对应。该子功能当前为 **Beta**，上线前需要固定版本并验证恢复与容量一致性。

需要分数区间、多个匹配条件等复杂配对时，再评估 **Open Match**。它负责组成对手，不负责在 Minecraft 内创建、清理竞技场。**Open Match 2 的当前 README 明确标注 public preview**，不能直接当作成熟稳定替代品。

**CloudNet** 是 Minecraft 取向的服务器网络管理候选，适合管理多个 Minecraft 实例和节点。它不能直接代替本项目的 AI 比赛适配层；其 nightly 开发分支与已发布版本应分别评估。本次 latest release 页面指向 v3.4.5。

| 组件 | 负责什么 | 本项目使用方式 | 仍需项目实现的内容 |
| --- | --- | --- | --- |
| BullMQ + Redis | 持久任务队列、并发、重试、任务锁 | 一场比赛是一项任务；有可用竞技场的 worker 领取 | 配对规则、竞技场预留、真实结束确认、清理、结果去重 |
| Agones | Kubernetes 上的游戏服务器生命周期、分配与扩缩容 | 一台 GameServer 对应一个 Minecraft 进程，rooms 表示可承载场数 | Minecraft SDK/sidecar 接入、具体 arena_id、健康与实际容量上报 |
| Open Match | 按自定义规则组成对手 | 在进入比赛任务队列前生成配对 | 自定义 MMF、向场地分配比赛、通知选手 |
| CloudNet | Minecraft 实例与节点管理 | 不使用 Kubernetes 时评估其进程管理能力 | 单个实例内部的多竞技场、比赛队列和 AI 执行 |

## 本项目的持续补位方式

```mermaid
flowchart LR
    A[新参赛者] --> B[等待配对]
    B --> C[BullMQ 比赛任务队列]
    C --> D[有空场的比赛适配器]
    D --> E[预留竞技场与两个选手]
    E --> F[实际 Minecraft 比赛]
    F --> G[持久化结果和回放]
    G --> H[退出旧选手并恢复地图]
    H --> D
```

只在比赛之间替换选手。运行中的比赛不因新报名者到来而换人。每个竞技场独立补位，没有等所有场地同时结束的全局屏障。

竞技场状态为 `available → reserved → running → saving → resetting → available`。只有地图恢复、旧玩家退出、床和资源状态通过检查后，才能重新变为 available。比赛结束并不立即代表场地可复用。

首次实现可从一个 Minecraft 进程的 2 个竞技场开始验证，再测 4、8 个。比赛计时与裁判状态按 arena_id 分开。每场放在独立世界中，独立缩圈和恢复；进程仍共享基础开销。多个 Minecraft 进程负责利用更多 CPU 核。配置的场数是压测目标，不是已证实的硬件容量。

## BullMQ 接入边界

- worker 的并发数不能超过其确实可用的竞技场数。每个比赛任务等待结果和地图恢复；游戏 tick 和 CPU 密集的 AI 推理运行在独立执行进程中，避免阻塞队列锁续期。
- 官方文档明确包含 **at-least-once** 语义，不能假设一次任务只会执行一次。每场有不可变 match_id，结果按该 ID 唯一提交；同一名参赛者同时只能持有一个有效比赛预留。
- 预留带递增代次，过期 worker 不能继续改变新比赛。worker 重连或任务重试时，先核实原比赛是否仍在运行、结果是否已保存，再决定恢复、作废或重赛，避免并发生成两份比赛。
- 地图重置失败、结果无法落盘或状态不确定时，场地进入隔离状态，其他场地继续工作。已完成的结果不会因队列重试重复加分。
- Redis 按 BullMQ 官方生产建议启用持久化，并设置 `maxmemory-policy noeviction`。Redis 内只存任务、租约与状态；完整回放文件另存。
- 当前本机 Redis 为 5.0.14.1。本次读取的 BullMQ 源码最低版本检查为 5.0.0、推荐最低为 6.2.0；生产部署应选择受维护且经过兼容验证的版本，不能把 npm 的 node-redis 客户端版本误当作 Redis 服务端版本。

## Agones 的多房间分配

官方示例使用 `rooms` counter 的 `count` 与 `capacity`。在本项目中，count 应包含预留、比赛中、保存中和重置中的场地，避免过早释放容量。

分配过程：先查询 `Allocated` 且 `rooms.minAvailable: 1` 的服务器；没有合适服务器时再查询 `Ready`；成功时递增 rooms。配套模板见 [arena-allocation.example.yaml](../deploy/agones/arena-allocation.example.yaml)。模板需要 Agones 集群、Fleet 和已实现的竞技场适配器，不能独立启动比赛。

`Packed` 策略用于集中放置以提高机器利用率；它不等于把 CPU 压到 100%。Paper 主线程耗时、内存、AI CPU 预算与重置峰值仍决定真实可承载场数。应根据实际负载暂停接单或调整容量。

一台服务器承载多场时，某一场结束只释放对应房间，不能 Shutdown 整个 GameServer，也不能把仍有活跃比赛的进程当成完全空闲。官方 SDK 支持把 Allocated 服务器重新设为 Ready 复用，但这应在符合进程整体状态时调用。

## 现有代码需要的改造

- `SkyDuelReferee` 与 `ClassicRules` 当前各持有单个 `Game`，且存在固定 SkyDuel 名称。需要每个竞技场独立的时钟、玩家、胜负、经济状态和回放。
- 缩圈使用 `WorldBorder`。不同场地必须使用不同世界，或将缩圈重写为竞技场范围机制。
- 示例 AI 当前固定两个用户名和一个裁判流。需要从比赛任务配置用户名、模型、arena_id 与观察来源。
- 需要等待地图实际恢复的可用信号、故障后的复核以及回放完成确认。
- 本轮调度选型不等于实现不可信投稿隔离。正式接收任意 `agent.js` 前仍需独立的资源限制与观察隔离执行器。

## 验收场景

后续接入至少要覆盖：两个场地并行；一场结束时另一场继续；排队中新加选手被后续空场领取；同一选手不能同时进入两场；重复完成消息不重复计分；worker 断开不会产生幽灵比赛；重置失败不会重新接单；Redis 重启后的队列恢复；容量下降只停止新开赛，不中断已有比赛。千人规模应区分排队人数测试与真实 Minecraft 并发压力测试。

## 官方与源码依据

1. [Agones 项目](https://github.com/googleforgames/agones)；[官方版本记录](https://github.com/googleforgames/agones/blob/main/CHANGELOG.md) 本次列出的最新发布为 v1.61.0（2026-09-22）。
2. [GameServer Counters and Lists](https://agones.dev/site/docs/guides/counters-and-lists/)：Beta 状态、房间容量、优先补入已有服务器的完整示例。
3. [GameServerAllocation](https://agones.dev/site/docs/reference/gameserverallocation/)：Allocated/Ready 选择器及 Packed/Distributed 策略。
4. [Agones SDK](https://agones.dev/site/docs/guides/client-sdks/)：Ready、Health、Shutdown 与实例复用。
5. [BullMQ 并发](https://docs.bullmq.io/guide/workers/concurrency)、[停滞任务](https://docs.bullmq.io/guide/jobs/stalled)、[幂等任务](https://docs.bullmq.io/patterns/idempotent-jobs)、[生产部署](https://docs.bullmq.io/guide/going-to-production)。
6. [BullMQ Redis 连接源码](https://github.com/taskforcesh/bullmq/blob/master/src/classes/redis-connection.ts)：服务端版本检查与推荐版本。
7. [Open Match 文档](https://open-match.dev/site/docs/)；[Open Match 2 README](https://github.com/googleforgames/open-match2)：public preview 与需要自定义匹配逻辑的说明。
8. [CloudNet 源码](https://github.com/CloudNetService/CloudNet)；[已发布版本](https://github.com/CloudNetService/CloudNet/releases/tag/v3.4.5)。
