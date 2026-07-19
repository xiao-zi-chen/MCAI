package com.kya.pvprobo.game;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

final class AfkTrackerTest {
    @Test
    void newPlayerDefaultsToNoAction() {
        AfkTracker tracker = new AfkTracker(900, 1200);

        assertEquals(AfkTracker.Decision.NONE, tracker.check("player", 0L));
    }

    @Test
    void warnsOnceAtWarningThreshold() {
        AfkTracker tracker = new AfkTracker(900, 1200);
        tracker.recordActivity("player", 0L);

        assertEquals(AfkTracker.Decision.WARN, tracker.check("player", 900_000L));
        assertEquals(AfkTracker.Decision.NONE, tracker.check("player", 901_000L));
    }

    @Test
    void kicksAtKickThreshold() {
        AfkTracker tracker = new AfkTracker(900, 1200);
        tracker.recordActivity("player", 0L);

        assertEquals(AfkTracker.Decision.KICK, tracker.check("player", 1_200_000L));
    }

    @Test
    void activityRefreshPreventsKick() {
        AfkTracker tracker = new AfkTracker(900, 1200);
        tracker.recordActivity("player", 0L);
        assertEquals(AfkTracker.Decision.WARN, tracker.check("player", 900_000L));

        tracker.recordActivity("player", 1_000_000L);

        assertEquals(AfkTracker.Decision.NONE, tracker.check("player", 1_800_000L));
        assertEquals(AfkTracker.Decision.WARN, tracker.check("player", 1_900_000L));
    }

    @Test
    void forgetRemovesState() {
        AfkTracker tracker = new AfkTracker(900, 1200);
        tracker.recordActivity("player", 0L);
        tracker.forget("PLAYER");

        assertEquals(AfkTracker.Decision.NONE, tracker.check("player", 1_200_000L));
    }
}
