package com.kya.pvprobo.game;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import org.bukkit.Material;
import org.junit.jupiter.api.Test;

final class DuelEquipmentPolicyTest {
    @Test
    void hitCountEquipmentDoesNotProvideDefaultWeapon() {
        assertEquals(Material.AIR, DuelEquipmentPolicy.hitCountWeapon(true, ""));
    }

    @Test
    void configuredWeaponDoesNotReenableHitCountEquipment() {
        assertEquals(Material.AIR, DuelEquipmentPolicy.hitCountWeapon(true, "IRON_SWORD"));
    }

    @Test
    void disabledEquipmentDoesNotEquipWeapon() {
        assertEquals(Material.AIR, DuelEquipmentPolicy.hitCountWeapon(false, "DIAMOND_SWORD"));
    }

    @Test
    void hitCountModeDoesNotReceiveDefaultEquipment() {
        assertFalse(DuelEquipmentPolicy.shouldEquip("hit_count", true));
        assertFalse(DuelEquipmentPolicy.shouldEquip("deathmatch", true));
        assertFalse(DuelEquipmentPolicy.shouldEquip("hit_count", false));
    }
}
