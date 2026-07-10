package com.kya.pvprobo.game;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Locale;
import java.util.Set;
import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;
import org.bukkit.scoreboard.DisplaySlot;
import org.bukkit.scoreboard.Objective;
import org.bukkit.scoreboard.Scoreboard;
import org.bukkit.scoreboard.ScoreboardManager;

public final class DuelService {
    public static final String MENU_TITLE = "PVPRobo Duel Menu";
    public static final String AI_BATTLE_MENU_TITLE = "PVPRobo AI Battle";
    private final Plugin plugin;
    private final EpisodeRegistry episodeRegistry;
    private final ArenaService arenaService;
    private String arenaId;
    private String roboName;
    private String playerName = "";
    private String difficulty = "bc";
    private String mode = "player_duel";
    private String aiLeftName = "";
    private String aiRightName = "";
    private String aiLeftDifficulty = "bc";
    private String aiRightDifficulty = "ppo_mid";
    private boolean active;
    private boolean celebrated;
    private Location lobbyLocation;
    private final LocalizedText text;
    private long runningSinceMillis;
    private final Set<String> playtestPlayerMode = new HashSet<>();
    private final Set<String> aiBattleViewers = new HashSet<>();
    private final Map<String, String> pendingAiBattleLeft = new HashMap<>();

    public DuelService(Plugin plugin, EpisodeRegistry episodeRegistry, ArenaService arenaService) {
        this.plugin = plugin;
        this.episodeRegistry = episodeRegistry;
        this.arenaService = arenaService;
        this.arenaId = plugin.getConfig().getString("duel.arena-id", "arena_0");
        this.roboName = plugin.getConfig().getString("duel.default-robo-name", "ROBO");
        this.lobbyLocation = configLocationOrNull("lobby.spawn");
        this.text = new LocalizedText(plugin);
        updateWorldSpawn(this.lobbyLocation);
    }

    public boolean isDuelMenuTitle(String title) {
        return text.isDuelMenuTitle(title);
    }

    public boolean isAiBattleMenuTitle(String title) {
        return text.isAiBattleMenuTitle(title);
    }

    public boolean canAdmitLogin(Player player) {
        int maxHumanPlayers = plugin.getConfig().getInt("admission.max-human-players", -1);
        if (maxHumanPlayers < 0 || player.isOp() || isRoboName(player.getName()) || episodeRegistry.isSpectator(player.getName())) {
            return true;
        }
        int humans = 0;
        for (Player online : plugin.getServer().getOnlinePlayers()) {
            if (!online.getName().equalsIgnoreCase(player.getName())
                && !online.isOp()
                && !isRoboName(online.getName())
                && !episodeRegistry.isSpectator(online.getName())) {
                humans++;
            }
        }
        return humans < maxHumanPlayers;
    }

    public String admissionFullMessage() {
        return plugin.getConfig().getString("admission.full-message", "PVPRobo human player slots are full. Please try again later.");
    }

    public synchronized String start(String playerName, String difficulty, int targetHits) {
        return start(playerName, difficulty, targetHits, null);
    }

    private synchronized String start(String playerName, String difficulty, int targetHits, Player viewer) {
        if (active) {
            return viewer == null ? "A PVPRobo duel or AI battle is already active. Stop it before starting another fight." : text.text(viewer, "duel.active");
        }
        String requestedDifficulty = normalizeDifficulty(difficulty);
        if (!isDifficultyEnabled(requestedDifficulty)) {
            return viewer == null
                ? difficultyDisplayName(requestedDifficulty) + " is not available yet."
                : text.text(viewer, "difficulty.unavailable", difficultyDisplayName(viewer, requestedDifficulty));
        }
        this.mode = "player_duel";
        this.difficulty = requestedDifficulty;
        this.playerName = playerName;
        this.aiLeftName = "";
        this.aiRightName = "";
        this.aiBattleViewers.clear();
        this.pendingAiBattleLeft.remove(playerName.toLowerCase(Locale.ROOT));
        this.active = true;
        this.celebrated = false;
        this.runningSinceMillis = 0L;
        EpisodeState state = episodeRegistry.state(arenaId);
        episodeRegistry.registerPlayers(arenaId, List.of(roboName, playerName));
        state.configureRules("hit_count", targetHits > 0 ? targetHits : defaultTargetHits());
        state.setEpisodeId("duel-" + System.currentTimeMillis());
        state.beginLoading();
        state.addEvent("duel_start:" + playerName + ":" + roboName + ":" + this.difficulty);
        showLoadingTitle(state);
        updateScoreboards(state);
        return viewer == null
            ? "Loading duel " + playerName + " vs " + roboName + " difficulty=" + difficultyDisplayName(this.difficulty) + " target_hits=" + state.targetHits()
            : text.text(viewer, "duel.loading", playerName, roboName, difficultyDisplayName(viewer, this.difficulty), state.targetHits());
    }

    public synchronized String startAiBattle(Player viewer, String leftDifficulty, String rightDifficulty, int targetHits) {
        return startAiBattle(viewer, viewer.getName(), leftDifficulty, rightDifficulty, targetHits);
    }

    public synchronized String startAiBattle(String viewerName, String leftDifficulty, String rightDifficulty, int targetHits) {
        Player viewer = viewerName == null || viewerName.isBlank() ? null : plugin.getServer().getPlayerExact(viewerName);
        return startAiBattle(viewer, viewerName == null ? "" : viewerName, leftDifficulty, rightDifficulty, targetHits);
    }

    private synchronized String startAiBattle(Player viewer, String viewerName, String leftDifficulty, String rightDifficulty, int targetHits) {
        if (active) {
            return viewer == null ? "A PVPRobo duel or AI battle is already active. Stop it before starting another fight." : text.text(viewer, "duel.active");
        }
        String left = normalizeDifficulty(leftDifficulty);
        String right = normalizeDifficulty(rightDifficulty);
        if (!isDifficultyEnabled(left)) {
            return viewer == null ? difficultyDisplayName(left) + " is not available yet." : text.text(viewer, "difficulty.unavailable", difficultyDisplayName(viewer, left));
        }
        if (!isDifficultyEnabled(right)) {
            return viewer == null ? difficultyDisplayName(right) + " is not available yet." : text.text(viewer, "difficulty.unavailable", difficultyDisplayName(viewer, right));
        }
        this.mode = "ai_battle";
        this.playerName = "";
        this.difficulty = left;
        this.aiLeftDifficulty = left;
        this.aiRightDifficulty = right;
        this.aiLeftName = aiRoboName(left, 0);
        this.aiRightName = aiRoboName(right, left.equals(right) ? 1 : 0);
        this.active = true;
        this.celebrated = false;
        this.runningSinceMillis = 0L;
        this.aiBattleViewers.clear();
        if (viewerName != null && !viewerName.isBlank()) {
            this.aiBattleViewers.add(viewerName);
            this.pendingAiBattleLeft.remove(viewerName.toLowerCase(Locale.ROOT));
        }

        EpisodeState state = episodeRegistry.state(arenaId);
        episodeRegistry.registerPlayers(arenaId, List.of(aiLeftName, aiRightName));
        state.configureRules("hit_count", targetHits > 0 ? targetHits : defaultTargetHits());
        state.setEpisodeId("ai-battle-" + System.currentTimeMillis());
        moveIdleRoboToStandby();
        state.beginLoading();
        state.addEvent("ai_battle_start:" + aiLeftName + ":" + aiRightName + ":" + aiLeftDifficulty + ":" + aiRightDifficulty);
        if (viewer != null) {
            moveViewerToAiBattle(viewer);
        }
        showLoadingTitle(state);
        updateScoreboards(state);
        return viewer == null
            ? "Loading AI battle " + aiLeftName + " (" + difficultyDisplayName(aiLeftDifficulty) + ") vs "
                + aiRightName + " (" + difficultyDisplayName(aiRightDifficulty) + ") target_hits=" + state.targetHits()
                + " waiting_for_ai=true"
            : text.text(viewer, "ai.loading", aiLeftName, difficultyDisplayName(viewer, aiLeftDifficulty), aiRightName, difficultyDisplayName(viewer, aiRightDifficulty), state.targetHits());
    }

