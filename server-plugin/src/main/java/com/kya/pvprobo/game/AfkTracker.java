package com.kya.pvprobo.game;

import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

public final class AfkTracker {
    public enum Decision {
        NONE,
        WARN,
        KICK
    }

    private static final class Entry {
        long lastActivityMillis;
        boolean warned;

        Entry(long lastActivityMillis) {
            this.lastActivityMillis = lastActivityMillis;
        }
    }

    private final long warnAfterMillis;
    private final long kickAfterMillis;
    private final Map<String, Entry> entries = new HashMap<>();

    public AfkTracker(long warnAfterSeconds, long kickAfterSeconds) {
        this.warnAfterMillis = Math.max(1L, warnAfterSeconds) * 1000L;
        this.kickAfterMillis = Math.max(Math.max(1L, kickAfterSeconds) * 1000L, this.warnAfterMillis);
    }

    public void recordActivity(String playerName, long nowMillis) {
        if (playerName == null || playerName.isBlank()) {
            return;
        }
        entries.put(key(playerName), new Entry(nowMillis));
    }

    public void forget(String playerName) {
        if (playerName == null || playerName.isBlank()) {
            return;
        }
        entries.remove(key(playerName));
    }

    public Decision check(String playerName, long nowMillis) {
        if (playerName == null || playerName.isBlank()) {
            return Decision.NONE;
        }
        Entry entry = entries.get(key(playerName));
        if (entry == null) {
            recordActivity(playerName, nowMillis);
            return Decision.NONE;
        }
        long idleMillis = Math.max(0L, nowMillis - entry.lastActivityMillis);
        if (idleMillis >= kickAfterMillis) {
            return Decision.KICK;
        }
        if (idleMillis >= warnAfterMillis && !entry.warned) {
            entry.warned = true;
            return Decision.WARN;
        }
        return Decision.NONE;
    }

    private String key(String playerName) {
        return playerName.toLowerCase(Locale.ROOT);
    }
}
