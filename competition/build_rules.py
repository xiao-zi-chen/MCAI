"""Compile the playtest rule source into server settings, schemas and documentation."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent

def load_rules(source=None):
    return json.loads(Path(source or ROOT / "rules.json").read_text(encoding="utf-8"))

def location(values):
    return ";".join(str(value) for value in values)

def server_configs(rules):
    match, layout = rules["match"], rules["map"]
    arena = {
        "name": match["arena_name"], "pauseCountdown": match["countdown_seconds"],
        "gameTime": match["duration_seconds"], "world": layout["world"],
        "pos1": location(layout["build_min"]), "pos2": location(layout["build_max"]),
        "specSpawn": location(layout["spectator_spawn"]), "lobbySpawn": location(layout["lobby_spawn"]),
        "lobbySpawnWorld": layout["world"], "lobbyPos1": location(layout["lobby_min"]), "lobbyPos2": location(layout["lobby_max"]),
        "minPlayers": match["teams"] * match["players_per_team"], "postGameWaiting": match["post_game_seconds"],
        "arenaTime": "NOON", "arenaWeather": "CLEAR",
        "teams": {name: {"isNewColor": True, "color": team["color"], "maxPlayers": match["players_per_team"], "bed": location(team["bed"]), "spawn": location(team["spawn"])} for name, team in layout["teams"].items()},
        "spawners": [{"location": location(s["position"]), "type": s["resource"], "team": s["team"], "maxSpawnedResources": s["cap"], "startLevel": s.get("start_level",1), "hologramEnabled": s.get("hologram_enabled",True)} for s in layout["spawners"]],
        "stores": [location(team["shop"]) for team in layout["teams"].values()] + [
            {"loc":location(team["upgrade_shop"]),"shop":"team-upgrades.yml","parent":"false","name":"团队升级","type":"VILLAGER","team":name}
            for name,team in layout["teams"].items() if "upgrade_shop" in team],
    }
    shop = {"data": [{"price": f"{item['price']} of {item['currency']}", "properties": item.get("properties", "applycolorbyteam" if item["id"] == "wool" else ""), "stack": {"type": item["material"], "amount": item["amount"], **item.get("stack",{})}} for item in rules["shop"]]}
    settings = {
        "locale": "zh-CN", "join-randomly-on-lobby-join": True, "join-randomly-after-lobby-timeout": True,
        "disable-hunger": not match["hunger"], "keep-inventory-on-death": match["keep_inventory_on_death"],
        "game-start-items": True, "player-respawn-items": True,
        "gived-game-start-items": match["initial_items"], "gived-player-respawn-items": match["initial_items"],
        "respawn-cooldown": {"enabled": True, "time": match["respawn_seconds"]},
        "respawn": {"protection-enabled": True, "protection-time": match["respawn_protection_seconds"]},
        "mainlobby": {"enabled": True, "world": layout["world"], "location": location(layout["lobby_spawn"])},
        "update-checker": {"zero": {"console": False, "admins": False}},
        "allow-crafting": rules["mechanics"]["bedwars"]["crafting"], "friendlyfire": rules["mechanics"]["bedwars"]["friendly_fire"], "player-drops": True,
        "allowed-commands": ["teamshop", "localbw"],
        "spawn-resources-on-game-start": False, "disable-opening-stores-of-other-teams": False,
        "destroy-placed-blocks-by-explosion-except": ["WHITE_STAINED_GLASS"],
        "specials": {"auto-igniteable-tnt":{"explosion-time":rules["mechanics"]["bedwars"]["tnt_fuse_ticks"]//20,"damage":rules["mechanics"]["bedwars"]["tnt_explosion_power"],"damage-placer":rules["mechanics"]["bedwars"]["tnt_hurts_placer"]},"throwable-fireball":{"damage":rules["mechanics"]["bedwars"]["fireball_explosion_power"],"incendiary":rules["mechanics"]["bedwars"]["fireball_incendiary"],"damage-thrower":rules["mechanics"]["bedwars"]["fireball_hurts_thrower"]}},
        "resources": {name: {"material": info["material"], "name": name.title(), "color": info["color"], "interval": info["interval_seconds"], "spread": 0.0} for name, info in rules["resources"].items()},
    }
    return arena, shop, settings

def action_schema(rules):
    bounds = rules["map"]
    def point(integer=False):
        return {"type": "object", "additionalProperties": False, "required": ["x", "y", "z"], "properties": {axis: {"type": "integer" if integer else "number", "minimum": bounds["build_min"][index], "maximum": bounds["build_max"][index]} for index, axis in enumerate("xyz")}}
    def order(kind, **fields):
        return {"type": "object", "additionalProperties": False, "required": ["type", *fields], "properties": {"type": {"const": kind}, **fields}}
    item_ids = [item["id"] for item in rules["shop"]]
    orders = [order("wait"), order("move", target=point()), order("bridge", target=point()),
              order("place", block=point(True), item={"enum": ["wool", "end_stone", "oak_planks", "obsidian", "glass", "ladder", "tnt", "sponge"]}),
              order("mine", block=point(True)), order("attack", targetId={"type": "string", "minLength": 1, "maxLength": 64}),
              order("equip", slot={"type": "integer", "minimum": 0, "maximum": 8}),
              order("equip", item={"enum": ["wooden_sword", *item_ids]}), order("use"),
              order("look", target=point()), order("upgrade", id={"enum":[u["id"] for u in rules.get("team_upgrades",[])]})]
    for operation in ["deposit", "withdraw"]:
        orders.append(order(operation, container={"enum":["team_chest","ender_chest"]}, item={"enum":list(rules['resources'])}, quantity={"type":"integer","minimum":1,"maximum":64}))
    orders.append(order("use", target=point(), durationTicks={"type":"integer","minimum":1,"maximum":40}))
    for item in rules["shop"]:
        orders.append(order("buy", item={"const": item["id"]}, quantity={"type": "integer", "minimum": item["amount"], "maximum": 64, "multipleOf": item["amount"]}))
    return {"$schema": "https://json-schema.org/draft/2020-12/schema", "$id": "urn:skyduel:action:0.1", "title": rules["submission"]["strategy_api"], "type": "object", "additionalProperties": False, "required": ["v", "order"], "properties": {"v": {"const": 1}, "order": {"oneOf": orders}}}

def markdown(rules):
    m, s = rules["match"], rules["submission"]
    rows = "\n".join(f"| {i['label']} | {i['amount']} | {i['price']} {rules['resources'][i['currency']]['label']} |" for i in rules["shop"])
    resources = "\n".join(f"| {info['label']} | {info['interval_seconds']} 秒 |" for info in rules["resources"].values())
    upgrades = "\n".join(f"| {u['label']} | {' / '.join(map(str,u['costs']))} |" for u in rules['team_upgrades'])
    phase_names = {'diamond_level':'钻石生成数量升级','emerald_level':'绿宝石生成数量升级','beds_gone':'所有存活的床消失','sudden_death':'边界开始向中心收缩'}
    potion_rows = "\n".join(f"| {i['label']} | {p['amplifier']+1} | {p['duration']} 秒 |" for i in rules["shop"] for p in (i.get("properties") if isinstance(i.get("properties"),list) else []) if p.get("name")=="SkyDuelPotion")
    phases = "\n".join(f"| {p['at_seconds']//60}:{p['at_seconds']%60:02d} | {phase_names[p['type']]}" + (f"，等级 {p['level']}" if 'level' in p else '') + " |" for p in rules['phases'])
    return f"""# {rules['title']} · {rules['version']}

