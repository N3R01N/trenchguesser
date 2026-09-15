import { store } from './redis.ts';
import { coinAtRank, ensureSnapshot, snapshotMeta } from './coins.ts';
import {
  countCategoryWins,
  effectiveCategories,
  scoreRound,
} from './score.ts';
import {
  DEFAULT_CONFIG,
  GUESS_GRACE_MS,
  RANGES,
  SPIN_SETTLE_MS,
  roundDuration,
  type Category,
  type GameConfig,
  type Guess,
  type Player,
  type Room,
  type Round,
} from './types.ts';

const ROOM_TTL_S = 6 * 60 * 60;
/**
 * How long the reveal owns the screen before standings.
 *
 * Scales with the number of categories, because each one gets its own beat:
 * the true value counts up, then every guess slides onto the log scale. Read
 * lazily — ESM hoists imports above any env assignment a caller makes.
 */
export function revealMs(categoryCount = 1): number {
  const override = process.env.TG_REVEAL_MS;
  if (override !== undefined) return Number(override);
  return 2_000 + categoryCount * 2_400;
}

/** Per-category beat, shared with the client's stagger. */
export const REVEAL_STEP_MS = 2_400;
const MIN_PLAYERS = 2;

/** No I/O/0/1 — these get misread off a phone screen across a table. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const K = {
  room: (code: string) => `room:${code}`,
  guesses: (code: string, round: number) => `room:${code}:g:${round}`,
};

export class RoomError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'RoomError';
    this.status = status;
  }
}

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

function newPlayer(name: string): Player {
  return {
    id: `p_${crypto.randomUUID().slice(0, 8)}`,
    name: name.trim().slice(0, 16),
    score: 0,
    present: true,
    catWins: 0,
    streak: 0,
  };
}

async function read(code: string): Promise<Room> {
  const room = await store().get<Room>(K.room(code.toUpperCase()));
  if (!room) throw new RoomError('Room not found', 404);
  return room;
}

async function write(room: Room): Promise<Room> {
  room.v += 1;
  await store().set(K.room(room.code), room, { ex: ROOM_TTL_S });
  return room;
}

function player(room: Room, playerId: string): Player {
  const p = room.players.find((x) => x.id === playerId);
  if (!p) throw new RoomError('You are not in this room', 403);
  return p;
}

function activePlayer(room: Room): Player | null {
  return room.players[room.turnIdx] ?? null;
}

/**
 * A repeat rank would replay a coin players have already seen, and a 10-round
 * Noob game draws from only 401 of them. Slide to the nearest unused rank.
 */
export function resolveRank(
  requested: number,
  from: number,
  to: number,
  used: number[],
): number {
  const lo = Math.max(1, from);
  const hi = Math.max(lo, to);
  const wanted = Math.min(hi, Math.max(lo, Math.round(requested)));
  const taken = new Set(used);
  if (!taken.has(wanted)) return wanted;

  for (let d = 1; d <= hi - lo; d++) {
    if (wanted - d >= lo && !taken.has(wanted - d)) return wanted - d;
    if (wanted + d <= hi && !taken.has(wanted + d)) return wanted + d;
  }
  return wanted; // range exhausted — caller allows the repeat rather than hanging
}

export async function createRoom(
  hostName: string,
  config: Partial<GameConfig> = {},
): Promise<{ room: Room; playerId: string }> {
  await ensureSnapshot();

  const host = newPlayer(hostName);
  const merged: GameConfig = { ...DEFAULT_CONFIG, ...config };
  if (merged.categories.length === 0) merged.categories = [...DEFAULT_CONFIG.categories];

  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode();
    const room: Room = {
      code,
      v: 1,
      hostId: host.id,
      createdAt: Date.now(),
      config: merged,
      phase: 'lobby',
      phaseEndsAt: null,
      turnIdx: 0,
      totalRounds: 0,
      usedRanks: [],
      players: [host],
      round: null,
    };
    const claimed = await store().set(K.room(code), room, {
      ex: ROOM_TTL_S,
      nx: true,
    });
    if (claimed) return { room, playerId: host.id };
  }
  throw new RoomError('Could not allocate a room code', 503);
}

export async function joinRoom(
  code: string,
  name: string,
): Promise<{ room: Room; playerId: string }> {
  const room = await read(code);
  if (room.phase !== 'lobby') {
    throw new RoomError('That game has already started', 409);
  }
  if (room.players.length >= 10) {
    throw new RoomError('That game is full', 409);
  }
  const p = newPlayer(name);
  room.players.push(p);
  await write(room);
  return { room, playerId: p.id };
}

