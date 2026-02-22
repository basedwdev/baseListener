import 'dotenv/config';
import { config } from './config/config.js';
import { logger } from './logger.js';
import { Database } from './db/db.js';
import { getProvider } from './blockchain/provider.js';
import { subscribe, publish, connectRedis, closeRedis } from './messaging/redis.js';
import { ListenerManager } from './core/listener.js';

let _listeners;
let _db;

async function start() {
    await connectRedis();       // S14: explicit connect before any pub/sub
    const provider = await getProvider(config.rpcProviders);
    _db = new Database();
    _db.createTable();

    _listeners = new ListenerManager(provider, _db);

    const saved = _db.getAll();
    for (const row of saved) {
        await _listeners.add(row);  // S6: add() is now async (calls token0())
    }
    logger.info(`Restored ${saved.length} pair(s) from DB`, { component: 'app' });

    await subscribe(config.redis.channels.tokenActions, async (msg) => {
        const { action, pair, memeTokenAddress } = msg;
        if (action === 'create') {
            await _listeners.add(msg);  // S6: add() is async
            await publish(config.redis.channels.info, `added pair ${pair}`);
        } else if (action === 'delete') {
            _listeners.remove(pair);    // S7+S8: signature simplified
            await publish(config.redis.channels.info, `removed pair ${pair}`);
        } else {
            logger.warn(`Unknown action: ${action}`, { component: 'app' });
        }
    });

    setInterval(async () => {
        const cutoff = Date.now() - config.timing.stalePairThresholdMs;
        const stale = _db.getStale(cutoff);
        if (stale.length > 0) {
            await publish(config.redis.channels.info, {
                message: 'stale-pairs check',
                pairs: stale.map(r => r.pair),
            });
        }
    }, config.timing.stalePairScanIntervalMs);

    logger.info('Swap bot running', { component: 'app' });
}

async function shutdown() {
    logger.info('Shutting down...', { component: 'app' });
    _listeners?.removeAll();
    _db?.close();
    await closeRedis();
    process.exit(0);
}

start().catch(err => {
    logger.error(`Fatal startup error: ${err.message}`, { component: 'app' });
    process.exit(1);
});

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
