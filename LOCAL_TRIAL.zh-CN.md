# 本地起床战争试验

当前为 `skyduel-0.6.0`、`sky-harbor-4.0`，Minecraft Java 1.21 / Paper 130 / Screaming BedWars 0.2.44。首次安装见 [README](README.md)。已接受的本地 EULA 会保留。

## 启动和停止

```powershell
powershell -ExecutionPolicy Bypass -File .\playtest.ps1 -NoBrowser
powershell -ExecutionPolicy Bypass -File .\playtest.ps1 -Mode Status
powershell -ExecutionPolicy Bypass -File .\playtest.ps1 -Mode Stop
```

启动默认开启两名 AI 和网页服务，停止会将未完成比赛标记为中断并保存世界。对局结果写入 `runs/bedwars-local/plugins/SkyDuelReferee/replays/`。本机浏览器访问 http://127.0.0.1:3007/ ，回放在 `/replays`，规则在 `/rules`。

`-NoDemo` 可启动人工试玩，但不会关闭已经运行的 AI。要人工参与，先 Stop，再以 `-NoDemo` 启动；两个客户端连接 `127.0.0.1:25567` 并输入 `/localbw`。模式仅有两个选手席位。

默认内存上限为 2 GiB，可用 `-MemoryGB` 调整。`-JavaHome` 指定 JDK 21；`-ViewerModules` 指定观战 node_modules；`-RuntimeRoot` 指定含 mineflayer-pathfinder 的 npm 项目目录；`-ModelDir` 指定含两个 JSON actor 的目录。首次安装脚本把依赖安装在仓库内，示例权重在 `models/showcase/`。

## 原版客户端画面

双击 `原版观战.cmd`，或运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\native-view.ps1 -Target EmberAI
powershell -ExecutionPolicy Bypass -File .\native-view.ps1 -Target BastionAI
powershell -ExecutionPolicy Bypass -File .\native-view.ps1 -Mode Stop
```

这是独立的原版 1.21 旁观客户端，不参与 AI 输入或训练。Shift 离开跟随，F5 切换视角，输入 `/localbw rules` 查看规则书。下载资源校验后缓存在 downloads；可将自选缓存目录写入本地 `downloads/native-cache.path` 后重新运行 `scripts/prepare-native-client.py`。该路径文件不会上传。

网页是按服务器记录重建的 3D 场景，原版客户端是实际游戏画面。旧版物品动作对照页 `/actions` 依赖本机历史验收录像，干净安装没有该历史数据。

## 地图、商店和规则

九岛地图包括两个基地、两个前哨、四座南北钻石岛和中心。基地有商人、升级商人、资源、普通箱、末影箱及屋顶楼梯；中央有上下层通道与双绿宝石点。桥口保留需要搭建的缺口。

世界是 `bedwars-v6`。旧世界和旧回放不会覆盖。生成器拒绝覆盖已有地图；改变布局应发布新地图 ID 和新世界。地图、商品、价格、升级、阶段与提交规则的源文件是 `competition/rules.json`，说明由同一来源生成。

```powershell
# 先停止服务，再修改规则、构建和同步：
powershell -ExecutionPolicy Bypass -File .\bedwars.ps1 -Mode Prepare
.venv\Scripts\python.exe scripts/prepare-bedwars.py --apply-rules
```

`--apply-rules` 会备份受控配置并同步世界名和视距，保留本地密码及 EULA。原版战斗规则与起床战争扩展的区别见 `competition/RULES.zh-CN.md`，不要把插件道具效果当作原版生存默认行为。

## 验证

```powershell
node --test scripts/bedwars-skills.test.cjs scripts/advanced-tactics.test.cjs scripts/strategy-planner.test.cjs local-viewer/*.test.cjs
.venv\Scripts\python.exe -m unittest discover -s competition -p test_rules.py
```

真实服务器验收先 Stop，再 `playtest.ps1 -NoDemo -NoBrowser`。依次运行，不能并发占用同名 AI：

```powershell
node scripts/verify-native-live.cjs
node scripts/verify-tactics-live.cjs
node scripts/verify-expanded-map-live.cjs
```

这些脚本会使用管理员道具/位置夹具，裁判将它们标成 test；完成后关闭调试权限。正常比赛不使用这些补给。报告保存在 runs，发布版证据摘要在 `docs/verification/v0.6.json`。

## 策略与参赛

Ember 与 Bastion 使用不同的历史近战权重与宏观偏好。当前新增内容是控制器改进，不是重新训练。权重出处、局限与摘要见 `models/showcase/`。

参赛者负责自己的策略和训练。建议提交单个 UTF-8 `agent.js`，同步入口 `act(o)`；schema 与规则合同见 `competition/CONTRACT.zh-CN.md`。`submission-kit` 是示例与数值验证工具，尚不是可安全执行任意投稿的正式平台。AGX 的游戏注册、调度、隔离、排名和回放接入仍需后端集成。
