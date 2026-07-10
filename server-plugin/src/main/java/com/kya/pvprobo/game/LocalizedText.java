package com.kya.pvprobo.game;

import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;

public final class LocalizedText {
    private static final String DEFAULT_LANGUAGE = "en_us";
    private static final String CHINESE_SIMPLIFIED = "zh_cn";
    private static final Map<String, String> EN_US = Map.ofEntries(
        Map.entry("menu.duel.title", "PVPRobo Duel Menu"),
        Map.entry("menu.ai.title", "PVPRobo AI Battle"),
        Map.entry("menu.ai.watch", "Watch AI Battle"),
        Map.entry("menu.ai.watch.lore", "Pick two fighters and watch them duel."),
        Map.entry("menu.ai.prompt.first", "Pick the first fighter."),
        Map.entry("menu.ai.prompt.second", "First fighter: {0}. Pick the opponent."),
        Map.entry("menu.ai.clear", "Clear Fighter 1"),
        Map.entry("menu.ai.clear.lore", "Start over."),
        Map.entry("menu.admin.paste_lobby", "Paste Lobby Here"),
        Map.entry("menu.admin.paste_lobby.lore1", "Pastes Ancient Chinese Town at your location."),
        Map.entry("menu.admin.paste_lobby.lore2", "Also saves this as the return lobby."),
        Map.entry("menu.admin.paste_arena", "Paste Sumo Arena Here"),
        Map.entry("menu.admin.paste_arena.lore1", "Pastes the staged sumo arena at your location."),
        Map.entry("menu.admin.paste_arena.lore2", "Also saves default duel coordinates."),
        Map.entry("item.menu", "PVPRobo Menu"),
        Map.entry("item.menu.lore", "Right-click to open the duel menu."),
        Map.entry("item.start", "Start {0}"),
        Map.entry("item.start.robo.lore", "Right-click to enter the arena."),
        Map.entry("item.start.robo_strong.lore", "Right-click for a tougher duel."),
        Map.entry("item.ai.lore", "Right-click to set up an AI duel."),
        Map.entry("difficulty.bc", "Novice ROBO"),
        Map.entry("difficulty.ppo_mid", "Skilled ROBO"),
        Map.entry("difficulty.ppo_high", "Elite ROBO"),
        Map.entry("difficulty.champion", "Champion ROBO"),
        Map.entry("difficulty.script_easy", "Basic SCRIPT"),
        Map.entry("difficulty.script_hard", "Tough SCRIPT"),
        Map.entry("difficulty.challenge", "Challenge {0}"),
        Map.entry("difficulty.locked", "{0} Locked"),
        Map.entry("difficulty.unavailable", "{0} is not available yet."),
        Map.entry("difficulty.locked_lore", "This AI is not configured yet."),
        Map.entry("difficulty.ready", "Click to start the duel."),
        Map.entry("difficulty.bc.desc", "A steady ROBO built from player-style fights."),
        Map.entry("difficulty.ppo_mid.desc", "A trained ROBO with cleaner timing and spacing."),
        Map.entry("difficulty.ppo_high.desc", "A sharper ROBO that punishes sloppy trades."),
        Map.entry("difficulty.champion.desc", "The current top ROBO. Expect a hard fight."),
        Map.entry("difficulty.script_easy.desc", "A simple SCRIPT fighter for warming up."),
        Map.entry("difficulty.script_hard.desc", "A tougher SCRIPT fighter with stronger pressure."),
        Map.entry("duel.active", "A PVPRobo duel or AI battle is already active. Stop it before starting another fight."),
        Map.entry("duel.loading", "Getting the arena ready: {0} vs {1} on {2}. First to {3} hits wins."),
        Map.entry("ai.loading", "Setting up AI Battle: {0} ({1}) vs {2} ({3}). First to {4} hits wins."),
        Map.entry("ai.battle_draw", "AI Battle Draw"),
        Map.entry("ai.wins", "{0} Wins"),
        Map.entry("title.loading", "Loading"),
        Map.entry("title.loading.subtitle", "Waiting for AI to join"),
        Map.entry("title.fight", "Fight"),
        Map.entry("title.draw", "Draw"),
        Map.entry("title.victory", "Victory"),
        Map.entry("title.defeat", "Defeat"),
        Map.entry("title.no_winner", "No winner"),
        Map.entry("title.winner", "{0} wins"),
        Map.entry("score.duel.title", "ROBO DUEL"),
        Map.entry("score.ai.title", "AI BATTLE"),
        Map.entry("score.mode", "Mode"),
        Map.entry("score.goal", "Goal"),
        Map.entry("score.goal_hits", "{0} hits"),
        Map.entry("score.phase", "Phase"),
        Map.entry("score.you", "You"),
        Map.entry("score.server", "Server"),
        Map.entry("score.location", "Location"),
        Map.entry("score.date", "Date"),
        Map.entry("score.address", "Address"),
        Map.entry("phase.loading", "Loading"),
        Map.entry("phase.countdown", "Ready"),
        Map.entry("phase.running", "Fighting"),
        Map.entry("phase.finished", "Finished"),
        Map.entry("phase.draw", "Draw"),
        Map.entry("phase.lobby", "Lobby"),
        Map.entry("location.arena", "Arena"),
        Map.entry("location.lobby", "Lobby"),
        Map.entry("lobby.returned", "Returned to the PVPRobo lobby."),
        Map.entry("menu.locked", "This ROBO strength is not available yet."),
        Map.entry("admin.only_lobby", "Only server admins can paste lobby builds."),
        Map.entry("admin.only_arena", "Only server admins can paste arena builds.")
    );
    private static final Map<String, String> ZH_CN = Map.ofEntries(
        Map.entry("menu.duel.title", "PVPRobo 对战菜单"),
        Map.entry("menu.ai.title", "PVPRobo AI 观战"),
        Map.entry("menu.ai.watch", "观看 AI 对决"),
        Map.entry("menu.ai.watch.lore", "选择两名 AI，看它们打一场。"),
        Map.entry("menu.ai.prompt.first", "先选第一名选手。"),
        Map.entry("menu.ai.prompt.second", "第一名选手：{0}。再选它的对手。"),
        Map.entry("menu.ai.clear", "重选一号选手"),
        Map.entry("menu.ai.clear.lore", "重新开始选择。"),
        Map.entry("menu.admin.paste_lobby", "在此粘贴大厅"),
        Map.entry("menu.admin.paste_lobby.lore1", "在当前位置粘贴古风城镇大厅。"),
        Map.entry("menu.admin.paste_lobby.lore2", "并保存为玩家返回点。"),
        Map.entry("menu.admin.paste_arena", "在此粘贴相扑擂台"),
        Map.entry("menu.admin.paste_arena.lore1", "在当前位置粘贴已准备的相扑擂台。"),
        Map.entry("menu.admin.paste_arena.lore2", "并保存默认对战坐标。"),
        Map.entry("item.menu", "PVPRobo 菜单"),
        Map.entry("item.menu.lore", "右键打开对战菜单。"),
        Map.entry("item.start", "挑战 {0}"),
        Map.entry("item.start.robo.lore", "右键进入擂台。"),
        Map.entry("item.start.robo_strong.lore", "右键来一场更硬的对局。"),
        Map.entry("item.ai.lore", "右键安排一场 AI 对决。"),
        Map.entry("difficulty.bc", "新手 ROBO"),
        Map.entry("difficulty.ppo_mid", "熟练 ROBO"),
        Map.entry("difficulty.ppo_high", "精英 ROBO"),
        Map.entry("difficulty.champion", "冠军 ROBO"),
        Map.entry("difficulty.script_easy", "入门 SCRIPT"),
        Map.entry("difficulty.script_hard", "强劲 SCRIPT"),
        Map.entry("difficulty.challenge", "挑战 {0}"),
        Map.entry("difficulty.locked", "{0} 未解锁"),
        Map.entry("difficulty.unavailable", "{0} 暂时不能挑战。"),
        Map.entry("difficulty.locked_lore", "这个 AI 还没有配置好。"),
        Map.entry("difficulty.ready", "点击开始对战。"),
        Map.entry("difficulty.bc.desc", "稳扎稳打的 ROBO，适合先试手感。"),
        Map.entry("difficulty.ppo_mid.desc", "节奏和走位更像样的进阶 ROBO。"),
        Map.entry("difficulty.ppo_high.desc", "压迫感更强，失误会被抓得很疼。"),
        Map.entry("difficulty.champion.desc", "当前最强 ROBO，想赢它得认真打。"),
        Map.entry("difficulty.script_easy.desc", "基础 SCRIPT，热身用刚刚好。"),
        Map.entry("difficulty.script_hard.desc", "更强势的 SCRIPT，会主动给压力。"),
        Map.entry("duel.active", "当前已有一场 PVPRobo 对战或 AI 对决在进行，请先结束后再开始。"),
        Map.entry("duel.loading", "正在准备擂台：{0} vs {1}，难度 {2}，先命中 {3} 次获胜。"),
        Map.entry("ai.loading", "正在安排 AI 对决：{0}（{1}）vs {2}（{3}），先命中 {4} 次获胜。"),
        Map.entry("ai.battle_draw", "AI 对决平局"),
        Map.entry("ai.wins", "{0} 获胜"),
        Map.entry("title.loading", "加载中"),
        Map.entry("title.loading.subtitle", "等待 AI 加入"),
        Map.entry("title.fight", "开打"),
        Map.entry("title.draw", "平局"),
        Map.entry("title.victory", "胜利"),
        Map.entry("title.defeat", "失败"),
        Map.entry("title.no_winner", "无人获胜"),
        Map.entry("title.winner", "{0} 获胜"),
        Map.entry("score.duel.title", "ROBO 对战"),
        Map.entry("score.ai.title", "AI 对决"),
        Map.entry("score.mode", "难度"),
        Map.entry("score.goal", "目标"),
        Map.entry("score.goal_hits", "{0} 次命中"),
        Map.entry("score.phase", "阶段"),
        Map.entry("score.you", "你"),
        Map.entry("score.server", "服务器"),
        Map.entry("score.location", "位置"),
        Map.entry("score.date", "日期"),
        Map.entry("score.address", "地址"),
        Map.entry("phase.loading", "加载中"),
        Map.entry("phase.countdown", "准备"),
        Map.entry("phase.running", "战斗中"),
        Map.entry("phase.finished", "已结束"),
        Map.entry("phase.draw", "平局"),
        Map.entry("phase.lobby", "大厅"),
        Map.entry("location.arena", "擂台"),
        Map.entry("location.lobby", "大厅"),
        Map.entry("lobby.returned", "已返回 PVPRobo 大厅。"),
        Map.entry("menu.locked", "这个 ROBO 强度暂时不能挑战。"),
        Map.entry("admin.only_lobby", "只有服务器管理员可以粘贴大厅建筑。"),
        Map.entry("admin.only_arena", "只有服务器管理员可以粘贴擂台建筑。")
    );

