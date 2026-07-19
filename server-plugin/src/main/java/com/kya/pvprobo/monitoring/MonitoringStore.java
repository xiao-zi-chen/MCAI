package com.kya.pvprobo.monitoring;

import com.kya.pvprobo.game.DuelService;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;
import org.bukkit.scheduler.BukkitTask;

public final class MonitoringStore implements AutoCloseable {
    private final Plugin plugin;
    private final DuelService duelService;
    private final int maxSamples;
    private final ArrayDeque<Map<String, Object>> playerHistory = new ArrayDeque<>();
    private BukkitTask task;
    private volatile Map<String, Object> latest = Map.of();

    public MonitoringStore(Plugin plugin, DuelService duelService) {
        this.plugin = plugin;
        this.duelService = duelService;
        this.maxSamples = Math.max(1, plugin.getConfig().getInt("monitoring.history.max-samples", 4320));
    }

    public void start() {
        if (!enabled() || task != null) {
            return;
        }
        long intervalTicks = Math.max(20L, plugin.getConfig().getLong("monitoring.history.sample-interval-seconds", 20L) * 20L);
        task = plugin.getServer().getScheduler().runTaskTimer(plugin, this::sample, 1L, intervalTicks);
    }

    public Map<String, Object> summary() {
        return new LinkedHashMap<>(latest);
    }

    public List<Map<String, Object>> playerHistory() {
        synchronized (playerHistory) {
            return new ArrayList<>(playerHistory);
        }
    }

    private void sample() {
        Map<String, Object> sample = new LinkedHashMap<>();
        Collection<? extends Player> onlinePlayers = plugin.getServer().getOnlinePlayers();
        int backendOnline = onlinePlayers.size();
        int publicHumans = publicHumanCount(onlinePlayers);
        int maxHumans = plugin.getConfig().getInt("admission.max-human-players", -1);
        sample.put("timestamp", Instant.now().toString());
        sample.put("online_players", backendOnline);
        sample.put("max_players", plugin.getServer().getMaxPlayers());
        sample.put("public_human_players", publicHumans);
        sample.put("max_human_players", maxHumans);
        sample.put("bot_players", Math.max(0, backendOnline - publicHumans));
        sample.put("players", playerNames(onlinePlayers));
        sample.put("server_name", plugin.getConfig().getString("server.display-name", "PVPRobo"));
        sample.put("server_domain", plugin.getConfig().getString("server.domain", ""));
        sample.put("duel", duelService.protocolStatus());
        sample.put("duels", duelService.protocolStatuses());
        latest = sample;
        synchronized (playerHistory) {
            playerHistory.addLast(sample);
            while (playerHistory.size() > maxSamples) {
                playerHistory.removeFirst();
            }
        }
    }

    private List<String> playerNames(Collection<? extends Player> players) {
        List<String> names = new ArrayList<>();
        for (Player player : players) {
            names.add(player.getName());
        }
        names.sort(String::compareToIgnoreCase);
        return names;
    }

    private int publicHumanCount(Collection<? extends Player> players) {
        int count = 0;
        for (Player player : players) {
            if (!isBotName(player.getName()) && !isSpectator(player.getName())) {
                count++;
            }
        }
        return count;
    }

    private boolean isBotName(String name) {
        if (name == null || name.isBlank()) {
            return false;
        }
        String upper = name.toUpperCase(Locale.ROOT);
        for (String prefix : plugin.getConfig().getStringList("admission.bot-name-prefixes")) {
            if (!prefix.isBlank() && upper.startsWith(prefix.toUpperCase(Locale.ROOT))) {
                return true;
            }
        }
        return upper.matches("ROBO[-_][A-Z][0-9]+") || upper.matches("SCRIPT[-_][A-Z][0-9]+");
    }

    private boolean isSpectator(String name) {
        if (name == null) {
            return false;
        }
        for (String spectator : plugin.getConfig().getStringList("spectators.usernames")) {
            if (name.equalsIgnoreCase(spectator)) {
                return true;
            }
        }
        return false;
    }

    private boolean enabled() {
        return plugin.getConfig().getBoolean("monitoring.enabled", true);
    }

    @Override
    public void close() {
        if (task != null) {
            task.cancel();
            task = null;
        }
    }
}
