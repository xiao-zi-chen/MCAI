# PVP ROBO

> 语言：[English](README.md) | 简体中文

<p align="center">
  <img src="docs/assets/pvp-robo-cover.png" alt="PVP ROBO cover" width="900">
</p>

<p align="center">
  <strong>面向 Windows、本地无渲染运行的 Minecraft PvP 强化学习环境。</strong>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-green.svg"></a>
  <img alt="Minecraft 1.21" src="https://img.shields.io/badge/Minecraft-1.21-3aa675.svg">
  <img alt="PaperMC" src="https://img.shields.io/badge/PaperMC---nogui-111827.svg">
  <img alt="Python" src="https://img.shields.io/badge/Python-3.11%2B-3776ab.svg">
</p>

PVP ROBO 是一套用于在本地私有服务器上训练和评估 Minecraft PvP 智能体的开源研究栈。它把无头 PaperMC 服务器、自定义 Paper 插件、由 Mineflayer 控制的机器人，以及兼容 Gymnasium 的 Python 环境，通过常驻的 localhost 协议连接在一起。

项目重点放在效率和可复现性上：结构化观测、扁平 `np.float32` 向量、整数动作数组、就地 episode reset、mock 优先的测试，以及用于安装、训练、评估和冒烟测试的 Windows PowerShell 脚本。

本仓库只面向私有、本地、离线研究服务器。请勿将它用于公共服务器作弊、绕过反作弊、隐蔽自动化或规避检测。

## 更新

