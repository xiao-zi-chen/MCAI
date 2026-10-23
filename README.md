# MCAI · 古堡争床

**Minecraft Java 1.21 的 4v4v4v4 起床战争 AI 比赛，当前版本 0.9.1。** 真实 Paper 服务器运行规则、战斗和方块物理；16 个无图形客户端分为红、蓝、绿、黄四队。网页可以观看比赛、完整回放、切换选手第一视角，并跳到拆床等关键事件。对局不调用云模型 API。

233×233 格地图包含 13 座岛，基于带 GPL-3.0 许可的 Crypt 地图扩建。16 个独立近战模型配合守床、采集、进攻和支援策略；每个模型含 312,587 个参数。模型采用二进制权重，文件总量约 20 MB，保留原始权重与推理结果。训练是行为克隆，宏观战术仍由公开策略控制。

## 启动四队比赛

Windows 10/11 需要 JDK 21、Node.js 22+、Python 3.11 和 Redis。先按[安装指南](LOCAL_TRIAL.zh-CN.md)准备基础依赖，再运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\squads.ps1 -Mode Prepare -JavaHome '你的 JDK 21 目录'
powershell -NoProfile -ExecutionPolicy Bypass -File .\squads.ps1 -Mode Doctor -MemoryGB 2
```

首次准备会创建 `runs/crypt-squads/eula.txt`。阅读并同意 [Minecraft EULA](https://www.minecraft.net/eula) 后，将其中 `eula=false` 改为 `eula=true`，然后启动：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\squads.ps1 -Mode Start -MemoryGB 2
```

也可以使用根目录的 `打开四队比赛中心.cmd`。比赛中心为 **http://127.0.0.1:3029/**，加入 16 个 AI 后由调度器开赛；观战与回放入口在比赛中心内，游戏端口为 `25570`。2 GiB Java 堆配置在首次启动前要求至少 4.5 GiB 可用内存。

[四队运行说明](docs/SQUADS_4V4V4V4.zh-CN.md) · [Linux 部署](docs/LINUX_PRIVATE_LAB.zh-CN.md) · [比赛规则与商店](competition/squads/RULES.zh-CN.md) · [地图来源与预览](maps/crypt-squads/README.md)

## 规则与调度

- 死亡时床存在，可在 5 秒后复活。等待期间床被拆，已经获得的这一次复活仍可完成；失床后再死亡则最终淘汰。全队最终淘汰才算出局。
- 第 2、4、6 分钟升级资源，第 8 分钟移除剩余床，第 10 分钟进入决胜阶段，15 分钟封顶。最后存活队获胜；平局、中止和机制验证局不计胜场。
- BullMQ + Redis 管理预约、分队、开局、保存和复原。场地恢复后才接下一组；一场开始后不补入新选手。
- 支持单个 Minecraft 进程管理多个独立世界，以及多个 Minecraft 进程。普通 Paper 的世界模拟共享主线程，多进程可以分散模拟工作；AI 控制器按比赛独立运行。
- 按内存余量和服务器延迟控制新开局，错开入场峰值。Linux 可配置 `runtime_cpu_cores`；测试与运行资源计入同一个受限进程组。

两个独立世界不等于同一个世界内的两个区域。当前提供的隔离方案使用独立世界，避免地图重置和事件归属互相影响。

## 回放与演示

网页回放保留真实地图、角色、方块变化和比赛事件，支持暂停、拖动、倍速、全屏与任意选手视角。完整录像按需读取并缓存少量分段，避免长录像持续占用内存。已核对一场 8 分 56 秒比赛的全部 5,370 帧：字段不变，压缩传输量减少约 **76.3%**。

需要离线展示时，使用 `scripts/export-replay.cjs` 导出网页画面。Chrome 与 FFmpeg 仅供视频导出使用，不参与 AI 训练和比赛运行。导出的 MP4、原始录像、测试记录与本地依赖均不随仓库发布。

## 验证与范围

已完成两场正常 16 AI 比赛，均有真实拆床、团队升级、录像保存和地图恢复；TPS 接近 20。3 核、5 GiB 限制下，单个 Minecraft 进程内的两个独立世界已通过 32 AI 并发检查，两场均正常结算。存在短时延迟尖峰，详细口径见[四队运行说明](docs/SQUADS_4V4V4V4.zh-CN.md)。48 AI 容量仍需以对应实测结论为准。

真实验收入口保留在 `squads.ps1 -Mode Verify` 和 Linux `scripts/squads-linux.py verify`。测试用例源文件、原始报告与训练样本保存在本地；仓库发布运行代码、必要配置、模型、地图与文档。

旧版双队演示和 PvP 训练核心仍可使用；四队模式以 `squads.ps1` 为入口。AGX 正式后端与安全隔离的投稿运行器尚未完成，短期实测也不能证明长期稳定或四个出生方向的胜率平衡。

[功能范围](docs/FEATURE_COVERAGE.zh-CN.md) · [原双队模型说明](models/showcase/MODEL_CARD.zh-CN.md) · [第三方来源](docs/THIRD_PARTY.zh-CN.md)

基于 [Minecraft-PVP-ROBO](https://github.com/KyaKayKya/Minecraft-PVP-ROBO) 的 MIT 开放核心，保留原许可与历史。地图许可单独保留；Minecraft / Mojang 资源由安装程序从官方服务获取。
