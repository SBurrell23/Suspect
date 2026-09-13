import { RULES } from '../config.js';

export const SABOTAGES = {
  lights: { label: 'Lights', critical: false, description: 'Crew vision drops to 4m. Fix at Electrical.', fixStations: 1 },
  comms: { label: 'Comms', critical: false, description: 'Task lists hidden, voice scrambled. Fix at Comms.', fixStations: 1 },
  reactor: { label: 'Reactor', critical: true, description: 'Two players must hold both panels at once.', fixStations: 2 },
  o2: { label: 'O2', critical: true, description: 'Enter the codes at both filters.', fixStations: 2 },
  doors: { label: 'Doors', critical: false, description: 'Seal a room for 10 seconds.', fixStations: 0 },
};

export function makeSabotage(type, now, opts = {}) {
  const def = SABOTAGES[type];
  const s = { type, startedAt: now, endsAt: def.critical ? now + RULES.CRITICAL_SABOTAGE_TIME * 1000 : 0, holds: [false, false], fixed: [false, false], codes: null, room: opts.room || null };
  if (type === 'o2') s.codes = [randomCode(), randomCode()];
  return s;
}

export function randomCode() {
  let c = '';
  for (let i = 0; i < 5; i++) c += Math.floor(Math.random() * 10);
  return c;
}

// Public view of a sabotage for clients (codes are shown on the HUD; that's the game)
export function publicSabotage(s) {
  if (!s) return null;
  return { type: s.type, startedAt: s.startedAt, endsAt: s.endsAt, holds: s.holds.slice(), fixed: s.fixed.slice(), codes: s.codes, room: s.room };
}
