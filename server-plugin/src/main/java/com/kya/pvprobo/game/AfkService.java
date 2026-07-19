package com.kya.pvprobo.game;

import java.util.Collection;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;
import org.bukkit.scheduler.BukkitTask;

public final class AfkService implements AutoCloseable {
    private final Plugin plugin;
    private final DuelService duelService;
    private final AfkTracker tracker;
    private BukkitTask task;

    public AfkService(Plugin plugin, DuelService duelService) {
        this.plugin = plugin;
        this.duelService = duelService;
        this.tracker = new AfkTracker(
            plugin.getConfig().getLong("afk.warn-after-seconds", 900L),
            plugin.getConfig().getLong("afk.kick-after-seconds", 1200L)
        );
    }

    public void start() {
        if (!enabled() || task != null) {
            return;
        }
        long intervalSeconds = Math.max(5L, plugin.getConfig().getLong("afk.check-interval-seconds", 30L));
        task = plugin.getServer().getScheduler().runTaskTimer(plugin, this::checkOnlinePlayers, 20L, intervalSeconds * 20L);
    }

    public void recordActivity(Player player) {
        if (player == null || !shouldTrack(player)) {
            return;
        }
        tracker.recordActivity(player.getName(), System.currentTimeMillis());
    }

    public void forget(Player player) {
        if (player != null) {
            tracker.forget(player.getName());
        }
    }

    private void checkOnlinePlayers() {
        Collection<? extends Player> players = plugin.getServer().getOnlinePlayers();
        long now = System.currentTimeMillis();
        for (Player player : players) {
            if (!shouldTrack(player)) {
                tracker.forget(player.getName());
                continue;
            }
            AfkTracker.Decision decision = tracker.check(player.getName(), now);
            if (decision == AfkTracker.Decision.WARN) {
                player.sendMessage(plugin.getConfig().getString("afk.warning-message", "You have been idle for a while. Move or use the menu to keep your PVPRobo slot."));
            } else if (decision == AfkTracker.Decision.KICK) {
                String message = plugin.getConfig().getString("afk.kick-message", "You were disconnected for being idle so another player can use the PVPRobo slot.");
                tracker.forget(player.getName());
                player.kickPlayer(message);
            }
        }
    }

    private boolean shouldTrack(Player player) {
        return enabled() && duelService.shouldAfkCheck(player);
    }

    private boolean enabled() {
        return plugin.getConfig().getBoolean("afk.enabled", true);
    }

    @Override
    public void close() {
        if (task != null) {
            task.cancel();
            task = null;
        }
    }
}
