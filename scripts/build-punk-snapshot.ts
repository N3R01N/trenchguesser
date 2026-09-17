/**
 * Builds the CryptoPunks sale history and reports what it found.
 *
 *   npm run snapshot:punks
 *
 * No API key: cryptopunks.app publishes this openly. The whole history is ~31
 * pages, after which a round costs nothing — the prices are all local and the
 * image is a URL the phone fetches itself.
 */
import { ensureSnapshot, punkSource, PUNK_UNIVERSE_CONFIG } from '../lib/punks.ts';

const started = Date.now();
console.log('reading every punk sale since June 2017...');

const meta = await ensureSnapshot(true);
const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log(
  `\nuniverse: ${meta.size} punks in ${meta.chunks} chunks, ` +
    `${(meta.bytes / 1024).toFixed(0)} KB, built in ${secs}s`,
);

let sold = 0;
let never = 0;
let multi = 0;
let overCap = 0;
const lasts: number[] = [];

for (let i = 0; i < meta.size; i++) {
  const e = await punkSource.entryAtRank(i);
  const last = e?.values.lastSale ?? 0;
  const high = e?.values.highSale ?? 0;
  const low = e?.values.lowSale ?? 0;
  if (last > 0) {
    sold++;
    lasts.push(last);
    if (high > low) multi++;
    if (high > PUNK_UNIVERSE_CONFIG.SALE_CAP_ETH) overCap++;
  } else never++;
}

lasts.sort((a, b) => a - b);
const q = (p: number) => lasts[Math.floor(lasts.length * p)] as number;
console.log(`\nsold at a real price : ${sold} (${((100 * sold) / meta.size).toFixed(1)}%)`);
console.log(`never sold           : ${never} (${((100 * never) / meta.size).toFixed(1)}%)`);
console.log(`more than one sale   : ${multi}  — these carry a distinct high and low`);
console.log(`a sale over ${PUNK_UNIVERSE_CONFIG.SALE_CAP_ETH} ETH  : ${overCap}`);
console.log(
  `\nlast sale (ETH): min ${lasts[0]?.toFixed(3)}  p5 ${q(0.05).toFixed(2)}  ` +
    `median ${q(0.5).toFixed(1)}  p95 ${q(0.95).toFixed(0)}  max ${lasts[lasts.length - 1]?.toFixed(0)}`,
);

console.log('\nsamples:');
for (const i of [0, 2140, 3100, 5822, 7804, 9998]) {
  const e = await punkSource.entryAtRank(i);
  if (!e) continue;
  const fmt = (v: number | undefined, note?: string) =>
    v && v > 0 ? `${v.toFixed(2)} ETH${note ? ` (${note})` : ''}` : 'never sold';
  console.log(
    `  ${e.n.padEnd(20)} last ${fmt(e.values.lastSale, e.notes?.lastSale).padEnd(28)} ` +
      `high ${fmt(e.values.highSale, e.notes?.highSale)}`,
  );
}