    private final Plugin plugin;
    private final Map<String, Map<String, String>> catalogs = new HashMap<>();

    public LocalizedText(Plugin plugin) {
        this.plugin = plugin;
        catalogs.put(DEFAULT_LANGUAGE, EN_US);
        catalogs.put(CHINESE_SIMPLIFIED, ZH_CN);
    }

    public String language(Player player) {
        if (!plugin.getConfig().getBoolean("localization.auto-detect-client-locale", true)) {
            return configuredDefaultLanguage();
        }
        if (player == null) {
            return configuredDefaultLanguage();
        }
        Locale locale = player.locale();
        String tag = locale == null ? configuredDefaultLanguage() : locale.toString().toLowerCase(Locale.ROOT);
        if (catalogs.containsKey(tag)) {
            return tag;
        }
        String shortTag = tag.replace('-', '_');
        if (catalogs.containsKey(shortTag)) {
            return shortTag;
        }
        String language = locale == null ? "" : locale.getLanguage().toLowerCase(Locale.ROOT);
        if (language.equals("zh")) {
            return CHINESE_SIMPLIFIED;
        }
        return configuredDefaultLanguage();
    }

    public String text(Player player, String key, Object... args) {
        return text(language(player), key, args);
    }

    public String text(String language, String key, Object... args) {
        Map<String, String> catalog = catalogs.getOrDefault(language, catalogs.get(DEFAULT_LANGUAGE));
        String value = catalog.getOrDefault(key, catalogs.get(DEFAULT_LANGUAGE).getOrDefault(key, key));
        String configured = plugin.getConfig().getString("localization.overrides." + language + "." + key, value);
        return format(configured, args);
    }

    public boolean isDuelMenuTitle(String title) {
        return matchesTitle(title, "menu.duel.title");
    }

    public boolean isAiBattleMenuTitle(String title) {
        return matchesTitle(title, "menu.ai.title");
    }

    private boolean matchesTitle(String title, String key) {
        if (title == null) {
            return false;
        }
        for (String language : catalogs.keySet()) {
            if (text(language, key).equals(title)) {
                return true;
            }
        }
        return false;
    }

    private String configuredDefaultLanguage() {
        String configured = plugin.getConfig().getString("localization.default-language", DEFAULT_LANGUAGE);
        String normalized = configured == null ? DEFAULT_LANGUAGE : configured.toLowerCase(Locale.ROOT).replace('-', '_');
        return catalogs.containsKey(normalized) ? normalized : DEFAULT_LANGUAGE;
    }

    private String format(String template, Object... args) {
        String value = template;
        for (int index = 0; index < args.length; index++) {
            value = value.replace("{" + index + "}", String.valueOf(args[index]));
        }
        return value;
    }
}
