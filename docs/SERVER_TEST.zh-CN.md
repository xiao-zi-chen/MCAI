# 同机隔离测试与分级压测

这套流程用于在已有其他工作的 Ubuntu 服务器上，测试自己的私有 Minecraft 起床战争实例。服务器中的其他项目、系统 Java、数据库、代理、网站、Redis 和防火墙都不需要改动。共享硬件仍可能产生资源竞争，因此结果必须连同资源限额一起解释。

## 独立目录和运行环境

将源码、编译后的两个插件、已校验的 Paper/BedWars JAR、Minecraft 资源缓存放到新目录，例如 `/usr/mcai-pvp-lab`。目录仅属于本项目。`scripts/bootstrap-linux.py` 把 Java、Redis 和 Python 依赖安装到目录下的 `deps/`，npm 依赖安装到各组件自己的目录，不运行系统包升级。执行前必须确认操作者已接受 Minecraft EULA；脚本需要显式 `--accept-eula`。

准备过程也应受到资源限制：

```bash
sudo systemd-run --unit=mcai-lab-prepare --collect \
  -p User=ubuntu -p WorkingDirectory=/usr/mcai-pvp-lab \
  -p CPUQuota=100% -p CPUWeight=10 -p Nice=10 -p IOWeight=10 \
  -p MemoryHigh=1500M -p MemoryMax=2G -p MemorySwapMax=0 \
  -p TasksMax=192 -p RuntimeMaxSec=25min \
  /usr/bin/python3 -u scripts/bootstrap-linux.py --accept-eula
```

`configs/scheduler.server-test.json` 定义 8 个独立世界；`configs/scheduler.server-64.json` 定义 32 个独立世界，每场 1v1，目标从 16 个同时运行的 AI 测到 64 个。场地数量是配置上限，实际通过的容量必须以报告为准。参赛者使用已有的两个权重、不同风格和随机种子。

扩大场地前，先暂停接纳、等待或明确中止自己的测试比赛并保存结果，然后停止自己的服务，再运行 `deps/python/bin/python scripts/prepare-bedwars.py --apply-rules --scheduler-config configs/scheduler.server-64.json`。此步骤备份现有受控配置；不要在游戏运行中准备场地。

## 限额运行

确认准备完成后再启动。下面的限额对整组 Java、Redis、协调器、AI 子进程和观战进程共同生效；AI 即使使用 detached 子进程，也继承同一 cgroup。

```bash
sudo systemd-run --unit=mcai-bedwars-lab --collect \
  -p User=ubuntu -p WorkingDirectory=/usr/mcai-pvp-lab \
  -p CPUQuota=300% -p CPUWeight=10 -p Nice=10 -p IOWeight=10 \
  -p MemoryHigh=9G -p MemoryMax=10G -p MemorySwapMax=0 \
  -p TasksMax=768 -p RuntimeMaxSec=3h -p TimeoutStopSec=90s \
  -p KillMode=mixed /usr/bin/python3 -u scripts/run-linux.py \
  --config=configs/scheduler.server-64.json --heap-mb=4096 --java-cpus=3
```

这是有时限的测试服务，不是生产部署。启动脚本预检所有端口；发现占用时退出，绝不结束占用端口的其他进程。服务只绑定回环地址。正常管理使用比赛中心；停止整套本项目服务使用 `sudo systemctl stop mcai-bedwars-lab`，不要使用 `pkill java`、`killall node` 等全局命令。停止前先暂停配对并等待当前比赛结束；强制停止不能算自然完成的比赛。

查看限额和用量：

```bash
systemctl show mcai-bedwars-lab -p CPUQuotaPerSecUSec -p MemoryCurrent -p MemoryMax -p TasksCurrent
journalctl -u mcai-bedwars-lab -n 30 --no-pager
```

## 分级测试

确认没有其他排队参赛者或在赛比赛后执行：

```bash
node scripts/stress-scheduler.cjs \
  --config=configs/scheduler.server-64.json \
  --levels=8,12,16,24,32,32 --watch-last=arena-1 --seconds=120 --warmup=90 \
  --min-steady=60 --entrants=128 --drain-seconds=2100
```

`levels` 的单位是竞技场，AI 并发数是它的两倍。128 是报名总数。测试仅在每级真正跑到目标并发，并取得至少 60 个合格稳态采样后通过。默认阈值包括 TPS≥19、服务器平均 MSPT≤35ms、最近 100 个实际 tick 的 P95≤50ms，以及每个 AI 进程的决策频率≥7Hz、事件循环 P95≤100ms。采样间隔约一秒，实际时间戳会记录下来。

脚本还检查服务器剩余内存、cgroup 剩余预算、主机 CPU 忙碌程度、磁盘剩余空间、重复玩家、外来玩家、隔离场地的录像、每场启动次数和结算次数。资源保护触发后停止加压，撤回仅属于本轮测试的等待者，让已开赛的 AI 自然结束。达到 drain 超时会明确标记未完成，不将中止当成正常完成。结束后保持暂停新开局，避免压力测试继续占用别人的资源。

