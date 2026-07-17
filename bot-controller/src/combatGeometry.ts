export type Vec3Like = {
  x: number;
  y: number;
  z: number;
};

export type AabbLike = {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
};

export type AttackRay = {
  eye: Vec3Like;
  direction: Vec3Like;
  targetBox: AabbLike;
  reach: number;
  blockingDistance?: number;
};

const EPSILON = 1e-9;

export function lookDirection(yaw: number, pitch: number): Vec3Like {
  const cosPitch = Math.cos(pitch);
  return normalize({
    x: -Math.sin(yaw) * cosPitch,
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * cosPitch
  });
}

export function directionTo(origin: Vec3Like, target: Vec3Like): Vec3Like {
  return normalize({
    x: target.x - origin.x,
    y: target.y - origin.y,
    z: target.z - origin.z
  });
}

export function canAttackTarget(ray: AttackRay): boolean {
  const targetDistance = rayIntersectsAabb(ray.eye, ray.direction, ray.targetBox, ray.reach);
  if (targetDistance === undefined) {
    return false;
  }
  return ray.blockingDistance === undefined || ray.blockingDistance > targetDistance + 0.01;
}

export function rayIntersectsAabb(origin: Vec3Like, direction: Vec3Like, box: AabbLike, maxDistance: number): number | undefined {
  const dir = normalize(direction);
  let tMin = 0;
  let tMax = maxDistance;

  for (const axis of ["x", "y", "z"] as const) {
    const key = axis.toUpperCase() as "X" | "Y" | "Z";
    const min = box[`min${key}`];
    const max = box[`max${key}`];
    const originValue = origin[axis];
    const directionValue = dir[axis];
    if (Math.abs(directionValue) < EPSILON) {
      if (originValue < min || originValue > max) {
        return undefined;
      }
      continue;
    }
    const inv = 1 / directionValue;
    let near = (min - originValue) * inv;
    let far = (max - originValue) * inv;
    if (near > far) {
      [near, far] = [far, near];
    }
    tMin = Math.max(tMin, near);
    tMax = Math.min(tMax, far);
    if (tMin - tMax > EPSILON) {
      return undefined;
    }
  }
  if (tMax < 0 || tMin > maxDistance) {
    return undefined;
  }
  return Math.max(0, tMin);
}

export function normalize(value: Vec3Like): Vec3Like {
  const length = Math.hypot(value.x, value.y, value.z);
  if (length < EPSILON) {
    return { x: 0, y: 0, z: 0 };
  }
  return { x: value.x / length, y: value.y / length, z: value.z / length };
}