export async function startGame(code: string, playerId: string): Promise<Room> {
  const room = await read(code);
  if (room.phase !== 'lobby') throw new RoomError('Already started', 409);
  if (playerId !== room.hostId) throw new RoomError('Only the host can start', 403);
  if (room.players.length < MIN_PLAYERS) {
    throw new RoomError(`Need at least ${MIN_PLAYERS} players`, 409);
  }

  // Player count is locked here: a per-player round total depends on it.
  room.totalRounds =
    room.config.roundsMode === 'flat'
      ? room.config.roundsValue
      : room.config.roundsValue * room.players.length;

  room.phase = 'spinning';
  room.phaseEndsAt = null;
  room.turnIdx = 0;
  return write(room);
}

/** The active player stops the reel. The coin is resolved and frozen here. */
export async function spin(
  code: string,
  playerId: string,
  requestedRank: number,
): Promise<Room> {
  const room = await read(code);
  if (room.phase !== 'spinning') throw new RoomError('Not spinning right now', 409);

  const active = activePlayer(room);
  if (!active) throw new RoomError('No active player', 409);
  if (active.id !== playerId) throw new RoomError('Not your turn', 403);

  const { from, to } = RANGES[room.config.range];
  const meta = await snapshotMeta();
  const ceiling = Math.min(to, meta?.size ?? to);
  const rank = resolveRank(requestedRank, from, ceiling, room.usedRanks);

  const coin = await coinAtRank(rank);
  if (!coin) throw new RoomError('Could not resolve that coin', 503);

  const truth: Record<Category, number> = {
    price: coin.price,
    mcap: coin.mcap,
    ath: coin.ath,
    fdv: coin.fdv,
    vol: coin.vol,
  };
  const { cats, mergedFdv } = effectiveCategories(room.config.categories, truth);
  const durationMs = roundDuration(room.config.baseRoundMs, cats.length);

  const opensAt = Date.now() + SPIN_SETTLE_MS;
  const roundNo = (room.round?.i ?? 0) + 1;
  const round: Round = {
    i: roundNo,
    rank,
    spunBy: playerId,
    coin: { id: coin.id, s: coin.s, n: coin.n, img: coin.img },
    truth,
    cats,
    mergedFdv,
    durationMs,
    opensAt,
    result: null,
  };

  room.round = round;
  room.usedRanks.push(rank);
  room.phase = 'guessing';
  room.phaseEndsAt = opensAt + durationMs;
  await store().del(K.guesses(room.code, roundNo));
  return write(room);
}

/**
 * Guesses go to a per-round hash rather than the room blob, so five phones
 * submitting at once never contend for the same key.
 */
export async function submitGuess(
  code: string,
  playerId: string,
  values: Partial<Record<Category, number>>,
): Promise<{ ok: true }> {
  const room = await read(code);
  if (room.phase !== 'guessing' || !room.round) {
    throw new RoomError('Not accepting guesses', 409);
  }
  player(room, playerId);

  if (room.phaseEndsAt !== null && Date.now() > room.phaseEndsAt + GUESS_GRACE_MS) {
    throw new RoomError('Too late', 409);
  }

  const clean: Partial<Record<Category, number>> = {};
  for (const cat of room.round.cats) {
    const v = values[cat];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) clean[cat] = v;
  }

  const guess: Guess = { at: Date.now(), values: clean };
  await store().hset(K.guesses(room.code, room.round.i), playerId, guess);
  await store().expire(K.guesses(room.code, room.round.i), ROOM_TTL_S);
  return { ok: true };
}

export async function readGuesses(
  code: string,
  roundNo: number,
): Promise<Record<string, Guess>> {
  return store().hgetall<Guess>(K.guesses(code.toUpperCase(), roundNo));
}

async function scoreCurrentRound(room: Room): Promise<Room> {
  const round = room.round;
  if (!round) throw new RoomError('No round to score', 409);

  const guesses = await readGuesses(room.code, round.i);
  const ids = room.players.map((p) => p.id);
  const result = scoreRound(ids, round.cats, round.truth, guesses);

  for (const p of room.players) {
    const delta = result.delta[p.id] ?? 0;
    p.score += delta;
    p.catWins += countCategoryWins(result, p.id);
    p.streak = delta > 0 ? p.streak + 1 : 0;
  }

  round.result = result;
  room.phase = 'reveal';
  room.phaseEndsAt = Date.now() + revealMs(round.cats.length);
  return room;
}

