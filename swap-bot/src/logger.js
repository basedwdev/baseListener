import winston from 'winston';
import 'winston-daily-rotate-file';
import { config } from './config/config.js';

const { combine, timestamp, printf, colorize, errors } = winston.format;

// Structured JSON format for log files
const fileFormat = combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    printf(({ timestamp, level, message, component, stack }) => JSON.stringify({
        timestamp,
        level,
        component: component ?? 'app',
        message: stack ?? message,
    }))
);

// Human-readable colorized format for console
const consoleFormat = combine(
    colorize(),
    timestamp({ format: 'HH:mm:ss' }),
    printf(({ timestamp, level, message, component }) =>
        `${timestamp} [${component ?? 'app'}] ${level}: ${message}`
    )
);

const fileTransport = new winston.transports.DailyRotateFile({
    dirname: config.log.dir,
    filename: 'swap-bot-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    frequency: '24h',
    zippedArchive: true,
    maxSize: '100m',
    maxFiles: '7d',
    format: fileFormat,
});

const errorFileTransport = new winston.transports.DailyRotateFile({
    level: 'error',
    dirname: config.log.dir,
    filename: 'swap-bot-%DATE%.error.log',
    datePattern: 'YYYY-MM-DD',
    frequency: '24h',
    zippedArchive: true,
    maxSize: '100m',
    maxFiles: '7d',
    format: fileFormat,
});

export const logger = winston.createLogger({
    level: config.log.level,
    transports: [
        new winston.transports.Console({ format: consoleFormat }),
        fileTransport,
        errorFileTransport,
    ],
});
