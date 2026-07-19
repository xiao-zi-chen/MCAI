package com.kya.pvprobo.game;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.Test;

final class CombatDamageDiagnosticsTest {
    @Test
    void classifiesCancelledDamageBeforeOtherReasons() {
        EpisodeState state = runningHitCountState();

        assertEquals("cancelled", CombatDamageDiagnostics.ignoredReason(state, "Alex", "ROBO", 2.0, true));
    }

    @Test
    void classifiesInactiveWrongModeAndUnregisteredDamage() {
        EpisodeState inactive = new EpisodeState(100, 2);
        inactive.registerPlayers(List.of("ROBO", "Alex"));

        assertEquals("inactive", CombatDamageDiagnostics.ignoredReason(inactive, "Alex", "ROBO", 2.0, false));

        EpisodeState wrongMode = runningHitCountState();
        wrongMode.configureRules("deathmatch", 2);
        wrongMode.start();
        assertEquals("wrong_mode", CombatDamageDiagnostics.ignoredReason(wrongMode, "Alex", "ROBO", 2.0, false));

        EpisodeState state = runningHitCountState();
        assertEquals("attacker_unregistered", CombatDamageDiagnostics.ignoredReason(state, "Viewer", "ROBO", 2.0, false));
        assertEquals("victim_unregistered", CombatDamageDiagnostics.ignoredReason(state, "Alex", "Viewer", 2.0, false));
    }

    @Test
    void classifiesSelfDamageAndNonPositiveFinalDamage() {
        EpisodeState state = runningHitCountState();

        assertEquals("self_damage", CombatDamageDiagnostics.ignoredReason(state, "Alex", "alex", 2.0, false));
        assertEquals("non_positive_final_damage", CombatDamageDiagnostics.ignoredReason(state, "Alex", "ROBO", 0.0, false));
    }

    @Test
    void formatsIgnoredDamageEventWithUsefulCombatContext() {
        String event = CombatDamageDiagnostics.ignoredEvent(
            "non_positive_final_damage",
            "Alex",
            "ROBO",
            0.0,
            "running",
            7,
            0.95f
        );

        assertTrue(event.startsWith("damage_ignored:non_positive_final_damage:Alex:ROBO"));
        assertTrue(event.contains(":final=0.000"));
        assertTrue(event.contains(":phase=running"));
        assertTrue(event.contains(":hurt=7"));
        assertTrue(event.contains(":cooldown=0.950"));
    }

    private EpisodeState runningHitCountState() {
        EpisodeState state = new EpisodeState(100, 2);
        state.registerPlayers(List.of("ROBO", "Alex"));
        state.start();
        return state;
    }
}
