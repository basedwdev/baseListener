import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '../src/db/db.js';

// Real addresses from Uniswap V3 WETH/USDC pool on Base
const PAIR = '0xd0b53d9277642d899df5c87a3966a349a798f224';
const WETH = '0x4200000000000000000000000000000000000006';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

describe('Database', () => {
    let db;

    beforeEach(() => {
        db = new Database();
        db.createTable();
    });

    afterEach(() => {
        db.close();
    });

    test('upsert stores a row and getAll retrieves it', () => {
        db.upsert(PAIR, USDC, WETH, 6, 18);
        const rows = db.getAll();
        assert.equal(rows.length, 1);
        assert.equal(rows[0].pair, PAIR);
        assert.equal(rows[0].memeTokenAddress, USDC);
        assert.equal(rows[0].baseTokenAddress, WETH);
        assert.equal(rows[0].memeTokenDecimals, 6);
        assert.equal(rows[0].baseTokenDecimals, 18);
    });

    test('delete removes the row', () => {
        db.upsert(PAIR, USDC, WETH, 6, 18);
        db.delete(PAIR);
        assert.equal(db.getAll().length, 0);
    });

    test('updateLastBought changes lastBoughtAt', () => {
        db.upsert(PAIR, USDC, WETH, 6, 18);
        const before = db.getAll()[0].lastBoughtAt;
        db.updateLastBought(PAIR);
        const after = db.getAll()[0].lastBoughtAt;
        assert.ok(after >= before);
    });

    test('getStale returns pairs older than the cutoff', () => {
        db.upsert(PAIR, USDC, WETH, 6, 18);
        // cutoff = now + 1ms ensures lastBoughtAt (set at upsert) is before the cutoff
        const stale = db.getStale(Date.now() + 1);
        assert.equal(stale.length, 1);
        assert.equal(stale[0].pair, PAIR);
    });

    test('getStale does not return a pair updated after the cutoff', () => {
        db.upsert(PAIR, USDC, WETH, 6, 18);
        db.updateLastBought(PAIR);                  // stamps lastBoughtAt = now
        const stale = db.getStale(Date.now() - 1); // cutoff is 1ms in the past
        assert.equal(stale.length, 0);
    });
});
