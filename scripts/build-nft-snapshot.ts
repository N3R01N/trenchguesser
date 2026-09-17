/**
 * Builds the NFT collection ladder and reports what the live API actually does.
 *
 *   npm run snapshot:nft
 *
 * Three things cannot be known from the docs, and this measures all of them:
 * how deep /collections/top really pages, what a key's real rate budget is, and
 * what share of the ladder comes back unguessable — which is what sets how deep
 * the degen tier can safely go.
 */
import {
  buildUniverse,
  collectionAtRank,
  ensureSnapshot,
  lastRateLimit,
  statsFor,
  NFT_UNIVERSE_CONFIG,
} from '../lib/nfts.ts';

const fmt = (n: number) =>
  n >= 1 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : n.toPrecision(3);

const started = Date.now();
console.log(
  `crawling up to ${NFT_UNIVERSE_CONFIG.CRAWL_PAGES} pages of ` +
    `${NFT_UNIVERSE_CONFIG.CHAIN} collections by ${NFT_UNIVERSE_CONFIG.SORT_BY}...`,
);

const meta = await ensureSnapshot(true);
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

console.log(
  `\nladder: ${meta.size} collections in ${meta.chunks} chunks, ` +
    `${(meta.bytes / 1024).toFixed(0)} KB, built in ${elapsed}s`,
);
if (meta.size < NFT_UNIVERSE_CONFIG.CRAWL_PAGES * NFT_UNIVERSE_CONFIG.PER_PAGE * 0.2) {
  console.log('  ^ thinner than expected — the endpoint may cap how deep it pages');
}

console.log('\nsamples:');
for (const rank of [1, 5, 25, 80, 250, 500, meta.size]) {
  const c = await collectionAtRank(rank);
  if (!c) continue;
  const stats = await statsFor(c.slug);
  console.log(
    `  #${String(rank).padEnd(5)} ${c.n.slice(0, 28).padEnd(28)} ${c.s.padEnd(10)} ` +
      (stats
        ? `floor ${fmt(stats.floor).padStart(8)} ETH  vol ${fmt(stats.atvol).padStart(11)}  ` +
          `owners ${fmt(stats.owners).padStart(8)}  sales ${fmt(stats.sales).padStart(9)}`
        : 'no usable numbers'),
  );
}

/**
 * The dead rate is the one number the whole per-round design rests on: every
 * unusable collection costs a spin one extra request and one extra beat.
 */
const SAMPLE = 40;
console.log(`\nsampling ${SAMPLE} ranks for usable numbers...`);
let alive = 0;
let checked = 0;
for (let i = 0; i < SAMPLE; i++) {
  const rank = 1 + Math.floor(Math.random() * meta.size);
  const c = await collectionAtRank(rank);
  if (!c) continue;
  checked++;
  if (await statsFor(c.slug)) alive++;
}
const deadPct = checked ? (100 * (checked - alive)) / checked : 0;
console.log(
  `  ${alive}/${checked} usable — ${deadPct.toFixed(0)}% dead ` +
    `(${(1 / (alive / checked || 1)).toFixed(2)} requests per round on average)`,
);
if (deadPct > 35) {
  console.log('  ^ high: tighten the filters or pull the degen tier shallower');
}

console.log(
  `\nrate budget: ${
    lastRateLimit
      ? `${lastRateLimit.remaining}/${lastRateLimit.limit} left, resets at ` +
        new Date(Number(lastRateLimit.reset) * 1000).toISOString()
      : 'no headers returned'
  }`,
);