本文件由当前模式的 `rules.json` 生成。状态为本地规则测试版；修改数值后必须重新生成，并给正式赛事发布新的版本。主办方负责地图、规则、裁判、运行和回放；参赛者自行编写策略或训练模型。训练模型不是报名的强制条件。

## 原版机制与起床战争规则

本赛项以 Minecraft Java {rules['engine']['minecraft']} 为基准。Minecraft 官方没有统一的起床战争商店、价格和复活规则；以下清楚区分原生行为与本赛项扩展。它不使用 1.8 的无冷却连点战斗。

| 范围 | 规则来源与实际行为 |
| --- | --- |
| 移动、碰撞、跳跃、潜行、游泳、楼梯 | Minecraft Java 1.21 原生物理；AI 发送正常玩家操作，不改速度或抵消击退 |
| 攻击、暴击、护甲和挖掘速度 | Minecraft Java 1.21 原生计算；剑存在攻击冷却，斧与剑的攻击速度不同 |
| 吃金苹果与喝药 | 原生持续使用，通常 32 刻（1.6 秒）；中断使用不会获得完整消耗效果 |
| 拉弓与放箭 | 原生蓄力，20 刻（1 秒）达到满蓄力；箭消耗、飞行与伤害交给服务器 |
| 金苹果效果 | 原生再生 II 5 秒、伤害吸收 I 120 秒；吸收生命与普通生命分别记录 |
| 末影珍珠、水桶、海绵、梯子 | 原生投掷/落点/冷却、流体、吸水及攀爬行为；珍珠传送的基础摔落伤害为 5 点，效果/附魔可改变最终损伤 |
| 拆床复活、商店、资源生成和团队升级 | 起床战争扩展，不是原版生存默认规则 |
| 永久装备与不消耗耐久 | 本赛项扩展：护甲和永久工具不可破坏、不可丢弃或存箱，死亡按下述规则保留/降级 |
| 自动点燃 TNT、可投掷火球、防爆玻璃 | 起床战争扩展；普通生存中的 TNT、火焰弹和玻璃没有这些默认行为 |
| 饥饿、自然回血、合成和友伤 | 本赛项均关闭；这些限制不是原版生存默认设置 |

