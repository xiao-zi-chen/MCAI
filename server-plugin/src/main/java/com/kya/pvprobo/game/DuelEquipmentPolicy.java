package com.kya.pvprobo.game;

import org.bukkit.Material;

public final class DuelEquipmentPolicy {
    private DuelEquipmentPolicy() {
    }

    public static boolean shouldEquip(String combatMode, boolean enabled) {
        return false;
    }

    public static Material hitCountWeapon(boolean enabled, String configuredWeapon) {
        return Material.AIR;
    }
}
