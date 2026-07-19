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
    void mineflayerBotAttacksTrustPaperNativeDamagePipeline() {
        assertFalse(CombatValidationPolicy.shouldValidateSyntheticOrBotAttack("ROBO", "Alex", BOT_PREFIXES, "ROBO"));
        assertFalse(CombatValidationPolicy.shouldValidateSyntheticOrBotAttack("ROBO_D0", "SCRIPT_H0", BOT_PREFIXES, "ROBO"));
        assertFalse(CombatValidationPolicy.shouldValidateSyntheticOrBotAttack("SCRIPT_H0", "ROBO_D0", BOT_PREFIXES, "ROBO"));
    }

    @Test
    void backendLineageControlsSyntheticGeometryValidationForBotNames() {
        assertFalse(CombatValidationPolicy.shouldValidateSyntheticOrBotAttack(
            "ROBO_A0",
            "SCRIPT_A0",
            BOT_PREFIXES,
            "ROBO",
            "mineflayer"
        ));
        assertTrue(CombatValidationPolicy.shouldValidateSyntheticOrBotAttack(
            "ROBO_A0",
            "SCRIPT_A0",
            BOT_PREFIXES,
            "ROBO",
            "legacy_synthetic"
        ));
        assertFalse(CombatValidationPolicy.shouldValidateSyntheticOrBotAttack(
            "ROBO_A0",
            "SCRIPT_A0",
            BOT_PREFIXES,
            "ROBO",
            "herobot"
        ));
        assertFalse(CombatValidationPolicy.shouldValidateSyntheticOrBotAttack(
            "ROBO_A0",
            "SCRIPT_A0",
            BOT_PREFIXES,
            "ROBO",
            "real_client"
        ));
    }
}