    public synchronized String participantsReady(String episodeId) {
        EpisodeState state = episodeRegistry.state(arenaId);
        if (!active || !state.episodeId().equals(episodeId)) {
            return "Ignoring readiness for inactive or stale episode " + episodeId;
        }
        if (!state.phase().equals("loading")) {
            return "Episode " + episodeId + " is already phase=" + state.phase();
        }
        List<String> missing = missingOnlineParticipants(state);
        if (!missing.isEmpty()) {
            return "Waiting for participants: " + missing;
        }
        if (mode.equals("ai_battle")) {
            arenaService.resetDuelArenaParticipants(arenaId, aiLeftName, aiRightName);
        } else {
            arenaService.resetDuelArena(arenaId, playerName, roboName);
        }
        state.beginCountdown();
        state.addEvent("participants_ready:" + String.join(",", state.registeredPlayers()));
        updateScoreboards(state);
        scheduleCountdown(state.episodeId());
        return "Participants ready for " + episodeId + "; countdown=" + countdownSeconds() + "s";
    }

    public synchronized String stop() {
        active = false;
        celebrated = false;
        runningSinceMillis = 0L;
        returnPlayersToLobby(episodeRegistry.state(arenaId));
        episodeRegistry.cleanup(arenaId);
        return "Stopped duel arena " + arenaId;
    }

    public synchronized String status() {
        EpisodeState state = episodeRegistry.state(arenaId);
        return "duel active=" + active
            + " mode=" + mode
            + " arena=" + arenaId
            + " player=" + playerName
            + " robo=" + roboName
            + " difficulty=" + difficulty + "(" + difficultyDisplayName(difficulty) + ")"
            + " participants=" + activeParticipantNames()
            + " viewers=" + aiBattleViewers
            + " target_hits=" + state.targetHits()
            + " phase=" + state.phase()
            + " winner=" + state.winner()
            + " hits=" + state.hitCounts();
    }

    public synchronized Map<String, Object> protocolStatus() {
        Map<String, Object> status = new LinkedHashMap<>();
        EpisodeState state = episodeRegistry.state(arenaId);
        status.put("active", active);
        status.put("mode", mode);
        status.put("arena_id", arenaId);
        status.put("player", playerName);
        status.put("robo", roboName);
        status.put("difficulty", difficulty);
        status.put("difficulty_name", difficultyDisplayName(difficulty));
        status.put("participants", participantStatus());
        status.put("viewers", new ArrayList<>(aiBattleViewers));
        status.put("target_hits", state.targetHits());
        status.put("phase", state.phase());
        status.put("winner", state.winner());
        status.put("episode_id", state.episodeId());
        status.put("hit_counts", state.hitCounts());
        return status;
    }

    public void openMenu(Player player) {
        Inventory menu = Bukkit.createInventory(null, 9, text.text(player, "menu.duel.title"));
        menu.setItem(0, difficultyItem(player, Material.WOODEN_SWORD, "bc"));
        menu.setItem(1, difficultyItem(player, Material.IRON_SWORD, "ppo_mid"));
        menu.setItem(2, difficultyItem(player, Material.DIAMOND_SWORD, "ppo_high"));
        menu.setItem(3, difficultyItem(player, Material.NETHERITE_SWORD, "champion"));
        menu.setItem(4, difficultyItem(player, Material.FEATHER, "script_easy"));
        menu.setItem(5, difficultyItem(player, Material.BLAZE_ROD, "script_hard"));
        menu.setItem(8, menuItem(player, Material.ENDER_EYE, text.text(player, "menu.ai.watch"), List.of(text.text(player, "menu.ai.watch.lore"))));
        player.openInventory(menu);
    }

    public void openAiBattleMenu(Player player) {
        Inventory menu = Bukkit.createInventory(null, 9, text.text(player, "menu.ai.title"));
        String pending = pendingAiBattleLeft.get(player.getName().toLowerCase(Locale.ROOT));
        String prompt = pending == null ? text.text(player, "menu.ai.prompt.first") : text.text(player, "menu.ai.prompt.second", difficultyDisplayName(player, pending));
        menu.setItem(0, aiBattleDifficultyItem(player, Material.WOODEN_SWORD, "bc", prompt));
        menu.setItem(1, aiBattleDifficultyItem(player, Material.IRON_SWORD, "ppo_mid", prompt));
        menu.setItem(2, aiBattleDifficultyItem(player, Material.DIAMOND_SWORD, "ppo_high", prompt));
        menu.setItem(3, aiBattleDifficultyItem(player, Material.NETHERITE_SWORD, "champion", prompt));
        menu.setItem(4, aiBattleDifficultyItem(player, Material.FEATHER, "script_easy", prompt));
        menu.setItem(5, aiBattleDifficultyItem(player, Material.BLAZE_ROD, "script_hard", prompt));
        if (pending != null) {
            menu.setItem(8, menuItem(player, Material.BARRIER, text.text(player, "menu.ai.clear"), List.of(text.text(player, "menu.ai.clear.lore"))));
        }
        player.openInventory(menu);
    }