## 游戏规则

- Minecraft Java {rules['engine']['minecraft']} / Paper {rules['engine']['paper_build']} / Screaming BedWars {rules['engine']['bedwars_plugin']}。
- {m['teams']} 队各 {m['players_per_team']} 人，开局倒计时 {m['countdown_seconds']} 秒，每局最多 {m['duration_seconds']} 秒游戏时间。卡服时不按墙钟提前结算。
- {rules['map'].get('description', '九座悬空岛，左右镜像；包括两座基地、两座前哨、四座钻石岛和中心绿宝石岛。')} 主桥留有缺口，需要选手搭建；原始建筑受保护。
- 初始 {m['initial_health']} 生命和一把木剑；无饥饿、无自然回血，金苹果效果按 Minecraft 1.21 处理。剑冷却、击退、暴击和挖掘时间采用固定版本原版机制。
- 以死亡时的床状态判定复活资格：死亡时床存在，{m['respawn_seconds']} 秒后在己方基地复活，获得木剑和 {m['respawn_protection_seconds']} 秒出生保护。倒计时期间床被拆，已经获得的这一次复活仍可完成；床被拆后再死亡，最终淘汰，不能复活。等待复活的旁观状态不显示为赛场角色。
- 初始皮甲；购买锁链、铁、钻石护甲升级护腿和靴子，头盔与胸甲保持队色皮甲。护甲永久保留，镐/斧死亡降一级、最低木制；剪刀保留。其余随身物品死亡掉落；箱内物资保留到本局结束。永久装备不能丢弃，重复购买同级或较低装备退回费用。
- 永久装备不生成地面掉落物，也不能存入箱子复制。工具可直接购买任意已列出的等级，按表格收费；商店没有列出的工具等级不可购买。普通箱可被各队访问；末影箱按玩家隔离，同一玩家可以从任意末影箱访问自己的储物。允许存取铁、金、钻石、绿宝石。
- 床被拆后当前玩家可以继续行动，但下次死亡最终淘汰。全队最终淘汰后该队出局；只剩一队时全队获胜；同时淘汰或到达时限后多队仍存活则平局。
- 只允许在赛区内放置/破坏参赛者放置的方块及敌方床；原始岛体受保护。建造范围为 {rules['map']['build_min']} 至 {rules['map']['build_max']}，按方块坐标含边界。
- 商店、装备和资源固定，不允许创造模式、非法飞行/位移、管理命令或修改裁判；末影珍珠属于允许的游戏内传送道具；实际到达商店范围、资源足够且背包可容纳时才能成交。
- 提供团队升级、弓箭、金苹果、自动点燃的 TNT、火球、末影珍珠、水桶和速度/跳跃/隐身药水。玻璃防爆；黑曜石需要合适工具，原始地图不受爆炸破坏。药水等级和时长由下表固定，隐身保留原版的装备可见性。它不会像部分 BedWars 插件那样额外隐藏盔甲。

## 资源与商店

| 资源 | 每个生成点间隔 |
| --- | --- |
{resources}

各生成点的地面堆积上限见 `rules.json` 的 `map.spawners`；达到上限暂停掉落，拾走后恢复。无初始囤积。商店数量是一次购买的一包，`buy.quantity` 必须是整包的倍数。基础间隔固定，生成器升级提高每轮生成数量。

| 物品 | 每包数量 | 每包价格 |
| --- | ---: | --- |
{rows}

## 特殊物品的明确参数

- 自动点燃 TNT：放置即点燃，{rules['mechanics']['bedwars']['tnt_fuse_ticks']} 刻（{rules['mechanics']['bedwars']['tnt_fuse_ticks']/20:g} 秒）引信，爆炸威力 {rules['mechanics']['bedwars']['tnt_explosion_power']}，会伤害放置者。爆炸威力不是固定生命伤害。
- 火球：右键发射是 BedWars 扩展，爆炸威力 {rules['mechanics']['bedwars']['fireball_explosion_power']}，会点火，也可能伤害发射者。Screaming BedWars 将火球对玩家的基础伤害设为 3 点，装备和效果再影响最终损伤；这项伤害设置属于插件扩展。
- 防爆白色玻璃免于本赛项爆炸拆除；原始地图方块也受保护。普通生存中的玻璃不具有这项特权。
- 普通物品商店可以在任一基地使用；团队升级必须到己方升级商人处购买。

| 药水 | 效果等级 | 持续时间 |
| --- | ---: | --- |
{potion_rows}

