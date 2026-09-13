// All tuning constants and "magic numbers" live here.

// ---- Networking -----------------------------------------------------------
// Set to an object like { host: 'peer.example.com', port: 443, path: '/', secure: true }
// to use a self-hosted peerjs-server. null = public PeerJS cloud broker (rate limited).
export const PEER_SERVER = null;

// OPERATOR: drop your own TURN credentials in here (free tiers: Metered, Twilio, Cloudflare).
// Without TURN, roughly 10-15% of friend groups will have someone who can never connect.
export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  // { urls: 'turn:YOUR_TURN_HOST:3478', username: 'USER', credential: 'PASS' },
];

export const NET = {
  SNAPSHOT_HZ: 15,
  INPUT_HZ: 20,
  SIM_DT: 1 / 20,
  INTERP_DELAY_MS: 100,
  MAX_PLAYERS: 10,
  MIN_PLAYERS: 3,
  ROOM_CODE_LEN: 6,
  ROOM_CODE_RETRIES: 5,
  RECONCILE_THRESHOLD: 0.3,
  RECONCILE_MS: 150,
  INPUT_REDUNDANCY: 3,
  HOST_CLAIM_WAIT_MS: 500,
  PEER_TIMEOUT_MS: 9000,
  PING_INTERVAL_MS: 2000,
};

// ---- Player / movement ----------------------------------------------------
export const PLAYER = {
  RADIUS: 0.4,
  HEIGHT: 1.8,
  EYE_HEIGHT: 1.6,
  WALK_SPEED: 4.2,
  SPRINT_SPEED: 4.7, // sprint adds 0.5 m/s over walking
  GHOST_SPEED: 6.0,
  ZERO_G_THRUST: 7.0,
  ZERO_G_DRAG: 0.9, // per sim step
  GRAVITY: -20,
  STEP_HEIGHT: 0.45,
  SKIN: 0.01,
  COLLISION_ITER: 3,
  GRID_CELL: 4,
};

export const CAMERA = {
  FOV: 75,
  FOV_SPRINT: 78,
  FOV_KILL: 68,
  THIRD_PERSON_DIST: 3.0,
  THIRD_PERSON_SHOULDER: 0.6,
};

// ---- Rules ----------------------------------------------------------------
export const RULES = {
  KILL_RANGE: 2.0,
  REPORT_RANGE: 3.0,
  USE_RANGE: 2.4,
  VENT_RANGE: 1.8,
  MEETING_BUTTON_RANGE: 2.8,
  ROLE_ASSIGN_MS: 3000,
  RESULT_MS: 7000,
  GAME_OVER_MS: 10000,
  SABOTAGE_COOLDOWN: 30,
  SABOTAGE_FIRST_COOLDOWN: 15,
  CRITICAL_SABOTAGE_TIME: 45,
  DOOR_CLOSE_TIME: 10,
  DOOR_COOLDOWN: 30,
  LIGHTS_VISION: 4,
  FLARE_PERIOD_MS: 28000,
  NAMEPLATE_FADE: 8,
  VULNERABLE_RANGE: 5,
  VISION_HYSTERESIS: 1.0,
};

export const GAME_DEFAULTS = {
  level: 'foundry',
  impostorCount: 0, // 0 = auto (1 for 4-6, 2 for 7-9, 3 for 10)
  killCooldown: 30,
  crewVisionRadius: 12,
  impostorVisionRadius: 18,
  moveSpeed: 1.0,
  tasksPerPlayer: 4,
  emergencyMeetingsPerPlayer: 1,
  discussTime: 30,
  voteTime: 30,
  confirmEjects: true,
  visualTasksEnabled: true,
};

export const SETTINGS_SCHEMA = [
  { key: 'level', label: 'Map', type: 'select', options: ['foundry', 'orbitalRing', 'greenhouse'] },
  { key: 'impostorCount', label: 'Impostors (0 = auto)', type: 'range', min: 0, max: 3, step: 1 },
  { key: 'killCooldown', label: 'Kill cooldown (s)', type: 'range', min: 15, max: 60, step: 5 },
  { key: 'crewVisionRadius', label: 'Crew vision (m)', type: 'range', min: 5, max: 25, step: 1 },
  { key: 'impostorVisionRadius', label: 'Impostor vision (m)', type: 'range', min: 5, max: 30, step: 1 },
  { key: 'moveSpeed', label: 'Move speed', type: 'range', min: 0.75, max: 1.5, step: 0.25 },
  { key: 'tasksPerPlayer', label: 'Tasks per player', type: 'range', min: 2, max: 8, step: 1 },
  { key: 'emergencyMeetingsPerPlayer', label: 'Emergency meetings', type: 'range', min: 0, max: 3, step: 1 },
  { key: 'discussTime', label: 'Discussion (s)', type: 'range', min: 15, max: 120, step: 5 },
  { key: 'voteTime', label: 'Voting (s)', type: 'range', min: 15, max: 60, step: 5 },
  { key: 'confirmEjects', label: 'Confirm ejects', type: 'bool' },
  { key: 'visualTasksEnabled', label: 'Visual tasks', type: 'bool' },
];

export const LOCAL_DEFAULTS = {
  sensitivity: 1.0,
  headBob: true,
  antialias: true,
  pushToTalk: false,
  masterVolume: 0.8,
  musicVolume: 0.5,
  voiceVolume: 1.0,
  name: '',
  colorIdx: 0,
};

export const COLORS = [
  { name: 'Red', hex: 0xd6332b },
  { name: 'Blue', hex: 0x2a5fd6 },
  { name: 'Green', hex: 0x2e9e4a },
  { name: 'Pink', hex: 0xee6fc1 },
  { name: 'Orange', hex: 0xf08a1d },
  { name: 'Yellow', hex: 0xf3d531 },
  { name: 'Black', hex: 0x3a3f47 },
  { name: 'White', hex: 0xe6ecf2 },
  { name: 'Purple', hex: 0x7a3fcf },
  { name: 'Brown', hex: 0x7b4f2a },
  { name: 'Cyan', hex: 0x3fd3e0 },
  { name: 'Lime', hex: 0x8ce03a },
];

export const LS_KEY = 'suspect.local.v1';
