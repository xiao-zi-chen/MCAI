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
