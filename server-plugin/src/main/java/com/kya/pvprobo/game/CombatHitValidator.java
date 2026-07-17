package com.kya.pvprobo.game;

import org.bukkit.FluidCollisionMode;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.entity.Player;
import org.bukkit.util.BoundingBox;
import org.bukkit.util.RayTraceResult;
import org.bukkit.util.Vector;

public final class CombatHitValidator {
    private static final double ENTITY_REACH = 3.5;
    private static final double HITBOX_EXPANSION = 0.1;
    private static final double BLOCK_EPSILON = 0.01;

    private CombatHitValidator() {
    }

    public static boolean isValidHit(Player attacker, Player victim) {
        Location eye = attacker.getEyeLocation();
        Vector direction = eye.getDirection().normalize();
        double victimDistance = rayHitDistance(eye.toVector(), direction, victim.getBoundingBox().expand(HITBOX_EXPANSION), ENTITY_REACH);
        if (!Double.isFinite(victimDistance)) {
            return false;
        }
        RayTraceResult blockHit = attacker.getWorld().rayTraceBlocks(eye, direction, ENTITY_REACH, FluidCollisionMode.NEVER, true);
        if (blockHit == null || blockHit.getHitPosition() == null) {
            return true;
        }
        double blockDistance = blockHit.getHitPosition().distance(eye.toVector());
        return !isBlockHitBeforeVictim(blockDistance, victimDistance);
    }

    public static boolean hasLineOfSightTo(Player viewer, Player target) {
        Location eye = viewer.getEyeLocation();
        Vector toTarget = target.getBoundingBox().getCenter().subtract(eye.toVector());
        double distance = toTarget.length();
        if (distance <= 0.001) {
            return true;
        }
        Vector direction = toTarget.normalize();
        World world = viewer.getWorld();
        if (!world.equals(target.getWorld())) {
            return false;
        }
        RayTraceResult blockHit = world.rayTraceBlocks(eye, direction, distance, FluidCollisionMode.NEVER, true);
        return blockHit == null;
    }

    static boolean isDamageImmune(int noDamageTicks) {
        return isDamageImmune(noDamageTicks, 20);
    }

    static boolean isDamageImmune(int noDamageTicks, int maximumNoDamageTicks) {
        return false;
    }

    static boolean isBlockHitBeforeVictim(double blockDistance, double victimDistance) {
        return blockDistance <= victimDistance + BLOCK_EPSILON;
    }

    static boolean rayIntersectsBox(Vector origin, Vector direction, BoundingBox box, double maxDistance) {
        return Double.isFinite(rayHitDistance(origin, direction, box, maxDistance));
    }

    static double rayHitDistance(Vector origin, Vector direction, BoundingBox box, double maxDistance) {
        Vector dir = direction.clone().normalize();
        double tMin = 0.0;
        double tMax = maxDistance;
        double[][] axes = {
            {origin.getX(), dir.getX(), box.getMinX(), box.getMaxX()},
            {origin.getY(), dir.getY(), box.getMinY(), box.getMaxY()},
            {origin.getZ(), dir.getZ(), box.getMinZ(), box.getMaxZ()}
        };
        for (double[] axis : axes) {
            double originValue = axis[0];
            double directionValue = axis[1];
            double min = axis[2];
            double max = axis[3];
            if (Math.abs(directionValue) < 1.0e-9) {
                if (originValue < min || originValue > max) {
                    return Double.POSITIVE_INFINITY;
                }
                continue;
            }
            double near = (min - originValue) / directionValue;
            double far = (max - originValue) / directionValue;
            if (near > far) {
                double tmp = near;
                near = far;
                far = tmp;
            }
            tMin = Math.max(tMin, near);
            tMax = Math.min(tMax, far);
            if (tMin - tMax > 1.0e-9) {
                return Double.POSITIVE_INFINITY;
            }
        }
        if (tMax < 0.0 || tMin > maxDistance) {
            return Double.POSITIVE_INFINITY;
        }
        return Math.max(0.0, tMin);
    }
}