    public List<String> handleMenuClick(Player player, ItemStack clicked) {
        if (clicked == null || clicked.getType().isAir()) {
            return List.of();
        }
        return switch (clicked.getType()) {
            case WOODEN_SWORD -> List.of(start(player.getName(), "bc", defaultTargetHits(), player));
            case IRON_SWORD -> List.of(start(player.getName(), "ppo_mid", defaultTargetHits(), player));
            case DIAMOND_SWORD -> List.of(start(player.getName(), "ppo_high", defaultTargetHits(), player));
            case NETHERITE_SWORD -> List.of(start(player.getName(), "champion", defaultTargetHits(), player));
            case FEATHER -> List.of(start(player.getName(), "script_easy", defaultTargetHits(), player));
            case BLAZE_ROD -> List.of(start(player.getName(), "script_hard", defaultTargetHits(), player));
            case ENDER_EYE -> {
                openAiBattleMenu(player);
                yield List.of();
            }
            case BARRIER -> List.of(text.text(player, "menu.locked"));
            default -> List.of();
        };
    }

    public List<String> handleAiBattleMenuClick(Player player, ItemStack clicked) {
        if (clicked == null || clicked.getType().isAir()) {
            return List.of();
        }
        if (clicked.getType() == Material.BARRIER) {
            pendingAiBattleLeft.remove(player.getName().toLowerCase(Locale.ROOT));
            openAiBattleMenu(player);
            return List.of();
        }
        String selected = difficultyForMaterial(clicked.getType());
        if (selected.isBlank()) {
            return List.of();
        }
        if (!isDifficultyEnabled(selected)) {
            return List.of(text.text(player, "difficulty.unavailable", difficultyDisplayName(player, selected)));
        }
        String key = player.getName().toLowerCase(Locale.ROOT);
        String left = pendingAiBattleLeft.get(key);
        if (left == null) {
            pendingAiBattleLeft.put(key, selected);
            openAiBattleMenu(player);
            return List.of();
        }
        pendingAiBattleLeft.remove(key);
        return List.of(startAiBattle(player, left, selected, defaultTargetHits()));
    }

    public void giveUtilityItems(Player player) {
        if (isRoboName(player.getName())) {
            return;
        }
        player.getInventory().setItem(0, menuItem(player, Material.NETHER_STAR, text.text(player, "item.menu"), List.of(text.text(player, "item.menu.lore"))));
        player.getInventory().setItem(1, menuItem(player, Material.WOODEN_SWORD, text.text(player, "item.start", difficultyDisplayName(player, "bc")), List.of(text.text(player, "item.start.robo.lore"))));
        player.getInventory().setItem(2, menuItem(player, Material.IRON_SWORD, text.text(player, "item.start", difficultyDisplayName(player, "ppo_mid")), List.of(text.text(player, "item.start.robo_strong.lore"))));
        player.getInventory().setItem(3, menuItem(player, Material.ENDER_EYE, text.text(player, "menu.ai.watch"), List.of(text.text(player, "item.ai.lore"))));
        player.getInventory().setItem(4, null);
        player.getInventory().setItem(8, null);
    }

    public List<String> handleUtilityItem(Player player, ItemStack item) {
        if (item == null || item.getType().isAir()) {
            return List.of();
        }
        return switch (item.getType()) {
            case NETHER_STAR -> {
                openMenu(player);
                yield List.of();
            }
            case ENDER_EYE -> {
                openAiBattleMenu(player);
                yield List.of();
            }
            case WOODEN_SWORD -> List.of(start(player.getName(), "bc", defaultTargetHits(), player));
            case IRON_SWORD -> List.of(start(player.getName(), "ppo_mid", defaultTargetHits(), player));
            case DIAMOND_SWORD -> List.of(start(player.getName(), "ppo_high", defaultTargetHits(), player));
            case NETHERITE_SWORD -> List.of(start(player.getName(), "champion", defaultTargetHits(), player));
            case FEATHER -> List.of(start(player.getName(), "script_easy", defaultTargetHits(), player));
            case BLAZE_ROD -> List.of(start(player.getName(), "script_hard", defaultTargetHits(), player));
            default -> List.of();
        };
    }

    public synchronized List<String> arenaStatus() {
        return List.of(
            "duel arena=" + arenaId
                + " world=" + plugin.getConfig().getString("duel.world", "world")
                + " reset_mode=" + plugin.getConfig().getString("duel.reset-mode", "preserve_blocks"),
            "auto_arena=" + plugin.getConfig().getBoolean("duel.auto-arena.enabled", false)
                + " style=" + plugin.getConfig().getString("duel.auto-arena.style", "champion_hall")
                + " knockout_enabled=" + knockoutEnabled(),
            "player_spawn=" + configLocation("duel.player-spawn"),
            "robo_spawn=" + configLocation("duel.robo-spawn"),
            "bounds_center=" + configLocation("duel.bounds.center")
                + " radius="
                + plugin.getConfig().getDouble("duel.bounds.radius-x", 16.0)
                + ","
                + plugin.getConfig().getDouble("duel.bounds.radius-y", 8.0)
                + ","
                + plugin.getConfig().getDouble("duel.bounds.radius-z", 16.0),
            "Auto arena builds during duel reset when duel.auto-arena.enabled=true."
        );
    }

    public synchronized String clearBuildAround(Player player, double radiusX, double radiusY, double radiusZ) {
        int rx = Math.max(1, (int) Math.ceil(radiusX));
        int ry = Math.max(1, (int) Math.ceil(radiusY));
        int rz = Math.max(1, (int) Math.ceil(radiusZ));
        int volume = (rx * 2 + 1) * (ry * 2 + 1) * (rz * 2 + 1);
        int maxVolume = plugin.getConfig().getInt("duel.max-clear-build-volume", 200000);
        if (volume > maxVolume) {
            return "Refusing to clear " + volume + " blocks. Lower the radii or raise duel.max-clear-build-volume.";
        }
        Location center = player.getLocation();
        if (center.getWorld() == null) {
            return "Cannot clear build: player world is unavailable.";
        }
        int changed = 0;
        int baseX = center.getBlockX();
        int baseY = center.getBlockY();
        int baseZ = center.getBlockZ();
        for (int x = baseX - rx; x <= baseX + rx; x++) {
            for (int y = baseY - ry; y <= baseY + ry; y++) {
                if (y < center.getWorld().getMinHeight() || y > center.getWorld().getMaxHeight()) {
                    continue;
                }
                for (int z = baseZ - rz; z <= baseZ + rz; z++) {
                    if (!center.getWorld().getBlockAt(x, y, z).getType().isAir()) {
                        center.getWorld().getBlockAt(x, y, z).setType(Material.AIR, false);
                        changed++;
                    }
                }
            }
        }
        return "Cleared " + changed + " non-air blocks around " + describe(center) + " radius=" + rx + "," + ry + "," + rz + ".";
    }

