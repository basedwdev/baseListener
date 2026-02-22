import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBuy, resolveAmounts, processSwapEvent } from '../src/core/swapProcessor.js';

/**
 * Real Uniswap V3 WETH/USDC 0.05% pool swap on Base chain.
 * Tx: 0x3dd1f721a100bf30e813194577dc7faa07e28f605d5c8b4cf7495795774d0cde
 *
 * token0 = WETH  (0x4200...0006, 18 decimals) — lower address → token0
 * token1 = USDC  (0x8335...2913,  6 decimals) — higher address → token1
 *
 * Swap: user sold 0.00774 WETH → received 15.263362 USDC
 *   amount0 = +7740000000000000   (WETH into pool)
 *   amount1 = -15263362           (USDC out of pool = USDC was bought)
 */

const POOL = '0xd0b53d9277642d899df5c87a3966a349a798f224';
const WETH = '0x4200000000000000000000000000000000000006';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const BUYER = '0xf0DA03E41B60F05ddF2F7C8007ECc3936C9a1b98';
const TX = '0x3dd1f721a100bf30e813194577dc7faa07e28f605d5c8b4cf7495795774d0cde';

const AMOUNT0 = 7740000000000000n;   // WETH (18 dec), positive = into pool
const AMOUNT1 = -15263362n;            // USDC (6 dec),  negative = out of pool (buy)
const SQRT_PRICE = 3519190486474440538307992n;

// USDC is the meme token (token1 = higher address), WETH is the base (token0)
// BigInt(USDC) > BigInt(WETH) → tokenOrdering = 1
const TOKEN_ORDERING = 1;

const mockProvider = {
    getTransactionReceipt: async () => ({ from: BUYER, logs: [] }),
};
const mockMemeContract = {
    balanceOf: async () => 500n * 10n ** 6n,   // 500 USDC
};

const baseCtx = {
    pairAddress: POOL,
    memeTokenAddress: USDC,
    baseTokenAddress: WETH,
    memeDecimals: 6,
    baseDecimals: 18,
    tokenOrdering: TOKEN_ORDERING,
    provider: mockProvider,
    memeContract: mockMemeContract,
};

// ─── Pure function tests ───────────────────────────────────────────────────

test('isBuy returns true for a negative token amount', () => {
    assert.equal(isBuy(AMOUNT1), true);   // AMOUNT1 = -15263362n
});

test('isBuy returns false for a positive token amount', () => {
    assert.equal(isBuy(AMOUNT0), false);  // AMOUNT0 = +7740000000000000n
});

test('resolveAmounts with ordering=1 maps amount1 to tokenAmount', () => {
    const { tokenAmount, baseAmount } = resolveAmounts(AMOUNT0, AMOUNT1, TOKEN_ORDERING);
    assert.equal(tokenAmount, AMOUNT1);
    assert.equal(baseAmount, AMOUNT0);
});

// ─── processSwapEvent tests ────────────────────────────────────────────────

test('processSwapEvent returns null for a sell (positive meme token amount)', async () => {
    const sellEvent = {
        args: { amount0: -AMOUNT0, amount1: -AMOUNT1, sqrtPriceX96: SQRT_PRICE },
        log: { transactionHash: TX },
    };
    // With ordering=1, tokenAmount = amount1 = +15263362 (positive = sell)
    const result = await processSwapEvent(sellEvent, baseCtx);
    assert.equal(result, null);
});

test('processSwapEvent returns enriched buy result for real swap data', async () => {
    const buyEvent = {
        args: { amount0: AMOUNT0, amount1: AMOUNT1, sqrtPriceX96: SQRT_PRICE },
        log: { transactionHash: TX },
    };
    const result = await processSwapEvent(buyEvent, baseCtx);

    assert.ok(result, 'expected a result object');
    assert.equal(result.chain, 'base');
    assert.equal(result.version, 'v3');
    assert.equal(result.txnHash, TX);
    assert.equal(result.pair, POOL);
    assert.equal(result.tokenContract, USDC);
    assert.equal(result.sender, BUYER);
    assert.ok(parseFloat(result.amountReceived) > 0);
    assert.ok(parseFloat(result.cost) > 0);
});

test('processSwapEvent returns null when amountReceived is below minAmountReceived', async () => {
    const buyEvent = {
        args: { amount0: AMOUNT0, amount1: AMOUNT1, sqrtPriceX96: SQRT_PRICE },
        log: { transactionHash: TX },
    };
    // Override minAmountReceived to an impossibly high value — the 15.26 USDC buy should be filtered out
    const result = await processSwapEvent(buyEvent, { ...baseCtx, minAmountReceived: 1_000_000 });
    assert.equal(result, null, 'expected null for buy below minAmountReceived');
});