`--levels=8,12,16,24,32,32 --watch-last=arena-1` 会在最后一个重复档位启动观战服务。应在该档位打开浏览器观战并保持连接；若没有真实浏览器连接，只能称为观战服务器开销。浏览器渲染位于观看者电脑，其内存不属于远端 AI 进程用量。

所有原始样本及报告写入 `runs/stress/<时间>/`。`mean_mspt_p50` 是“平均 MSPT 的采样中位数”；`tick_window_p95_max_ms` 是各个真实 tick 窗口 P95 的最大值，不能改称整场逐 tick P95。报告同时保留最大 tick 时间和 GC 累计计数，避免掩盖重置或启动时的卡顿。

Windows 可使用 `scheduler.ps1 -Config configs/scheduler.stress.json -Mode Prepare`，再启动并运行同一 Node 测试脚本。Prepare 必须在 Minecraft 已停止时执行。默认配置仍是 `configs/scheduler.local.json`，压力配置不会覆盖它。

## 私有观战

通过 SSH 转发比赛中心与要观看的场地端口；不需要开放公网的离线认证游戏端口或管理接口：

```bash
ssh -N -L 3009:127.0.0.1:3009 -L 3007:127.0.0.1:3007 \
  -L 3010:127.0.0.1:3010 -L 3011:127.0.0.1:3011 \
  -L 3012:127.0.0.1:3012 -L 3013:127.0.0.1:3013 \
  -L 3014:127.0.0.1:3014 -L 3015:127.0.0.1:3015 \
  -L 3016:127.0.0.1:3016 ubuntu@YOUR_SERVER
```

随后打开 `http://127.0.0.1:3009`。竞技场 1 的观战端口是 3007；8 场配置其余是 3010–3016，32 场配置其余是 3010–3040。要观看更多场地，需要为相应端口增加 SSH 转发。新录像带有真实床方块与掉落物快照；旧录像可以恢复床，但没有记录过的掉落物不会凭空生成。


## 录像与内存

游戏主线程每 100ms 只生成当前快照并放入内存批次。录像后台线程每批 50 帧写临时文件，队列最多 4 批；结束时流式合并并原子替换为完整 JSON，不在主线程拼接整场字符串，也不把整场帧对象留在 Java 堆中。磁盘写入或队列失败会隔离竞技场，不能计为完整比赛。辅助结果文件位于 `replays/results/`，协调器和录像目录只读取小摘要；压测验收逐行核对完整录像中的每帧参赛者身份。

AI 的常驻观察连接声明 `controller` 模式，省去仅供观战的床和掉落物几何快照；观战和新录像仍保留这些真实世界状态。这不改变资源生成、游戏规则或 AI 的可用决策信息。

2026-10-22 的第一轮在 1.5 核/5GiB 配额下，8 个 AI 的短时间稳态性能通过，但 12 个 AI 触发延迟保护，随后旧录像保存方式触发 Java 堆内存耗尽，存在未完成结算。该轮不能作为完整可靠运行的证明。更大配额、后台批量录像修复后的测试必须单独记录。

报告中的 `completed` 表示所有预留比赛已结算并释放场地；`competition_completed` 还要求全部比赛自然结束。主动取消预热的比赛必须标记中止，不计胜场。`natural_completed_matches` 和 `result_status_counts` 单独记录自然完成数和各类结果数量。


## 单机多进程：48 个 AI

`configs/scheduler.multi-48.json` 把 24 个竞技场交错分配给三个独立 Paper 进程，每个进程 8 个世界、16 个 AI。共用一个 Redis、比赛队列和观战中心；`server_id` 决定游戏连接、控制连接、录像目录和观战所处的服务。场地结束后仍独立保存、重置和补位。默认旧的 Windows 单进程流程保留；以下多进程启动示例用于 Linux。

先让已有压测报告写完、暂停并排空自己的比赛，再停止自己的旧实例。不要仅凭“空闲场地”判断压测器已经退出：末尾还会逐帧校验录像并恢复调度参数。压测器通过本地进程锁阻止对同一个管理端口同时运行第二个压测；锁持有到校验与参数恢复全部结束。然后运行：

```bash
deps/python/bin/python scripts/prepare-multi.py --accept-eula
sudo systemd-run --unit=mcai-bedwars-multi48 --collect \
  -p User=ubuntu -p WorkingDirectory=/usr/mcai-pvp-lab \
  -p CPUQuota=300% -p CPUWeight=10 -p Nice=10 -p IOWeight=10 \
  -p MemoryHigh=9G -p MemoryMax=10G -p MemorySwapMax=0 \
  -p TasksMax=768 -p RuntimeMaxSec=3h -p TimeoutStopSec=90s \
  -p KillMode=mixed /usr/bin/python3 -u scripts/run-linux.py \
  --config=configs/scheduler.multi-48.json
```

