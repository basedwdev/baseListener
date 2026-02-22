import BetterSqlite3 from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { config } from '../config/config.js';
import { logger } from '../logger.js';

export class Database {
    /**
     * Opens (or creates) the SQLite database file.
     * The directory is created automatically if it doesn't exist.
     */
    constructor() {
        mkdirSync(dirname(config.db.path), { recursive: true });
        this.db = new BetterSqlite3(config.db.path);
        // WAL mode: faster writes, non-blocking reads
        this.db.pragma('journal_mode = WAL');
        logger.info('SQLite connection established', { component: 'db' });
    }

    /**
     * Creates the tokensDB table if it doesn't already exist.
     */
    createTable() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS tokensDB (
                pair               TEXT PRIMARY KEY,
                memeTokenAddress   TEXT NOT NULL,
                baseTokenAddress   TEXT NOT NULL,
                memeTokenDecimals  INTEGER NOT NULL,
                baseTokenDecimals  INTEGER NOT NULL,
                lastBoughtAt       INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_lastBoughtAt ON tokensDB(lastBoughtAt);
        `);
        logger.info('tokensDB table ready', { component: 'db' });
    }

    /**
     * Inserts or replaces a tracked token pair.
     * @param {string} pair
     * @param {string} memeTokenAddress
     * @param {string} baseTokenAddress
     * @param {number} memeTokenDecimals
     * @param {number} baseTokenDecimals
     */
    upsert(pair, memeTokenAddress, baseTokenAddress, memeTokenDecimals, baseTokenDecimals) {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO tokensDB
                (pair, memeTokenAddress, baseTokenAddress, memeTokenDecimals, baseTokenDecimals, lastBoughtAt)
            VALUES
                (?, ?, ?, ?, ?, ?)
        `);
        stmt.run(pair, memeTokenAddress, baseTokenAddress, memeTokenDecimals, baseTokenDecimals, Date.now());
        logger.info(`upserted pair ${pair}`, { component: 'db' });
    }

    /**
     * Removes a tracked token pair.
     * @param {string} pair
     */
    delete(pair) {
        this.db.prepare('DELETE FROM tokensDB WHERE pair = ?').run(pair);
        logger.info(`deleted pair ${pair}`, { component: 'db' });
    }

    /**
     * Returns all tracked pairs.
     * @returns {Array<object>}
     */
    getAll() {
        return this.db.prepare('SELECT * FROM tokensDB').all();
    }

    /**
     * Updates the lastBoughtAt timestamp for a pair (throttled by caller).
     * @param {string} pair
     */
    updateLastBought(pair) {
        this.db.prepare('UPDATE tokensDB SET lastBoughtAt = ? WHERE pair = ?').run(Date.now(), pair);
        logger.info(`updated lastBoughtAt for ${pair}`, { component: 'db' });
    }

    /**
     * Returns pairs whose lastBoughtAt is older than the given cutoff.
     * @param {number} cutoffMs  e.g. Date.now() - stalePairThresholdMs
     * @returns {Array<object>}
     */
    getStale(cutoffMs) {
        return this.db.prepare('SELECT * FROM tokensDB WHERE lastBoughtAt <= ?').all(cutoffMs);
    }

    /**
     * Closes the database connection.
     */
    close() {
        this.db.close();
        logger.info('SQLite connection closed', { component: 'db' });
    }
}
