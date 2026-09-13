export const SKIP = -1;

// votes: Map<voterSlot, targetSlot | SKIP>
export function tally(votes) {
  const counts = new Map();
  for (const target of votes.values()) counts.set(target, (counts.get(target) || 0) + 1);
  let best = null, bestCount = 0, tie = false;
  for (const [target, c] of counts) {
    if (c > bestCount) { best = target; bestCount = c; tie = false; }
    else if (c === bestCount) tie = true;
  }
  const countsObj = {};
  for (const [k, v] of counts) countsObj[k] = v;
  if (bestCount === 0) return { ejected: null, tie: false, skipped: true, counts: countsObj };
  if (tie) return { ejected: null, tie: true, skipped: false, counts: countsObj };
  if (best === SKIP) return { ejected: null, tie: false, skipped: true, counts: countsObj };
  return { ejected: best, tie: false, skipped: false, counts: countsObj };
}
