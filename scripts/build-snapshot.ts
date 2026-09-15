/**
 * Builds the coin universe and prints what it found.
 *
 *   npm run snapshot
 *
 * With Upstash credentials present this writes the real snapshot. Without them it
 * builds into the in-memory store and simply reports, which is enough to verify
 * the crawl, the exclusion set and the volume floor.
 */
import { ensureSnapshot, coinAtRank, UNIVERSE_CONFIG } from '../lib/coins.ts';

const fmt = (n: number) =>
  n >= 1 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : n.toPrecision(3);

const started = Date.now();
console.log(
  `crawling ${UNIVERSE_CONFIG.CRAWL_PAGES} pages, volume floor $${UNIVERSE_CONFIG.VOLUME_FLOOR.toLocaleString()}...`,
);

const meta = await ensureSnapshot(true);

console.log(
  `\nuniverse: ${meta.size} coins in ${meta.chunks} chunks, ` +
    `${(meta.bytes / 1024).toFixed(0)} KB, built in ${((Date.now() - started) / 1000).toFixed(1)}s`,
);

console.log('\nsamples:');
for (const rank of [100, 500, 1000, 1500, 2000, 2400, meta.size]) {
  const c = await coinAtRank(rank);
  if (!c) continue;
  console.log(
    `  #${String(rank).padEnd(5)} ${c.s.padEnd(10)} ${c.n.slice(0, 26).padEnd(26)} ` +
      `$${fmt(c.price).padEnd(12)} mcap $${fmt(c.mcap).padStart(13)}  vol $${fmt(c.vol).padStart(11)}`,
  );
}

const dupes = await (async () => {
  let same = 0;
  for (let r = 1; r <= meta.size; r++) {
    const c = await coinAtRank(r);
    if (c && Math.abs(c.fdv - c.mcap) / c.mcap < 0.01) same++;
  }
  return same;
})();
console.log(
  `\nfdv within 1% of mcap: ${dupes} / ${meta.size} (${((100 * dupes) / meta.size).toFixed(1)}%)`,
);
