# 第三方来源

项目基于 [KyaKayKya/Minecraft-PVP-ROBO](https://github.com/KyaKayKya/Minecraft-PVP-ROBO) 的 MIT 开放核心，保留原 LICENSE 与 Git 历史。

| 组件 | 来源 | 处理 |
| --- | --- | --- |
| Minecraft Java 1.21 | Mojang 官方版本清单和下载服务 | 安装时校验并下载；JAR、资源和音频不提交到 Git |
| Paper 1.21 build 130 | Paper 官方下载服务 | 安装时下载，保留其许可要求 |
| Screaming BedWars 0.2.44 | ScreamingSandals / Modrinth，LGPL-3.0 | 独立依赖，不复制源码进本项目；固定摘要校验 |
| Mineflayer、pathfinder、Prismarine viewer | PrismarineJS，MIT | npm 锁定依赖；仅用于本地受控服务器 |
| 原创地图 | `bedwars-map-plugin` | 本项目程序生成，未导入授权不明的网上地图 |

调研记录另见 `STRATEGY_RESEARCH.zh-CN.md` 与 `NATIVE_ALIGNMENT.zh-CN.md`。参考项目不等于采用其代码，也不代表完整复刻其功能。`xiao-zi-chen/MCAI` 为本版本发布目标。

Agones 调度配置示例依据官方 Counters and Lists 文档改写，使用 Apache-2.0，许可文本位于 `deploy/agones/LICENSE`。它是设计模板，当前运行系统未引入 Agones 依赖。

本地调度锁定 BullMQ 5.81.5（MIT，taskforcesh/bullmq）与 ioredis 5.11.1（MIT，redis/ioredis），版本和完整依赖见 `local-scheduler/package-lock.json`。Redis 由运行者提供，服务器程序不随仓库分发；本机复用了已有 Windows Redis 5.0.14.1，BullMQ 推荐的 Redis 版本为 6.2 以上。


## Crypt 四队地图

使用 [atomic-cogwheel0/act-bedwars](https://github.com/atomic-cogwheel0/act-bedwars) 的 Crypt 方块结构，固定提交 `aad1a8e250016ef1283f823367249cc0b8f0d15b`。`maps/crypt-squads/` 中的原始 NBT 及派生地图资产遵循该目录的 GPL-3.0 许可，保留作者署名、原始源文件、转换脚本和哈希，不按本仓库 MIT 许可重新授权。具体修改见该目录 README。