    public void handleJoin(Player player) {
        if (active && mode.equals("ai_battle")) {
            if (player.getName().equals(aiLeftName)) {
                arenaService.resetDuelParticipant(arenaId, aiLeftName, true);
                return;
            }
            if (player.getName().equals(aiRightName)) {
                arenaService.resetDuelParticipant(arenaId, aiRightName, false);
                return;
            }
        }
        if (isRoboName(player.getName())) {
            EpisodeState assignedState = episodeRegistry.stateForPlayer(player.getName());
            if (assignedState != null && !(active && mode.equals("player_duel") && assignedState.isRegisteredPlayer(player.getName()))) {
                return;
            }
            Location roboSpawn = assignedState != null ? configLocationOrNull("duel.robo-spawn") : roboStandbyLocation();
            if (roboSpawn != null) {
                player.teleport(roboSpawn);
                player.setBedSpawnLocation(roboSpawn, true);
            }
            return;
        }
        Location lobby = lobbyLocation != null ? lobbyLocation : configLocationOrNull("lobby.spawn");
        if (lobby != null) {
            player.teleport(lobby);
            player.setBedSpawnLocation(lobby, true);
        }
        player.setGameMode(GameMode.ADVENTURE);
        giveUtilityItems(player);
        updateLobbyScoreboard(player);
    }

    public Location respawnLocationFor(Player player) {
        if (active && mode.equals("ai_battle")) {
            if (player.getName().equals(aiLeftName)) {
                return configLocationOrNull("duel.player-spawn");
            }
            if (player.getName().equals(aiRightName)) {
                return configLocationOrNull("duel.robo-spawn");
            }
        }
        if (isRoboName(player.getName())) {
            EpisodeState assignedState = episodeRegistry.stateForPlayer(player.getName());
            if (active && mode.equals("player_duel") && assignedState != null && assignedState.isRegisteredPlayer(player.getName())) {
                return configLocationOrNull("duel.robo-spawn");
            }
            if (assignedState != null) {
                return null;
            }
            return active && mode.equals("player_duel") && player.getName().equalsIgnoreCase(roboName)
                ? configLocationOrNull("duel.robo-spawn")
                : roboStandbyLocation();
        }
        return lobbyLocation != null ? lobbyLocation : configLocationOrNull("lobby.spawn");
    }

    public boolean shouldProtect(Player player) {
        if (isRoboName(player.getName()) || episodeRegistry.isSpectator(player.getName())) {
            return false;
        }
        if (player.isOp() && plugin.getConfig().getBoolean("duel.allow-op-building", true)) {
            return false;
        }
        World world = player.getWorld();
        String duelWorld = plugin.getConfig().getString("duel.world", "world");
        String lobbyWorld = plugin.getConfig().getString("lobby.world", duelWorld);
        return world.getName().equals(duelWorld) || world.getName().equals(lobbyWorld);
    }

    public synchronized void enforceMovementBounds(Player player) {
        if (isRoboName(player.getName()) || episodeRegistry.isSpectator(player.getName())) {
            return;
        }
        if (!active && episodeRegistry.stateForPlayer(player.getName()) != null) {
            return;
        }
        EpisodeState state = episodeRegistry.state(arenaId);
        if (active && state.isRegisteredPlayer(player.getName()) && (state.phase().equals("countdown") || state.phase().equals("running"))) {
            if (!insideDuelBounds(player.getLocation())) {
                if (state.phase().equals("running") && knockoutEnabled()) {
                    state.playerKnockedOut(player.getName());
                    onEpisodeMaybeFinished(state);
                } else {
                    player.teleport(readConfigLocation(isRoboName(player.getName()) ? "duel.robo-spawn" : "duel.player-spawn"));
                }
            }
            return;
        }
        if (isAiBattleViewer(player.getName())) {
            return;
        }
        Location lobby = lobbyLocation != null ? lobbyLocation : configLocationOrNull("lobby.spawn");
        if (lobby == null || player.getWorld() == null || lobby.getWorld() == null || !player.getWorld().equals(lobby.getWorld())) {
            return;
        }
        double radius = Math.max(8.0, plugin.getConfig().getDouble("lobby.leash-radius", 80.0));
        if (player.getLocation().distanceSquared(lobby) > radius * radius) {
            player.teleport(lobby);
            player.sendMessage(ChatColor.YELLOW + text.text(player, "lobby.returned"));
        }
    }

    public synchronized String setDifficulty(String difficulty) {
        this.difficulty = normalizeDifficulty(difficulty);
        return "Duel difficulty set to " + difficultyDisplayName(this.difficulty) + " (" + this.difficulty + ")";
    }

    public synchronized String setRoboName(String roboName) {
        if (roboName != null && !roboName.isBlank()) {
            this.roboName = roboName;
        }
        return "Duel ROBO name set to " + this.roboName;
    }

    public synchronized String setTarget(String playerName) {
        EpisodeState state = episodeRegistry.state(arenaId);
        if (state.active()) {
            this.playerName = playerName;
            episodeRegistry.registerPlayers(arenaId, List.of(roboName, playerName));
        }
        return "Duel target set to " + playerName;
    }

    public synchronized String setDuelLocation(String locationKey, Location location) {
        if (!List.of("player-spawn", "robo-spawn", "bounds.center").contains(locationKey)) {
            return "Unsupported duel location: " + locationKey;
        }
        String path = "duel." + locationKey;
        saveConfigLocation(path, location, !locationKey.equals("bounds.center"));
        plugin.getConfig().set("duel.world", location.getWorld() == null ? "world" : location.getWorld().getName());
        plugin.saveConfig();
        return "Saved duel." + locationKey + " at " + describe(location);
    }

    public synchronized String setDuelBoundsRadius(double radiusX, double radiusY, double radiusZ) {
        plugin.getConfig().set("duel.bounds.radius-x", Math.max(1.0, round(radiusX)));
        plugin.getConfig().set("duel.bounds.radius-y", Math.max(1.0, round(radiusY)));
        plugin.getConfig().set("duel.bounds.radius-z", Math.max(1.0, round(radiusZ)));
        plugin.saveConfig();
        return "Saved duel bounds radius x=" + round(radiusX) + " y=" + round(radiusY) + " z=" + round(radiusZ);
    }

