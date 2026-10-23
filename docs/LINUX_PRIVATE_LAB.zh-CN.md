# Linux 私有四队实例

这个入口只管理当前工作目录中的 Minecraft、专用 Redis、比赛调度器和验证进程。默认配置是 `configs/scheduler.squads.json`，4 队、每队 4 人。所有端口监听 `127.0.0.1`，远程使用时通过 SSH 转发访问。

需要 Linux、Python 3.12、Node.js 22 或更高版本、编译工具，以及支持 cgroup v2 的 systemd 用户服务。Java 21、Redis 和 Python 环境安装在本项目 `deps/` 中，不更换系统版本。准备前需要项目的 Paper、BedWars 和两个已构建的插件 JAR；`prepare-bedwars.py` 优先从 `downloads/BedWars-0.2.44.jar` 读取 BedWars，兼容原有本地路径。

```bash
python3 scripts/squads-linux.py prepare
python3 scripts/squads-linux.py doctor
python3 scripts/squads-linux.py status
```

`prepare` 在独立的临时 systemd 用户服务中安装依赖，命令返回后可查看配置 `scheduler_root` 下的 `prepare.log`。准备服务限制为 1 个 CPU 核心和 1.5 GiB 内存，不自动启动 Minecraft，不改变 EULA。Java 与 Redis 下载会校验 SHA-256，Node 依赖使用锁文件。观赛所需的官方 1.21 物品模型、四队床和角色纹理由官方资源包提取并校验来源哈希，不运行图形客户端。

阅读并同意 Minecraft EULA 后，操作者才可以使用以下明确接受参数：

```bash
python3 scripts/squads-linux.py verify --accept-eula --normal-rounds=1
```

该命令启动受限实例，并在同一个资源限制内运行真实验收：16 个客户端、四队分配、完整的床、有效动作、最终死亡判定、录像、地图复原和下一场正常比赛。受控测试与正常比赛分别记录，正常比赛必须有出岛、搭桥和玩家拆床行为。失败不会被记录为验收通过。普通启动可使用 `start`；已经接受过本实例 EULA 时不用重复传接受参数。

运行服务默认总 CPU 上限是 2 个核心；私有配置可显式设置 `runtime_cpu_cores`，例如 4 核主机设置为 `3`，为其他任务保留余量。启动时校验该值不大于主机逻辑核数，监督进程核对实际 cgroup 限额。内存硬上限仍为 5 GiB，软上限 4.5 GiB，禁用本组交换内存。单进程 Java 默认堆为 2 GiB，多后端可在各 `servers` 条目中设置 `heap_mb`。服务优先级较低，子进程和验证进程共同计入限制。主机和本组余量不足时调度器停止接纳新比赛。

```bash
python3 scripts/squads-linux.py stop
```

停止时先暂停排队、结束本实例比赛并等待地图复原，再关闭调度器、保存 Minecraft 世界并停止专用 Redis。启动失败时也只清理本次创建的子进程。systemd 单元名包含配置和目录的摘要，操作前核对工作目录，避免误停其他实例。不会启用系统开机自启，也不会变更全局防火墙、Java、Node 或 Redis。

所有命令都接受 `--config=项目内的配置文件.json`。私有服务器的地址、资源配置、部署说明和测试记录应保存在忽略版本控制的 `runs/` 下。

`agent_view_distance` 可设置为 2–32 格区块半径，四队默认 4。它只调整 AI 客户端收到的区块范围；观战相机仍按整张地图加载，服务器模拟距离不变。较小范围可降低传输、解析与客户端内存开销，但必须通过完整比赛确认寻路和经济活动仍然正常。`admission_interval_ms` 控制相邻比赛入场间隔，避免多组客户端同时连接的峰值。

## 证据与排查

- `scheduler_root/doctor.json`：当前依赖、端口、EULA、内存和资源身份检查。
- `scheduler_root/supervisor.log`：受限进程组的启动、检查与停止结果。
- `scheduler_root/ready.json`：世界与床准备完成后才生成，停止时删除。
- `scheduler_root/verification-<请求ID>.json`：本次真实验收报告。
- `scheduler_root/verification-state.json`：验证进程的状态及退出码。
- `scheduler_root/minecraft.out.log`、`minecraft.err.log`：Minecraft 输出。

仅依赖安装、测试或端口可访问，均不代表真实 16 人对局已验收。以当前实例的真实验收报告为准。
