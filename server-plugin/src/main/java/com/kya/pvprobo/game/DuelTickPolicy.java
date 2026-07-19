package com.kya.pvprobo.game;

public final class DuelTickPolicy {
    private DuelTickPolicy() {
    }

    public static boolean shouldFinishAfterTick(boolean sessionActive, boolean episodeActive, String phase) {
        return sessionActive && !episodeActive && isTerminalPhase(phase);
    }

    public static boolean isTerminalPhase(String phase) {
        return "self_win".equals(phase) || "opponent_win".equals(phase) || "draw".equals(phase);
    }
}
