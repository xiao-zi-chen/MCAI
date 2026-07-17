package com.kya.pvprobo.game;

public final class DuelDamagePolicy {
    private static final double SURVIVAL_HEALTH_BUFFER = 1.0;

    private DuelDamagePolicy() {
    }

    public static boolean isCountableFinalDamage(double finalDamage) {
        return Double.isFinite(finalDamage) && finalDamage > 0.0;
    }

    public static boolean shouldScheduleHealthRestore(double finalDamage) {
        return isCountableFinalDamage(finalDamage);
    }

    public static double safePreDamageHealth(double currentHealth, double maxHealth, double finalDamage) {
        if (!isCountableFinalDamage(finalDamage) || maxHealth <= 0.0) {
            return currentHealth;
        }
        if (currentHealth - finalDamage > 0.0) {
            return currentHealth;
        }
        return Math.min(maxHealth, finalDamage + SURVIVAL_HEALTH_BUFFER);
    }

    public static double restoreHealthTarget(double maxHealth) {
        return Math.max(0.0, maxHealth);
    }
}
