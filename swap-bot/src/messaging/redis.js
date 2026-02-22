import Redis from 'ioredis';
import { config } from '../config/config.js';
import { logger } from '../logger.js';

/**
 * Creates a configured ioredis client with logging and backoff retry.
 * @param {string} name - label used in log messages (e.g. 'pub', 'sub')
 * @returns {Redis}
 */
function createClient(name) {
    const client = new Redis(config.redis.url, {
        lazyConnect: true,
        retryStrategy(times) {
            const delay = Math.min(1000 * 2 ** (times - 1), 30_000);
            logger.warn(`[${name}] Redis reconnect attempt ${times}, waiting ${delay}ms`, { component: 'redis' });
            return delay;
        },
    });

    client.on('connect', () => logger.info(`[${name}] Redis connected`, { component: 'redis' }));
    client.on('close', () => logger.warn(`[${name}] Redis connection closed`, { component: 'redis' }));
    client.on('error', (err) => logger.error(`[${name}] Redis error: ${err.message}`, { component: 'redis' }));

    return client;
}

// Two separate clients are required:
// - pubClient stays in normal mode and can publish / run commands
// - subClient enters subscribe mode and can only receive messages
const pubClient = createClient('pub');
const subClient = createClient('sub');

// S2: single dispatcher registered once — calling subscribe() multiple times
// used to stack a new 'message' listener each time, causing duplicate delivery.
// Now all channel routing goes through this one handler.
const _handlers = new Map();
subClient.on('message', (ch, raw) => {
    const handler = _handlers.get(ch);
    if (!handler) return;
    try {
        handler(JSON.parse(raw));
    } catch {
        // message wasn't JSON — pass it through as a raw string
        handler(raw);
    }
});

/**
 * Publishes a message to a Redis channel.
 * @param {string} channel
 * @param {object|string} payload  - objects are JSON-serialised automatically
 */
export async function publish(channel, payload) {
    const message = typeof payload === 'string' ? payload : JSON.stringify(payload);
    try {
        await pubClient.publish(channel, message);
    } catch (err) {
        logger.error(`Failed to publish to ${channel}: ${err.message}`, { component: 'redis' });
    }
}

/**
 * Subscribes to a Redis channel and calls handler for each message.
 * Re-subscribing to the same channel replaces the previous handler.
 * @param {string}   channel
 * @param {function} handler  - (parsedPayload: object|string) => void
 */
export async function subscribe(channel, handler) {
    await subClient.subscribe(channel);
    _handlers.set(channel, handler);
    logger.info(`Subscribed to channel: ${channel}`, { component: 'redis' });
}

/**
 * Explicitly connects both Redis clients.
 * Must be called once during startup before publish/subscribe are used.
 */
export async function connectRedis() {
    await Promise.all([pubClient.connect(), subClient.connect()]);
    logger.info('Redis clients connected', { component: 'redis' });
}

/**
 * Gracefully closes both Redis connections.
 */
export async function closeRedis() {
    await pubClient.quit();
    await subClient.quit();
    logger.info('Redis connections closed', { component: 'redis' });
}
