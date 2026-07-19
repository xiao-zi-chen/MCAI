package com.kya.pvprobo.game;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import org.bukkit.ChatColor;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.ArmorStand;
import org.bukkit.plugin.Plugin;

public final class LeaderboardService {
    private static final String HOLOGRAM_TAG = "pvprobo_leaderboard";
    private static final int MAX_ENTRIES = 10;

    private final Plugin plugin;
    private final File file;
    private YamlConfiguration data;

    public LeaderboardService(Plugin plugin) {
        this.plugin = plugin;
        this.file = new File(plugin.getDataFolder(), "leaderboard.yml");
        this.data = YamlConfiguration.loadConfiguration(file);
    }

    public synchronized void record(
        String difficulty,
        String playerName,
        boolean won,
        int playerHits,
        int roboHits,
        int durationTicks
    ) {
        if (playerName == null || playerName.isBlank()) {
            return;
        }
        String key = normalizeDifficulty(difficulty);
        String path = "difficulties." + key + "." + playerName;
        int wins = data.getInt(path + ".wins", 0) + (won ? 1 : 0);
        int losses = data.getInt(path + ".losses", 0) + (won ? 0 : 1);
        int bestWinTicks = data.getInt(path + ".best-win-ticks", 0);
        int bestLossHits = data.getInt(path + ".best-loss-hits", 0);
        if (won && (bestWinTicks <= 0 || durationTicks < bestWinTicks)) {
            bestWinTicks = Math.max(1, durationTicks);
        }
        if (!won && playerHits > bestLossHits) {
            bestLossHits = playerHits;
        }
        data.set(path + ".wins", wins);
        data.set(path + ".losses", losses);
        data.set(path + ".best-win-ticks", bestWinTicks);
        data.set(path + ".best-loss-hits", bestLossHits);
        data.set(path + ".last-player-hits", playerHits);
        data.set(path + ".last-robo-hits", roboHits);
        data.set(path + ".last-duration-ticks", Math.max(0, durationTicks));
        save();
        refreshDisplay();
    }

    public synchronized void refreshDisplay() {
        Location base = leaderboardLocation();
        if (base == null || base.getWorld() == null || !plugin.getConfig().getBoolean("leaderboard.enabled", true)) {
            return;
        }
        World world = base.getWorld();
        removeExisting(world);
        double lineSpacing = plugin.getConfig().getDouble("leaderboard.line-spacing", 0.28);
        spawnLine(world, base.clone().add(0.0, lineSpacing * 2.0, 0.0), ChatColor.GOLD + "" + ChatColor.BOLD + serverName() + " Top Duels");
        spawnLine(world, base.clone().add(0.0, lineSpacing, 0.0), ChatColor.GRAY + "Wins: fastest time  |  No wins: most hits");

        List<String> difficulties = difficultyOrder();
        double columnSpacing = plugin.getConfig().getDouble("leaderboard.column-spacing-x", 4.5);
        double startOffset = -((difficulties.size() - 1) * columnSpacing) / 2.0;
        for (int column = 0; column < difficulties.size(); column++) {
            Location columnBase = base.clone().add(startOffset + column * columnSpacing, 0.0, 0.0);
            List<String> lines = displayLinesFor(difficulties.get(column));
            for (int row = 0; row < lines.size(); row++) {
                spawnLine(world, columnBase.clone().add(0.0, -row * lineSpacing, 0.0), lines.get(row));
            }
        }
    }

    public synchronized List<String> statusLines() {
        List<String> lines = new ArrayList<>();
        for (String difficulty : difficultyOrder()) {
            List<Record> records = ranked(difficulty);
            lines.add(displayName(difficulty) + ": " + records.size() + " ranked player(s)");
        }
        lines.add("file=" + file.getPath());
        return lines;
    }

    private List<String> displayLinesFor(String difficulty) {
        List<String> lines = new ArrayList<>();
        lines.add(ChatColor.YELLOW + "" + ChatColor.BOLD + displayName(difficulty));
        List<Record> records = ranked(difficulty);
        if (records.isEmpty()) {
            lines.add(ChatColor.DARK_GRAY + "No records yet");
            return lines;
        }
        for (int index = 0; index < Math.min(MAX_ENTRIES, records.size()); index++) {
            Record record = records.get(index);
            lines.add(formatRecord(index + 1, record));
        }
        return lines;
    }

    private String formatRecord(int rank, Record record) {
        String player = record.player.length() > 12 ? record.player.substring(0, 12) : record.player;
        if (record.hasWin()) {
            return ChatColor.AQUA + "" + rank + ". " + ChatColor.WHITE + player
                + ChatColor.GREEN + " W " + ChatColor.WHITE + seconds(record.bestWinTicks) + "s";
        }
        return ChatColor.AQUA + "" + rank + ". " + ChatColor.WHITE + player
            + ChatColor.RED + " " + record.bestLossHits + " hits";
    }

