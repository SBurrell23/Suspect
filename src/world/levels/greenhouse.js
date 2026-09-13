// LEVEL 3 — THE GREENHOUSE (occlusion). A biodome garden. Hedges block sightlines at eye height;
// you can hear someone three meters away and not see them. The hedge maze is generated from a
// fixed seed at module load (data, not engine code).
const H = Math.PI / 2;

// ---- procedural hedge maze (6x6 cells, 4m each, x:[18,42] z:[-12,12]) ------------------
function seeded(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function buildMaze() {
  const N = 6, CELL = 4, X0 = 18, Z0 = -12;
  const rand = seeded(20260912);
  // walls: vertical edges v[c][r] between (c,r)-(c+1,r) for c in 0..N-2; horizontal h[c][r] between (c,r)-(c,r+1)
  const v = Array.from({ length: N - 1 }, () => Array(N).fill(true));
  const h = Array.from({ length: N }, () => Array(N - 1).fill(true));
  const seen = Array.from({ length: N }, () => Array(N).fill(false));
  const stack = [[0, 3]];
  seen[0][3] = true;
  while (stack.length) {
    const [c, r] = stack[stack.length - 1];
    const nbrs = [];
    if (c > 0 && !seen[c - 1][r]) nbrs.push([c - 1, r, 'v', c - 1, r]);
    if (c < N - 1 && !seen[c + 1][r]) nbrs.push([c + 1, r, 'v', c, r]);
    if (r > 0 && !seen[c][r - 1]) nbrs.push([c, r - 1, 'h', c, r - 1]);
    if (r < N - 1 && !seen[c][r + 1]) nbrs.push([c, r + 1, 'h', c, r]);
    if (!nbrs.length) { stack.pop(); continue; }
    const [nc, nr, kind, wc, wr] = nbrs[Math.floor(rand() * nbrs.length)];
    if (kind === 'v') v[wc][wr] = false; else h[wc][wr] = false;
    seen[nc][nr] = true;
    stack.push([nc, nr]);
  }
  // a few extra loops so it is not a pure tree
  for (let i = 0; i < 5; i++) {
    if (rand() < 0.5) v[Math.floor(rand() * (N - 1))][Math.floor(rand() * N)] = false;
    else h[Math.floor(rand() * N)][Math.floor(rand() * (N - 1))] = false;
  }
  // clear the entrance (col 0, rows 2/3), stairs footprints and the observation-walk landings
  h[0][2] = false; h[0][3] = false; h[0][4] = false; // entrance + west stairs (z 0..8)
  h[5][1] = false; h[5][0] = false; h[5][2] = false; // east stairs (z -8..0)
  const props = [];
  for (let c = 0; c < N - 1; c++) for (let r = 0; r < N; r++) if (v[c][r]) {
    const x = X0 + (c + 1) * CELL, z = Z0 + r * CELL + CELL / 2;
    props.push({ type: 'hedge', pos: [x, 0, z - 1], rot: 0, scale: 0.95 }, { type: 'hedge', pos: [x, 0, z + 1], rot: 0, scale: 0.95 });
  }
  for (let c = 0; c < N; c++) for (let r = 0; r < N - 1; r++) if (h[c][r]) {
    const x = X0 + c * CELL + CELL / 2, z = Z0 + (r + 1) * CELL;
    props.push({ type: 'hedge', pos: [x - 1, 0, z], rot: H, scale: 0.95 }, { type: 'hedge', pos: [x + 1, 0, z], rot: H, scale: 0.95 });
  }
  return props;
}

const mazeHedges = buildMaze();

export default {
  id: 'greenhouse',
  name: 'The Greenhouse',
  palette: { primary: 0x6a7a5a, accent: 0x7fd36a, floor: 0x5a4a35, wall: 0x7c8b74, ceiling: 0xb9c7b1, emissive: 0x9cff7a, surface: 'soil', floorTex: 'soil', wallTex: 'wall' },
  fogColor: 0x4a5a52,
  background: 0x9fd4ef,
  spawn: [0, 0, 6],
  spawnRadius: 3,
  meetingTable: [0, 0, 0],
  rooms: [
    { id: 'atrium', name: 'Central Atrium', pos: [0, 0, 0], size: [30, 12, 30], open: true, reverb: 'outdoor', floorTex: 'soil' },
    { id: 'maze', name: 'Hedge Maze', pos: [30, 0, 0], size: [26, 5, 26], open: true, reverb: 'outdoor', floorTex: 'soil', floorColor: 0x4f6a3a },
    { id: 'vault', name: 'Seed Vault', pos: [0, 0, -23], size: [16, 4, 12], reverb: 'small-room', wallColor: 0xcfd8e0, floorColor: 0xbfc9d2, floorTex: 'tiles', surface: 'metal' },
    { id: 'irrigation', name: 'Irrigation Control', pos: [-25, 0, -6], size: [14, 4, 12], reverb: 'small-room', wallColor: 0x8a9aa0, floorColor: 0x6d7a80, floorTex: 'metal', surface: 'metal' },
    { id: 'cavern', name: 'Mushroom Cavern', pos: [-25, 0, 14], size: [16, 5, 14], reverb: 'large-metal', wallColor: 0x2b2f3a, floorColor: 0x2a2530, ceilColor: 0x1c1a24, floorTex: 'soil', visionScale: 0.5 },
    { id: 'shed', name: 'Potting Shed', pos: [0, 0, 22], size: [14, 4, 10], reverb: 'small-room', wallColor: 0x8b6a45, floorColor: 0x6f5636, wallTex: 'bark', floorTex: 'concrete' },
  ],
  corridors: [
    { from: 'atrium', to: 'maze', width: 3, height: 3.4 },
    { from: 'atrium', to: 'vault', width: 3, height: 3.2 },
    { from: 'atrium', to: 'irrigation', width: 3, height: 3.2 },
    { from: 'irrigation', to: 'cavern', width: 3, height: 3.2 },
    { from: 'atrium', to: 'cavern', width: 3, height: 3.2 },
    { from: 'atrium', to: 'shed', width: 3, height: 3.2 },
  ],
  // Observation Walk: an elevated path above the hedges
  platforms: [
    { pos: [20.25, 3.5, 0], size: [2.5, 0.3, 2.5], grating: true, rails: ['n', 'w'] },
    { pos: [30, 3.5, 0], size: [17, 0.3, 2.5], grating: true, rails: ['n', 's'] },
    { pos: [39.75, 3.5, 0], size: [2.5, 0.3, 2.5], grating: true, rails: ['s', 'e'] },
  ],
  stairs: [
    { from: [20.25, 0, 7.5], to: [20.25, 3.5, 1.25], width: 2.2 },
    { from: [39.75, 0, -7.5], to: [39.75, 3.5, -1.25], width: 2.2 },
  ],
  walls: [],
  props: [
    ...mazeHedges,
    { type: 'tree', pos: [0, 0, -4] },
    { type: 'fern', pos: [-6, 0, -9] }, { type: 'fern', pos: [7, 0, -10] }, { type: 'fern', pos: [-9, 0, 4] }, { type: 'fern', pos: [10, 0, 6] },
    { type: 'fern', pos: [-3, 0, 12] }, { type: 'fern', pos: [5, 0, 12] }, { type: 'fern', pos: [12, 0, -3] }, { type: 'fern', pos: [-12, 0, -2] },
    { type: 'plant', pos: [-13, 0, -13] }, { type: 'plant', pos: [13, 0, -13] }, { type: 'plant', pos: [13, 0, 13] }, { type: 'plant', pos: [-13, 0, 13] },
    { type: 'bench', pos: [-5, 0, 4], rot: 0.5 }, { type: 'bench', pos: [5, 0, 4], rot: -0.5 },
    { type: 'rock', pos: [-8, 0, -6], rot: 0.4 }, { type: 'rock', pos: [9, 0, -1], rot: 1.2, scale: 0.7 },
    { type: 'hedge', pos: [-11, 0, -8], rot: 0.3 }, { type: 'hedge', pos: [11, 0, 9], rot: -0.4 },
    // seed vault
    { type: 'server', pos: [-6, 0, -18], rot: 0 }, { type: 'server', pos: [-4.8, 0, -18], rot: 0 }, { type: 'server', pos: [4.8, 0, -18], rot: 0 }, { type: 'server', pos: [6, 0, -18], rot: 0 },
    { type: 'cryoPod', pos: [0, 0, -24], rot: H }, { type: 'locker', pos: [-7.4, 0, -25], rot: H },
    // irrigation
    { type: 'hydroTray', pos: [-25, 0, -3], rot: 0 }, { type: 'hydroTray', pos: [-25, 0, -8.5], rot: 0 },
    { type: 'tank', pos: [-30, 0, -9], scale: 0.8 }, { type: 'pipeCluster', pos: [-20, 0, -11.4], rot: 0 }, { type: 'barrel', pos: [-30.5, 0, -2] },
    // cavern
    { type: 'mushroom', pos: [-30, 0, 10], scale: 1.4 }, { type: 'mushroom', pos: [-28, 0, 18], scale: 1.1 }, { type: 'mushroom', pos: [-22, 0, 17], scale: 1.6 },
    { type: 'mushroom', pos: [-20, 0, 10], scale: 0.9 }, { type: 'mushroom', pos: [-31, 0, 15], scale: 1.2 }, { type: 'mushroom', pos: [-25, 0, 12], scale: 0.8 },
    { type: 'rock', pos: [-29, 0, 19], rot: 0.8, scale: 1.3 }, { type: 'rock', pos: [-19.5, 0, 19], rot: 2.1 }, { type: 'rock', pos: [-31, 0, 9], rot: 1.5, scale: 0.8 },
    { type: 'fern', pos: [-24, 0, 19] }, { type: 'fern', pos: [-29, 0, 12] },
    // shed
    { type: 'crateStack', pos: [5, 0, 25], rot: 0.2 }, { type: 'crate', pos: [-4, 0, 25.5] }, { type: 'barrel', pos: [-2.5, 0, 25.8] },
    { type: 'plant', pos: [-5.5, 0, 18] }, { type: 'plant', pos: [-3.5, 0, 18] }, { type: 'bench', pos: [2, 0, 19.5] },
    // maze extras
    { type: 'plant', pos: [41.5, 0, -11.5] }, { type: 'plant', pos: [18.5, 0, 11.5] }, { type: 'lamp', pos: [30, 0, 11.5] }, { type: 'lamp', pos: [30, 0, -11.5] },
  ],
  vents: [
    { id: 'v1', pos: [-12, 0, 12], connects: ['v2', 'v5'] },
    { id: 'v2', pos: [6, 0, -27], connects: ['v1', 'v3'] },
    { id: 'v3', pos: [-30, 0, -10.5], connects: ['v2', 'v4'] },
    { id: 'v4', pos: [-30, 0, 19.5], connects: ['v3', 'v5'] },
    { id: 'v5', pos: [-5, 0, 25], connects: ['v4', 'v6'] },
    { id: 'v6', pos: [12, 0, -12], connects: ['v5', 'v1'] },
  ],
  taskStations: [
    { id: 'ts_atr_scan', pos: [14.4, 0, -8], rot: -H, minigame: 'identScan', label: 'Bio Scan', visual: true },
    { id: 'ts_atr_wire', pos: [-14.4, 0, 8], rot: H, minigame: 'wireSplice', label: 'Irrigation' },
    { id: 'ts_vault_cat', pos: [-3, 0, -28.4], rot: 0, minigame: 'seedCatalogue', label: 'Catalogue' },
    { id: 'ts_vault_climate', pos: [4, 0, -28.4], rot: 0, minigame: 'reactorCalibrate', label: 'Climate' },
    { id: 'ts_irr_upload', pos: [-31.4, 0, -4], rot: H, minigame: 'dataUpload', label: 'Upload', downloadAt: 'ts_shed_download' },
    { id: 'ts_shed_download', pos: [6.4, 0, 24], rot: -H, minigame: 'dataUpload', label: 'Download', downloadOnly: true },
    { id: 'ts_irr_pump', pos: [-25, 0, -11.4], rot: 0, minigame: 'valveSequence', label: 'Pump' },
    { id: 'ts_irr_ph', pos: [-18.6, 0, -3], rot: -H, minigame: 'spectrometer', label: 'pH Meter' },
    { id: 'ts_cav_spore', pos: [-32.4, 0, 14], rot: H, minigame: 'airlockPressurize', label: 'Spore Vent' },
    { id: 'ts_cav_pest', pos: [-25, 0, 20.4], rot: Math.PI, minigame: 'debrisClear', label: 'Pest Control' },
    { id: 'ts_shed_sort', pos: [-5, 0, 26.4], rot: Math.PI, minigame: 'cargoSort', label: 'Sort Seeds' },
    { id: 'ts_shed_wire', pos: [6.4, 0, 20], rot: -H, minigame: 'voicePrint', label: 'Voice ID' },
    { id: 'ts_maze_sprinkler', pos: [42.4, 0, 10], rot: -H, minigame: 'valveSequence', label: 'Sprinkler' },
    { id: 'ts_walk_gauge', pos: [30, 3.5, -0.9], rot: 0, minigame: 'spectrometer', label: 'Humidity' },
  ],
  sabotageStations: [
    { id: 'fix_lights', type: 'lights', pos: [-6.4, 0, 20], rot: H, label: 'Electrical' },
    { id: 'fix_comms', type: 'comms', pos: [-31.4, 0, -9], rot: H, label: 'Comms' },
    { id: 'fix_react_a', type: 'reactor', index: 0, pos: [-17.6, 0, 15], rot: -H, label: 'Climate Core' },
    { id: 'fix_react_b', type: 'reactor', index: 1, pos: [-30, 0, 7.6], rot: 0, label: 'Climate Core' },
    { id: 'fix_o2_a', type: 'o2', index: 0, pos: [-7.4, 0, -21], rot: H, label: 'O2 Filter' },
    { id: 'fix_o2_b', type: 'o2', index: 1, pos: [14.4, 0, 10], rot: -H, label: 'O2 Filter' },
  ],
  doors: [
    { id: 'd_vault', room: 'vault', pos: [0, 0, -16], rot: 0, width: 3, height: 3.2 },
    { id: 'd_shed', room: 'shed', pos: [0, 0, 16], rot: 0, width: 3, height: 3.2 },
    { id: 'd_irrigation', room: 'irrigation', pos: [-16.5, 0, -6], rot: H, width: 3, height: 3.2 },
    { id: 'd_maze', room: 'maze', pos: [16, 0, 0], rot: H, width: 3, height: 3.4 },
    { id: 'd_cavern', room: 'cavern', pos: [-16, 0, 11], rot: H, width: 3, height: 3.2 },
  ],
  lights: [
    { type: 'hemi', color: 0xbfe3ff, ground: 0x1e3a1e, intensity: 0.7 },
    { type: 'ambient', color: 0x2f4f2f, intensity: 0.25 },
    // dappled daylight through the dome: a cookie-mapped spotlight from above
    { type: 'spot', pos: [4, 34, 6], target: [0, 0, 0], color: 0xfff6d8, intensity: 1100, range: 60, angle: 0.72, penumbra: 0.4, decay: 1.2, castShadow: true, cookie: true },
    { type: 'point', pos: [0, 3.7, -23], color: 0xdfefff, intensity: 40, range: 18 },
    { type: 'point', pos: [-25, 3.7, -6], color: 0xfff0cc, intensity: 40, range: 18 },
    { type: 'point', pos: [-28, 2.6, 11], color: 0x3388ff, intensity: 22, range: 12 },
    { type: 'point', pos: [-21, 2.2, 17], color: 0x33ff88, intensity: 18, range: 11 },
    { type: 'point', pos: [0, 3.7, 22], color: 0xffe0aa, intensity: 35, range: 16 },
    { type: 'point', pos: [24, 4.5, 7], color: 0xcfe8ff, intensity: 30, range: 18 },
    { type: 'point', pos: [36, 4.5, -7], color: 0xcfe8ff, intensity: 30, range: 18 },
  ],
  special: [{ type: 'dome', pos: [0, 0, 0], radius: 25, ribRadius: 15.2, ribY: 12 }],
  ambience: { reverb: 'outdoor', bedTrack: 'organic' },
};
