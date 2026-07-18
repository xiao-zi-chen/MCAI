# PVPRobo Open-Core 文档

> 语言：[English](README.md) | 简体中文

这些文档面向公开版本地 RL 平台。

最新公开更新：人类玩家攻击的命中注册现在信任 Paper 原生伤害事件；ROBO/SCRIPT 攻击仍保留过渡期几何校验。Hit-count PvP 只统计最终伤害为正的事件，因此快速连击是否计数由 Minecraft 原版伤害刻决定。

- [wiki/overview.md](wiki/overview.md)：架构、仓库布局、版本要求和公开/私有边界。
- [wiki/runbook.md](wiki/runbook.md)：从 clone 到运行的设置流程、测试、worker 启动、rollout、数据采集、BC、PPO、评估和本地 duel 命令。
- [wiki/local-ai-battle.md](wiki/local-ai-battle.md)：用本地 Minecraft 客户端观看 AI 对战的步骤，以及 spectator 设置相关排查。
- [wiki/rl-training.md](wiki/rl-training.md)：观测/动作契约、奖励、演示数据集、BC、PPO、policy pool 和模型发布约定。
- [wiki/released-checkpoints.md](wiki/released-checkpoints.md)：随仓库公开的 BC 与 Champion ROBO checkpoint、预检、AI-vs-AI 冒烟测试和玩家 duel 设置。
- [wiki/protocol.md](wiki/protocol.md)：Paper 插件和 Mineflayer controller 的 JSONL 协议。
- [wiki/troubleshooting.md](wiki/troubleshooting.md)：Windows、Java、Gradle、Node、Python、Paper、EULA 和端口相关问题排查。
- [open-source/repository-split-classification.md](open-source/repository-split-classification.md)：公开核心与私有云服部分拆分的依据。
- [open-source/open-core-prep-plan.md](open-source/open-core-prep-plan.md)：准备公开候选版本时使用的检查清单。

私有云服运维、认证入口、部署包、地图、皮肤、排行榜、监控和线上服务器 handoff 不在这里公开记录。
