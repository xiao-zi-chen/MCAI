package com.kya.pvprobo.control;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.kya.pvprobo.game.ArenaService;
import com.kya.pvprobo.game.DuelService;
import com.kya.pvprobo.game.EpisodeRegistry;
import com.kya.pvprobo.game.EpisodeState;
import com.kya.pvprobo.game.SnapshotService;
import com.kya.pvprobo.thread.MainThreadBridge;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class PluginCommandHandler {
    private final String pluginVersion;
    private final MainThreadBridge mainThread;
    private final EpisodeRegistry episodeRegistry;
    private final ArenaService arenaService;
    private final SnapshotService snapshotService;
    private final DuelService duelService;

    public PluginCommandHandler(
        String pluginVersion,
        MainThreadBridge mainThread,
        EpisodeRegistry episodeRegistry,
        ArenaService arenaService,
        SnapshotService snapshotService,
        DuelService duelService
    ) {
        this.pluginVersion = pluginVersion;
        this.mainThread = mainThread;
        this.episodeRegistry = episodeRegistry;
        this.arenaService = arenaService;
        this.snapshotService = snapshotService;
        this.duelService = duelService;
    }

    public Map<String, Object> handle(String line) {
        String id = "unknown";
        try {
            JsonObject request = JsonProtocol.decode(line);
            id = request.get("id").getAsString();
            return dispatch(request);
        } catch (Exception ex) {
            Map<String, Object> error = base(id, "error");
            error.put("ok", false);
            error.put("error", ex.getMessage());
            return error;
        }
    }

    private Map<String, Object> dispatch(JsonObject request) throws Exception {
        String id = request.get("id").getAsString();
        String type = request.get("type").getAsString();

        return switch (type) {
            case "hello" -> hello(id);
            case "ping" -> ok(id, "pong");
            case "status" -> status(id);
            case "register_players" -> registerPlayers(id, request);
            case "list_players" -> players(id);
            case "reset" -> mainThread.call(() -> reset(id, request));
            case "start_episode" -> mainThread.call(() -> startEpisode(id, request));
            case "observe", "snapshot_request" -> mainThread.call(() -> snapshot(id, request));
            case "wait_tick", "tick_snapshot" -> mainThread.call(() -> waitTickSnapshot(id, request));
            case "reward_snapshot" -> mainThread.call(() -> reward(id, request));
            case "done" -> mainThread.call(() -> done(id, request));
            case "cleanup" -> mainThread.call(() -> cleanup(id, request));
            case "start_ai_battle" -> mainThread.call(() -> startAiBattle(id, request));
            case "duel_participants_ready" -> mainThread.call(() -> duelParticipantsReady(id, request));
            case "stop_duel" -> mainThread.call(() -> stopDuel(id));
            default -> error(id, "unsupported message type: " + type);
        };
    }

    private Map<String, Object> hello(String id) {
        Map<String, Object> response = base(id, "hello_ack");
        response.put("server", "pvprobo-paper-plugin");
        response.put("plugin_version", pluginVersion);
        return response;
    }

    private Map<String, Object> status(String id) {
        Map<String, Object> response = ok(id, "status");
        EpisodeState defaultState = episodeRegistry.state("arena_0");
        response.put("registered_players", defaultState.registeredPlayers());
        response.put("episode_active", defaultState.active());
        response.put("episode_id", defaultState.episodeId());
        response.put("arenas", episodeRegistry.status());
        Map<String, Object> duelStatus = duelService.protocolStatus();
        response.put("duel", duelStatus);
        response.put("duels", List.of(duelStatus));
        return response;
    }

    private Map<String, Object> registerPlayers(String id, JsonObject request) {
        String arenaId = arenaId(request);
        JsonArray array = request.getAsJsonArray("players");
        List<String> players = new ArrayList<>();
        for (int i = 0; i < array.size(); i++) {
            players.add(array.get(i).getAsString());
        }
        episodeRegistry.registerPlayers(arenaId, players);
        EpisodeState episodeState = episodeRegistry.state(arenaId);
        Map<String, Object> response = ok(id, "register_players_ack");
        response.put("arena_id", episodeState.arenaId());
        response.put("registered_players", episodeState.registeredPlayers());
        return response;
    }

    private Map<String, Object> players(String id) {
        Map<String, Object> response = base(id, "players");
        response.put("registered_players", episodeRegistry.allRegisteredPlayers());
        response.put("arenas", episodeRegistry.status());
        return response;
    }

    private Map<String, Object> reset(String id, JsonObject request) {
        String arenaId = arenaId(request);
        EpisodeState episodeState = episodeRegistry.state(arenaId);
        if (request.has("episode_id")) {
            episodeState.setEpisodeId(request.get("episode_id").getAsString());
        }
        String combatMode = request.has("combat_mode") ? request.get("combat_mode").getAsString() : "hit_count";
        int targetHits = request.has("target_hits") ? request.get("target_hits").getAsInt() : episodeState.targetHits();
        episodeState.configureRules(combatMode, targetHits);
        arenaService.resetArena(episodeState.arenaId());
        episodeState.setPhase("reset");
        Map<String, Object> response = base(id, "reset_ack");
        response.put("arena_id", episodeState.arenaId());
        response.put("tick", episodeState.tick());
        response.put("snapshot", snapshotService.snapshot(episodeState));
        return response;
    }

    private Map<String, Object> startEpisode(String id, JsonObject request) {
        EpisodeState episodeState = episodeRegistry.state(arenaId(request));
        if (request.has("episode_id")) {
            episodeState.setEpisodeId(request.get("episode_id").getAsString());
        }
        episodeState.start();
        Map<String, Object> response = ok(id, "start_episode_ack");
        response.put("arena_id", episodeState.arenaId());
        response.put("tick", episodeState.tick());
        return response;
    }

    private Map<String, Object> snapshot(String id, JsonObject request) {
        Map<String, Object> snapshot = snapshotService.snapshot(episodeRegistry.state(arenaId(request)));
        snapshot.put("id", id);
        return snapshot;
    }

    private Map<String, Object> waitTickSnapshot(String id, JsonObject request) {
        EpisodeState episodeState = episodeRegistry.state(arenaId(request));
        episodeState.markTick();
        duelService.onTick(episodeState);
        return snapshot(id, request);
    }

    private Map<String, Object> reward(String id, JsonObject request) {
        EpisodeState episodeState = episodeRegistry.state(arenaId(request));
        Map<String, Object> response = base(id, "reward");
        response.put("arena_id", episodeState.arenaId());
        response.putAll(snapshotService.rewardSnapshot(episodeState));
        return response;
    }

    private Map<String, Object> done(String id, JsonObject request) {
        EpisodeState episodeState = episodeRegistry.state(arenaId(request));
        Map<String, Object> response = base(id, "done");
        response.put("arena_id", episodeState.arenaId());
        response.putAll(snapshotService.doneSnapshot(episodeState));
        return response;
    }

    private Map<String, Object> cleanup(String id, JsonObject request) {
        if (request.has("arena_id") || request.has("arena")) {
            EpisodeState episodeState = episodeRegistry.state(arenaId(request));
            episodeRegistry.cleanup(episodeState.arenaId());
            Map<String, Object> response = ok(id, "cleanup_ack");
            response.put("arena_id", episodeState.arenaId());
            return response;
        }
        arenaService.cleanupArena();
        episodeRegistry.cleanupAll();
        return ok(id, "cleanup_ack");
    }

    private Map<String, Object> startAiBattle(String id, JsonObject request) {
        String left = request.has("left_difficulty") ? request.get("left_difficulty").getAsString() : "bc";
        String right = request.has("right_difficulty") ? request.get("right_difficulty").getAsString() : "ppo_mid";
        String viewer = request.has("viewer") ? request.get("viewer").getAsString() : "";
        int targetHits = request.has("target_hits") ? request.get("target_hits").getAsInt() : 0;
        String message = duelService.startAiBattle(viewer, left, right, targetHits);
        Map<String, Object> response = ok(id, "start_ai_battle_ack");
        response.put("message", message);
        response.put("duel", duelService.protocolStatus());
        return response;
    }

    private Map<String, Object> duelParticipantsReady(String id, JsonObject request) {
        String episodeId = request.has("episode_id") ? request.get("episode_id").getAsString() : "";
        String message = duelService.participantsReady(episodeId);
        Map<String, Object> response = ok(id, "duel_participants_ready_ack");
        response.put("message", message);
        response.put("duel", duelService.protocolStatus());
        return response;
    }

    private Map<String, Object> stopDuel(String id) {
        String message = duelService.stop();
        Map<String, Object> response = ok(id, "stop_duel_ack");
        response.put("message", message);
        response.put("duel", duelService.protocolStatus());
        return response;
    }

    private String arenaId(JsonObject request) {
        if (request.has("arena_id")) {
            return request.get("arena_id").getAsString();
        }
        if (request.has("arena")) {
            return request.get("arena").getAsString();
        }
        return "arena_0";
    }

    private static Map<String, Object> ok(String id, String type) {
        Map<String, Object> response = base(id, type);
        response.put("ok", true);
        return response;
    }

    private static Map<String, Object> error(String id, String message) {
        Map<String, Object> response = base(id, "error");
        response.put("ok", false);
        response.put("error", message);
        return response;
    }

    private static Map<String, Object> base(String id, String type) {
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("v", JsonProtocol.VERSION);
        response.put("id", id);
        response.put("type", type);
        return response;
    }
}
