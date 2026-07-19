package com.kya.pvprobo.game;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.data.BlockData;
import org.bukkit.plugin.Plugin;

public final class ReplayService {
    private static final int SCHEMA_VERSION = 1;
    private static final Pattern SAFE_NAME = Pattern.compile("[A-Za-z0-9_.-]{1,64}");
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

    private final Plugin plugin;
    private final File directory;

    public ReplayService(Plugin plugin) {
        this.plugin = plugin;
        this.directory = new File(plugin.getDataFolder(), plugin.getConfig().getString("replay.directory", "replays"));
    }

    public synchronized List<String> status() {
        List<String> lines = new ArrayList<>();
        lines.add("Replay mode: " + (enabled() ? "enabled" : "disabled"));
        lines.add("source=duel.bounds");
        lines.add("directory=" + directory.getPath());
        lines.add("max-volume=" + maxVolume());
        lines.add("snapshots=" + snapshotNames().size());
        return lines;
    }

    public synchronized List<String> record(String rawName) {
        if (!enabled()) {
            return List.of("Replay mode is disabled in config.yml (replay.enabled=false).");
        }
        String name = normalizeName(rawName);
        Bounds bounds = readDuelBounds();
        if (bounds.world == null) {
            return List.of("Replay record failed: world is not loaded.");
        }
        if (bounds.volume() > maxVolume()) {
            return List.of("Replay record failed: volume " + bounds.volume() + " exceeds replay.max-volume=" + maxVolume() + ".");
        }
        if (!directory.exists() && !directory.mkdirs()) {
            return List.of("Replay record failed: could not create " + directory.getPath());
        }

        Snapshot snapshot = new Snapshot();
        snapshot.schemaVersion = SCHEMA_VERSION;
        snapshot.name = name;
        snapshot.world = bounds.world.getName();
        snapshot.recordedAtEpochMs = Instant.now().toEpochMilli();
        snapshot.minX = bounds.minX;
        snapshot.minY = bounds.minY;
        snapshot.minZ = bounds.minZ;
        snapshot.sizeX = bounds.sizeX();
        snapshot.sizeY = bounds.sizeY();
        snapshot.sizeZ = bounds.sizeZ();
        snapshot.blocks = new ArrayList<>(bounds.volume());

        for (int y = bounds.minY; y <= bounds.maxY; y++) {
            for (int z = bounds.minZ; z <= bounds.maxZ; z++) {
                for (int x = bounds.minX; x <= bounds.maxX; x++) {
                    Block block = bounds.world.getBlockAt(x, y, z);
                    snapshot.blocks.add(new BlockEntry(
                        x - bounds.minX,
                        y - bounds.minY,
                        z - bounds.minZ,
                        block.getBlockData().getAsString(true)
                    ));
                }
            }
        }

        File file = snapshotFile(name);
        try (var writer = Files.newBufferedWriter(file.toPath(), StandardCharsets.UTF_8)) {
            GSON.toJson(snapshot, writer);
        } catch (IOException exc) {
            plugin.getLogger().warning("Failed to save replay snapshot: " + exc.getMessage());
            return List.of("Replay record failed: " + exc.getMessage());
        }
        return List.of("Replay recorded: " + name, "blocks=" + snapshot.blocks.size(), "file=" + file.getPath());
    }

    public synchronized List<String> play(String rawName) {
        if (!enabled()) {
            return List.of("Replay mode is disabled in config.yml (replay.enabled=false).");
        }
        String name = normalizeName(rawName);
        File file = snapshotFile(name);
        if (!file.isFile()) {
            return List.of("Replay not found: " + name);
        }

        Snapshot snapshot;
        try (var reader = Files.newBufferedReader(file.toPath(), StandardCharsets.UTF_8)) {
            snapshot = GSON.fromJson(reader, Snapshot.class);
        } catch (IOException | RuntimeException exc) {
            plugin.getLogger().warning("Failed to load replay snapshot: " + exc.getMessage());
            return List.of("Replay play failed: " + exc.getMessage());
        }
        if (snapshot == null || snapshot.schemaVersion != SCHEMA_VERSION || snapshot.blocks == null) {
            return List.of("Replay play failed: unsupported or empty snapshot.");
        }
        if (snapshot.blocks.size() > maxVolume()) {
            return List.of("Replay play failed: snapshot volume " + snapshot.blocks.size() + " exceeds replay.max-volume=" + maxVolume() + ".");
        }
        World world = Bukkit.getWorld(snapshot.world);
        if (world == null) {
            return List.of("Replay play failed: world is not loaded: " + snapshot.world);
        }

        int applied = 0;
        for (BlockEntry entry : snapshot.blocks) {
            try {
                BlockData data = Bukkit.createBlockData(entry.data);
                world.getBlockAt(snapshot.minX + entry.dx, snapshot.minY + entry.dy, snapshot.minZ + entry.dz).setBlockData(data, false);
                applied++;
            } catch (IllegalArgumentException exc) {
                plugin.getLogger().warning("Skipping invalid replay block data: " + entry.data);
            }
        }
        return List.of("Replay played: " + name, "blocks=" + applied);
    }

