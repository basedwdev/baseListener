# swap-bot

Listens to Uniswap V3 pool contracts on Base chain, detects buy events in real time, and publishes enriched results to downstream services via Redis pub/sub. Pairs to watch are added and removed dynamically at runtime — no restart required.

---

## Components

| Module | Role |
|---|---|
| `src/index.js` | Entry point — wires all components, restores state from DB on boot, handles shutdown |
| `src/config/config.js` | Single frozen config object; throws fast on missing env vars |
| `src/blockchain/provider.js` | Probes all configured RPCs; returns a `FallbackProvider` across all live nodes |
| `src/blockchain/priceCalc.js` | Pure math — `sqrtPriceX96` → price, Transfer log scanner |
| `src/blockchain/abis/uniV3Pool.json` | Minimal ABI: `Swap` event + `token0()`/`token1()` view functions |
| `src/core/listener.js` | `ListenerManager` — manages active pair subscriptions, throttled DB writes |
| `src/core/swapProcessor.js` | Swap event → enriched buy result pipeline |
| `src/db/db.js` | SQLite persistence via `better-sqlite3` (WAL mode) |
| `src/messaging/redis.js` | `pub`/`sub` ioredis clients with exponential-backoff reconnect |
| `src/logger.js` | Winston logger — colorized console + daily-rotating JSON files |

### Redis channels

| Direction | Env var | Payload |
|---|---|---|
| Inbound | `REDIS_CHANNEL_TOKEN_ACTIONS` | `{ action, pair, memeTokenAddress, baseTokenAddress, memeTokenDecimals, baseTokenDecimals }` |
| Outbound | `REDIS_CHANNEL_BUYS` | enriched buy result (see below) |
| Outbound | `REDIS_CHANNEL_INFO` | operational messages (pair added/removed, stale-pair alerts) |
| Outbound | `REDIS_CHANNEL_ERRORS` | structured error objects `{ error, pair, context? }` |

<details>
<summary>Token action message</summary>

```json
{
  "action": "create",
  "pair": "0x...",
  "memeTokenAddress": "0x...",
  "baseTokenAddress": "0x...",
  "memeTokenDecimals": 18,
  "baseTokenDecimals": 6
}
```

Use `"action": "delete"` with `pair` to stop listening.
</details>

<details>
<summary>Buy result message</summary>

```json
{
  "totalTokensPurchased": "1234.567",
  "amountReceived":       "1234.567",
  "cost":                 "0.0500",
  "userBalance":          "5000.000",
  "tokenPrice":           "0.00001234",
  "pair":                 "0x...",
  "tokenContract":        "0x...",
  "sender":               "0x...",
  "txnHash":              "0x...",
  "version":              "v3",
  "chain":                "base"
}
```
</details>

---

## Run

```bash
cp .env.example .env   # fill in RPC_PROVIDERS and REDIS_URL at minimum
npm install
npm start
```

**Requirements:** Node.js ≥ 22, a running Redis instance.

### With pm2

```bash
pm2 start src/index.js --name swap-bot
pm2 logs swap-bot
```

---

## Test

```bash
npm test
```

Uses Node's built-in test runner. No external test dependencies required. The test env file (`.env.test`) is already committed — it uses an in-memory SQLite DB and suppresses logs.

---

## Debug & Operate

**Increase log verbosity**
```bash
LOG_LEVEL=debug npm start
```

**Tune the dust filter** — drop buys below a threshold (default: 0.01 tokens):
```
MIN_AMOUNT_RECEIVED=1.0
```

**Add a pair at runtime** (no restart needed):
```bash
redis-cli PUBLISH token-actions '{"action":"create","pair":"0x...","memeTokenAddress":"0x...","baseTokenAddress":"0x...","memeTokenDecimals":18,"baseTokenDecimals":6}'
```

**Remove a pair at runtime:**
```bash
redis-cli PUBLISH token-actions '{"action":"delete","pair":"0x..."}'
```

**Stale pair detection** — pairs with no buy activity for `STALE_PAIR_THRESHOLD_MS` (default: 3 days) are periodically published to `REDIS_CHANNEL_INFO`. The scan runs every `STALE_PAIR_SCAN_INTERVAL_MS` (default: 6 hours).

**Resilience** — all tracked pairs survive restarts (persisted in SQLite). If an RPC node goes down after boot, `FallbackProvider` re-routes requests to the next live node automatically. Redis reconnects automatically with exponential backoff (cap: 30s).
