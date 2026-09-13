// Task assignment. A task is a station (or a two-station chain for Data Upload).
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export function buildTaskPool(level) {
  return level.stations.filter((s) => !s.downloadOnly).map((s) => ({
    stationId: s.id,
    minigame: s.minigame,
    label: s.label || s.id,
    steps: s.downloadAt ? [s.id, s.downloadAt] : [s.id],
    visual: !!s.visual,
    zone: level.zoneAt(s.pos[0], s.pos[1] + 0.5, s.pos[2])?.name || '',
  }));
}

export function assignTasksFor(slot, pool, n) {
  const picks = shuffle(pool.slice()).slice(0, Math.min(n, pool.length));
  return picks.map((p, i) => ({
    id: `${slot}-${i}`,
    stationId: p.stationId,
    minigame: p.minigame,
    label: p.label,
    steps: p.steps.slice(),
    step: 0,
    done: false,
    visual: p.visual,
    zone: p.zone,
  }));
}

// Which station the task currently wants
export function currentStation(task) { return task.steps[Math.min(task.step, task.steps.length - 1)]; }

export function serializeTasks(tasks) {
  return tasks.map((t) => ({ id: t.id, stationId: t.stationId, minigame: t.minigame, label: t.label, steps: t.steps, step: t.step, done: t.done, visual: t.visual, zone: t.zone }));
}
