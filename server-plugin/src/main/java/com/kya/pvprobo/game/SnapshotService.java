package com.kya.pvprobo.game;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.bukkit.util.Vector;

public final class SnapshotService {
    public SnapshotService() {
    }

    public Map<String, Object> snapshot(EpisodeState episodeState) {
        Map<String, Object> snapshot = new LinkedHashMap<>();
        snapshot.put("v", 1);
        snapshot.put("id", "snapshot");
        snapshot.put("type", "snapshot");
        snapshot.put("arena_id", episodeState.arenaId());
        snapshot.put("tick", episodeState.tick());
        snapshot.put("phase", episodeState.phase());
        snapshot.put("combat_mode", episodeState.combatMode());
        snapshot.put("target_hits", episodeState.targetHits());
        snapshot.put("hit_counts", episodeState.hitCounts());
        snapshot.put("hit_deltas", episodeState.drainHitDeltas());
        snapshot.put("last_hitter", episodeState.lastHitter());
        snapshot.put("winner", episodeState.winner());
        snapshot.put("done_reason", episodeState.doneReason());
        snapshot.put("players", playerSnapshots(episodeState));
        snapshot.put("events", episodeState.drainEvents());
        return snapshot;
    }

    public Map<String, Object> rewardSnapshot(EpisodeState episodeState) {
        Player a = Bukkit.getPlayerExact(episodeState.playerA());
        Player b = Bukkit.getPlayerExact(episodeState.playerB());
        double selfHp = a == null ? 0.0 : a.getHealth();
        double opponentHp = b == null ? 0.0 : b.getHealth();
        Map<String, Object> reward = new LinkedHashMap<>();
        reward.put("reward", (selfHp - opponentHp) / 20.0);
        reward.put("self_hp", selfHp);
        reward.put("opponent_hp", opponentHp);
        reward.put("hit_counts", episodeState.hitCounts());
        reward.put("last_hitter", episodeState.lastHitter());
        reward.put("winner", episodeState.winner());
        return reward;
    }

    public Map<String, Object> doneSnapshot(EpisodeState episodeState) {
        Map<String, Object> done = new LinkedHashMap<>();
        boolean terminated = episodeState.phase().endsWith("_win") || episodeState.phase().equals("draw");
        boolean truncated = episodeState.tick() >= episodeState.maxTicks();
        done.put("terminated", terminated);
        done.put("truncated", truncated);
        done.put("reason", episodeState.doneReason());
        return done;
    }

    private List<Map<String, Object>> playerSnapshots(EpisodeState episodeState) {
        List<Map<String, Object>> players = new ArrayList<>();
        for (String name : episodeState.registeredPlayers()) {
            Player player = Bukkit.getPlayerExact(name);
            if (player != null) {
                players.add(playerSnapshot(player, opponentFor(episodeState, name)));
            }
        }
        return players;
    }

    private Player opponentFor(EpisodeState episodeState, String playerName) {
        for (String name : episodeState.registeredPlayers()) {
            if (!name.equals(playerName)) {
                return Bukkit.getPlayerExact(name);
            }
        }
        return null;
    }

    private Map<String, Object> playerSnapshot(Player player, Player opponent) {
        Location loc = player.getLocation();
        Vector velocity = player.getVelocity();
        Map<String, Object> snapshot = new LinkedHashMap<>();
        snapshot.put("name", player.getName());
        snapshot.put("hp", player.getHealth());
        snapshot.put("max_hp", 20.0);
        snapshot.put("pos", List.of(loc.getX(), loc.getY(), loc.getZ()));
        snapshot.put("vel", List.of(velocity.getX(), velocity.getY(), velocity.getZ()));
        snapshot.put("yaw", loc.getYaw());
        snapshot.put("pitch", loc.getPitch());
        snapshot.put("attack_cooldown", player.getAttackCooldown());
        snapshot.put("hurt_time", player.getNoDamageTicks());
        snapshot.put("on_ground", player.isOnGround());
        snapshot.put("line_of_sight", opponent != null && CombatHitValidator.hasLineOfSightTo(player, opponent));
        return snapshot;
    }

}
