package com.kya.pvprobo.game;

final class DuelArenaPoolSizing {
    private DuelArenaPoolSizing() {
    }

    static int sessionCount(boolean enabled, int configuredCount, int maxHumanPlayers) {
        if (!enabled) {
            return 1;
        }
        int count = Math.max(1, configuredCount);
        if (configuredCount <= 0) {
            count = 1;
        }
        if (maxHumanPlayers > 0) {
            count = Math.max(count, maxHumanPlayers);
        }
        return count;
    }

    static int columns(int configuredColumns, int sessionCount) {
        if (configuredColumns > 0) {
            return configuredColumns;
        }
        return Math.max(1, (int) Math.ceil(Math.sqrt(Math.max(1, sessionCount))));
    }
}
