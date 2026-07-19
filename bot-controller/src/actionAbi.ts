export const SWORD_PVP_ACTION_V1 = "SwordPvPActionV1" as const;
export const VIRTUAL_HID_FRAME_V1 = "VirtualHIDFrameV1" as const;

const MOUSE_COUNT_LIMIT = 32767;
export const RESTRICTED_ACTION_FORBIDDEN_FIELDS = [
  "target_id",
  "target_username",
  "entity_id",
  "attack_entity",
  "look_at",
  "lookAt",
  "look_primitive",
  "yaw",
  "pitch",
  "absolute_yaw",
  "absolute_pitch",
] as const;

const FORBIDDEN_SWORD_ACTION_FIELDS: ReadonlySet<string> = new Set(RESTRICTED_ACTION_FORBIDDEN_FIELDS);

export type ActionExecutionStatus = "executed" | "clipped" | "delayed" | "dropped" | "modified";

export type SwordPvpActionV1 = {
  abi_version: typeof SWORD_PVP_ACTION_V1;
  sequence_id?: number;
  observation_tick?: number;
  observation_time_ms?: number;
  policy_time_ms?: number;
  control_step_ticks?: number;
  move_forward?: -1 | 0 | 1;
  move_strafe?: -1 | 0 | 1;
  jump_hold?: boolean;
  sprint_hold?: boolean;
  sneak_hold?: boolean;
  attack_pulse?: boolean;
  use_pulse?: boolean;
  mouse_dx?: number;
  mouse_dy?: number;
  recenter_request?: boolean;
  recenter_target_x?: number;
  recenter_target_y?: number;
};

export type KeyboardStateV1 = {
  forward?: boolean;
  back?: boolean;
  left?: boolean;
  right?: boolean;
  jump?: boolean;
  sprint?: boolean;
  sneak?: boolean;
};

export type MouseButtonStateV1 = {
  attack?: boolean;
  use?: boolean;
};

export type RecenterStateV1 = {
  requested?: boolean;
  busy?: boolean;
  phase?: string;
  target_x?: number;
  target_y?: number;
};

export type VirtualHidFrameV1 = {
  abi_version: typeof VIRTUAL_HID_FRAME_V1;
  sequence_id?: number;
  source_sequence_id?: number;
  execute_tick?: number;
  execute_time_ms?: number;
  control_step_ticks?: number;
  keys?: KeyboardStateV1;
  mouse_buttons?: MouseButtonStateV1;
  mouse_dx?: number;
  mouse_dy?: number;
  wheel_dy?: number;
  recenter?: RecenterStateV1;
  status?: ActionExecutionStatus;
  status_reasons?: string[];
};

export type NormalizedSwordPvpActionV1 = Required<SwordPvpActionV1>;
export type NormalizedKeyboardStateV1 = Required<KeyboardStateV1>;
export type NormalizedMouseButtonStateV1 = Required<MouseButtonStateV1>;
export type NormalizedRecenterStateV1 = Required<RecenterStateV1>;
export type NormalizedVirtualHidFrameV1 = Required<Omit<VirtualHidFrameV1, "keys" | "mouse_buttons" | "recenter" | "status_reasons">> & {
  keys: NormalizedKeyboardStateV1;
  mouse_buttons: NormalizedMouseButtonStateV1;
  recenter: NormalizedRecenterStateV1;
  status_reasons: string[];
};

export function encodeSwordPvpActionV1(action: SwordPvpActionV1): NormalizedSwordPvpActionV1 {
  return decodeSwordPvpActionV1(action);
}