    public synchronized void onEpisodeMaybeFinished(EpisodeState state) {
        updateScoreboards(state);
        if (!active || celebrated || !state.arenaId().equals(arenaId) || state.active()) {
            return;
        }
        if (!state.phase().equals("self_win") && !state.phase().equals("opponent_win") && !state.phase().equals("draw")) {
            return;
        }
        celebrated = true;
        active = false;
        for (String name : state.registeredPlayers()) {
            Player player = plugin.getServer().getPlayerExact(name);
            if (player == null) {
                continue;
            }
            boolean winner = name.equals(state.winner());
            String title = state.winner().isBlank() ? text.text(player, "title.draw") : (winner ? text.text(player, "title.victory") : text.text(player, "title.defeat"));
            String subtitle = state.winner().isBlank() ? text.text(player, "title.no_winner") : text.text(player, "title.winner", state.winner());
            player.sendTitle(title, subtitle, 10, 60, 20);
            player.playSound(player.getLocation(), winner ? Sound.UI_TOAST_CHALLENGE_COMPLETE : Sound.ENTITY_WITHER_HURT, 1.0f, 1.0f);
            player.spawnParticle(winner ? Particle.TOTEM_OF_UNDYING : Particle.SMOKE, player.getLocation().add(0.0, 1.0, 0.0), 40, 0.6, 0.8, 0.6);
        }
        if (mode.equals("ai_battle")) {
            String subtitle = shortName(aiLeftName) + " " + state.hitCounts().getOrDefault(aiLeftName, 0)
                + " - " + state.hitCounts().getOrDefault(aiRightName, 0) + " " + shortName(aiRightName);
            for (String name : aiBattleViewers) {
                Player viewer = plugin.getServer().getPlayerExact(name);
                if (viewer == null) {
                    continue;
                }
                String title = state.winner().isBlank() ? text.text(viewer, "ai.battle_draw") : text.text(viewer, "ai.wins", shortName(state.winner()));
                viewer.sendTitle(title, subtitle, 10, 60, 20);
                viewer.playSound(viewer.getLocation(), Sound.UI_TOAST_CHALLENGE_COMPLETE, 1.0f, 1.0f);
            }
        }
        plugin.getServer().getScheduler().runTaskLater(plugin, () -> returnPlayersToLobby(state), 80L);
    }

    public synchronized void onTick(EpisodeState state) {
        if (!active || !state.arenaId().equals(arenaId) || !state.active() || !state.phase().equals("running")) {
            return;
        }
        if (!knockoutEnabled()) {
            return;
        }
        List<String> knockedOut = new ArrayList<>();
        double threshold = knockoutYThreshold();
        for (String name : state.registeredPlayers()) {
            Player player = plugin.getServer().getPlayerExact(name);
            if (player != null && player.getLocation().getY() < threshold) {
                knockedOut.add(name);
            }
        }
        if (knockedOut.isEmpty()) {
            return;
        }
        if (knockedOut.size() >= 2) {
            state.draw("double_knockout");
        } else {
            state.playerKnockedOut(knockedOut.get(0));
        }
        onEpisodeMaybeFinished(state);
    }

    private int defaultTargetHits() {
        return plugin.getConfig().getInt("duel.default-target-hits", 50);
    }

    private int countdownSeconds() {
        return Math.max(0, plugin.getConfig().getInt("duel.countdown-seconds", 3));
    }

    private double knockoutYThreshold() {
        Location center = readConfigLocation("duel.bounds.center");
        double drop = Math.max(0.1, plugin.getConfig().getDouble("duel.knockout-drop-y", 3.0));
        return center.getY() - drop;
    }

    private boolean knockoutEnabled() {
        return plugin.getConfig().getBoolean("duel.knockout-enabled", true);
    }

    private void scheduleCountdown(String episodeId) {
        int seconds = countdownSeconds();
        if (seconds <= 0) {
            startCountdownEpisode(episodeId);
            return;
        }
        for (int remaining = seconds; remaining >= 1; remaining--) {
            int delayTicks = (seconds - remaining) * 20;
            int value = remaining;
            plugin.getServer().getScheduler().runTaskLater(plugin, () -> showCountdownTitle(episodeId, value), delayTicks);
        }
        plugin.getServer().getScheduler().runTaskLater(plugin, () -> startCountdownEpisode(episodeId), seconds * 20L);
    }

    private List<String> missingOnlineParticipants(EpisodeState state) {
        List<String> missing = new ArrayList<>();
        for (String name : state.registeredPlayers()) {
            if (plugin.getServer().getPlayerExact(name) == null) {
                missing.add(name);
            }
        }
        return missing;
    }

    private void showLoadingTitle(EpisodeState state) {
        showTitleToParticipants(state, "title.loading", "title.loading.subtitle", Sound.BLOCK_NOTE_BLOCK_PLING, Particle.END_ROD);
        for (String name : new ArrayList<>(aiBattleViewers)) {
            Player viewer = plugin.getServer().getPlayerExact(name);
            if (viewer != null) {
                viewer.sendTitle(text.text(viewer, "title.loading"), text.text(viewer, "title.loading.subtitle"), 0, 30, 8);
                viewer.playSound(viewer.getLocation(), Sound.BLOCK_NOTE_BLOCK_PLING, 1.0f, 0.8f);
            }
        }
    }

    private synchronized void startCountdownEpisode(String episodeId) {
        EpisodeState state = episodeRegistry.state(arenaId);
        if (!active || !state.episodeId().equals(episodeId) || !state.phase().equals("countdown")) {
            return;
        }
        state.start();
        runningSinceMillis = System.currentTimeMillis();
        showTitleToParticipants(state, "title.fight", "", Sound.ENTITY_PLAYER_LEVELUP, Particle.CRIT);
        updateScoreboards(state);
    }

    private synchronized void showCountdownTitle(String episodeId, int remaining) {
        EpisodeState state = episodeRegistry.state(arenaId);
        if (!active || !state.episodeId().equals(episodeId) || !state.phase().equals("countdown")) {
            return;
        }
        showTitleToParticipants(state, String.valueOf(remaining), "", Sound.BLOCK_NOTE_BLOCK_PLING, Particle.HAPPY_VILLAGER);
    }

    private void showTitleToParticipants(EpisodeState state, String titleKey, String subtitleKey, Sound sound, Particle particle) {
        for (String name : state.registeredPlayers()) {
            Player player = plugin.getServer().getPlayerExact(name);
            if (player == null) {
                continue;
            }
            String title = text.text(player, titleKey);
            String subtitle = subtitleKey.isBlank() ? "" : text.text(player, subtitleKey);
            player.sendTitle(title, subtitle, 0, 18, 4);
            player.playSound(player.getLocation(), sound, 1.0f, 1.0f);
            player.spawnParticle(particle, player.getLocation().add(0.0, 1.0, 0.0), 12, 0.35, 0.45, 0.35);
        }
    }

    private double round(double value) {
        return Math.round(value * 100.0) / 100.0;
    }

    private String describe(Location location) {
        String worldName = location.getWorld() == null ? "world" : location.getWorld().getName();
        return worldName + " x=" + round(location.getX())
            + " y=" + round(location.getY())
            + " z=" + round(location.getZ())
            + " yaw=" + round(location.getYaw())
            + " pitch=" + round(location.getPitch());
    }