## 团队升级与比赛阶段

到己方升级商人处购买，每项按等级依次扣除钻石；升级作用于当前队伍整局。

| 升级 | 各级钻石费用 |
| --- | --- |
{upgrades}

锋利 I；保护 I–IV；急迫 I–II。熔炉 I/II 将铁金每轮产量提高至 2/3，III 解锁基地绿宝石（30 秒），IV 铁金产量提高至 4、基地绿宝石间隔 15 秒。治疗池在出生点 8 格内给予再生 I。陷阱最多存 3 次，敌人进入出生点 9 格范围时消耗一次，施加 5 秒失明/缓慢、解除隐身并提醒队友；触发间隔 15 秒。

| 比赛时间 | 事件 |
| --- | --- |
{phases}

突然死亡阶段，边界在 180 秒内从 {max(rules['map']['build_max'][i]-rules['map']['build_min'][i] for i in [0,2])+8} 格收缩到 16 格；越界按规则受伤。到 {m['duration_seconds']//60} 分钟仍有多队存活则平局。每局结束恢复床、方块、生成器和边界，清空装备与升级。

## 对阵与判分

{'同组四队打一局，获胜队全员获胜；' if m['teams']>2 else '同一对手交换红蓝各打一局；'}胜 {m['series']['win_points']} 分、平 {m['series']['draw_points']} 分、负 {m['series']['loss_points']} 分。比较同一赛程的积分，同分保留并列，不用伤害、采集或普通击杀破平。平台故障作废重赛；参赛策略运行故障的正式裁定还需要接入 AGX 执行器。本地调度器保存每名选手的场次和胜场，中止或测试局不计胜场。

## 投稿与观察合同

提交单个 UTF-8 `{s['file']}`，同步入口 `{s['entry']}`。允许算法策略或内嵌权重的本地推理；不允许联网、读宿主文件或调用云端模型。比赛间清空运行上下文；本局可以使用 JS 全局变量记忆历史。正式比赛运行提交时冻结的源码版本。

自身位置、血量、背包、装备与冷却可见；初始静态地图、商店价格、资源点和床状态公开。对手仅在 {s['visibility_radius_blocks']} 格内且无遮挡时出现；隐藏位置、精确血量、背包、冷却和策略源码不提供。动态方块只公开当前可见部分，选手可以记住历史观察。可使用 16 格内实际收到的方块音效及其位置进行判断，音效不附带隐藏敌人的身份或实时坐标。观察与动作的完整约定见 `CONTRACT.zh-CN.md`，动作结构见 `action.schema.json`。

策略每 {s['decision_interval_ticks']} 个游戏刻度调用一次，同一轮冻结观察并在统一后续刻度应用动作。平台辅助寻路、搭路和瞄准必须公开、版本固定，并受相同合法观察限制。

候选预算：源码 {s['source_bytes']//1048576} MiB、堆 {s['heap_bytes']//1048576} MiB、栈 {s['stack_bytes']//1048576} MiB、初始化 {s['init_wall_ms']} ms、单次回调 {s['act_wall_ms']} ms、每席每局累计 CPU {s['match_cpu_ms']//1000} 秒。预算仍需完整比赛执行器压测后冻结；目前不能把这些指标说成已经由 Minecraft 插件强制执行。

## 当前可用范围

已提供真实 Minecraft 地图、商店与经典机制扩展、机器可读规则源、动作 schema、示例策略、实时观战和整局结构化回放。网页按 10 Hz 服务器状态、逐刻事件和官方 1.21 物品模型重建画面，可播放、暂停和跳转；它不是原版客户端录屏。原版旁观入口使用未修改的 Java 1.21 客户端，真实动作、物品、界面和音效由游戏自身绘制。调试资源/阶段测试会标记为测试局，不列入正式演示回放。投稿执行器与 AGX 排名尚未接通；运行预算仍是候选值，不能据此开放正式报名。
"""

def build(source=None):
    source = Path(source or ROOT / "rules.json")
    output = source.parent
    rules = load_rules(source)
    generated = output / "generated"
    generated.mkdir(exist_ok=True)
    arena, shop, settings = server_configs(rules)
    for name, obj in [("arena.yml", arena), ("shop.yml", shop), ("settings.yml", settings)]:
        (generated/name).write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output/"action.schema.json").write_text(json.dumps(action_schema(rules), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output/"RULES.zh-CN.md").write_text(markdown(rules), encoding="utf-8")
    paths = [source, output/"action.schema.json", generated/"arena.yml", generated/"shop.yml", generated/"settings.yml"]
    manifest = {"rules_version": rules["version"], "files": {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}}
    (generated/"manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Compiled {rules['version']} ({rules['map']['id']})")

if __name__ == "__main__":
    build()
