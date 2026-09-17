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

## Two modes

**Coins** spins a market-cap rank and guesses price, market cap, ATH, FDV and
24h volume. **NFTs** spins an all-time-volume rank over Ethereum collections and
guesses floor price, all-time volume, owners and sales.

They are the same game over a different universe. `lib/universe.ts` picks the
source; everything downstream — the state machine, scoring, every screen — is
indifferent to which one it got.

The two sources have opposite shapes, and that is the whole design:

| | CoinGecko | OpenSea |
|---|---|---|
| Ranked list | 27 requests, **numbers included** | 30 requests, **no numbers at all** |
| Per-entity numbers | free, in the list | one request each, at spin time |
| Budget | 10,000 credits/month | 120 per sub-minute window |

OpenSea's ranked list carries names and art but no floor price, and there is no
batched stats endpoint. Pricing the whole ladder up front would cost one request
per collection, so NFT mode stores only the ladder and fetches the numbers for
the one collection a spin lands on: **30 requests to build, one per round.** A
100-round game costs about 135.

That trade has one consequence worth knowing: **the build can no longer filter
on numbers it hasn't fetched.** A collection with no floor is only discovered on
landing, so `applySpin` walks to the next rank and burns the dead one. What can
be filtered up front — unverified, NSFW, disabled, art-less — is, because that
all arrives in the cheap list call.

Measured against the live API rather than assumed: thirty pages yield **2,876
collections**, 96% of raw rows clear the filters (`/collections/top` is already
curated, so the safelist filter does less work than you would expect), and
**5% of the ladder comes back unguessable** — so a round costs 1.05 requests on
average. Slider bounds are set from the same crawl: floors run 0.00024 to 29.7
ETH, all-time volume 269 to 1.38M, owners 220 to 5.3K, sales 476 to 39K.

The documented 600/hour is not what a key reports. `X-RateLimit-Limit` comes
back as 120 against a sub-minute reset, and 67 requests in 40 seconds drew no
429 at all — far more headroom than this game asks for. `lib/nfts.ts` backs off
to `X-RateLimit-Reset` rather than trusting any of these numbers.

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
   it injects the credentials itself, under either `UPSTASH_REDIS_REST_URL` and
   `UPSTASH_REDIS_REST_TOKEN` or `KV_REST_API_URL` and `KV_REST_API_TOKEN`
   depending on how the store was added. The app reads both pairs, so nothing
   needs renaming. `REDIS_URL` is the `rediss://` protocol endpoint and is not
   used — the client speaks REST.
3. Add `COINGECKO_API_KEY` under **Settings → Environment Variables**, and
   `OPENSEA_API_KEY` too if you want NFT mode. Either mode fails with a plain
   503 naming the key it is missing, so a game without one is never a mystery.
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
| OpenSea requests | 120/window | ~30/ladder/day + ~1.05/round |
| Upstash commands | 500,000/mo | ~1,200/game |
| Upstash storage | 256 MB | ~1.1 MB (both snapshots) |

## Scripts

```bash
npm run dev          # local server
npm test             # 76 tests, no test framework — node --test runs the TS directly
npm run snapshot     # rebuild the coin universe and print what it found
npm run snapshot:nft # rebuild the collection ladder, and measure the dead rate
npm run playthrough  # drive a full game over HTTP against a running server
```

`playthrough` is the fastest way to check a change end to end:

```bash
npm run dev &
BASE=http://localhost:3000 npm run playthrough
MODE=nfts BASE=http://localhost:3000 npm run playthrough
```

## How it fits together

```
lib/types.ts        domain model, and every constant both sides need
lib/score.ts        log-squared error, winner/loser split, FDV merge, reveal tiers
lib/universe.ts     which source a game draws from (server only)
lib/coins.ts        CoinGecko: crawl, exclude, filter, chunk, lazy rebuild
lib/nfts.ts         OpenSea: the ladder up front, the numbers per round
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