    private void returnPlayersToLobby(EpisodeState state) {
        Location lobby = lobbyLocation != null ? lobbyLocation : configLocationOrNull("lobby.spawn");
        for (String name : state.registeredPlayers()) {
            Player player = plugin.getServer().getPlayerExact(name);
            if (player == null) {
                continue;
            }
            Location destination = isRoboName(name) ? roboStandbyLocation() : lobby;
            if (destination == null) {
                continue;
            }
            player.teleport(destination);
            player.setBedSpawnLocation(destination, true);
            player.setGameMode(isRoboName(name) ? GameMode.SURVIVAL : GameMode.ADVENTURE);
            giveUtilityItems(player);
            if (!isRoboName(name)) {
                updateLobbyScoreboard(player);
            }
        }
        for (String name : new ArrayList<>(aiBattleViewers)) {
            Player player = plugin.getServer().getPlayerExact(name);
            if (player == null || lobby == null) {
                continue;
            }
            player.teleport(lobby);
            player.setBedSpawnLocation(lobby, true);
            player.setGameMode(GameMode.ADVENTURE);
            giveUtilityItems(player);
            updateLobbyScoreboard(player);
        }
        aiBattleViewers.clear();
        pendingAiBattleLeft.clear();
    }

    private void updateWorldSpawn(Location location) {
        if (location != null && location.getWorld() != null) {
            location.getWorld().setSpawnLocation(location);
        }
    }

    private void updateScoreboards(EpisodeState state) {
        for (String name : state.registeredPlayers()) {
            Player player = plugin.getServer().getPlayerExact(name);
            if (player != null) {
                Scoreboard scoreboard = duelScoreboardFor(state, player);
                if (scoreboard != null) {
                    player.setScoreboard(scoreboard);
                }
            }
        }
        if (mode.equals("ai_battle")) {
            for (String name : aiBattleViewers) {
                Player player = plugin.getServer().getPlayerExact(name);
                if (player != null) {
                    Scoreboard scoreboard = aiBattleScoreboardFor(state, player);
                    if (scoreboard != null) {
                        player.setScoreboard(scoreboard);
                    }
                }
            }
        }
    }

    private void updateLobbyScoreboard(Player player) {
        Scoreboard scoreboard = lobbyScoreboardFor(player);
        if (scoreboard != null) {
            player.setScoreboard(scoreboard);
        }
    }

    private Scoreboard duelScoreboardFor(EpisodeState state, Player viewer) {
        ScoreboardManager manager = Bukkit.getScoreboardManager();
        if (manager == null) {
            return null;
        }
        Scoreboard scoreboard = manager.getNewScoreboard();
        Objective objective = scoreboard.registerNewObjective("pvprobo_duel", "dummy", ChatColor.GOLD + "" + ChatColor.BOLD + text.text(viewer, "score.duel.title"));
        objective.setDisplaySlot(DisplaySlot.SIDEBAR);
        addScore(objective, ChatColor.GRAY + serverDomain(), 9);
        addScore(objective, ChatColor.YELLOW + text.text(viewer, "score.mode") + " " + ChatColor.WHITE + difficultyDisplayName(viewer, difficulty), 8);
        addScore(objective, ChatColor.YELLOW + text.text(viewer, "score.goal") + " " + ChatColor.WHITE + text.text(viewer, "score.goal_hits", state.targetHits()), 7);
        addScore(objective, ChatColor.GREEN + shortName(playerName) + " " + ChatColor.WHITE + state.hitCounts().getOrDefault(playerName, 0), 6);
        addScore(objective, ChatColor.RED + shortName(roboName) + " " + ChatColor.WHITE + state.hitCounts().getOrDefault(roboName, 0), 5);
        addScore(objective, ChatColor.AQUA + text.text(viewer, "score.phase") + " " + ChatColor.WHITE + phaseDisplayName(viewer, state.phase()), 4);
        addScore(objective, ChatColor.LIGHT_PURPLE + text.text(viewer, "score.you") + " " + ChatColor.WHITE + shortName(viewer.getName()), 3);
        addScore(objective, ChatColor.DARK_GRAY + dateText(), 2);
        addScore(objective, ChatColor.GOLD + serverDomain(), 1);
        return scoreboard;
    }

    private Scoreboard aiBattleScoreboardFor(EpisodeState state, Player viewer) {
        ScoreboardManager manager = Bukkit.getScoreboardManager();
        if (manager == null) {
            return null;
        }
        Scoreboard scoreboard = manager.getNewScoreboard();
        Objective objective = scoreboard.registerNewObjective("pvprobo_ai", "dummy", ChatColor.AQUA + "" + ChatColor.BOLD + text.text(viewer, "score.ai.title"));
        objective.setDisplaySlot(DisplaySlot.SIDEBAR);
        addScore(objective, ChatColor.GRAY + serverDomain(), 9);
        addScore(objective, ChatColor.YELLOW + text.text(viewer, "score.goal") + " " + ChatColor.WHITE + text.text(viewer, "score.goal_hits", state.targetHits()), 8);
        addScore(objective, ChatColor.GREEN + shortName(aiLeftName) + " " + ChatColor.WHITE + state.hitCounts().getOrDefault(aiLeftName, 0), 7);
        addScore(objective, ChatColor.DARK_GREEN + shortName(difficultyDisplayName(viewer, aiLeftDifficulty)), 6);
        addScore(objective, ChatColor.RED + shortName(aiRightName) + " " + ChatColor.WHITE + state.hitCounts().getOrDefault(aiRightName, 0), 5);
        addScore(objective, ChatColor.DARK_RED + shortName(difficultyDisplayName(viewer, aiRightDifficulty)), 4);
        addScore(objective, ChatColor.AQUA + text.text(viewer, "score.phase") + " " + ChatColor.WHITE + phaseDisplayName(viewer, state.phase()), 3);
        addScore(objective, ChatColor.LIGHT_PURPLE + text.text(viewer, "score.you") + " " + ChatColor.WHITE + shortName(viewer.getName()), 2);
        addScore(objective, ChatColor.GOLD + serverDomain(), 1);
        return scoreboard;
    }

    private Scoreboard lobbyScoreboardFor(Player player) {
        ScoreboardManager manager = Bukkit.getScoreboardManager();
        if (manager == null) {
            return null;
        }
        Scoreboard scoreboard = manager.getNewScoreboard();
        Objective objective = scoreboard.registerNewObjective("pvprobo_lobby", "dummy", ChatColor.AQUA + "" + ChatColor.BOLD + serverName());
        objective.setDisplaySlot(DisplaySlot.SIDEBAR);
        addScore(objective, ChatColor.GOLD + text.text(player, "score.server"), 8);
        addScore(objective, ChatColor.WHITE + serverName(), 7);
        addScore(objective, ChatColor.GOLD + text.text(player, "score.location"), 6);
        addScore(objective, ChatColor.WHITE + locationLabel(player, player), 5);
        addScore(objective, ChatColor.GOLD + text.text(player, "score.date"), 4);
        addScore(objective, ChatColor.WHITE + dateText(), 3);
        addScore(objective, ChatColor.GOLD + text.text(player, "score.address"), 2);
        addScore(objective, ChatColor.AQUA + serverDomain(), 1);
        return scoreboard;
    }

    private void addScore(Objective objective, String text, int score) {
        objective.getScore(text).setScore(score);
    }

