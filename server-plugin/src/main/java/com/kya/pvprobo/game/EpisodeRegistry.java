package com.kya.pvprobo.game;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

public final class EpisodeRegistry {
    private final int maxTicks;
    private final int targetHits;
    private final Set<String> spectatorUsernames;
    private final Map<String, EpisodeState> states = new ConcurrentHashMap<>();
    private final Map<String, String> playerArena = new ConcurrentHashMap<>();

    public EpisodeRegistry(int maxTicks, int targetHits) {
        this(maxTicks, targetHits, List.of());
    }

    public EpisodeRegistry(int maxTicks, int targetHits, List<String> spectatorUsernames) {
        this.maxTicks = maxTicks;
        this.targetHits = targetHits;
        this.spectatorUsernames = normalizedNames(spectatorUsernames);
    }

    public EpisodeState state(String arenaId) {
        String normalized = normalizeArenaId(arenaId);
        return states.computeIfAbsent(normalized, id -> new EpisodeState(id, maxTicks, targetHits));
    }

    public EpisodeState stateForPlayer(String playerName) {
        if (isSpectator(playerName)) {
            return null;
        }
        String arenaId = playerArena.get(playerName);
        return arenaId == null ? null : state(arenaId);
    }

    public void registerPlayers(String arenaId, List<String> players) {
        EpisodeState state = state(arenaId);
        List<String> previous = state.registeredPlayers();
        for (String player : previous) {
            playerArena.remove(player, state.arenaId());
        }
        List<String> trainingPlayers = players.stream()
            .filter(player -> !isSpectator(player))
            .toList();
        state.registerPlayers(trainingPlayers);
        for (String player : trainingPlayers) {
            playerArena.put(player, state.arenaId());
        }
    }

    public List<String> registeredPlayers(String arenaId) {
        return state(arenaId).registeredPlayers();
    }

    public List<String> allRegisteredPlayers() {
        return new ArrayList<>(playerArena.keySet());
    }

    public boolean isSpectator(String playerName) {
        return spectatorUsernames.contains(normalizeName(playerName));
    }

    public Map<String, Object> status() {
        Map<String, Object> arenas = new LinkedHashMap<>();
        states.keySet().stream().sorted().forEach(arenaId -> {
            EpisodeState state = state(arenaId);
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("registered_players", state.registeredPlayers());
            item.put("episode_active", state.active());
            item.put("episode_id", state.episodeId());
            item.put("phase", state.phase());
            item.put("tick", state.tick());
            arenas.put(arenaId, item);
        });
        return arenas;
    }

    public void cleanup(String arenaId) {
        state(arenaId).cleanup();
    }

    public void cleanupAll() {
        for (EpisodeState state : states.values()) {
            state.cleanup();
        }
    }

    public static String normalizeArenaId(String arenaId) {
        if (arenaId == null || arenaId.isBlank() || arenaId.equals("default")) {
            return "arena_0";
        }
        return arenaId;
    }

    private static Set<String> normalizedNames(List<String> names) {
        Set<String> normalized = new HashSet<>();
        for (String name : names) {
            if (name != null && !name.isBlank()) {
                normalized.add(normalizeName(name));
            }
        }
        return Set.copyOf(normalized);
    }

    private static String normalizeName(String name) {
        return name == null ? "" : name.toLowerCase(Locale.ROOT);
    }
}
