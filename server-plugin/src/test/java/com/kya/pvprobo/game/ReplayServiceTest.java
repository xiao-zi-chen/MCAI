package com.kya.pvprobo.game;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

final class ReplayServiceTest {
    @Test
    void acceptsSafeSnapshotNames() {
        assertEquals("arena_20260706", ReplayService.normalizeName(" arena_20260706 "));
        assertEquals("champion-hall.v1", ReplayService.normalizeName("champion-hall.v1"));
    }

    @Test
    void rejectsPathLikeSnapshotNames() {
        assertThrows(IllegalArgumentException.class, () -> ReplayService.normalizeName("../world"));
        assertThrows(IllegalArgumentException.class, () -> ReplayService.normalizeName("folder\\world"));
        assertThrows(IllegalArgumentException.class, () -> ReplayService.normalizeName(""));
        assertThrows(IllegalArgumentException.class, () -> ReplayService.normalizeName(".."));
    }
}