export function swordActionToVirtualHidFrameV1(
  action: NormalizedSwordPvpActionV1,
  executeTick = action.observation_tick,
  executeTimeMs = action.policy_time_ms,
): NormalizedVirtualHidFrameV1 {
  return {
    abi_version: VIRTUAL_HID_FRAME_V1,
    sequence_id: action.sequence_id,
    source_sequence_id: action.sequence_id,
    execute_tick: executeTick,
    execute_time_ms: executeTimeMs,
    control_step_ticks: action.control_step_ticks,
    keys: {
      forward: action.move_forward === 1,
      back: action.move_forward === -1,
      left: action.move_strafe === -1,
      right: action.move_strafe === 1,
      jump: action.jump_hold,
      sprint: action.sprint_hold,
      sneak: action.sneak_hold,
    },
    mouse_buttons: {
      attack: action.attack_pulse,
      use: action.use_pulse,
    },
    mouse_dx: action.mouse_dx,
    mouse_dy: action.mouse_dy,
    wheel_dy: 0,
    recenter: {
      requested: action.recenter_request,
      busy: false,
      phase: "idle",
      target_x: action.recenter_target_x,
      target_y: action.recenter_target_y,
    },
    status: "executed",
    status_reasons: [],
  };
}

export function decodeSwordPvpActionV1(payload: unknown): NormalizedSwordPvpActionV1 {
  const object = requireObject(payload, "SwordPvPActionV1");
  requireAbi(object, SWORD_PVP_ACTION_V1);
  const forbidden = Object.keys(object).filter(key => FORBIDDEN_SWORD_ACTION_FIELDS.has(key));
  if (forbidden.length > 0) {
    throw new Error(`forbidden SwordPvPActionV1 fields: ${forbidden.sort().join(",")}`);
  }
  return {
    abi_version: SWORD_PVP_ACTION_V1,
    sequence_id: nonNegativeInteger(object, "sequence_id", 0),
    observation_tick: nonNegativeInteger(object, "observation_tick", 0),
    observation_time_ms: nonNegativeInteger(object, "observation_time_ms", 0),
    policy_time_ms: nonNegativeInteger(object, "policy_time_ms", 0),
    control_step_ticks: positiveInteger(object, "control_step_ticks", 1),
    move_forward: direction(object, "move_forward", 0),
    move_strafe: direction(object, "move_strafe", 0),
    jump_hold: boolValue(object, "jump_hold", false),
    sprint_hold: boolValue(object, "sprint_hold", false),
    sneak_hold: boolValue(object, "sneak_hold", false),
    attack_pulse: boolValue(object, "attack_pulse", false),
    use_pulse: boolValue(object, "use_pulse", false),
    mouse_dx: mouseCount(object, "mouse_dx", 0),
    mouse_dy: mouseCount(object, "mouse_dy", 0),
    recenter_request: boolValue(object, "recenter_request", false),
    recenter_target_x: normalizedNumber(object, "recenter_target_x", 0),
    recenter_target_y: normalizedNumber(object, "recenter_target_y", 0),
  };
}

export function encodeVirtualHidFrameV1(frame: VirtualHidFrameV1): NormalizedVirtualHidFrameV1 {
  return decodeVirtualHidFrameV1(frame);
}

export function decodeVirtualHidFrameV1(payload: unknown): NormalizedVirtualHidFrameV1 {
  const object = requireObject(payload, "VirtualHIDFrameV1");
  requireAbi(object, VIRTUAL_HID_FRAME_V1);
  return {
    abi_version: VIRTUAL_HID_FRAME_V1,
    sequence_id: nonNegativeInteger(object, "sequence_id", 0),
    source_sequence_id: nonNegativeInteger(object, "source_sequence_id", 0),
    execute_tick: nonNegativeInteger(object, "execute_tick", 0),
    execute_time_ms: nonNegativeInteger(object, "execute_time_ms", 0),
    control_step_ticks: positiveInteger(object, "control_step_ticks", 1),
    keys: keyboardState(objectValue(object, "keys")),
    mouse_buttons: mouseButtonState(objectValue(object, "mouse_buttons")),
    mouse_dx: mouseCount(object, "mouse_dx", 0),
    mouse_dy: mouseCount(object, "mouse_dy", 0),
    wheel_dy: integerValue(object, "wheel_dy", 0),
    recenter: recenterState(objectValue(object, "recenter")),
    status: executionStatus(object, "status", "executed"),
    status_reasons: stringList(object, "status_reasons"),
  };
}