    private List<Record> ranked(String difficulty) {
        String path = "difficulties." + normalizeDifficulty(difficulty);
        if (!data.contains(path)) {
            return List.of();
        }
        List<Record> records = new ArrayList<>();
        if (data.getConfigurationSection(path) == null) {
            return List.of();
        }
        for (String player : data.getConfigurationSection(path).getKeys(false)) {
            String playerPath = path + "." + player;
            records.add(new Record(
                player,
                data.getInt(playerPath + ".wins", 0),
                data.getInt(playerPath + ".losses", 0),
                data.getInt(playerPath + ".best-win-ticks", 0),
                data.getInt(playerPath + ".best-loss-hits", 0)
            ));
        }
        records.sort(Comparator
            .comparing((Record record) -> !record.hasWin())
            .thenComparingInt(record -> record.hasWin() ? record.bestWinTicks : -record.bestLossHits)
            .thenComparing(record -> record.player.toLowerCase()));
        return records;
    }

    private void removeExisting(World world) {
        for (ArmorStand stand : world.getEntitiesByClass(ArmorStand.class)) {
            if (stand.getScoreboardTags().contains(HOLOGRAM_TAG)) {
                stand.remove();
            }
        }
    }

    private void spawnLine(World world, Location location, String text) {
        world.spawn(location, ArmorStand.class, stand -> {
            stand.addScoreboardTag(HOLOGRAM_TAG);
            stand.setInvisible(true);
            stand.setMarker(true);
            stand.setGravity(false);
            stand.setInvulnerable(true);
            stand.setCustomNameVisible(true);
            stand.setCustomName(text);
        });
    }

    private Location leaderboardLocation() {
        Location lobby = readLocation("lobby.spawn");
        if (lobby == null || lobby.getWorld() == null) {
            return null;
        }
        return lobby.add(
            plugin.getConfig().getDouble("leaderboard.offset.x", 0.0),
            plugin.getConfig().getDouble("leaderboard.offset.y", 4.0),
            plugin.getConfig().getDouble("leaderboard.offset.z", 10.0)
        );
    }

    private Location readLocation(String path) {
        if (!plugin.getConfig().contains(path + ".x")) {
            return null;
        }
        String worldName = plugin.getConfig().getString("lobby.world", plugin.getConfig().getString("duel.world", "world"));
        return new Location(
            plugin.getServer().getWorld(worldName),
            plugin.getConfig().getDouble(path + ".x", 0.0),
            plugin.getConfig().getDouble(path + ".y", 64.0),
            plugin.getConfig().getDouble(path + ".z", 0.0)
        );
    }

    private void save() {
        try {
            data.save(file);
        } catch (IOException exc) {
            plugin.getLogger().warning("Failed to save leaderboard: " + exc.getMessage());
        }
    }

    private List<String> difficultyOrder() {
        List<String> configured = plugin.getConfig().getStringList("duel.difficulty-order");
        if (!configured.isEmpty()) {
            return configured.stream().map(this::normalizeDifficulty).distinct().toList();
        }
        return List.of("bc", "ppo_mid", "ppo_high", "champion", "script_easy", "script_hard");
    }

    private String displayName(String difficulty) {
        return switch (normalizeDifficulty(difficulty)) {
            case "ppo_mid" -> plugin.getConfig().getString("duel.difficulty-names.ppo_mid", "Skilled ROBO");
            case "ppo_high" -> plugin.getConfig().getString("duel.difficulty-names.ppo_high", "Elite ROBO");
            case "script_easy" -> plugin.getConfig().getString("duel.difficulty-names.script_easy", "Basic SCRIPT");
            case "script_hard" -> plugin.getConfig().getString("duel.difficulty-names.script_hard", "Tough SCRIPT");
            case "champion" -> plugin.getConfig().getString("duel.difficulty-names.champion", "Champion ROBO");
            default -> plugin.getConfig().getString("duel.difficulty-names.bc", "Novice ROBO");
        };
    }

    private String normalizeDifficulty(String value) {
        if (value == null || value.isBlank()) {
            return "bc";
        }
        String normalized = value.toLowerCase();
        return switch (normalized) {
            case "bc", "ppo_mid", "ppo_high", "script_easy", "script_hard", "champion" -> normalized;
            default -> "bc";
        };
    }

    private String serverName() {
        return plugin.getConfig().getString("server.display-name", "PVPRobo");
    }

    private double seconds(int ticks) {
        return Math.round((ticks / 20.0) * 10.0) / 10.0;
    }

    private record Record(String player, int wins, int losses, int bestWinTicks, int bestLossHits) {
        boolean hasWin() {
            return wins > 0 && bestWinTicks > 0;
        }
    }
}
