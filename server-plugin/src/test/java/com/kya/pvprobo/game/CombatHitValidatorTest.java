package com.kya.pvprobo.game;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.bukkit.util.BoundingBox;
import org.bukkit.util.Vector;
import org.junit.jupiter.api.Test;

final class CombatHitValidatorTest {
    @Test
    void noDamageTicksBlockRepeatedHitCredit() {
        assertTrue(CombatHitValidator.isDamageImmune(1));
        assertFalse(CombatHitValidator.isDamageImmune(0));
    }

    @Test
    void viewRayMustIntersectVictimHitboxWithinReach() {
        Vector eye = new Vector(0.0, 1.62, 0.0);
        Vector forward = new Vector(0.0, 0.0, -1.0);
        BoundingBox victim = new BoundingBox(-0.3, 0.0, -3.3, 0.3, 1.8, -2.7);

        assertTrue(CombatHitValidator.rayIntersectsBox(eye, forward, victim, 3.5));
        assertFalse(CombatHitValidator.rayIntersectsBox(eye, new Vector(1.0, 0.0, 0.0), victim, 3.5));
        assertFalse(CombatHitValidator.rayIntersectsBox(eye, forward, victim, 2.0));
    }
}