function keyboardState(payload: Record<string, unknown> | undefined): NormalizedKeyboardStateV1 {
  const object = payload ?? {};
  return {
    forward: boolValue(object, "forward", false),
    back: boolValue(object, "back", false),
    left: boolValue(object, "left", false),
    right: boolValue(object, "right", false),
    jump: boolValue(object, "jump", false),
    sprint: boolValue(object, "sprint", false),
    sneak: boolValue(object, "sneak", false),
  };
}

function mouseButtonState(payload: Record<string, unknown> | undefined): NormalizedMouseButtonStateV1 {
  const object = payload ?? {};
  return {
    attack: boolValue(object, "attack", false),
    use: boolValue(object, "use", false),
  };
}

function recenterState(payload: Record<string, unknown> | undefined): NormalizedRecenterStateV1 {
  const object = payload ?? {};
  return {
    requested: boolValue(object, "requested", false),
    busy: boolValue(object, "busy", false),
    phase: stringValue(object, "phase", "idle"),
    target_x: normalizedNumber(object, "target_x", 0),
    target_y: normalizedNumber(object, "target_y", 0),
  };
}

function requireObject(payload: unknown, label: string): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`${label} payload must be an object`);
  }
  return payload as Record<string, unknown>;
}

function requireAbi(payload: Record<string, unknown>, expected: string): void {
  if (payload.abi_version !== expected) {
    throw new Error(`abi_version must be ${expected}`);
  }
}

function objectValue(payload: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = payload[key];
  if (value === undefined) {
    return undefined;
  }
  return requireObject(value, key);
}

function integerValue(payload: Record<string, unknown>, key: string, fallback: number): number {
  const value = payload[key] ?? fallback;
  if (!Number.isInteger(value)) {
    throw new Error(`${key} must be an integer`);
  }
  return value as number;
}

function nonNegativeInteger(payload: Record<string, unknown>, key: string, fallback: number): number {
  const value = integerValue(payload, key, fallback);
  if (value < 0) {
    throw new Error(`${key} must be non-negative`);
  }
  return value;
}

function positiveInteger(payload: Record<string, unknown>, key: string, fallback: number): number {
  const value = integerValue(payload, key, fallback);
  if (value < 1) {
    throw new Error(`${key} must be positive`);
  }
  return value;
}

function direction(payload: Record<string, unknown>, key: string, fallback: -1 | 0 | 1): -1 | 0 | 1 {
  const value = integerValue(payload, key, fallback);
  if (value !== -1 && value !== 0 && value !== 1) {
    throw new Error(`${key} must be -1, 0, or 1`);
  }
  return value;
}

function boolValue(payload: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = payload[key] ?? fallback;
  if (typeof value !== "boolean") {
    throw new Error(`${key} must be a boolean`);
  }
  return value;
}

function mouseCount(payload: Record<string, unknown>, key: string, fallback: number): number {
  const value = integerValue(payload, key, fallback);
  if (Math.abs(value) > MOUSE_COUNT_LIMIT) {
    throw new Error(`${key} exceeds mouse count serialization limit`);
  }
  return value;
}

function normalizedNumber(payload: Record<string, unknown>, key: string, fallback: number): number {
  const value = payload[key] ?? fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${key} must be a finite number`);
  }
  if (value < -1 || value > 1) {
    throw new Error(`${key} must be in [-1.0, 1.0]`);
  }
  return value;
}

function stringValue(payload: Record<string, unknown>, key: string, fallback: string): string {
  const value = payload[key] ?? fallback;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value;
}

function executionStatus(payload: Record<string, unknown>, key: string, fallback: ActionExecutionStatus): ActionExecutionStatus {
  const value = stringValue(payload, key, fallback);
  if (value !== "executed" && value !== "clipped" && value !== "delayed" && value !== "dropped" && value !== "modified") {
    throw new Error(`${key} must be a known execution status`);
  }
  return value;
}

function stringList(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key] ?? [];
  if (!Array.isArray(value)) {
    throw new Error(`${key} must be a list`);
  }
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0) {
      throw new Error(`${key} must contain non-empty strings`);
    }
  }
  return [...value];
}
