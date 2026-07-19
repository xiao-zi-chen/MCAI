package com.kya.pvprobo.game;

import java.util.Locale;

public final class CombatDamageDiagnostics {
    private CombatDamageDiagnostics() {
    }

    public static String ignoredReason(
        EpisodeState episodeState,
        String attackerName,
        String victimName,
        double finalDamage,
        boolean cancelled
    ) {
        if (cancelled) {
            return "cancelled";
        }
        if (episodeState == null) {
            return "no_episode";
        }
        if (!episodeState.active()) {
            return "inactive";
        }
        if (!"hit_count".equals(episodeState.combatMode())) {
            return "wrong_mode";
        }
        if (!episodeState.isRegisteredPlayer(attackerName)) {
            return "attacker_unregistered";
        }
        if (!episodeState.isRegisteredPlayer(victimName)) {
            return "victim_unregistered";
        }
        if (attackerName != null && victimName != null && attackerName.equalsIgnoreCase(victimName)) {
            return "self_damage";
        }
        if (!DuelDamagePolicy.isCountableFinalDamage(finalDamage)) {
            return "non_positive_final_damage";
        }
        return "";
    }

    public static String ignoredEvent(
        String reason,
        String attackerName,
        String victimName,
        double finalDamage,
        String phase,
        int victimHurtTime,
        float attackerCooldown
    ) {
        return "damage_ignored:" + safe(reason)
            + ":" + safe(attackerName)
            + ":" + safe(victimName)
            + ":final=" + String.format(Locale.ROOT, "%.3f", finalDamage)
            + ":phase=" + safe(phase)
            + ":hurt=" + victimHurtTime
            + ":cooldown=" + String.format(Locale.ROOT, "%.3f", attackerCooldown);
    }

    private static String safe(String value) {
        return value == null ? "" : value;
    }
}
