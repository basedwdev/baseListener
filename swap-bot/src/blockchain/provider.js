import { JsonRpcProvider, FallbackProvider } from 'ethers';
import { logger } from '../logger.js';

/**
 * Probes every RPC URL and returns a provider backed by all live nodes.
 * - Single live node  → returns a plain JsonRpcProvider.
 * - Multiple live nodes → returns a FallbackProvider(quorum=1) that
 *   automatically re-routes requests if a node becomes unresponsive.
 * Throws if no URLs respond.
 * @param {string[]} urls
 * @returns {Promise<JsonRpcProvider|FallbackProvider>}
 */
export async function getProvider(urls) {
    const live = [];

    for (const url of urls) {
        try {
            const provider = new JsonRpcProvider(url);
            // getBlockNumber() is a lightweight call — confirms the node is reachable
            await provider.getBlockNumber();
            logger.info(`RPC confirmed: ${url}`, { component: 'provider' });
            live.push(provider);
        } catch (err) {
            logger.warn(`RPC unavailable, skipping: ${url} — ${err.message}`, { component: 'provider' });
        }
    }

    if (live.length === 0) throw new Error('All RPC providers failed. Check your RPC_PROVIDERS env var.');
    if (live.length === 1) return live[0];

    logger.info(`Using FallbackProvider with ${live.length} live RPC(s)`, { component: 'provider' });
    return new FallbackProvider(
        live.map(p => ({ provider: p, priority: 1, weight: 1 })),
        undefined,   // auto-detect network
        { quorum: 1 },
    );
}
