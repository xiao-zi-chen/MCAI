package com.kya.pvprobo.game;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

final class DuelArenaPoolSizingTest {
    @Test
    void disabledArenaPoolUsesSingleSession() {
        assertEquals(1, DuelArenaPoolSizing.sessionCount(false, 99, 20));
    }

    @Test
    void positiveHumanLimitRaisesAutoArenaCapacity() {
        assertEquals(20, DuelArenaPoolSizing.sessionCount(true, 0, 20));
    }

    @Test
    void positiveHumanLimitOverridesStaleSmallerConfiguredCount() {
        assertEquals(20, DuelArenaPoolSizing.sessionCount(true, 3, 20));
    }

    @Test
    void explicitCountControlsUnlimitedHumanCapacity() {
        assertEquals(12, DuelArenaPoolSizing.sessionCount(true, 12, -1));
    }

    @Test
    void unlimitedHumanCapacityWithoutExplicitCountFallsBackToOne() {
        assertEquals(1, DuelArenaPoolSizing.sessionCount(true, 0, -1));
    }

    @Test
    void autoColumnsUseCompactGrid() {
        assertEquals(5, DuelArenaPoolSizing.columns(0, 20));
    }

    @Test
    void explicitColumnsWinWhenConfigured() {
        assertEquals(4, DuelArenaPoolSizing.columns(4, 20));
    }
}