    private ItemStack menuItem(Material material, String name, List<String> lore) {
        return menuItem(null, material, name, lore);
    }

    private ItemStack menuItem(Player player, Material material, String name, List<String> lore) {
        ItemStack item = new ItemStack(material);
        ItemMeta meta = item.getItemMeta();
        if (meta != null) {
            meta.setDisplayName(ChatColor.GOLD + name);
            List<String> coloredLore = new ArrayList<>();
            for (String line : lore) {
                coloredLore.add(ChatColor.GRAY + line);
            }
            meta.setLore(coloredLore);
            item.setItemMeta(meta);
        }
        return item;
    }

    private ItemStack difficultyItem(Player player, Material material, String difficulty) {
        if (isDifficultyEnabled(difficulty)) {
            return menuItem(player, material, text.text(player, "difficulty.challenge", difficultyDisplayName(player, difficulty)), List.of(text.text(player, "difficulty." + normalizeDifficulty(difficulty) + ".desc"), text.text(player, "difficulty.ready")));
        }
        return menuItem(player, Material.BARRIER, text.text(player, "difficulty.locked", difficultyDisplayName(player, difficulty)), List.of(text.text(player, "difficulty.locked_lore")));
    }

    private ItemStack aiBattleDifficultyItem(Player player, Material material, String difficulty, String prompt) {
        if (isDifficultyEnabled(difficulty)) {
            return menuItem(player, material, difficultyDisplayName(player, difficulty), List.of(prompt));
        }
        return menuItem(player, Material.BARRIER, text.text(player, "difficulty.locked", difficultyDisplayName(player, difficulty)), List.of(text.text(player, "difficulty.locked_lore")));
    }

    private void saveConfigLocation(String path, Location location, boolean includeFacing) {
        plugin.getConfig().set(path + ".x", round(location.getX()));
        plugin.getConfig().set(path + ".y", round(location.getY()));
        plugin.getConfig().set(path + ".z", round(location.getZ()));
        if (includeFacing) {
            plugin.getConfig().set(path + ".yaw", round(location.getYaw()));
            plugin.getConfig().set(path + ".pitch", round(location.getPitch()));
        }
    }

    private Location configLocationOrNull(String path) {
        if (!plugin.getConfig().contains(path + ".x")) {
            return null;
        }
        return readConfigLocation(path);
    }

    private Location readConfigLocation(String path) {
        String worldName = plugin.getConfig().getString("duel.world", "world");
        if (path.startsWith("lobby.")) {
            worldName = plugin.getConfig().getString("lobby.world", worldName);
        }
        Location location = new Location(
            plugin.getServer().getWorld(worldName),
            plugin.getConfig().getDouble(path + ".x", 0.0),
            plugin.getConfig().getDouble(path + ".y", 64.0),
            plugin.getConfig().getDouble(path + ".z", 0.0),
            (float) plugin.getConfig().getDouble(path + ".yaw", 0.0),
            (float) plugin.getConfig().getDouble(path + ".pitch", 0.0)
        );
        return location;
    }

    private String configLocation(String path) {
        return "x=" + plugin.getConfig().getDouble(path + ".x", 0.0)
            + " y=" + plugin.getConfig().getDouble(path + ".y", 64.0)
            + " z=" + plugin.getConfig().getDouble(path + ".z", 0.0)
            + " yaw=" + plugin.getConfig().getDouble(path + ".yaw", 0.0)
            + " pitch=" + plugin.getConfig().getDouble(path + ".pitch", 0.0);
    }

    public synchronized String setPlaytestPlayerMode(Player player, boolean enabled) {
        String key = player.getName().toLowerCase(Locale.ROOT);
        if (enabled) {
            playtestPlayerMode.add(key);
            giveUtilityItems(player);
            return "PVPRobo playtest player mode enabled. Menus and player commands now behave like a normal player for this session.";
        }
        playtestPlayerMode.remove(key);
        giveUtilityItems(player);
        return "PVPRobo playtest player mode disabled. Admin tools are available again.";
    }

    public synchronized boolean isPlaytestPlayerMode(Player player) {
        return playtestPlayerMode.contains(player.getName().toLowerCase(Locale.ROOT));
    }

    private String difficultyDisplayName(String value) {
        return switch (normalizeDifficulty(value)) {
            case "ppo_mid" -> plugin.getConfig().getString("duel.difficulty-names.ppo_mid", "Skilled ROBO");
            case "ppo_high" -> plugin.getConfig().getString("duel.difficulty-names.ppo_high", "Elite ROBO");
            case "script_easy" -> plugin.getConfig().getString("duel.difficulty-names.script_easy", "Basic SCRIPT");
            case "script_hard" -> plugin.getConfig().getString("duel.difficulty-names.script_hard", "Tough SCRIPT");
            case "champion" -> plugin.getConfig().getString("duel.difficulty-names.champion", "Champion ROBO");
            default -> plugin.getConfig().getString("duel.difficulty-names.bc", "Novice ROBO");
        };
    }

    private String difficultyDisplayName(Player player, String value) {
        String normalized = normalizeDifficulty(value);
        String configured = plugin.getConfig().getString("localization.difficulty-names." + text.language(player) + "." + normalized);
        if (configured != null && !configured.isBlank()) {
            return configured;
        }
        return text.text(player, "difficulty." + normalized);
    }

    private boolean isDifficultyEnabled(String value) {
        String normalized = normalizeDifficulty(value);
        List<String> enabled = plugin.getConfig().getStringList("duel.enabled-difficulties");
        if (enabled.isEmpty()) {
            enabled = List.of("bc", "ppo_mid", "ppo_high", "champion", "script_easy", "script_hard");
        }
        for (String item : enabled) {
            if (normalizeDifficulty(item).equals(normalized)) {
                return true;
            }
        }
        return false;
    }

    private int elapsedRunningTicks() {
        if (runningSinceMillis <= 0L) {
            return 0;
        }
        long elapsedMillis = Math.max(0L, System.currentTimeMillis() - runningSinceMillis);
        return Math.max(1, (int) Math.round(elapsedMillis / 50.0));
    }

    private String phaseDisplayName(String phase) {
        return switch (phase) {
            case "loading" -> "Loading";
            case "countdown" -> "Get Ready";
            case "running" -> "Fighting";
            case "self_win", "opponent_win" -> "Finished";
            case "draw" -> "Draw";
            default -> "Lobby";
        };
    }

    private String phaseDisplayName(Player player, String phase) {
        return switch (phase) {
            case "loading" -> text.text(player, "phase.loading");
            case "countdown" -> text.text(player, "phase.countdown");
            case "running" -> text.text(player, "phase.running");
            case "self_win", "opponent_win" -> text.text(player, "phase.finished");
            case "draw" -> text.text(player, "phase.draw");
            default -> text.text(player, "phase.lobby");
        };
    }

