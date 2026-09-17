import { z } from 'zod';
import { CATEGORIES, UNIVERSE_KEYS } from './types.ts';

/** Every inbound body crosses this boundary. Nothing else trusts the client. */

const name = z.string().trim().min(1, 'Pick a name').max(16, 'Name is too long');
const playerId = z.string().min(1).max(64);
const category = z.enum(CATEGORIES);

export const configSchema = z
  .object({
    mode: z.enum(UNIVERSE_KEYS),
    categories: z.array(category).min(1, 'Pick at least one thing to guess').max(5),
    baseRoundMs: z.number().int().min(3_000).max(120_000),
    roundsMode: z.enum(['flat', 'perPlayer']),
    roundsValue: z.number().int().min(1).max(50),
    range: z.enum(['noob', 'normal', 'degen']),
  })
  .partial();

export const createSchema = z.object({
  name,
  config: configSchema.optional(),
});

export const joinSchema = z.object({ name });

export const playerSchema = z.object({ playerId });

export const spinSchema = z.object({
  playerId,
  rank: z.number().int().min(1).max(20_000),
});

export const guessSchema = z.object({
  playerId,
  // partialRecord, not record: z.record over an enum key demands every key be
  // present, and a player may move only some of the sliders.
  // Zero is rejected per-category in room.ts rather than here: it is a real
  // answer ("never sold") for punks and meaningless for everything else.
  values: z.partialRecord(category, z.number().nonnegative().finite()),
});
