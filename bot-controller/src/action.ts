export const ACTION_NVECS = [2, 2, 2, 2, 2, 2, 2, 2, 2, 9, 7, 5, 4] as const;

export type DecodedAction = {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  sprint: boolean;
  sneak: boolean;
  attack: boolean;
  use: boolean;
  hotbarSlot: number;
  yawDeltaRadians: number;
  pitchDeltaRadians: number;
  lookPrimitive: "none" | "enemy_head" | "enemy_body" | "enemy_feet";
};

const YAW_DELTAS = [-30, -15, -5, 0, 5, 15, 30].map(deg => deg * Math.PI / 180);
const PITCH_DELTAS = [-15, -5, 0, 5, 15].map(deg => deg * Math.PI / 180);
const LOOK_PRIMITIVES = ["none", "enemy_head", "enemy_body", "enemy_feet"] as const;

export function validateAction(raw: unknown): number[] {
  if (!Array.isArray(raw)) {
    throw new Error("action must be an array");
  }
  if (raw.length !== ACTION_NVECS.length) {
    throw new Error(`action must have length ${ACTION_NVECS.length}`);
  }
  return raw.map((value, index) => {
    if (!Number.isInteger(value)) {
      throw new Error(`action[${index}] must be an integer`);
    }
    const n = ACTION_NVECS[index];
    if (value < 0 || value >= n) {
      throw new Error(`action[${index}] out of bounds`);
    }
    return value;
  });
}

export function decodeAction(raw: unknown): DecodedAction {
  const action = validateAction(raw);
  return {
    forward: action[0] === 1,
    back: action[1] === 1,
    left: action[2] === 1,
    right: action[3] === 1,
    jump: action[4] === 1,
    sprint: action[5] === 1,
    sneak: action[6] === 1,
    attack: action[7] === 1,
    use: action[8] === 1,
    hotbarSlot: action[9],
    yawDeltaRadians: YAW_DELTAS[action[10]],
    pitchDeltaRadians: PITCH_DELTAS[action[11]],
    lookPrimitive: LOOK_PRIMITIVES[action[12]]
  };
}

export function neutralAction(): number[] {
  return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 2, 0];
}

export function randomAction(rng: () => number = Math.random): number[] {
  return ACTION_NVECS.map(n => Math.floor(rng() * n));
}

