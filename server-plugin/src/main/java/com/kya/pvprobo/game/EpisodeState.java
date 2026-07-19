package com.kya.pvprobo.game;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Queue;
import java.util.concurrent.ConcurrentLinkedQueue;

public final class EpisodeState {
    private final int maxTicks;
    private final int defaultTargetHits;
    private final Queue<String> events = new ConcurrentLinkedQueue<>();
    private List<String> registeredPlayers = List.of();
    private Map<String, Integer> hitCounts = new HashMap<>();
    private Map<String, Integer> pendingHitDeltas = new HashMap<>();
    private String episodeId = "";
    private String phase = "idle";
    private String doneReason = "idle";
    private final String arenaId;
    private String combatMode = "hit_count";
    private String lastHitter = "";
    private String winner = "";
    private int tick;
    private int targetHits;
    private boolean active;

    public EpisodeState(int maxTicks) {
        this("arena_0", maxTicks, 5);
    }

    public EpisodeState(int maxTicks, int targetHits) {
        this("arena_0", maxTicks, targetHits);
    }

    public EpisodeState(String arenaId, int maxTicks, int targetHits) {
        this.arenaId = EpisodeRegistry.normalizeArenaId(arenaId);
        this.maxTicks = maxTicks;
        this.defaultTargetHits = targetHits;
        this.targetHits = targetHits;
        resetHitCounts();
    }

    public synchronized void registerPlayers(List<String> players) {
        this.registeredPlayers = List.copyOf(players);
        resetHitCounts();
    }

    public synchronized List<String> registeredPlayers() {
        return new ArrayList<>(registeredPlayers);
    }

    public synchronized String playerA() {
        return registeredPlayers.isEmpty() ? "ROBO-A0" : registeredPlayers.get(0);
    }

    public synchronized String playerB() {
        return registeredPlayers.size() < 2 ? "SCRIPT-A0" : registeredPlayers.get(1);
    }

    public synchronized void setEpisodeId(String episodeId) {
        this.episodeId = episodeId;
    }

    public synchronized String episodeId() {
        return episodeId;
    }

    public synchronized String arenaId() {
        return arenaId;
    }

    public synchronized void configureRules(String combatMode, int targetHits) {
        this.combatMode = combatMode == null || combatMode.isBlank() ? "hit_count" : combatMode;
        this.targetHits = targetHits > 0 ? targetHits : defaultTargetHits;
        resetHitCounts();
    }

    public synchronized void start() {
        active = true;
        tick = 0;
        phase = "running";
        doneReason = "running";
        lastHitter = "";
        winner = "";
        events.clear();
        resetHitCounts();
    }

    public synchronized void beginCountdown() {
        active = false;
        tick = 0;
        phase = "countdown";
        doneReason = "countdown";
        lastHitter = "";
        winner = "";
        events.clear();
        resetHitCounts();
    }

    public synchronized void beginLoading() {
        active = false;
        tick = 0;
        phase = "loading";
        doneReason = "loading";
        lastHitter = "";
        winner = "";
        events.clear();
        resetHitCounts();
    }

    public synchronized void cleanup() {
        active = false;
        phase = "idle";
        doneReason = "cleanup";
        lastHitter = "";
        winner = "";
        events.clear();
        registeredPlayers = List.of();
        resetHitCounts();
    }

    public synchronized boolean active() {
        return active;
    }

    public synchronized int tick() {
        return tick;
    }

    public synchronized int maxTicks() {
        return maxTicks;
    }

    public synchronized int targetHits() {
        return targetHits;
    }

    public synchronized String combatMode() {
        return combatMode;
    }

    public synchronized String lastHitter() {
        return lastHitter;
    }

    public synchronized String winner() {
        return winner;
    }

    public synchronized String phase() {
        return phase;
    }

    public synchronized String doneReason() {
        return doneReason;
    }

    public synchronized void setPhase(String phase) {
        this.phase = phase;
    }

    public synchronized void markTick() {
        tick++;
        if (active && tick >= maxTicks) {
            active = false;
            phase = "draw";
            doneReason = "timeout";
            winner = "";
        }
    }

