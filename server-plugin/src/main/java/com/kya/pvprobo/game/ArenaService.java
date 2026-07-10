package com.kya.pvprobo.game;

import java.util.List;
import org.bukkit.GameRule;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Item;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.plugin.Plugin;
import org.bukkit.util.Vector;

public final class ArenaService {
    private final Plugin plugin;
    private final EpisodeRegistry episodeRegistry;

    public ArenaService(Plugin plugin, EpisodeRegistry episodeRegistry) {
        this.plugin = plugin;
        this.episodeRegistry = episodeRegistry;
    }

    public void resetArena(String arenaId) {
        EpisodeState episodeState = episodeRegistry.state(arenaId);
        World world = world();
        setGameRules(world);
        prepareArenaSpaces(world);
        int arenaIndex = arenaIndex(episodeState.arenaId(), episodeState);
        cleanupArena(arenaIndex);
        List<String> players = episodeState.registeredPlayers();
        if (players.size() >= 1) {
            resetPlayer(episodeState, players.get(0), playerLocation(arenaIndex, "player-a"));
        }
        if (players.size() >= 2) {
            resetPlayer(episodeState, players.get(1), playerLocation(arenaIndex, "player-b"));
        }
    }

    public void resetDuelArena(String arenaId, String playerName, String roboName) {
        resetDuelArenaParticipants(arenaId, playerName, roboName);
    }

    public void resetDuelArenaParticipants(String arenaId, String leftName, String rightName) {
        EpisodeState episodeState = episodeRegistry.state(arenaId);
        World world = duelWorld();
        setGameRules(world);
        prepareDuelArena(world);
        cleanupDuelArena(world);
        resetPlayer(episodeState, leftName, location(world, "duel.player-spawn"));
        resetPlayer(episodeState, rightName, location(world, "duel.robo-spawn"));
    }

    public void prepareDuelArena() {
        World world = duelWorld();
        setGameRules(world);
        prepareDuelArena(world);
    }

    public void resetDuelParticipant(String arenaId, String name, boolean leftSide) {
        EpisodeState episodeState = episodeRegistry.state(arenaId);
        World world = duelWorld();
        setGameRules(world);
        resetPlayer(episodeState, name, location(world, leftSide ? "duel.player-spawn" : "duel.robo-spawn"));
    }

    public void cleanupArena() {
        for (int arenaId = 0; arenaId < arenaCount(); arenaId++) {
            cleanupArena(arenaId);
        }
    }

    private void cleanupArena(int arenaId) {
        World world = world();
        double radius = plugin.getConfig().getDouble("arena.radius", 10.0);
        Location center = arenaCenter(arenaId);
        for (Entity entity : world.getNearbyEntities(center, radius, radius, radius)) {
            if (entity instanceof Item || entity instanceof Projectile) {
                entity.remove();
            }
        }
    }

    private void cleanupDuelArena(World world) {
        Location center = location(world, "duel.bounds.center");
        double radiusX = plugin.getConfig().getDouble("duel.bounds.radius-x", plugin.getConfig().getDouble("arena.radius", 10.0));
        double radiusY = plugin.getConfig().getDouble("duel.bounds.radius-y", 8.0);
        double radiusZ = plugin.getConfig().getDouble("duel.bounds.radius-z", plugin.getConfig().getDouble("arena.radius", 10.0));
        for (Entity entity : world.getNearbyEntities(center, radiusX, radiusY, radiusZ)) {
            if (entity instanceof Item || entity instanceof Projectile) {
                entity.remove();
            }
        }
        cleanupVolatileBlocks(world, center, radiusX, radiusY, radiusZ);
    }

