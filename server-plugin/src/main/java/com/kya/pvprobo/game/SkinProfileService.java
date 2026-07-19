package com.kya.pvprobo.game;

import com.destroystokyo.paper.profile.ProfileProperty;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Base64;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.AsyncPlayerPreLoginEvent;
import org.bukkit.plugin.Plugin;

public final class SkinProfileService implements Listener {
    private final Plugin plugin;

    public SkinProfileService(Plugin plugin) {
        this.plugin = plugin;
    }

    @EventHandler(priority = EventPriority.HIGHEST)
    public void onAsyncPreLogin(AsyncPlayerPreLoginEvent event) {
        String configPrefix = skinConfigPrefix(event.getName());
        if (configPrefix.isBlank() || !enabled(configPrefix)) {
            return;
        }
        String textureValue = configuredTextureValue(configPrefix);
        if (textureValue.isBlank()) {
            return;
        }
        String signature = plugin.getConfig().getString(configPrefix + ".texture-signature", "").trim();
        event.getPlayerProfile().removeProperty("textures");
        if (signature.isBlank()) {
            event.getPlayerProfile().setProperty(new ProfileProperty("textures", textureValue));
        } else {
            event.getPlayerProfile().setProperty(new ProfileProperty("textures", textureValue, signature));
        }
        event.setPlayerProfile(event.getPlayerProfile());
        plugin.getLogger().info("Applied " + skinKind(event.getName()) + " skin profile for " + event.getName()
            + " source=" + skinSource(configPrefix)
            + " signed=" + (!signature.isBlank()));
    }

    private boolean enabled(String configPrefix) {
        return plugin.getConfig().getBoolean(configPrefix + ".enabled", true);
    }

    private String configuredTextureValue(String configPrefix) {
        String explicit = plugin.getConfig().getString(configPrefix + ".texture-value", "").trim();
        if (!explicit.isBlank()) {
            return explicit;
        }
        String url = plugin.getConfig().getString(configPrefix + ".url", "").trim();
        if (url.isBlank()) {
            return "";
        }
        String model = plugin.getConfig().getString(configPrefix + ".model", "slim").trim().toLowerCase();
        String metadata = model.equals("slim") || model.equals("alex")
            ? ",\"metadata\":{\"model\":\"slim\"}"
            : "";
        String payload = "{\"textures\":{\"SKIN\":{\"url\":\"" + escapeJson(url) + "\"" + metadata + "}}}";
        return Base64.getEncoder().encodeToString(payload.getBytes(StandardCharsets.UTF_8));
    }

    private String skinSource(String configPrefix) {
        if (!plugin.getConfig().getString(configPrefix + ".texture-value", "").trim().isBlank()) {
            return "texture-value";
        }
        if (!plugin.getConfig().getString(configPrefix + ".url", "").trim().isBlank()) {
            return "url";
        }
        return "none";
    }

    private String skinConfigPrefix(String name) {
        if (isScriptName(name)) {
            return "duel.script-skin";
        }
        if (isRoboName(name)) {
            return "duel.robo-skin";
        }
        return "";
    }

    private String skinKind(String name) {
        return isScriptName(name) ? "SCRIPT" : "ROBO";
    }

    private boolean isRoboName(String name) {
        String configured = plugin.getConfig().getString("duel.default-robo-name", "ROBO");
        String upper = name.toUpperCase(Locale.ROOT);
        return name.equalsIgnoreCase(configured) || name.equalsIgnoreCase("ROBO") || upper.matches("ROBO[-_][A-Z][0-9]+");
    }

    private boolean isScriptName(String name) {
        String upper = name.toUpperCase(Locale.ROOT);
        return upper.matches("SCRIPT[-_][A-Z][0-9]+");
    }

    private String escapeJson(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
