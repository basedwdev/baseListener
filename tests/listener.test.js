import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ListenerManager } from '../src/core/listener.js';

/**
 * Real Uniswap V3 WETH/USDC 0.05% pool addresses (Base chain).
 * WETH = token0 (lower address), USDC = token1 (higher address)
 */
const PAIR = '0xd0b53d9277642d899df5c87a3966a349a798f224';
const MEME = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';  // USDC — higher address → token1
const BASE = '0x4200000000000000000000000000000000000006';  // WETH — lower address  → token0

const pairInfo = {
    pair: PAIR,
    memeTokenAddress: MEME,
    baseTokenAddress: BASE,
    memeTokenDecimals: 6,
    baseTokenDecimals: 18,
};

/**
 * Creates a minimal mock DB that records calls.
 */
function makeMockDb() {
    const calls = { upsert: [], delete: [], updateLastBought: [] };
    return {
        calls,
        upsert: (...args) => calls.upsert.push(args),
        delete: (pair) => calls.delete.push(pair),
        updateLastBought: (pair) => calls.updateLastBought.push(pair),
    };
}

/**
 * Creates a contract factory that returns:
 *  - poolContract for the pair address (supports token0(), on(), removeAllListeners())
 *  - tokenContract for any other address (supports balanceOf())
 *
 * @param {string} token0Address - the address that token0() will return
 */
function makeMockContractFactory(token0Address = BASE) {
    const poolContract = {
        _listeners: {},
        token0: async () => token0Address,
        on: (event, handler) => { poolContract._listeners[event] = handler; },
        removeAllListeners: () => { poolContract._listeners = {}; },
    };
    const tokenContract = {
        balanceOf: async () => 0n,
    };
    const factory = (addr) => addr === PAIR ? poolContract : tokenContract;
    return { factory, poolContract };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ListenerManager', () => {
    let db, manager, poolContract;

    beforeEach(() => {
        db = makeMockDb();
        const mocks = makeMockContractFactory(BASE);  // WETH is token0 → MEME (USDC) is token1
        poolContract = mocks.poolContract;
        manager = new ListenerManager({}, db, mocks.factory);
    });

    test('add() registers the pair in the active map and calls db.upsert()', async () => {
        await manager.add(pairInfo);
        assert.ok(manager.active.has(PAIR), 'pair should appear in active map');
        assert.equal(db.calls.upsert.length, 1, 'db.upsert() should be called once');
        assert.equal(db.calls.upsert[0][0], PAIR);
    });

    test('add() is idempotent — second call for the same pair is a no-op', async () => {
        await manager.add(pairInfo);
        await manager.add(pairInfo);
        assert.equal(manager.active.size, 1);
        assert.equal(db.calls.upsert.length, 1, 'db.upsert() should only be called once');
    });

    test('add() sets tokenOrdering=1 when token0() returns the base token', async () => {
        // token0() returns BASE (WETH), so MEME (USDC) is token1 → ordering = 1
        await manager.add(pairInfo);
        assert.equal(manager.ordering.get(PAIR), 1);
    });

    test('add() sets tokenOrdering=0 when token0() returns the meme token', async () => {
        // Override factory so token0() returns the meme token address
        const { factory } = makeMockContractFactory(MEME);
        const mgr = new ListenerManager({}, makeMockDb(), factory);
        await mgr.add(pairInfo);
        assert.equal(mgr.ordering.get(PAIR), 0);
    });

    test('add() falls back to address comparison when token0() throws', async () => {
        const failingPool = {
            token0: async () => { throw new Error('RPC timeout'); },
            on: () => { },
            removeAllListeners: () => { },
        };
        const fallbackFactory = (addr) => addr === PAIR ? failingPool : {};
        const mgr = new ListenerManager({}, makeMockDb(), fallbackFactory);
        // BigInt(MEME) > BigInt(BASE) → meme is NOT token0 → ordering = 1
        await mgr.add(pairInfo);
        assert.equal(mgr.ordering.get(PAIR), 1);
    });

    test('remove() cleans up all maps and calls db.delete()', async () => {
        await manager.add(pairInfo);
        manager.remove(PAIR);
        assert.ok(!manager.active.has(PAIR), 'pair should be removed from active');
        assert.ok(!manager.ordering.has(PAIR), 'ordering entry should be removed');
        assert.ok(!manager.decimals.has(PAIR), 'decimals entry should be removed');
        assert.equal(db.calls.delete.length, 1);
        assert.equal(db.calls.delete[0], PAIR);
    });

    test('remove() is a no-op for an unknown pair', () => {
        manager.remove('0x000000000000000000000000000000000000dead');
        assert.equal(db.calls.delete.length, 0);
    });

    test('removeAll() clears all maps without touching the DB', async () => {
        await manager.add(pairInfo);
        manager.removeAll();
        assert.equal(manager.active.size, 0);
        assert.equal(manager.ordering.size, 0);
        assert.equal(manager.decimals.size, 0);
        // removeAll() is for shutdown — it does NOT delete from DB (pairs persist for next restart)
        assert.equal(db.calls.delete.length, 0);
    });

    test('_throttledDbUpdate() writes to DB when lastBoughtAt is old enough', async () => {
        await manager.add(pairInfo);
        manager.active.get(PAIR).lastBoughtAt = 0;  // epoch → guaranteed to exceed any throttle window
        await manager._throttledDbUpdate(PAIR);
        assert.equal(db.calls.updateLastBought.length, 1);
    });

    test('_throttledDbUpdate() skips the write if called again within the throttle window', async () => {
        await manager.add(pairInfo);
        manager.active.get(PAIR).lastBoughtAt = 0;
        await manager._throttledDbUpdate(PAIR);   // first call — writes, updates lastBoughtAt to ~now
        await manager._throttledDbUpdate(PAIR);   // second call — lastBoughtAt is now, too soon
        assert.equal(db.calls.updateLastBought.length, 1, 'should only write once');
    });

    test('_throttledDbUpdate() is a no-op for an untracked pair', async () => {
        await manager._throttledDbUpdate('0xunknown');
        assert.equal(db.calls.updateLastBought.length, 0);
    });
});
