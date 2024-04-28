import sqlite3 from 'sqlite3';
import { readFileSync } from "fs";
import amqp from 'amqplib';
import { dbInfoLogger, dbErrorLogger } from './logger.js';

const dbName = "AllTrackedGroups.db";
const THREE_DAYS_AGO_MILI = 259200000;
const THREE_HOURS_MILI = 10800000;


let errorsExchange = "InfoBotExchange";

// const opt = {
//     credentials: amqp.credentials.plain('dbUserMcSexy', 'thisismysupersexypasswordyeah'),
//     cert: readFileSync('./certs/client_certificate.pem'),
//     key: readFileSync('./certs/client_key.pem'),
//     ca: [readFileSync('./certs/ca_certificate.pem')],
//     passphrase: 'ilovebigbonersandimgay',
//     rejectUnauthorized: false
// };

// let channelToMq;

// async function createMQConn() {
//     try {
//         //24.199.72.56
//         let connectionToMq = await amqp.connect('amqps://localhost:6942/krishna', opt);

//         console.log('Connected to MQ successfully');
//         connectionToMq.on("error", (err) => {
//             if (err) {
//                 dbErrorLogger.error(`mq connection was closed due to ${err}`);
//                 setTimeout(() => {
//                     createMQConn();
//                 }, 10000);
//             }
//         });
//         connectionToMq.on("close", () => {
//             dbErrorLogger.error(`mq connection was closed due the gays`);
//             setTimeout(() => {
//                 createMQConn();
//             }, 10000);
//         });
//         dbInfoLogger.info(`successfully connected to mq`);

//         let channel = await connectionToMq.createChannel();

//         channel.on('error', async (err) => {
//             dbErrorLogger.error(`channel connection was closed due to ${err}`);
//             channel = await connectionToMq.createChannel();
//         });

//         channel.on('close', () => {
//             dbErrorLogger.error(`channel connection was closed`);
//         });

//         // token actions
//         channel.assertExchange(errorsExchange, 'direct', { durable: true });

//         channelToMq = channel;

//     } catch (error) {
//         let errMsg = `could not establish connections because ${error}`;
//         dbErrorLogger.error(errMsg);
//         setTimeout(() => {
//             console.log('retrying connection');
//             createMQConn();
//         }, 10000);
//     }
// }

let channelToMq;

export function setMqConn(conn){
    channelToMq = conn;
    sendCheckTokensToDeleteMQ();
}

let thisDbConnection;

export function createDbConnection() {
    const db = new sqlite3.Database(dbName, (error) => {
        if (error) {
            throw err;
        }
    });
    dbInfoLogger.info("Connection with SQLite has been established");
    thisDbConnection = db;
}

export async function createTable() {
    return new Promise((resolve, reject) => {
        thisDbConnection.run(`
        CREATE TABLE IF NOT EXISTS tokensDB
        (
          pair VARCHAR(50) PRIMARY KEY,
          shitTokenAddress VARCHAR(50) NOT NULL,
          regTokenAddress VARCHAR(50) NOT NULL,
          shitTokenDecimals VARCHAR(3) NOT NULL,
          regTokenDecimals VARCHAR(3) NOT NULL,
          lastBuyTime INTEGER NOT NULL
        );`, (err) => {
            if (err) {
                dbErrorLogger.error(`could not create table because ${err}`);
                reject(false);
            } else {
                dbInfoLogger.info('created table successfully');
                resolve(true);
            }
        });
    });
}

export async function addRecord(pair, shitTokenAddress, regTokenAddress, shitTokenDecimals, regTokenDecimals) {
    let ltb = Date.now();
    return new Promise((resolve, reject) => {
        thisDbConnection.run(`INSERT or REPLACE into tokensDB(pair, shitTokenAddress, regTokenAddress, shitTokenDecimals, regTokenDecimals, lastBuyTime) VALUES (?,?,?,?,?,?)`,
            pair, shitTokenAddress, regTokenAddress, shitTokenDecimals, regTokenDecimals, ltb,
            (err) => {
                if (!err) {
                    dbInfoLogger.info(`added token for tracking ${pair}, ${shitTokenAddress}, ${regTokenAddress}, ${shitTokenDecimals}, ${regTokenDecimals}, ${ltb}`);
                    resolve(true);
                } else {
                    dbErrorLogger.error(`could not add new record ${pair}, ${shitTokenAddress}, ${regTokenAddress}, ${shitTokenDecimals}, ${regTokenDecimals}, ${ltb} because ${err}`);
                    reject(false);
                }
            }
        );
    });
}