    private void cleanupVolatileBlocks(World world, Location center, double radiusX, double radiusY, double radiusZ) {
        int minX = (int) Math.floor(center.getX() - radiusX);
        int maxX = (int) Math.ceil(center.getX() + radiusX);
        int minY = Math.max(world.getMinHeight(), (int) Math.floor(center.getY() - radiusY));
        int maxY = Math.min(world.getMaxHeight() - 1, (int) Math.ceil(center.getY() + radiusY));
        int minZ = (int) Math.floor(center.getZ() - radiusZ);
        int maxZ = (int) Math.ceil(center.getZ() + radiusZ);
        for (int x = minX; x <= maxX; x++) {
            for (int y = minY; y <= maxY; y++) {
                for (int z = minZ; z <= maxZ; z++) {
                    Material type = world.getBlockAt(x, y, z).getType();
                    if (type == Material.FIRE || type == Material.SOUL_FIRE) {
                        world.getBlockAt(x, y, z).setType(Material.AIR, false);
                    }
                }
            }
        }
    }

    private void prepareDuelArena(World world) {
        if (!plugin.getConfig().getBoolean("duel.auto-arena.enabled", false)) {
            return;
        }
        String style = plugin.getConfig().getString("duel.auto-arena.style", "champion_hall");
        if (!"champion_hall".equalsIgnoreCase(style)) {
            return;
        }
        Location center = location(world, "duel.bounds.center");
        int radiusX = Math.max(8, plugin.getConfig().getInt("duel.auto-arena.radius-x", 22));
        int radiusZ = Math.max(8, plugin.getConfig().getInt("duel.auto-arena.radius-z", 22));
        int clearBelow = Math.max(1, plugin.getConfig().getInt("duel.auto-arena.clear-below", 2));
        int clearAbove = Math.max(6, plugin.getConfig().getInt("duel.auto-arena.clear-above", 12));
        int floorY = center.getBlockY() - 1;
        int minX = center.getBlockX() - radiusX;
        int maxX = center.getBlockX() + radiusX;
        int minZ = center.getBlockZ() - radiusZ;
        int maxZ = center.getBlockZ() + radiusZ;
        int minY = Math.max(world.getMinHeight(), floorY - clearBelow);
        int maxY = Math.min(world.getMaxHeight() - 1, floorY + clearAbove);

        for (int x = minX; x <= maxX; x++) {
            for (int z = minZ; z <= maxZ; z++) {
                boolean edge = x == minX || x == maxX || z == minZ || z == maxZ;
                boolean nearEdge = x <= minX + 2 || x >= maxX - 2 || z <= minZ + 2 || z >= maxZ - 2;
                for (int y = minY; y <= maxY; y++) {
                    Material material = duelArenaMaterial(center, x, y, z, floorY, maxY, edge, nearEdge);
                    world.getBlockAt(x, y, z).setType(material, false);
                }
            }
        }
        placeDuelArenaDetails(world, center, radiusX, radiusZ, floorY, maxY);
    }

    private Material duelArenaMaterial(Location center, int x, int y, int z, int floorY, int maxY, boolean edge, boolean nearEdge) {
        if (y < floorY) {
            return Material.DEEPSLATE_BRICKS;
        }
        if (y == floorY) {
            int dx = Math.abs(x - center.getBlockX());
            int dz = Math.abs(z - center.getBlockZ());
            if ((dx <= 1 && dz <= 1) || (dx % 6 == 0 && dz % 6 == 0)) {
                return Material.SEA_LANTERN;
            }
            if (nearEdge) {
                return Material.POLISHED_BLACKSTONE_BRICKS;
            }
            if ((x + z) % 4 == 0) {
                return Material.POLISHED_DIORITE;
            }
            return Material.POLISHED_DEEPSLATE;
        }
        if (edge) {
            if (y == floorY + 1 || y == maxY) {
                return Material.SMOOTH_QUARTZ;
            }
            if ((y - floorY) % 4 == 0) {
                return Material.SEA_LANTERN;
            }
            return Material.POLISHED_BLACKSTONE_BRICKS;
        }
        if (y == maxY) {
            int dx = Math.abs(x - center.getBlockX());
            int dz = Math.abs(z - center.getBlockZ());
            if (dx % 7 == 0 || dz % 7 == 0) {
                return Material.SEA_LANTERN;
            }
            return Material.DEEPSLATE_TILES;
        }
        return Material.AIR;
    }

