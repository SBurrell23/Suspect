export function autoImpostorCount(playerCount) {
  if (playerCount >= 10) return 3;
  if (playerCount >= 7) return 2;
  return 1;
}

export function impostorCountFor(playerCount, setting) {
  const auto = autoImpostorCount(playerCount);
  if (!setting || setting <= 0) return auto;
  return Math.max(1, Math.min(setting, Math.max(1, Math.floor((playerCount - 1) / 2))));
}

export function assignRoles(slots, impostorCount) {
  const pool = slots.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const impostors = new Set(pool.slice(0, Math.min(impostorCount, pool.length)));
  const roles = new Map();
  for (const s of slots) roles.set(s, impostors.has(s) ? 'impostor' : 'crew');
  return { roles, impostors };
}