/**
 * Drives every phase transition. Idempotent per phase, and safe to call from any
 * polling client — the server decides whether the move is legal, not the caller.
 */
export async function advance(code: string, playerId: string): Promise<Room> {
  const room = await read(code);
  player(room, playerId);
  const now = Date.now();

  switch (room.phase) {
    case 'guessing': {
      const guesses = await readGuesses(room.code, room.round?.i ?? 0);
      const everyoneIn = room.players.every((p) => !p.present || guesses[p.id]);
      const expired = room.phaseEndsAt !== null && now > room.phaseEndsAt;
      if (!expired && !everyoneIn) throw new RoomError('Round still running', 409);
      return write(await scoreCurrentRound(room));
    }

    case 'reveal': {
      if (room.phaseEndsAt !== null && now < room.phaseEndsAt) {
        throw new RoomError('Reveal still running', 409);
      }
      room.phase = 'standings';
      room.phaseEndsAt = null;
      return write(room);
    }

    case 'standings': {
      const played = room.round?.i ?? 0;
      if (played >= room.totalRounds) {
        room.phase = 'final';
        room.phaseEndsAt = null;
        return write(room);
      }
      const nextIdx = (room.turnIdx + 1) % room.players.length;
      const next = room.players[nextIdx];
      if (next && playerId !== next.id && playerId !== room.hostId) {
        throw new RoomError('Only the next player can start the round', 403);
      }
      room.turnIdx = nextIdx;
      room.phase = 'spinning';
      room.phaseEndsAt = null;
      return write(room);
    }

    default:
      throw new RoomError(`Cannot advance from ${room.phase}`, 409);
  }
}

export async function setPresence(
  code: string,
  playerId: string,
  present: boolean,
): Promise<Room> {
  const room = await read(code);
  const p = player(room, playerId);
  if (p.present === present) return room;
  p.present = present;
  return write(room);
}

/**
 * The shared view of a room.
 *
 * Deliberately player-agnostic: an identical payload for every phone means the
 * CDN can collapse a whole table's polling into one origin read per second. The
 * client derives "is it my turn" from the player id it holds locally, and it
 * already knows its own guesses, so nothing per-player needs to be served.
 */
export interface PublicState {
  code: string;
  v: number;
  serverTime: number;
  phase: Room['phase'];
  phaseEndsAt: number | null;
  hostId: string;
  activePlayerId: string | null;
  config: GameConfig;
  totalRounds: number;
  roundNo: number;
  players: Player[];
  round: PublicRound | null;
  /** Player ids that have locked in this round. */
  submitted: string[];
}

export interface PublicRound {
  i: number;
  rank: number;
  spunBy: string;
  coin: Round['coin'];
  cats: Category[];
  mergedFdv: boolean;
  durationMs: number;
  opensAt: number;
  /** Null until the round is revealed. */
  truth: Record<Category, number> | null;
  result: Round['result'];
  /** Null until the round is revealed. */
  guesses: Record<string, Guess> | null;
}

const REVEALED = new Set(['reveal', 'standings', 'final']);

export async function publicState(code: string): Promise<PublicState> {
  const room = await read(code);
  const revealed = REVEALED.has(room.phase);
  const round = room.round;

  let submitted: string[] = [];
  let guesses: Record<string, Guess> | null = null;
  if (round) {
    const all = await readGuesses(room.code, round.i);
    submitted = Object.keys(all);
    guesses = revealed ? all : null;
  }

  return {
    code: room.code,
    v: room.v,
    serverTime: Date.now(),
    phase: room.phase,
    phaseEndsAt: room.phaseEndsAt,
    hostId: room.hostId,
    activePlayerId: activePlayer(room)?.id ?? null,
    config: room.config,
    totalRounds: room.totalRounds,
    roundNo: round?.i ?? 0,
    players: room.players,
    submitted,
    round: round
      ? {
          i: round.i,
          rank: round.rank,
          spunBy: round.spunBy,
          coin: round.coin,
          cats: round.cats,
          mergedFdv: round.mergedFdv,
          durationMs: round.durationMs,
          opensAt: round.opensAt,
          truth: revealed ? round.truth : null,
          result: revealed ? round.result : null,
          guesses,
        }
      : null,
  };
}
