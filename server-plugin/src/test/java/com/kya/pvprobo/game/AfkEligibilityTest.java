package com.kya.pvprobo.game;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

final class AfkEligibilityTest {
    @Test
    void tracksNormalPublicHumans() {
        assertTrue(AfkEligibility.shouldTrack(false, false, false, false));
    }

    @Test
    void exemptsOwnerOperator() {
        assertFalse(AfkEligibility.shouldTrack(true, false, false, false));
    }

    @Test
    void exemptsBots() {
        assertFalse(AfkEligibility.shouldTrack(false, true, false, false));
    }

    @Test
    void exemptsConfiguredSpectators() {
        assertFalse(AfkEligibility.shouldTrack(false, false, true, false));
    }

    @Test
    void exemptsActivePlayerDuelParticipants() {
        assertFalse(AfkEligibility.shouldTrack(false, false, false, true));
    }
}
