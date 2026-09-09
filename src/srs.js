// Lightweight SM-2 spaced repetition, used for the Library "due" counts and
// long-term scheduling. The in-session practice loop (requeue-until-correct) is
// separate and lives in app.js.

export function freshSrs() {
  return { ease: 2.5, interval: 0, reps: 0, lapses: 0, due: Date.now(), last: 0 };
}

// grade: 0 = again, 3 = hard, 4 = good, 5 = easy
export function schedule(srs, grade) {
  const s = { ...srs };
  s.last = Date.now();
  if (grade < 3) {
    s.reps = 0;
    s.lapses += 1;
    s.interval = 0;
    s.due = Date.now() + 60 * 1000; // ~1 min: comes back this session
    s.ease = Math.max(1.3, s.ease - 0.2);
    return s;
  }
  s.reps += 1;
  if (s.reps === 1) s.interval = 1;
  else if (s.reps === 2) s.interval = 3;
  else s.interval = Math.round(s.interval * s.ease);
  const easeDelta = grade === 3 ? -0.15 : grade === 5 ? 0.15 : 0;
  s.ease = Math.max(1.3, s.ease + easeDelta);
  if (grade === 3) s.interval = Math.max(1, Math.round(s.interval * 0.7));
  s.due = Date.now() + s.interval * 86400000;
  return s;
}

export function deckStats(deck) {
  const now = Date.now();
  let due = 0;
  let mastered = 0;
  for (const c of deck.cards) {
    const srs = c.srs || freshSrs();
    if ((srs.due || 0) <= now) due += 1;
    if ((srs.interval || 0) >= 7) mastered += 1;
  }
  return { total: deck.cards.length, due, mastered };
}