    private void placeDuelArenaDetails(World world, Location center, int radiusX, int radiusZ, int floorY, int maxY) {
        int centerX = center.getBlockX();
        int centerZ = center.getBlockZ();
        placeSpawnPad(world, centerX - 5, floorY, centerZ, Material.LAPIS_BLOCK);
        placeSpawnPad(world, centerX + 5, floorY, centerZ, Material.REDSTONE_BLOCK);
        for (int sx : new int[] {-1, 1}) {
            for (int sz : new int[] {-1, 1}) {
                buildPillar(world, centerX + sx * (radiusX - 3), floorY, centerZ + sz * (radiusZ - 3), maxY);
            }
        }
        for (int x = centerX - radiusX + 4; x <= centerX + radiusX - 4; x += 8) {
            world.getBlockAt(x, floorY + 2, centerZ - radiusZ).setType(Material.SEA_LANTERN, false);
            world.getBlockAt(x, floorY + 2, centerZ + radiusZ).setType(Material.SEA_LANTERN, false);
        }
        for (int z = centerZ - radiusZ + 4; z <= centerZ + radiusZ - 4; z += 8) {
            world.getBlockAt(centerX - radiusX, floorY + 2, z).setType(Material.SEA_LANTERN, false);
            world.getBlockAt(centerX + radiusX, floorY + 2, z).setType(Material.SEA_LANTERN, false);
        }
    }

    private void placeSpawnPad(World world, int centerX, int floorY, int centerZ, Material accent) {
        for (int x = centerX - 1; x <= centerX + 1; x++) {
            for (int z = centerZ - 1; z <= centerZ + 1; z++) {
                world.getBlockAt(x, floorY, z).setType(accent, false);
            }
        }
        world.getBlockAt(centerX, floorY, centerZ).setType(Material.SEA_LANTERN, false);
    }

    private void buildPillar(World world, int x, int floorY, int z, int maxY) {
        for (int y = floorY + 1; y <= maxY; y++) {
            Material material = (y - floorY) % 4 == 0 ? Material.SEA_LANTERN : Material.CHISELED_POLISHED_BLACKSTONE;
            world.getBlockAt(x, y, z).setType(material, false);
        }
    }

    private void resetPlayer(EpisodeState episodeState, String name, Location location) {
        Player player = plugin.getServer().getPlayerExact(name);
        if (player == null) {
            episodeState.addEvent("missing_player:" + name);
            return;
        }
        player.teleport(location);
        player.setVelocity(new Vector(0, 0, 0));
        player.getInventory().clear();
        player.getInventory().setArmorContents(null);
        player.getActivePotionEffects().forEach(effect -> player.removePotionEffect(effect.getType()));
        player.setHealth(20.0);
        player.setFoodLevel(20);
        player.setSaturation(20.0f);
        player.setFireTicks(0);
        player.setFallDistance(0.0f);
        player.getInventory().setHeldItemSlot(0);
    }

    private void setGameRules(World world) {
        world.setGameRule(GameRule.DO_DAYLIGHT_CYCLE, false);
        world.setGameRule(GameRule.DO_WEATHER_CYCLE, false);
        world.setGameRule(GameRule.DO_MOB_SPAWNING, false);
        world.setGameRule(GameRule.DO_FIRE_TICK, false);
        world.setGameRule(GameRule.DO_PATROL_SPAWNING, false);
        world.setGameRule(GameRule.DO_TRADER_SPAWNING, false);
        world.setGameRule(GameRule.DO_IMMEDIATE_RESPAWN, true);
        world.setGameRule(GameRule.KEEP_INVENTORY, true);
        world.setGameRule(GameRule.MOB_GRIEFING, false);
        world.setGameRule(GameRule.ANNOUNCE_ADVANCEMENTS, false);
        world.setGameRule(GameRule.SHOW_DEATH_MESSAGES, false);
        world.setGameRule(GameRule.DO_INSOMNIA, false);
        world.setStorm(false);
        world.setThundering(false);
        world.setTime(6000L);
    }

    private void prepareArenaSpaces(World world) {
        for (int arenaId = 0; arenaId < arenaCount(); arenaId++) {
            prepareArenaSpace(world, arenaCenter(arenaId));
        }
    }

