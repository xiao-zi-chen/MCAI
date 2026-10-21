# MCAI · 悬空夺床

本地运行的 **Minecraft Java 1.21 起床战争 AI 对战**。真实 Paper 服务器负责规则与物理，两个 AI 用本地模型和公开策略比赛，支持原版客户端观战、平视网页观战和整局回放。对局不调用云模型 API。

当前版本 **0.6.0**：九岛地图、两种示例打法、35 种商品、6 类团队升级。基地间距 112 格，包含南北钻石分路、前哨岛、双绿宝石点和高地通道。

## 运行

需要 Windows 10/11、JDK 21、Node.js 22+ 和 Python 3.11。首次安装会下载带摘要校验的服务器依赖与游戏资源。

```powershell
powershell -ExecutionPolicy Bypass -File .\setup-bedwars.ps1 -JavaHome '你的 JDK 21 目录'
```

阅读 [Minecraft EULA](https://www.minecraft.net/eula) 后，如同意，将本地 `runs/bedwars-local/eula.txt` 的 `eula=false` 改为 `eula=true`，再启动：

```powershell
powershell -ExecutionPolicy Bypass -File .\playtest.ps1 -NoBrowser
```

- [实时平视观战](http://127.0.0.1:3007/)
- [完整回放](http://127.0.0.1:3007/replays)
- [规则和商店](http://127.0.0.1:3007/rules)
- 原版画面：双击 `原版观战.cmd`，首次使用会下载官方 1.21 客户端资源。

详细安装、停止、手动参与与验证命令见 [本地试验指南](LOCAL_TRIAL.zh-CN.md)。客户端、服务器和本地录制不包含在仓库中。

## 给别人看

[Releases](https://github.com/xiao-zi-chen/MCAI/releases) 提供 `MCAI-showcase-0.6.0.zip` 展示包：解压后双击 `index.html`，即可离线观看完整比赛、精彩片段、地图截图与规则。MP4 视频也可以单独发送。接收者不需要安装 Minecraft。仓库保持私有，ZIP 可由所有者直接转发。

![已修复的商店村民与网页回放](docs/assets/skyduel-merchants.jpg)

## 内容和范围

- `competition/`：规则源文件、生成的商店/地图配置、参赛合同和动作 schema。
- `bedwars-map-plugin/`、`referee-plugin/`：原创地图、经济扩展、裁判和记录。
- `scripts/`、`models/showcase/`：两个示例 AI、权重、训练和验收工具。
- `local-viewer/`：实时观战与回放；默认平视，可切换第一视角。
- `bot-controller/`、`server-plugin/`、`python/`：保留的 PvP 训练核心。

Ember 偏快攻和拆床，Bastion 偏防守、升级和远程控制。每个近战 actor 为 22,027 参数；本版本主要改进地图、策略和动作执行，没有重新训练网络。它们仍是示例对手，不能保证达到高手水平。

目前是双队 1v1。本项目提供参赛规则与合同草案；**AGX 正式后端接入和安全隔离的投稿运行器尚未完成**。不宣称复刻某个商业服务器的全部模式。

[0.6 改动与验证](docs/RELEASE_0.6.zh-CN.md) · [功能范围](docs/FEATURE_COVERAGE.zh-CN.md) · [模型说明](models/showcase/MODEL_CARD.zh-CN.md) · [第三方来源](docs/THIRD_PARTY.zh-CN.md)

基于 [Minecraft-PVP-ROBO](https://github.com/KyaKayKya/Minecraft-PVP-ROBO) 的 MIT 开放核心，保留原许可与历史。Minecraft / Mojang 资源由安装程序从官方服务获取。
