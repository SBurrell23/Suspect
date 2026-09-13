import lobby from './lobby.js';
import foundry from './foundry.js';
import orbitalRing from './orbitalRing.js';
import greenhouse from './greenhouse.js';

export const LEVELS = { lobby, foundry, orbitalRing, greenhouse };
export const PLAYABLE_LEVELS = ['foundry', 'orbitalRing', 'greenhouse'];
export function getLevel(id) { return LEVELS[id] || LEVELS.foundry; }
