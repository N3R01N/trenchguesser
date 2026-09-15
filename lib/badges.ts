import type { Player } from './types.ts';

export interface Badge {
  emoji: string;
  title: string;
}

/**
 * The emoji strip beside a name on the leaderboard.
 *
 * Only awarded once a round has actually been scored — at 0-0-0 nobody is
 * leading and nobody is last.
 */
export function badgesFor(
  players: Player[],
  playerId: string,
  deltas?: Record<string, number>,
): Badge[] {
  const me = players.find((p) => p.id === playerId);
  if (!me || players.length < 2) return [];

  const scores = players.map((p) => p.score);
  const top = Math.max(...scores);
  const bottom = Math.min(...scores);
  const played = scores.some((s) => s !== 0);

  const badges: Badge[] = [];

  if (played && me.score === top) badges.push({ emoji: '👑', title: 'In the lead' });
  if (played && me.score === bottom && top !== bottom) {
    badges.push({ emoji: '💩', title: 'Dead last' });
  }

  const mostWins = Math.max(...players.map((p) => p.catWins));
  if (mostWins > 0 && me.catWins === mostWins) {
    badges.push({ emoji: '🎯', title: `${me.catWins} category wins` });
  }

  if (me.streak >= 2) {
    badges.push({ emoji: '🔥', title: `${me.streak} winning rounds in a row` });
  }

  if (deltas && biggestFaller(players, deltas) === playerId) {
    badges.push({ emoji: '📉', title: 'Fell furthest this round' });
  }

  if (!me.present) badges.push({ emoji: '👻', title: 'Disconnected' });

  return badges;
}

/**
 * Who lost the most places this round. Null when nobody actually dropped.
 *
 * Previous standings are reconstructed from the deltas; category wins are not
 * rewound, so the ordering of tied players before the round is approximate.
 */
export function biggestFaller(
  players: Player[],
  deltas: Record<string, number>,
): string | null {
  const before = ranked(
    players.map((p) => ({ ...p, score: p.score - (deltas[p.id] ?? 0) })),
  ).map((p) => p.id);
  const after = ranked(players).map((p) => p.id);

  let worst: string | null = null;
  let drop = 0;
  for (const id of after) {
    const moved = after.indexOf(id) - before.indexOf(id);
    if (moved > drop) {
      drop = moved;
      worst = id;
    }
  }
  return worst;
}

/** Standings order: score first, then category wins as the tiebreak. */
export function ranked(players: Player[]): Player[] {
  return [...players].sort(
    (a, b) => b.score - a.score || b.catWins - a.catWins || a.name.localeCompare(b.name),
  );
}
