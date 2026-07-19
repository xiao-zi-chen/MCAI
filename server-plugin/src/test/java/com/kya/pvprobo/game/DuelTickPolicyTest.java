package com.kya.pvprobo.game;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

final class DuelTickPolicyTest {
    @Test
    void timeoutDrawShouldFinishEvenAfterEpisodeBecomesInactive() {
        assertTrue(DuelTickPolicy.shouldFinishAfterTick(true, false, "draw"));
    }

    @Test
    void activeRunningEpisodeContinuesTickProcessing() {
        assertFalse(DuelTickPolicy.shouldFinishAfterTick(true, true, "running"));
    }

    @Test
    void inactiveSessionDoesNotFinishAgain() {
        assertFalse(DuelTickPolicy.shouldFinishAfterTick(false, false, "draw"));
    }
}
