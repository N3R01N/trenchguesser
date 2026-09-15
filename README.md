# Trenchguesser

A lobby party game for phones. Spin a wheel, land on a number, and that number is
a coin's market-cap rank. Everyone guesses what it's worth at once. Closest wins,
worst pays.

## Running it locally

```bash
npm install
echo "COINGECKO_API_KEY=your-demo-key" > .env.local
npm run dev
```

Open two browser windows (one private, so they get separate identities) and host
a game in one, join in the other.

No database is needed to develop: without Upstash credentials the app falls back
to an in-memory store and says so at startup. State dies with the dev server.

The first room you create builds the coin universe, which crawls 27 pages of the
CoinGecko API and takes about 45 seconds. Every room after that is instant until
the snapshot ages out.

## The API key is not optional

Get a free Demo key from the [CoinGecko developer dashboard](https://www.coingecko.com/en/api/pricing)
— no card required, 10,000 credits a month, of which this uses roughly 7,000.

The keyless public API returns `429` on the third consecutive request, and the
snapshot builder needs 27 in a row. CoinGecko's own docs say the keyless tier is
"not suitable for production workloads, scheduled polling, or high-frequency
updates."

## Deploying to Vercel

1. Push the repo and import it at [vercel.com/new](https://vercel.com/new).
2. Add a Redis store: **Storage → Marketplace → Upstash for Redis**. Connecting
   it sets `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` for you.
3. Add `COINGECKO_API_KEY` under **Settings → Environment Variables**.
4. Deploy.

There is no cron to configure: the coin snapshot rebuilds itself lazily whenever
a lobby is created and the existing one is more than three hours old, behind a
lock so only one builder ever runs. Vercel's Hobby plan only permits daily cron
fired within a ±59 minute window, which is no use for this.

Note that Vercel's Hobby plan is for personal, non-commercial projects.

### Free-tier budget

| Resource | Ceiling | This uses |
|---|---|---|
| CoinGecko credits | 10,000/mo | ~7,000/mo |
| Upstash commands | 500,000/mo | ~1,200/game |
| Upstash storage | 256 MB | ~550 KB |

## Scripts

```bash
npm run dev          # local server
npm test             # 38 tests, no test framework — node --test runs the TS directly
npm run snapshot     # rebuild the coin universe and print what it found
npm run playthrough  # drive a full game over HTTP against a running server
```

`playthrough` is the fastest way to check a change end to end:

```bash
npm run dev &
BASE=http://localhost:3000 npm run playthrough
```

## How it fits together

```
lib/types.ts        domain model, and every constant both sides need
lib/score.ts        log-squared error, winner/loser split, FDV merge, reveal tiers
lib/coins.ts        snapshot builder: crawl, exclude, filter, chunk, lazy rebuild
lib/room.ts         the game state machine (server only)
lib/useRoomState.ts polling hook — the transport seam
components/phases/  one file per screen
```

Four runtime dependencies: `next`, `react`, `@upstash/redis`, `zod`.

A few decisions worth knowing before changing things:

- **Rank means position in our own snapshot.** CoinGecko's `market_cap_rank`
  field disagrees with its own `market_cap_desc` ordering — one sampled page held
  ranks 2113–2588 interleaved, with all 250 rows mismatched.
- **Scoring is squared error on the log axis.** Plain squared error ranks
  identically to absolute error and rewards lowballing, because guessing low is
  bounded at zero while guessing high is unbounded.
- **State is polled, not pushed.** Vercel Hobby caps a function at 300s, so
  WebSocket connections would die every five minutes, and connections pin to a
  single instance so fan-out would need Redis anyway. The state payload is
  identical for every player, so the CDN collapses a table of phones into roughly
  one origin read per second.
- **Presence is a heartbeat, not a flag.** A closed tab or a locked phone sends
  no goodbye.
- **The truth is frozen at spin time** and stripped from every payload until the
  reveal. Anti-cheat is a short timer, so the coin's real values must never reach
  a client early.
