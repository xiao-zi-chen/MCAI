package com.kya.pvprobo.game;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

final class EpisodeStateTest {
    @Test
    void registersPlayersAndTracksDeath() {
        EpisodeState state = new EpisodeState(100);
        state.registerPlayers(List.of("a", "b"));
        state.start();
        state.playerDied("b");
        assertFalse(state.active());
        assertEquals("self_win", state.phase());
        assertEquals("death", state.doneReason());
    }

    @Test
    void timeoutProducesDraw() {
        EpisodeState state = new EpisodeState(2);
        state.start();
        state.markTick();
        assertTrue(state.active());
        state.markTick();
        assertFalse(state.active());
        assertEquals("draw", state.phase());
        assertEquals("timeout", state.doneReason());
    }

    @Test
    void hitCountWinEndsEpisode() {
        EpisodeState state = new EpisodeState(100, 2);
        state.registerPlayers(List.of("a", "b"));
        state.start();
        assertTrue(state.recordHit("a", "b"));
        assertTrue(state.active());
        assertTrue(state.recordHit("a", "b"));
        assertFalse(state.active());
        assertEquals("self_win", state.phase());
        assertEquals("target_hits", state.doneReason());
        assertEquals("a", state.winner());
        assertEquals(2, state.hitCounts().get("a"));
    }

    @Test
    void registeredPlayerMatchingIsCaseInsensitiveButCountsUseCanonicalNames() {
        EpisodeState state = new EpisodeState(100, 2);
        state.registerPlayers(List.of("ROBO", "KyaKayKya"));
        state.start();

        assertTrue(state.isRegisteredPlayer("robO"));
        assertTrue(state.isRegisteredPlayer("kyakaykya"));
        assertTrue(state.recordHit("kyakaykya", "robo"));

        assertEquals(1, state.hitCounts().get("KyaKayKya"));
        assertEquals(0, state.hitCounts().get("ROBO"));
        assertEquals("KyaKayKya", state.lastHitter());
    }

    @Test
    void quitAfterTerminalResultDoesNotOverwriteWinner() {
        EpisodeState state = new EpisodeState(100, 2);
        state.registerPlayers(List.of("a", "b"));
        state.start();
        assertTrue(state.recordHit("b", "a"));
        assertTrue(state.recordHit("b", "a"));

        state.playerQuit("b");

        assertEquals("opponent_win", state.phase());
        assertEquals("target_hits", state.doneReason());
        assertEquals("b", state.winner());
    }

    @Test
    void deathAfterTerminalResultDoesNotOverwriteWinner() {
        EpisodeState state = new EpisodeState(100, 2);
        state.registerPlayers(List.of("a", "b"));
        state.start();
        assertTrue(state.recordHit("a", "b"));
        assertTrue(state.recordHit("a", "b"));

        state.playerDied("b");

        assertEquals("self_win", state.phase());
        assertEquals("target_hits", state.doneReason());
        assertEquals("a", state.winner());
    }

    @Test
    void ignoresUnregisteredHitsAndQuits() {
        EpisodeState state = new EpisodeState(100, 2);
        state.registerPlayers(List.of("a", "b"));
        state.start();
        assertFalse(state.recordHit("viewer", "a"));
        assertEquals(0, state.hitCounts().get("a"));
        state.playerQuit("viewer");
        assertTrue(state.active());
    }

    @Test
    void tracksArenaId() {
        EpisodeState state = new EpisodeState("arena_3", 100, 2);
        assertEquals("arena_3", state.arenaId());
        assertEquals("arena_0", new EpisodeState("default", 100, 2).arenaId());
    }

    @Test
    void tracksEpisodeIdForSnapshotsAndRecords() {
        EpisodeState state = new EpisodeState("arena_3", 100, 2);
        state.setEpisodeId("duel-123");
        assertEquals("duel-123", state.episodeId());
    }

    @Test
    void registryIsolatesArenas() {
        EpisodeRegistry registry = new EpisodeRegistry(100, 2);
        registry.registerPlayers("arena_0", List.of("a0", "b0"));
        registry.registerPlayers("arena_1", List.of("a1", "b1"));
        EpisodeState arena0 = registry.state("arena_0");
        EpisodeState arena1 = registry.state("arena_1");
        arena0.start();
        arena1.start();
        assertTrue(arena0.recordHit("a0", "b0"));
        assertEquals(1, arena0.hitCounts().get("a0"));
        assertEquals(0, arena1.hitCounts().get("a1"));
        assertEquals(arena1, registry.stateForPlayer("a1"));
    }

    @Test
    void registryPlayerLookupIsCaseInsensitiveButKeepsCanonicalNames() {
        EpisodeRegistry registry = new EpisodeRegistry(100, 2);
        registry.registerPlayers("arena_0", List.of("ROBO", "KyaKayKya"));

        assertEquals(registry.state("arena_0"), registry.stateForPlayer("kyakaykya"));
        assertEquals(Set.of("ROBO", "KyaKayKya"), Set.copyOf(registry.allRegisteredPlayers()));

        registry.cleanup("arena_0");

        assertNull(registry.stateForPlayer("robo"));
        assertTrue(registry.allRegisteredPlayers().isEmpty());
    }

    @Test
    void registryCleanupRemovesPlayerArenaMappings() {
        EpisodeRegistry registry = new EpisodeRegistry(100, 2);
        registry.registerPlayers("arena_0", List.of("a", "b"));
        registry.state("arena_0").start();

        registry.cleanup("arena_0");

        assertNull(registry.stateForPlayer("a"));
        assertNull(registry.stateForPlayer("b"));
        assertTrue(registry.allRegisteredPlayers().isEmpty());
        assertTrue(registry.registeredPlayers("arena_0").isEmpty());
    }

    @Test
    void registryCleanupAllRemovesPlayerArenaMappings() {
        EpisodeRegistry registry = new EpisodeRegistry(100, 2);
        registry.registerPlayers("arena_0", List.of("a0", "b0"));
        registry.registerPlayers("arena_1", List.of("a1", "b1"));

        registry.cleanupAll();

        assertNull(registry.stateForPlayer("a0"));
        assertNull(registry.stateForPlayer("a1"));
        assertTrue(registry.allRegisteredPlayers().isEmpty());
    }

    @Test
    void registryExcludesSpectatorsFromTrainingPlayers() {
        EpisodeRegistry registry = new EpisodeRegistry(100, 2, List.of("ViewerOne"));
        registry.registerPlayers("arena_0", List.of("a", "ViewerOne", "b"));
        EpisodeState state = registry.state("arena_0");
        assertEquals(List.of("a", "b"), state.registeredPlayers());
        assertEquals(Set.of("a", "b"), Set.copyOf(registry.allRegisteredPlayers()));
        assertTrue(registry.isSpectator("viewerone"));
        assertNull(registry.stateForPlayer("ViewerOne"));
        state.start();
        assertFalse(state.recordHit("ViewerOne", "a"));
        assertEquals(0, state.hitCounts().get("a"));
    }
}