    public synchronized void playerDied(String name) {
        String canonicalName = canonicalPlayerName(name);
        if (isTerminalPhase()) {
            events.add("death_after_done:" + name);
            return;
        }
        if (canonicalName == null) {
            events.add("death_ignored:" + name);
            return;
        }
        active = false;
        if (canonicalName.equals(playerA())) {
            phase = "opponent_win";
            winner = playerB();
        } else if (canonicalName.equals(playerB())) {
            phase = "self_win";
            winner = playerA();
        } else {
            phase = "draw";
            winner = "";
        }
        doneReason = "death";
        events.add("death:" + canonicalName);
    }

    public synchronized void playerKnockedOut(String name) {
        String canonicalName = canonicalPlayerName(name);
        if (canonicalName == null) {
            events.add("knockout_ignored:" + name);
            return;
        }
        active = false;
        if (canonicalName.equals(playerA())) {
            phase = "opponent_win";
            winner = playerB();
        } else if (canonicalName.equals(playerB())) {
            phase = "self_win";
            winner = playerA();
        } else {
            phase = "draw";
            winner = "";
        }
        doneReason = "knockout";
        events.add("knockout:" + canonicalName);
    }

    public synchronized void draw(String reason) {
        active = false;
        phase = "draw";
        doneReason = reason == null || reason.isBlank() ? "draw" : reason;
        winner = "";
        events.add("draw:" + doneReason);
    }

    public synchronized void playerQuit(String name) {
        String canonicalName = canonicalPlayerName(name);
        if (canonicalName == null) {
            events.add("quit_ignored:" + name);
            return;
        }
        if (isTerminalPhase()) {
            events.add("quit_after_done:" + name);
            return;
        }
        active = false;
        phase = "draw";
        doneReason = "quit:" + canonicalName;
        winner = "";
        events.add("quit:" + canonicalName);
    }

    public synchronized boolean isRegisteredPlayer(String name) {
        return canonicalPlayerName(name) != null;
    }

    public synchronized boolean recordHit(String attacker, String victim) {
        if (!active || !"hit_count".equals(combatMode)) {
            return false;
        }
        String canonicalAttacker = canonicalPlayerName(attacker);
        String canonicalVictim = canonicalPlayerName(victim);
        if (canonicalAttacker == null || canonicalVictim == null || canonicalAttacker.equals(canonicalVictim)) {
            return false;
        }
        int next = hitCounts.getOrDefault(canonicalAttacker, 0) + 1;
        hitCounts.put(canonicalAttacker, next);
        pendingHitDeltas.put(canonicalAttacker, pendingHitDeltas.getOrDefault(canonicalAttacker, 0) + 1);
        lastHitter = canonicalAttacker;
        events.add("hit:" + canonicalAttacker + ":" + canonicalVictim + ":" + next);
        if (next >= targetHits) {
            active = false;
            winner = canonicalAttacker;
            if (canonicalAttacker.equals(playerA())) {
                phase = "self_win";
            } else if (canonicalAttacker.equals(playerB())) {
                phase = "opponent_win";
            } else {
                phase = "draw";
            }
            doneReason = "target_hits";
        }
        return true;
    }

    public synchronized Map<String, Integer> hitCounts() {
        return orderedCounts(hitCounts);
    }

    public synchronized Map<String, Integer> drainHitDeltas() {
        Map<String, Integer> deltas = orderedCounts(pendingHitDeltas);
        pendingHitDeltas.clear();
        return deltas;
    }

    public void addEvent(String event) {
        events.add(event);
    }

    public List<String> drainEvents() {
        List<String> drained = new ArrayList<>();
        String event;
        while ((event = events.poll()) != null) {
            drained.add(event);
        }
        return drained;
    }

    private synchronized void resetHitCounts() {
        hitCounts = new HashMap<>();
        pendingHitDeltas = new HashMap<>();
        for (String player : registeredPlayers) {
            hitCounts.put(player, 0);
            pendingHitDeltas.put(player, 0);
        }
    }

    private boolean isTerminalPhase() {
        return phase.equals("self_win") || phase.equals("opponent_win") || phase.equals("draw");
    }

    private String canonicalPlayerName(String name) {
        if (name == null) {
            return null;
        }
        for (String player : registeredPlayers) {
            if (player.equalsIgnoreCase(name)) {
                return player;
            }
        }
        return null;
    }

    private Map<String, Integer> orderedCounts(Map<String, Integer> source) {
        Map<String, Integer> ordered = new LinkedHashMap<>();
        for (String player : registeredPlayers) {
            ordered.put(player, source.getOrDefault(player, 0));
        }
        return ordered;
    }
}
