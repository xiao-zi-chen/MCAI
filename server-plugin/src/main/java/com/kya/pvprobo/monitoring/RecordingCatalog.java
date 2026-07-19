package com.kya.pvprobo.monitoring;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.bukkit.plugin.Plugin;

public final class RecordingCatalog {
    private static final Gson GSON = new Gson();
    private final Plugin plugin;

    public RecordingCatalog(Plugin plugin) {
        this.plugin = plugin;
    }

    public Map<String, Object> scan() {
        File directory = recordingDirectory();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("directory", directory.getPath());
        result.put("exists", directory.isDirectory());
        result.put("scanned_at", Instant.now().toString());

        File manifestFile = new File(directory, "manifest.json");
        JsonObject manifest = readObject(manifestFile);
        List<Map<String, Object>> episodes = new ArrayList<>();
        int totalSteps = 0;
        if (manifest != null && manifest.has("episodes") && manifest.get("episodes").isJsonArray()) {
            JsonArray items = manifest.getAsJsonArray("episodes");
            for (JsonElement element : items) {
                if (!element.isJsonObject()) {
                    continue;
                }
                Map<String, Object> episode = episodeSummary(directory, element.getAsJsonObject());
                totalSteps += ((Number) episode.getOrDefault("steps", 0)).intValue();
                episodes.add(episode);
            }
        }
        episodes.sort(Comparator.comparing(item -> String.valueOf(item.get("episode_id"))));
        result.put("manifest_present", manifest != null);
        result.put("schema_version", manifest == null ? null : numberOrNull(manifest, "schema_version"));
        result.put("record_source", manifest == null ? null : stringOrBlank(manifest, "record_source"));
        result.put("git_commit", manifest == null ? null : stringOrBlank(manifest, "git_commit"));
        result.put("episode_count", episodes.size());
        result.put("total_steps", totalSteps);
        result.put("episodes", episodes);
        result.put("loose_files", looseRecordFiles(directory));
        return result;
    }

    private Map<String, Object> episodeSummary(File directory, JsonObject object) {
        String npzName = stringOrBlank(object, "npz_file");
        String jsonlName = stringOrBlank(object, "jsonl_file");
        File npz = npzName.isBlank() ? null : new File(directory, npzName);
        File jsonl = jsonlName.isBlank() ? null : new File(directory, jsonlName);
        Map<String, Object> episode = new LinkedHashMap<>();
        episode.put("episode_id", stringOrBlank(object, "episode_id"));
        episode.put("arena_id", stringOrBlank(object, "arena_id"));
        episode.put("mode", stringOrBlank(object, "mode"));
        episode.put("difficulty", stringOrBlank(object, "difficulty"));
        episode.put("steps", numberOrZero(object, "steps"));
        episode.put("actors", GSON.fromJson(object.get("actors"), List.class));
        episode.put("npz_file", npzName);
        episode.put("jsonl_file", jsonlName);
        episode.put("npz_exists", npz != null && npz.isFile());
        episode.put("jsonl_exists", jsonl != null && jsonl.isFile());
        episode.put("npz_bytes", npz != null && npz.isFile() ? npz.length() : 0L);
        episode.put("jsonl_bytes", jsonl != null && jsonl.isFile() ? jsonl.length() : 0L);
        episode.put("updated_at", latestModified(npz, jsonl));
        return episode;
    }

    private List<Map<String, Object>> looseRecordFiles(File directory) {
        File[] files = directory.listFiles((dir, name) -> name.endsWith(".npz") || name.endsWith(".jsonl"));
        if (files == null || files.length == 0) {
            return List.of();
        }
        List<Map<String, Object>> results = new ArrayList<>();
        for (File file : files) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("name", file.getName());
            item.put("bytes", file.length());
            item.put("updated_at", Instant.ofEpochMilli(file.lastModified()).toString());
            results.add(item);
        }
        results.sort(Comparator.comparing(item -> String.valueOf(item.get("name"))));
        return results;
    }

    private File recordingDirectory() {
        String configured = plugin.getConfig().getString("monitoring.recordings.directory", "");
        if (configured != null && !configured.isBlank()) {
            return new File(configured).getAbsoluteFile();
        }
        File dataFolder = plugin.getDataFolder().getAbsoluteFile();
        File plugins = dataFolder.getParentFile();
        File workerRoot = plugins == null ? null : plugins.getParentFile();
        if (workerRoot != null) {
            return new File(workerRoot, "duel-records").getAbsoluteFile();
        }
        return new File("duel-records").getAbsoluteFile();
    }

    private JsonObject readObject(File file) {
        if (!file.isFile()) {
            return null;
        }
        try {
            String text = Files.readString(file.toPath(), StandardCharsets.UTF_8);
            return JsonParser.parseString(text).getAsJsonObject();
        } catch (IOException | RuntimeException exc) {
            plugin.getLogger().warning("Failed to read recording manifest " + file + ": " + exc.getMessage());
            return null;
        }
    }

    private String latestModified(File first, File second) {
        long value = 0L;
        if (first != null && first.isFile()) {
            value = Math.max(value, first.lastModified());
        }
        if (second != null && second.isFile()) {
            value = Math.max(value, second.lastModified());
        }
        return value <= 0L ? "" : Instant.ofEpochMilli(value).toString();
    }

    private String stringOrBlank(JsonObject object, String key) {
        return object.has(key) && !object.get(key).isJsonNull() ? object.get(key).getAsString() : "";
    }

    private Number numberOrNull(JsonObject object, String key) {
        return object.has(key) && !object.get(key).isJsonNull() ? object.get(key).getAsNumber() : null;
    }

    private int numberOrZero(JsonObject object, String key) {
        return object.has(key) && !object.get(key).isJsonNull() ? object.get(key).getAsInt() : 0;
    }
}
