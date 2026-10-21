# 示例近战模型

`EmberAI.json` 和 `BastionAI.json` 是可由 JavaScript 直接推理的 actor 权重，每个 22,027 参数。运行不需要 Python 深度学习框架或外部模型 API。

- Ember：V2 权重。原始微调 2,048 步，再增加 8,192 步真实 Minecraft 对战。
- Bastion：V3 权重，在 40 局真实近战的 4,938 个观察上拟合教师动作。验证集按对局划分；教师一致率不是比赛胜率。
- 选型参考：V3 对 V2 交换出生侧各 16 局，进攻 actor 为 6 胜 10 负，防守 actor 为 10 胜 6 负。因此保留 V2 Ember 与 V3 Bastion 的组合。样本有限，不能推断跨地图强度。

模型建议近战走位；地形保护、原版攻击冷却、资源、搭桥、商店、拆床和撤退由公开控制器负责。0.6 版本没有重新训练网络。

`selection.json` 中的 SHA-256 是原始训练 checkpoint 的历史标识；发布的 JSON 权重摘要另存于 `manifest.json`。训练脚本留在 `scripts/train-two-models.py`、`scripts/distill-melee.py`；历史训练运行目录不随仓库发布。