    public synchronized List<String> list() {
        List<String> names = snapshotNames();
        if (names.isEmpty()) {
            return List.of("No replay snapshots found in " + directory.getPath());
        }
        List<String> lines = new ArrayList<>();
        lines.add("Replay snapshots:");
        for (String name : names) {
            lines.add("- " + name);
        }
        return lines;
    }

    public synchronized List<String> delete(String rawName) {
        String name = normalizeName(rawName);
        File file = snapshotFile(name);
        if (!file.isFile()) {
            return List.of("Replay not found: " + name);
        }
        if (!file.delete()) {
            return List.of("Replay delete failed: " + file.getPath());
        }
        return List.of("Replay deleted: " + name);
    }

    public static String normalizeName(String rawName) {
        if (rawName == null || rawName.isBlank()) {
            throw new IllegalArgumentException("Replay name is required.");
        }
        String name = rawName.trim();
        if (!SAFE_NAME.matcher(name).matches() || name.equals(".") || name.equals("..")) {
            throw new IllegalArgumentException("Replay name must be 1-64 chars: letters, numbers, dot, underscore, or dash.");
        }
        return name;
    }

    private List<String> snapshotNames() {
        File[] files = directory.listFiles((dir, name) -> name.toLowerCase(Locale.ROOT).endsWith(".json"));
        if (files == null || files.length == 0) {
            return List.of();
        }
        List<String> names = new ArrayList<>();
        for (File file : files) {
            String name = file.getName();
            names.add(name.substring(0, name.length() - ".json".length()));
        }
        names.sort(Comparator.naturalOrder());
        return names;
    }

    private Bounds readDuelBounds() {
        String worldName = plugin.getConfig().getString("duel.world", "world");
        World world = Bukkit.getWorld(worldName);
        Location center = new Location(
            world,
            plugin.getConfig().getDouble("duel.bounds.center.x", 0.0),
            plugin.getConfig().getDouble("duel.bounds.center.y", 64.0),
            plugin.getConfig().getDouble("duel.bounds.center.z", 0.0)
        );
        int radiusX = (int) Math.ceil(plugin.getConfig().getDouble("duel.bounds.radius-x", 16.0));
        int radiusY = (int) Math.ceil(plugin.getConfig().getDouble("duel.bounds.radius-y", 8.0));
        int radiusZ = (int) Math.ceil(plugin.getConfig().getDouble("duel.bounds.radius-z", 16.0));
        return new Bounds(
            world,
            center.getBlockX() - radiusX,
            Math.max(-64, center.getBlockY() - radiusY),
            center.getBlockZ() - radiusZ,
            center.getBlockX() + radiusX,
            Math.min(319, center.getBlockY() + radiusY),
            center.getBlockZ() + radiusZ
        );
    }

    private File snapshotFile(String name) {
        return new File(directory, normalizeName(name) + ".json");
    }

    private boolean enabled() {
        return plugin.getConfig().getBoolean("replay.enabled", true);
    }

    private int maxVolume() {
        return Math.max(1, plugin.getConfig().getInt("replay.max-volume", 120000));
    }

    private record Bounds(World world, int minX, int minY, int minZ, int maxX, int maxY, int maxZ) {
        int sizeX() {
            return maxX - minX + 1;
        }

        int sizeY() {
            return maxY - minY + 1;
        }

        int sizeZ() {
            return maxZ - minZ + 1;
        }

        int volume() {
            return sizeX() * sizeY() * sizeZ();
        }
    }

    private static final class Snapshot {
        int schemaVersion;
        String name;
        String world;
        long recordedAtEpochMs;
        int minX;
        int minY;
        int minZ;
        int sizeX;
        int sizeY;
        int sizeZ;
        List<BlockEntry> blocks;
    }

    private static final class BlockEntry {
        int dx;
        int dy;
        int dz;
        String data;

        BlockEntry() {
        }

        BlockEntry(int dx, int dy, int dz, String data) {
            this.dx = dx;
            this.dy = dy;
            this.dz = dz;
            this.data = data;
        }
    }
}
