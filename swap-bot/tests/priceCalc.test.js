import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sqrtX96ToPrice, getHighestTransferAmount } from '../src/blockchain/priceCalc.js';

/**
 * Real values from Uniswap V3 WETH/USDC 0.05% pool on Base.
 * Tx: 0x3dd1f721a100bf30e813194577dc7faa07e28f605d5c8b4cf7495795774d0cde
 *
 * WETH = token0 (0x4200...0006, 18 dec), USDC = token1 (0x8335...2913, 6 dec)
 * sqrtPriceX96 implies WETH ≈ $1,973 → 1 USDC ≈ 0.000507 WETH
 */

const PAIR = '0xd0b53d9277642d899df5c87a3966a349a798f224';
const SQRT_PRICE = 3519190486474440538307992n;
const USDC_AMOUNT = 15263362n;   // 15.263362 USDC (6 dec) — real amount from the swap

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// ERC-20 Transfer log where the pool is the `from` (tokens leaving the pool = buy)
function makeTransferLog(fromAddress, amount) {
    return {
        topics: [
            TRANSFER_TOPIC,
            '0x000000000000000000000000' + fromAddress.slice(2).toLowerCase(),
        ],
        data: '0x' + amount.toString(16).padStart(64, '0'),
    };
}

// ─── sqrtX96ToPrice ────────────────────────────────────────────────────────

test('sqrtX96ToPrice returns WETH cost per USDC in expected range', () => {
    // USDC is token1 (isToken0=false), memeDecimals=6, baseDecimals=18
    // Expected: ~0.000507 WETH per USDC (i.e. WETH ≈ $1,973)
    const price = parseFloat(sqrtX96ToPrice(SQRT_PRICE, -6, -18, false));
    assert.ok(price > 0.0004 && price < 0.0007,
        `expected ~0.000507, got ${price}`);
});

test('sqrtX96ToPrice returns NaN string on bad input', () => {
    assert.equal(sqrtX96ToPrice('bad', 6, 18, true), 'NaN');
});

// ─── getHighestTransferAmount ──────────────────────────────────────────────

test('getHighestTransferAmount returns amount from matching log', () => {
    const log = makeTransferLog(PAIR, USDC_AMOUNT);
    const result = getHighestTransferAmount([log], PAIR, 0n);
    assert.equal(result, USDC_AMOUNT);
});

test('getHighestTransferAmount returns fallback when no log matches', () => {
    const fallback = 999n;
    const unrelatedLog = makeTransferLog('0x000000000000000000000000000000000000dead', 9999n);
    const result = getHighestTransferAmount([unrelatedLog], PAIR, fallback);
    assert.equal(result, fallback);
});
