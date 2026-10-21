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