| 日期 | 重点 |
| --- | --- |
| 2026.07.19 | 修复 ROBO reach parity：Mineflayer 攻击检查和 synthetic validation 统一限制到 Minecraft 原版实体交互距离。感谢 [刮泥Charlie](https://space.bilibili.com/171229828) 发现 reach 问题。 |
| 2026.07.17 | 加入隔墙命中拒绝、真实视线快照、原版有效伤害刻计分，并让人类玩家攻击的命中注册回到 Paper 原生机制。感谢 [励励lili](https://space.bilibili.com/383268814)、[MistWhy](https://space.bilibili.com/2129888402) 和 [科琳Colleen](https://space.bilibili.com/355912988) 发现战斗规则问题。 |
| 2026.07.15 | 发布本地 AI Battle 观战文档和 Champion ROBO 预检流程。 |
| 2026.07.12 | 发布首个公开版本地 PvP RL 栈，包含 BC baseline 和 Champion checkpoint。 |

## 仓库内容

```text
server-plugin/        Paper 插件：读取特权状态、重置 arena、控制 episode
bot-controller/       Mineflayer 无头机器人控制器
python/               Gymnasium 环境、协议、BC/PPO 训练、评估和测试
scripts/              Windows PowerShell 安装、构建、运行、训练和评估脚本
configs/              安全的本地默认配置和示例 manifest
docs/                 架构、协议、训练、运行手册和故障排查文档
```

私有部署资产、地图、皮肤、签名纹理、线上服务器运维内容、生成的世界，以及下载的第三方二进制文件都不会放进本仓库。仓库内包含两个小型公开 checkpoint，便于快速复现：一个 BC baseline，以及当前 Champion ROBO PPO policy。

## 快速开始

环境要求：

- Windows 10 或更新版本
- Java 21
- Gradle 8.x
- Node.js 22.x 和 npm
- Python 3.11+
- `uv`

安装 Python 和 Node 依赖：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-python-env.ps1
npm.cmd --prefix bot-controller install
```

构建全部组件：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-all.ps1 `
  -JavaHome "<JDK 21 path>" `
  -GradleHome "<Gradle path>"
```

检查公开 checkpoint 是否可用：

```powershell
.\.venv\Scripts\python.exe -m mc_pvp_env.duel_policy_manifest `
  --manifest configs\duel-policies.example.json preflight --difficulty bc

.\.venv\Scripts\python.exe -m mc_pvp_env.duel_policy_manifest `
  --manifest configs\duel-policies.example.json preflight --difficulty champion
```

在本地私有 worker 上观看 Champion ROBO 对战 BC baseline：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-ai-battle-live.ps1 `
  -WorkerId 1 `
  -StartWorker `
  -AcceptEula `
  -LeftDifficulty champion `
  -RightDifficulty bc
```

只有显式传入 `-AcceptEula` 时脚本才会写入 `eula=true`。请确认你同意 Mojang 的 Minecraft EULA 后再使用。

如果想用 Minecraft 客户端观战，而不是只跑冒烟脚本，请看 [本地 AI Battle 观战](docs/wiki/local-ai-battle.md)。文档会说明如何启动 worker 1、运行 duel daemon、用 Minecraft Java Edition 1.21 加入 `127.0.0.1:25566`、打开游戏内 AI Battle 菜单，以及出生点或游戏模式不对时如何恢复。

启动本地 worker 并运行 100 个随机动作：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-worker.ps1 `
  -WorkerId 0 `
  -JavaHome "<JDK 21 path>" `
  -GradleHome "<Gradle path>" `
  -NodeHome "<Node path>" `
  -AcceptEula `
  -Steps 100
```

同样，`-AcceptEula` 只会在你显式传入时写入 `eula=true`。你也可以手动编辑 `runs\worker_000\eula.txt`。

停止 worker：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop-workers.ps1 -WorkerId 0
```

## Python API

```python
import mc_pvp_env

env = mc_pvp_env.make_env("configs/default-env.json")
obs, info = env.reset()

for _ in range(100):
    action = env.action_space.sample()
    obs, reward, terminated, truncated, info = env.step(action)
    if terminated or truncated:
        obs, info = env.reset()

env.close()
```

主 API 返回 Gymnasium 风格的 `(obs, reward, terminated, truncated, info)` 元组。观测是扁平的 `np.float32` 数组；更丰富的快照会保留在 `info`、调试路径和测试中。

## 训练与评估

采集脚本策略演示数据：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\collect-demos.ps1 `
  -WorkerId 0 -Episodes 5 -Seed 123 -MaxStepsPerEpisode 40 `
  -Out runs\worker_000\demos\smoke
```

训练一个小型 behavior cloning 策略：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\train-bc.ps1 `
  -Data runs\worker_000\demos\smoke `
  -Out runs\worker_000\bc\smoke `
  -Epochs 1 -BatchSize 256 -HiddenSize 128 -Seed 123
```

运行一次短 PPO 冒烟测试：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-ppo-training.ps1 `
  -WorkerId 0 -AcceptEula -Rebuild -TotalTimesteps 2000 -Tui
```

生成的 runs、下载的 jar/tool、数据集和新的本地 checkpoint 默认都会被 gitignore。刻意公开的 checkpoint 位于 `checkpoints/`。

## 文档

- [英文文档索引](docs/README.md)
- [简体中文文档索引](docs/README.zh-CN.md)
- [架构概览](docs/wiki/overview.md)
- [运行手册](docs/wiki/runbook.md)
- [本地 AI Battle 观战](docs/wiki/local-ai-battle.md)
- [RL 训练](docs/wiki/rl-training.md)
- [公开 checkpoint](docs/wiki/released-checkpoints.md)
- [JSONL 协议](docs/wiki/protocol.md)
- [故障排查](docs/wiki/troubleshooting.md)

## 项目状态

公开核心已经为协议解析、动作编码、观测 flatten、manifest 工具和 mock 环境行为提供单元测试。最近一次 open-core 验证还完成了插件构建、bot 测试、Python 测试、100-step 本地 worker 冒烟测试、BC 冒烟测试和 PPO 冒烟测试。详见 [open-core 验证记录](docs/open-source/open-core-verification.md)。

## 许可证

PVP ROBO 使用 [MIT License](LICENSE) 发布。
