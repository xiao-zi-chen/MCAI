package com.kya.pvprobo.game;

public final class AfkEligibility {
    private AfkEligibility() {
    }

    public static boolean shouldTrack(
        boolean ownerOperator,
        boolean botName,
        boolean spectator,
        boolean activePlayerDuelParticipant
    ) {
        return !ownerOperator && !botName && !spectator && !activePlayerDuelParticipant;
    }
}