    private void prepareArenaSpace(World world, Location center) {
        int radius = (int) Math.ceil(plugin.getConfig().getDouble("arena.radius", 10.0));
        int wallHeight = plugin.getConfig().getInt("arena.wall-height", 5);
        int centerX = center.getBlockX();
        int centerY = center.getBlockY();
        int centerZ = center.getBlockZ();
        for (int x = centerX - radius; x <= centerX + radius; x++) {
            for (int z = centerZ - radius; z <= centerZ + radius; z++) {
                boolean edge = x == centerX - radius || x == centerX + radius || z == centerZ - radius || z == centerZ + radius;
                world.getBlockAt(x, centerY - 1, z).setType(Material.STONE, false);
                for (int y = centerY; y <= centerY + wallHeight; y++) {
                    world.getBlockAt(x, y, z).setType(edge ? Material.STONE : Material.AIR, false);
                }
            }
        }
        placeLight(world, centerX - radius + 2, centerY - 1, centerZ - radius + 2);
        placeLight(world, centerX + radius - 2, centerY - 1, centerZ - radius + 2);
        placeLight(world, centerX - radius + 2, centerY - 1, centerZ + radius - 2);
        placeLight(world, centerX + radius - 2, centerY - 1, centerZ + radius - 2);
        placeLight(world, centerX, centerY - 1, centerZ);
    }

    private void placeLight(World world, int x, int y, int z) {
        world.getBlockAt(x, y, z).setType(Material.SEA_LANTERN, false);
    }

    private int arenaCount() {
        return Math.max(1, plugin.getConfig().getInt("arena.count", 1));
    }

    private int arenaIndex(String arenaId, EpisodeState episodeState) {
        if (arenaId == null || arenaId.isBlank() || arenaId.equals("default")) {
            return 0;
        }
        if (arenaId.startsWith("arena_")) {
            try {
                int parsed = Integer.parseInt(arenaId.substring("arena_".length()));
                if (parsed >= 0 && parsed < arenaCount()) {
                    return parsed;
                }
            } catch (NumberFormatException ignored) {
                // Fall through to the default arena.
            }
        }
        episodeState.addEvent("unknown_arena:" + arenaId);
        return 0;
    }

    private Location arenaCenter(int arenaId) {
        Location origin = location("arena.center");
        double spacing = plugin.getConfig().getDouble("arena.spacing", 64.0);
        int columns = Math.max(1, plugin.getConfig().getInt("arena.columns", (int) Math.ceil(Math.sqrt(arenaCount()))));
        int row = arenaId / columns;
        int col = arenaId % columns;
        return origin.clone().add(col * spacing, 0.0, row * spacing);
    }

    private Location playerLocation(int arenaId, String playerPath) {
        Location center = arenaCenter(arenaId);
        Location base = location("arena." + playerPath);
        Location origin = location("arena.center");
        double dx = base.getX() - origin.getX();
        double dy = base.getY() - origin.getY();
        double dz = base.getZ() - origin.getZ();
        return new Location(world(), center.getX() + dx, center.getY() + dy, center.getZ() + dz, base.getYaw(), base.getPitch());
    }

    private World world() {
        String worldName = plugin.getConfig().getString("arena.world", "world");
        World world = plugin.getServer().getWorld(worldName);
        if (world == null) {
            throw new IllegalStateException("world not loaded: " + worldName);
        }
        return world;
    }

    private World duelWorld() {
        String worldName = plugin.getConfig().getString("duel.world", plugin.getConfig().getString("arena.world", "world"));
        World world = plugin.getServer().getWorld(worldName);
        if (world == null) {
            throw new IllegalStateException("duel world not loaded: " + worldName);
        }
        return world;
    }

    private Location location(String path) {
        World world = world();
        return location(world, path);
    }

    private Location location(World world, String path) {
        double x = plugin.getConfig().getDouble(path + ".x");
        double y = plugin.getConfig().getDouble(path + ".y");
        double z = plugin.getConfig().getDouble(path + ".z");
        float yaw = (float) plugin.getConfig().getDouble(path + ".yaw", 0.0);
        float pitch = (float) plugin.getConfig().getDouble(path + ".pitch", 0.0);
        return new Location(world, x, y, z, yaw, pitch);
    }
}