export async function updateLastBoughtTime(pair) {
    return new Promise((resolve, reject) => {
        let ltb = Date.now();
        thisDbConnection.run('UPDATE tokensDB SET lastBuyTime=(?) WHERE pair=(?)', ltb, pair, (err) => {
            if (!err) {
                dbInfoLogger.info(`updated LTB for ${pair}`);
                resolve(true);
            } else {
                dbErrorLogger.error(`could not update lastTimeBought for ${pair} because ${err}`);
                reject(err)
            }
        })
    });
}

export async function findItem(pair) {
    return new Promise((resolve, reject) => {
        thisDbConnection.get(`SELECT * FROM tokensDB WHERE pair=(?)`, pair, (err, row) => {
            if (!err) {
                resolve(row);
            } else {
                dbErrorLogger.error(`could not findItem ${pair} because ${err}`);
                reject(err);
            }
        });
    });
}

// use this to restore
export async function retrieveAllItems() {
    return new Promise((resolve, reject) => {
        thisDbConnection.all(`SELECT * FROM tokensDB`, (err, rows) => {
            if (!err) {
                resolve(rows);
            } else {
                dbErrorLogger.error(`could not retrieveAllItems because ${err}`);
                reject(err);
            }
        })
    });
}

// use this to sent to bot
export function retrieveAllItemsByLTB() {
    return new Promise((resolve, reject) => {
        let ltb = Date.now() - THREE_DAYS_AGO_MILI;
        thisDbConnection.all(`SELECT * FROM tokensDB where lastBuyTime<=(?)`, ltb, (err, rows) => {
            if (!err) {
                resolve(rows);
            } else {
                dbErrorLogger.error(`could not retrieveAllItems because ${err}`);
                reject(err);
            }
        })
    });
}

// use this to delete a token will be paired with rabbitmq maybe
export function deleteItem(pair) {
    return new Promise((resolve, reject) => {
        thisDbConnection.run(`DELETE FROM tokensDB WHERE pair=(?)`, pair, (err) => {
            if (!err) {
                dbInfoLogger.info(`removed item ${pair} from db`);
                resolve(true);
            } else {
                dbErrorLogger.error(`could not remove ${pair} because ${err}`);
                reject(err);
            }
        })
    });
}

function sendCheckTokensToDeleteMQ() {
    try {
        setInterval(async () => {
            retrieveAllItemsByLTB().then(rows => {
                let results = [];
                for (let row of rows) {
                    results.push(row.pair);
                }
                let msg = {
                    message: `ETHV2 database says to check the following for deletion`,
                    pairs: results
                }
                msg = JSON.stringify(msg);
                channelToMq.publish(errorsExchange, 'listener', Buffer.from(msg));
            })
        }, THREE_HOURS_MILI * 2);
        return true;
    } catch (err) {
        let errMsg = `[ETHV2] err`;
        dbErrorLogger.error(errMsg);
        return false;
    }
};

export function closeConnection(db) {
    thisDbConnection.close();
}

// createDbConnection()
// await createMQConn();
// createTable()
//     .then(async res => {
//         //await sendCheckTokensToDeleteMQ();
//         await addRecord('0x0d4a11d5eeaac28ec3f61d100daf4d40471f1852', '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', '0xdAC17F958D2ee523a2206206994597C13D831ec7', 18, 6);
//         await findItem('0x0d4a11d5eeaac28ec3f61d100daf4d40471f1852').then(r => {
//             console.log('found item!!!', r);
//         });
//     });
//         await addRecord('124', '0x5', '0x6', 18, 18, 'eth', 'v3');
//         await findItem('123').then(r => {
//             console.log('found item!!!', r);
//         });
//         await updateLastBoughtTime('123', 1);
//         await updateLastBoughtTime('124', 2);
//         setTimeout(async() => {
//             await deleteItem('123');
//         }, 15000)

//     });