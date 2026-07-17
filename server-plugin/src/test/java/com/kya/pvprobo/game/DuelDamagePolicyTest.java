package com.kya.pvprobo.game;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

final class DuelDamagePolicyTest {
    @Test
    void countsOnlyPositiveVanillaFinalDamage() {
        assertFalse(DuelDamagePolicy.isCountableFinalDamage(0.0));
        assertFalse(DuelDamagePolicy.isCountableFinalDamage(-0.25));
        assertTrue(DuelDamagePolicy.isCountableFinalDamage(0.01));
        assertTrue(DuelDamagePolicy.isCountableFinalDamage(1.0));
    }

    @Test
    void keepsSafeHealthWhenDamageWouldOtherwiseKill() {
        assertEquals(3.0, DuelDamagePolicy.safePreDamageHealth(1.0, 20.0, 2.0));
        assertEquals(20.0, DuelDamagePolicy.safePreDamageHealth(1.0, 20.0, 30.0));
    }

    @Test
    void leavesHealthAloneWhenDamageIsSurvivable() {
        assertEquals(10.0, DuelDamagePolicy.safePreDamageHealth(10.0, 20.0, 2.0));
        assertEquals(2.1, DuelDamagePolicy.safePreDamageHealth(2.1, 20.0, 2.0));
    }

    @Test
    void restoresToMaximumHealthAfterCountedHit() {
        assertEquals(20.0, DuelDamagePolicy.restoreHealthTarget(20.0));
        assertEquals(40.0, DuelDamagePolicy.restoreHealthTarget(40.0));
    }

    @Test
    void schedulesHealthRestoreOnlyAfterPositiveFinalDamage() {
        assertFalse(DuelDamagePolicy.shouldScheduleHealthRestore(0.0));
        assertFalse(DuelDamagePolicy.shouldScheduleHealthRestore(-1.0));
        assertTrue(DuelDamagePolicy.shouldScheduleHealthRestore(0.01));
        assertTrue(DuelDamagePolicy.shouldScheduleHealthRestore(3.0));
    }
}
