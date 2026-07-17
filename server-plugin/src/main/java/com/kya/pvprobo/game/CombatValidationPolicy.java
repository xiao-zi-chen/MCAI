package com.kya.pvprobo.game;

import java.util.List;
import java.util.Locale;

public final class CombatValidationPolicy {
    private CombatValidationPolicy() {
    }

    public static boolean shouldValidateSyntheticOrBotAttack(
        String attackerName,
        String victimName,
        List<String> botPrefixes,
        String defaultRoboName
    ) {
        return isBotControlledName(attackerName, botPrefixes, defaultRoboName);
    }

    static boolean isBotControlledName(String name, List<String> botPrefixes, String defaultRoboName) {
        if (name == null || name.isBlank()) {
            return false;
        }
        if (defaultRoboName != null && name.equalsIgnoreCase(defaultRoboName)) {
            return true;
        }
        String upper = name.toUpperCase(Locale.ROOT);
        if (name.equalsIgnoreCase("ROBO")) {
            return true;
        }
        if (upper.matches("ROBO[-_][A-Z][0-9]+") || upper.matches("SCRIPT[-_][A-Z][0-9]+")) {
            return true;
        }
        for (String prefix : botPrefixes) {
            if (prefix != null && !prefix.isBlank() && upper.startsWith(prefix.toUpperCase(Locale.ROOT))) {
                return true;
            }
        }
        return false;
    }
}