    private String serverName() {
        return plugin.getConfig().getString("server.display-name", "PVPRobo");
    }

    private String serverDomain() {
        return plugin.getConfig().getString("server.domain", "mcpvp.local");
    }

    private String dateText() {
        return LocalDate.now().format(DateTimeFormatter.ISO_LOCAL_DATE);
    }

    private String locationLabel(Player player) {
        EpisodeState state = episodeRegistry.state(arenaId);
        if (active && state.isRegisteredPlayer(player.getName())) {
            return "Arena";
        }
        return "Lobby";
    }

    private String locationLabel(Player viewer, Player player) {
        EpisodeState state = episodeRegistry.state(arenaId);
        if (active && state.isRegisteredPlayer(player.getName())) {
            return text.text(viewer, "location.arena");
        }
        return text.text(viewer, "location.lobby");
    }

    private String shortName(String name) {
        if (name == null || name.isBlank()) {
            return "-";
        }
        return name.length() <= 12 ? name : name.substring(0, 12);
    }

    private String normalizeDifficulty(String value) {
        if (value == null || value.isBlank()) {
            return "bc";
        }
        String normalized = value.toLowerCase(Locale.ROOT);
        return switch (normalized) {
            case "bc", "ppo_mid", "ppo", "ppo-high", "ppo_high", "script_easy", "script-easy", "script_hard", "script-hard", "champion" -> normalized.equals("ppo") ? "ppo_mid" : normalized.replace("-", "_");
            default -> "bc";
        };
    }

    private String difficultyForMaterial(Material material) {
        return switch (material) {
            case WOODEN_SWORD -> "bc";
            case IRON_SWORD -> "ppo_mid";
            case DIAMOND_SWORD -> "ppo_high";
            case NETHERITE_SWORD -> "champion";
            case FEATHER -> "script_easy";
            case BLAZE_ROD -> "script_hard";
            default -> "";
        };
    }

    private boolean isRoboName(String name) {
        if (name == null) {
            return false;
        }
        for (String prefix : plugin.getConfig().getStringList("admission.bot-name-prefixes")) {
            if (!prefix.isBlank() && name.toUpperCase(Locale.ROOT).startsWith(prefix.toUpperCase(Locale.ROOT))) {
                return true;
            }
        }
        String upper = name.toUpperCase(Locale.ROOT);
        return name.equalsIgnoreCase(roboName)
            || name.equalsIgnoreCase("ROBO")
            || upper.matches("ROBO[-_][A-Z][0-9]+")
            || upper.matches("SCRIPT[-_][A-Z][0-9]+");
    }

    public boolean hasAdminAccess(Player player) {
        return (player.isOp() || player.hasPermission("pvprobo.admin")) && !isPlaytestPlayerMode(player);
    }

    private boolean insideDuelBounds(Location location) {
        Location center = readConfigLocation("duel.bounds.center");
        double radiusX = plugin.getConfig().getDouble("duel.bounds.radius-x", 16.0);
        double radiusY = plugin.getConfig().getDouble("duel.bounds.radius-y", 8.0);
        double radiusZ = plugin.getConfig().getDouble("duel.bounds.radius-z", 16.0);
        return Math.abs(location.getX() - center.getX()) <= radiusX
            && Math.abs(location.getY() - center.getY()) <= radiusY
            && Math.abs(location.getZ() - center.getZ()) <= radiusZ;
    }

    private List<String> activeParticipantNames() {
        if (mode.equals("ai_battle") && active) {
            return List.of(aiLeftName, aiRightName);
        }
        return active && !playerName.isBlank() ? List.of(roboName, playerName) : List.of();
    }

    private List<Map<String, Object>> participantStatus() {
        List<Map<String, Object>> participants = new ArrayList<>();
        if (mode.equals("ai_battle") && active) {
            participants.add(participant(aiLeftName, aiLeftDifficulty));
            participants.add(participant(aiRightName, aiRightDifficulty));
        } else if (active) {
            participants.add(participant(roboName, difficulty));
        }
        return participants;
    }

    private Map<String, Object> participant(String name, String difficulty) {
        Map<String, Object> participant = new LinkedHashMap<>();
        participant.put("name", name);
        participant.put("difficulty", normalizeDifficulty(difficulty));
        participant.put("difficulty_name", difficultyDisplayName(difficulty));
        return participant;
    }

    private String aiRoboName(String difficulty, int suffix) {
        String normalized = normalizeDifficulty(difficulty);
        String prefix = normalized.startsWith("script_") ? "SCRIPT" : "ROBO";
        String letter = switch (normalized) {
            case "ppo_mid" -> "B";
            case "ppo_high" -> "C";
            case "champion" -> "D";
            case "script_easy" -> "E";
            case "script_hard" -> "H";
            default -> "A";
        };
        return prefix + "_" + letter + suffix;
    }

    private boolean isAiBattleViewer(String name) {
        return aiBattleViewers.contains(name);
    }

    public synchronized void handleQuit(Player player) {
        aiBattleViewers.remove(player.getName());
        pendingAiBattleLeft.remove(player.getName().toLowerCase(Locale.ROOT));
    }

    private void moveViewerToAiBattle(Player viewer) {
        Location target = spectatorLocation();
        viewer.teleport(target);
        viewer.setGameMode(GameMode.SPECTATOR);
        updateAiBattleScoreboard(viewer);
    }

    private void moveIdleRoboToStandby() {
        Player idleRobo = plugin.getServer().getPlayerExact(roboName);
        if (idleRobo == null) {
            idleRobo = plugin.getServer().getPlayerExact("ROBO");
        }
        if (idleRobo == null || idleRobo.getName().equals(aiLeftName) || idleRobo.getName().equals(aiRightName)) {
            return;
        }
        if (episodeRegistry.stateForPlayer(idleRobo.getName()) != null) {
            return;
        }
        Location standby = roboStandbyLocation();
        if (standby != null) {
            idleRobo.teleport(standby);
            idleRobo.setBedSpawnLocation(standby, true);
        }
    }

    private Location roboStandbyLocation() {
        Location configured = configLocationOrNull("duel.robo-standby-spawn");
        if (configured != null) {
            return configured;
        }
        return spectatorLocation();
    }

    private Location spectatorLocation() {
        Location target = configLocationOrNull("duel.spectator-spawn");
        if (target != null) {
            return target;
        }
        Location center = readConfigLocation("duel.bounds.center");
        target = center.clone().add(0.0, 4.0, 15.0);
        target.setYaw(180.0f);
        target.setPitch(20.0f);
        return target;
    }

    private void updateAiBattleScoreboard(Player viewer) {
        Scoreboard scoreboard = aiBattleScoreboardFor(episodeRegistry.state(arenaId), viewer);
        if (scoreboard != null) {
            viewer.setScoreboard(scoreboard);
        }
    }
}
