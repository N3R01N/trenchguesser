import { coinSource } from './coins.ts';
import { nftSource } from './nfts.ts';
import type { UniverseKey, UniverseSource } from './types.ts';

/**
 * Which pool a game draws from.
 *
 * Server only: importing this pulls in a source, and every source reaches the
 * store and the network. The interface itself lives in types.ts, so tests and
 * client code can name it without dragging any of that along.
 */

export const DEFAULT_UNIVERSE: UniverseKey = 'coins';

const SOURCES: Record<UniverseKey, UniverseSource> = {
  coins: coinSource,
  nfts: nftSource,
};

export function universeFor(key: UniverseKey = DEFAULT_UNIVERSE): UniverseSource {
  return SOURCES[key];
}
