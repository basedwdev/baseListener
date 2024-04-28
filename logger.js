import  *  as  winston  from  'winston';
import  'winston-daily-rotate-file';


const infoTransport = new winston.transports.DailyRotateFile({
  level: 'info',
  dirname: './logs',
  filename: 'appinfo-%DATE%-info.log',
  frequency: '24h',
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '100m',
  maxFiles: '3d'
});

const errorTransport = new winston.transports.DailyRotateFile({
  level: 'error',
  dirname: './logs',
  filename: 'apperr-%DATE%-errors.log',
  frequency: '24h',
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '100m',
  maxFiles: '3d'
});

const dbInfoTransport = new winston.transports.DailyRotateFile({
  level: 'info',
  dirname: './logs',
  filename: 'dbinfo-%DATE%-info.log',
  frequency: '24h',
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '100m',
  maxFiles: '3d'
});

const dbErrorTransport = new winston.transports.DailyRotateFile({
  level: 'error',
  dirname: './logs',
  filename: 'dberror-%DATE%-errors.log',
  frequency: '24h',
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '100m',
  maxFiles: '3d'
});

export const dbInfoLogger = winston.createLogger({
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf((info) => {
      return JSON.stringify({
        timestamp: info.timestamp,
        message: info.message
      });
    })
  ),
  transports: [
    dbInfoTransport
  ]
});

export const dbErrorLogger = winston.createLogger({
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf((info) => {
      return JSON.stringify({
        timestamp: info.timestamp,
        message: info.message
      });
    })
  ),
  transports: [
    dbErrorTransport
  ]
});

export const infoLogger = winston.createLogger({
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf((info) => {
      return JSON.stringify({
        timestamp: info.timestamp,
        message: info.message
      });
    })
  ),
  transports: [
    infoTransport
  ]
});

export const errorLogger = winston.createLogger({
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf((info) => {
      return JSON.stringify({
        timestamp: info.timestamp,
        message: info.message
      });
    })
  ),
  transports: [
    errorTransport
  ]
});