准备脚本只在新的项目子目录内复制已停服实例的 JAR、缓存与恢复后的世界，不复制旧的裁判租约、参赛状态和录像。目标目录已存在时拒绝覆盖。每个 Java 初始配置最大堆为 1536 MiB；3 个 Java 的堆上限相加为 4.5 GiB，**10 GiB 是整组 Java、AI、队列和观战共同使用的硬上限**，两者不能混同。CPU 配额也是合计 300%，不会变成每进程 3 核。低优先级、配额和保留内存降低对同机工作的影响，不能保证共享硬件上零竞争。

游戏端口为 25567–25569，裁判端口 25810–25812，RCON 25578–25580，观察连接 25700–25723；均绑定 localhost。网页仍用 3009，第一场观战 3007，其余 3010–3032。观战更多场地时追加相应 SSH 转发即可。

控制池按比赛的竞技场路由指令，未知或重复配置启动时拒绝。一个服务不可用时，该服务的竞技场不可接纳，健康服务可继续处理自己的比赛。比赛中心显示每个服务的 AI 数和延迟；总览 TPS 取最低值、MSPT 取最高值，逐 tick P95 展示三个服务中最差的 100 tick 窗口，并保存其来源。这个指标不是把三个进程的所有 tick 混合计算的 P95。

同一配置的实际并发测试：

```bash
node scripts/stress-scheduler.cjs --config=configs/scheduler.multi-48.json \
  --levels=24,24 --watch-last=arena-1 --warmup=180 --seconds=180 \
  --min-steady=60 --entrants=128 --drain-seconds=2100
```

每个目标是竞技场数，24 场对应 48 个 AI；128 是排队参赛人数。只有裁判确认两名玩家都在 `running` 状态的场地计入实际对战人数。质量验收要求至少 60 个满载稳态采样同时满足 TPS≥19、MSPT≤35、各服务最近 100 tick 的 P95≤50ms、AI 决策频率≥7Hz、AI 事件循环 P95≤100ms。它是短时筛查，不等于长时间稳定性承诺；未通过时仍保存实测峰值和每个服务的原始指标。

## 超载探索与已有结果

`--mode=overload` 只供受控压测：普通接纳保持暂停，压测器通过同一个带令牌的分配接口分批申请场地，允许跨过游戏 tick 延迟门槛继续探索人数。主机可用内存、测试 cgroup 内存、主机 CPU、磁盘、控制连接时效和身份检查仍生效。性能通过条件不变；运行了更多 AI 不能据此标为通过。退出后撤回本次未开赛的选手，进行中的比赛自然结束。

2026-10-22 的单进程、32 世界测试分为两轮：普通容量测试采用合计 3 核 CPU / 9 GiB，16 与 24 AI 通过短时门槛，32 AI 延迟超标，21 场自然完成。随后超载探索以 3 核运行，内存上限在 64 AI 阶段从 9 GiB 调到 10 GiB；峰值实际同时对战为 62，64 未稳定达到，32/48/64 目标均未通过该轮门槛。62 场自然完成，完整回放身份、单次启动和结算一致性检查无错误。超载轮在尝试启动观战时因请求超时停止后续阶段；这轮不能宣称完成了 64 AI 同时观战测试。启动观战的请求超时已单独放宽到 25 秒，不影响 AI 动作链路。


## 本次结束时的多进程结果（2026-10-22）

在 4 个逻辑 CPU 的共享主机上，对本项目合计限制为 3 核 / 10 GiB。普通接纳模式在峰值 38 个 AI 时触发延迟保护；共 21 场，其中 19 场自然结束、2 场在容量采样结束后为继续下一轮而明确中止，全部完成保存与释放。

后续受控超载轮实际达到 **48 个 AI / 24 场 / 3 个服务**，每个服务 8 场。无观战阶段共有 45 个满载稳态采样，最慢服务平均 MSPT 的采样中位数为 **54.16ms**，最低 TPS **17.11**，最差 100 tick 窗口的 P95 **194.78ms**；满足全部门槛的满载采样为 0。整组服务的采样内存峰值约 **9056 MiB**，不能据此宣称稳定承载 48 人。

观战阶段也出现过 48 个 AI，但浏览器在加载地形时超时，没有通过真实画面的满载验收。排查发现上游 `worker.js` 原始大小约 63 MB；观战静态 JS/方块状态 JSON 已加入 gzip 传输缓存，并修正多进程页面显示的游戏端口。压缩改动后没有再继续游戏压力测试，不将它写成已通过的 48 人观战结果。

最终这一轮生成 48 份完整录像并逐帧核对身份：29 场自然结束，19 场按所有者结束测试的要求中止。其中 `arena-6` 的一场虽已保存自然结束结果，但地图恢复超时，按设计隔离且没有释放场地。两名选手仍等待释放，因此不能把整轮标成完成。压测器停止后，报告由保存的协调器快照离线收尾，未重新核对最后一轮的启动次数。原始性能和失败原因全部保留，未调整规则、AI 行为或门槛来取得“通过”。

[可复核的测量摘要](benchmarks/2026-10-22.json) 包含各轮目标、实际人数、有效采样、结果数量和未完成项。测试结束后按所有者要求撤除远端运行环境；主机地址、口令、数据库备份、完整运行日志和录像不提交进源码仓库。
