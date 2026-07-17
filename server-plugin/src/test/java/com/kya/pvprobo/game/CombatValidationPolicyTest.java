package com.kya.pvprobo.game;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.Test;

final class CombatValidationPolicyTest {
    private static final List<String> BOT_PREFIXES = List.of("ROBO", "SCRIPT");

    @Test
    void humanPlayerAttacksDoNotRunSyntheticGeometryValidation() {
        assertFalse(CombatValidationPolicy.shouldValidateSyntheticOrBotAttack("Alex", "Steve", BOT_PREFIXES, "ROBO"));
        assertFalse(CombatValidationPolicy.shouldValidateSyntheticOrBotAttack("Alex", "ROBO", BOT_PREFIXES, "ROBO"));
    }

    @Test
    void botAttacksStillRunTransitionalGeometryValidation() {
        assertTrue(CombatValidationPolicy.shouldValidateSyntheticOrBotAttack("ROBO", "Alex", BOT_PREFIXES, "ROBO"));
        assertTrue(CombatValidationPolicy.shouldValidateSyntheticOrBotAttack("ROBO_D0", "SCRIPT_H0", BOT_PREFIXES, "ROBO"));
        assertTrue(CombatValidationPolicy.shouldValidateSyntheticOrBotAttack("SCRIPT_H0", "ROBO_D0", BOT_PREFIXES, "ROBO"));
    }
}
