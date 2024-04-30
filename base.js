import { ethers } from "ethers";
import { readFileSync } from "fs";
import amqp from 'amqplib';
import { BigNumber } from "bignumber.js";
import { sendBuyMessageMQ, sendErrorMessageMQ, sendInfoMQ } from "./sender.js";
import { infoLogger, errorLogger } from './logger.js';
import { addRecord, createTable, setMqConn, updateLastBoughtTime, createDbConnection, retrieveAllItems, deleteItem } from "./databaseHelper.js";

const UNISWAP_ROUTER_ABI_V3 = readFileSync("./uniV3Abi.json").toString();
const USER_BALANCE_ABI =  ['function balanceOf(address) view returns (uint256)'];

const THREE_HOURS_MILI = 10800000;

const runningPairs = new Map(); // pairs of contracts being listened to
const contractOrdering = new Map(); // ordering of tokens such that we know which token is which (maybe remove)
const decimalValues = new Map();
const lastTimeBought = new Map();

const listOfProviders = [
    "https://base.llamarpc.com",
    "https://base-rpc.publicnode.com",
    "https://mainnet.base.org"
];

//const newTokensUrl = "https://sqs.us-west-2.amazonaws.com/482044134407/TokenQueueBASEV3";
const transferHash = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const opt = {
    credentials: amqp.credentials.plain('listenerBot', 'buttplugsinmygaybutt'),
    cert: readFileSync('./certs/client_certificate.pem'),
    key: readFileSync('./certs/client_key.pem'),
    ca: [readFileSync('./certs/ca_certificate.pem')],
    passphrase: 'ilovebigbonersandimgay',
    rejectUnauthorized: false
};

const buyQueueExchange = 'LatestBuysExchange';
const infoBotExchange = "InfoBotExchange";
const addTokensQueue = "BuyBotTokenActionQueueV3Base";


const getAmountTransfered = function (tnxData, contractPairAddress, defaultAmount) {
    const logs = tnxData.logs; // array of logs
    let highestAmountBought = defaultAmount;
    for (let i = 0; i < logs.length; i++) {
        const currentLog = logs[i]; // object
        // does tnx hash == transfer
        if (currentLog.topics[0].toString() == transferHash) {
            const sender = ethers.utils.defaultAbiCoder.decode(
                ['address'], currentLog.topics[1]
            );

            // we want to see if the sender is the pair
            if (sender[0].toLowerCase() === contractPairAddress.toLowerCase()) {
                // get amount value
                const amountBought = ethers.utils.defaultAbiCoder.decode(
                    ['uint256'], currentLog.data
                );
                if (highestAmountBought < amountBought.toString()) {
                    highestAmountBought = amountBought.toString();
                }

            }
        }
    }
    return highestAmountBought;
}

const getValidProvider = async function (listOfProviders) {
    let tempProvider;
    for (let provider of listOfProviders) {
        try {
            tempProvider = new ethers.providers.JsonRpcProvider(provider);
            let isValid = await tempProvider.getBlockNumber();
            if (typeof (isValid) === 'number') {
                return tempProvider;
            }
        } catch (err) {
            errorLogger.error(`${provider} was invalid`);
            //await sendEmailMessage(`[BASEV3] unable to get provider because ${err}`);
            await sendErrorMessageMQ(channelToMq, `${provider} was invalid ${err}`);
            throw new Error(err);
        }
    }
}

const createNewContract = function (address, abi) {
    try {
        let contract = new ethers.Contract(address, abi, baseProvider);
        return contract;
    } catch (err) {
        let errMsg = `[BASEV3] Could not create contract for address ${address} because ${err}`;
        errorLogger.error(errMsg);
        throw new Error(errMsg);
    }
}

// make sure you pass in negative balance number
async function getUserBalance(shitTokenAddress, decimals, userAddress, amountBought) {
    try {
        let balanceContract = createNewContract(shitTokenAddress, USER_BALANCE_ABI);
        let userBalance = await balanceContract.balanceOf(userAddress);
        userBalance = new BigNumber(userBalance.toString()).times(10 ** decimals).toString();
        if (userBalance == "0") {
            userBalance = new BigNumber(amountBought.toString()).times(10 ** decimals).toString();
        }
        return userBalance;
    } catch (error) {
        let errMsg = `could not get userBalance for ${userAddress} and token ${shitTokenAddress} with ${amountBought} and error ${error}`;
        errorLogger.error(errMsg);
        sendErrorMessageMQ(channelToMq, errMsg);
        return -1;
    }
}



function getPrice(sqrtPriceX96, token0Addr, token1Addr) {
    let decimal0 = decimalValues.get(token0Addr);
    let decimal1 = decimalValues.get(token1Addr);

    try {
        let sqprice = new BigNumber(sqrtPriceX96.toString());
        let buyOneOfToken0 = ((sqprice.dividedBy(2 ** 96) ** 2)) / (10 ** decimal1 / 10 ** decimal0);
        if (contractOrdering.get(token0Addr) == 0) {
            buyOneOfToken0 = buyOneOfToken0.toFixed(decimal1);
            return buyOneOfToken0;
        } else {
            let buyOneOfToken1 = ((1 / buyOneOfToken0));
            buyOneOfToken1 = buyOneOfToken1.toFixed(decimal0);
            return buyOneOfToken1;
        }
    } catch (err) {
        errorLogger.error(`could not get price because ${err}`);
        return 'NaN';
    }
}

function checkIfPairIsValid(pair) {
    return pair != undefined && pair != ""
}

function returnWhichPairs(amount0, amount1, shitTokenAddress) {
    let tokenAmount;
    let ethAmount;
    if (contractOrdering.get(shitTokenAddress) == 0) {
        tokenAmount = amount0;
        ethAmount = amount1;
    } else {
        tokenAmount = amount1;
        ethAmount = amount0;
    }
    return {
        tokenAmount, ethAmount
    };
}

async function setTokenOrdering(shitTokenAddress, regTokenAddress) {
    try {
        const isToken0 = BigInt(shitTokenAddress) < BigInt(regTokenAddress);

        if (isToken0) {
            console.log('yo')
            contractOrdering.set(shitTokenAddress, 0);
        } else {
            console.log('nigga')
            contractOrdering.set(shitTokenAddress, 1);
        }
    } catch (err) {
        // default to 0 is token
        errorLogger.error(`error with setting token ordering of ${err}`);
        contractOrdering.set(shitTokenAddress, 0);
    }
}

function setDecimalValues(tokenAddress, tokenDecimals) {
    if (!decimalValues.has(tokenAddress)) {
        decimalValues.set(tokenAddress, tokenDecimals);
    }
}

/**
 * 
 * take current pair and create filter
 * on swap evets, obtain the events, and return which address should be which amount (i.e. which is token0 and in/out)
 * if the buy amounts aren't zero, get the tnx hash, and determine the real amounts sent via pair being the sender
 */

let timeToLog = 1;
let listenToSwaps = async (pairContract, pairAddress, shitTokenAddress, regTokenAddress) => {
    const currentPair = pairAddress;
    let myfilterV3 = {
        address: currentPair,
        topics: [
            "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67"
        ]
    }
    try {
        await pairContract.on(myfilterV3, async (...parameters) => {
            let event = parameters[parameters.length - 1];
            let amountsSent = returnWhichPairs(event.args["amount0"].toString(), event.args["amount1"].toString(), shitTokenAddress);
            let totalTokensPurchased = amountsSent.tokenAmount;
            let ethAmount = amountsSent.ethAmount;
            if (totalTokensPurchased < 0) {
                totalTokensPurchased *= -1;
                let x96 = event.args['sqrtPriceX96'];
                const priceOfToken = getPrice(x96, shitTokenAddress, regTokenAddress);
                const txnHash = event.transactionHash;
                let tnxInfo = '';
                let sender = '';
                let tokenAmount = totalTokensPurchased;
                try {
                    tnxInfo = await baseProvider.getTransactionReceipt(txnHash);
                    sender = tnxInfo['from'];
                    tokenAmount = getAmountTransfered(tnxInfo, currentPair, tokenAmount);
                } catch (err) {
                    errorLogger.error(`could not get transaction info because ${err}`);
                }

                let sTokenDecimals = decimalValues.get(shitTokenAddress) * -1;
                let ethTokenDecimals = decimalValues.get(regTokenAddress) * -1;
                let userBalance = await getUserBalance(shitTokenAddress, sTokenDecimals, sender, tokenAmount);
                totalTokensPurchased = new BigNumber(totalTokensPurchased).times(10 ** sTokenDecimals).toFixed(3)
                tokenAmount = new BigNumber(tokenAmount).times(10 ** sTokenDecimals).toFixed(3);
                ethAmount = new BigNumber(ethAmount).times(10 ** ethTokenDecimals).toFixed(4);
                let results = {
                    "totalTokensPurchased": totalTokensPurchased.toString(),
                    "amountReceived": tokenAmount.toString(),
                    "cost": ethAmount.toString(),
                    "userBalance" : userBalance,
                    "pair": currentPair,
                    "tokenContract": shitTokenAddress,
                    "sender": sender,
                    "tnx": txnHash,
                    "tokenPrice": `${priceOfToken}`,
                    'version': 'v3',
                    'chain': 'base'
                }

                let jsonResults = JSON.stringify(results);
                try {
                    await sendBuyMessageMQ(channelToMq, jsonResults);
                } catch (error) {
                    errorLogger.error(`couldnt send buy message because ${error}`);
                    await sendBuyMessageMQ(channelToMq, jsonResults);
                }

                let curTime = Date.now();
                if (!lastTimeBought.has(pairAddress)) {
                    lastTimeBought.set(pairAddress, curTime);
                    await updateLastBoughtTime(pairAddress)
                        .catch(async err => {
                            let errMsg = `db error of ${err}`;
                            await sendErrorMessageMQ(channelToMq, errMsg)
                            errorLogger.error(errMsg);
                        })
                } else {
                    if (curTime - lastTimeBought.get(pairAddress) >= THREE_HOURS_MILI) {
                        lastTimeBought.set(pairAddress, curTime);
                        await updateLastBoughtTime(pairAddress)
                            .catch(async err => {
                                let errMsg = `db error of ${err}`;
                                await sendErrorMessageMQ(channelToMq, errMsg)
                                errorLogger.error(errMsg);
                            })
                    }
                }
                if (timeToLog % 20 == 0) {
                    infoLogger.info(results);
                }
                timeToLog++;
            }
        });
    } catch (err) {
        throw new Error(err);
    }
};

/*
steps are 
- listen to SQS message for each version
- parse the body to obtain Pair, contractAddress, action
- if pair not already created
- Create new Contract (ethers contract)
- determing token ordering, add to currentRunningPairs
- begin listening to swaps

if token is for deletion

- check if exists, get the contract, remove listener, delete from running pairs and delete ordering

*/
async function addNewTokenToListening(pair, shitTokenAddress, regTokenAddress, shitTokenDecimals, regularTokenDecimals, action) {
    try {
        infoLogger.info(`received new message with pair address ${pair}`);
        if (action == "create") {
            if (checkIfPairIsValid(pair) && !runningPairs.has(pair)) {
                try {
                    let pairContract = createNewContract(pair, UNISWAP_ROUTER_ABI_V3);
                    setTokenOrdering(shitTokenAddress, regTokenAddress);
                    runningPairs.set(pair, pairContract); // add token to list of pairs that are being tracked
                    setDecimalValues(regTokenAddress, regularTokenDecimals);
                    setDecimalValues(shitTokenAddress, shitTokenDecimals);
                    listenToSwaps(pairContract, pair, shitTokenAddress, regTokenAddress);
                    addRecord(pair, shitTokenAddress, regTokenAddress, shitTokenDecimals, regularTokenDecimals)
                        .catch(async err => {
                            let errMsg = `db error of ${err}`;
                            await sendErrorMessageMQ(channelToMq, errMsg)
                            errorLogger.error(errMsg);
                        })
                } catch (error) {
                    runningPairs.delete(pair);
                    contractOrdering.delete(shitTokenAddress);
                    decimalValues.delete(shitTokenAddress);
                }
            }
        } else if (action == "delete") {
            if (checkIfPairIsValid(pair) && runningPairs.has(pair)) {
                let contract = runningPairs.get(pair);
                contract.removeAllListeners();
                runningPairs.delete(pair);
                contractOrdering.delete(shitTokenAddress);
                decimalValues.delete(shitTokenAddress);
                lastTimeBought.delete(pair);
                await deleteItem(pair)
                    .catch(async err => {
                        let errMsg = `db error of ${err}`;
                        await sendErrorMessageMQ(channelToMq, errMsg)
                        errorLogger.error(errMsg);
                    });
            }
        }
    } catch (err) {
        let errMsg = `There was an issue with the requested contract of ${err}`;
        errorLogger.error(errMsg);
        await sendErrorMessageMQ(channelToMq, errMsg);
        //await sendEmailMessage(`[BASEV3] There was an issue with the requested contract of ${err}`);
    }
}

let baseProvider = await getValidProvider(listOfProviders);

//await addNewTokenToListening("0x865F9B6D5b2e3adBB8C4D0885aF0ABe587cC5d28", "0xbab184cdd64c95856074d2ec13ebacdd6e383430", "0x4200000000000000000000000000000000000006", "18", "18", "create")

let channelToMq;
let shouldRestore = true;

async function beginListening() {
    try {
        //24.199.72.56
        let connectionToMq = await amqp.connect('amqps://24.199.72.56:6942/krishna', opt);

        console.log('Connected to MQ successfully');
        connectionToMq.on("error", (err) => {
            if (err) {
                errorLogger.error(`mq connection was closed due to ${err}`);
                setTimeout(() => {
                    beginListening();
                }, 10000);
            }
        });
        connectionToMq.on("close", () => {
            errorLogger.error(`mq connection was closed due the gays`);
            setTimeout(() => {
                beginListening();
            }, 10000);
        });
        infoLogger.info(`successfully connected to mq`);

        let channel = await connectionToMq.createChannel();

        channel.on('error', async (err) => {
            errorLogger.error(`channel connection was closed due to ${err}`);
            channel = await connectionToMq.createChannel();
        });

        channel.on('close', () => {
            errorLogger.error(`channel connection was closed`);
        });

        channel.assertExchange(buyQueueExchange, 'direct', { durable: true });
        channel.assertExchange(infoBotExchange, 'direct', { durable: true });

        channelToMq = channel;

        setMqConn(channelToMq);
        if (shouldRestore) {
            restoreExistingTrendingRecords();
        }

        console.log('beginning to listen for messages in rabbitMq');
        try {
            await channel.consume(addTokensQueue, async (msg) => {
                let importantBody = JSON.parse(msg.content);
                if (importantBody['action'] === 'delete') {
                    await addNewTokenToListening(
                        importantBody['pair'],
                        importantBody['shitTokenAddress'],
                        '',
                        '',
                        '',
                        importantBody['action']
                    );
                    let msg = `deleted token from listening with pair ${importantBody['pair']}`;
                    await sendInfoMQ(channelToMq, msg);
                } else {
                    await addNewTokenToListening(
                        importantBody['pair'],
                        importantBody['shitTokenAddress'],
                        importantBody['regTokenAddress'],
                        importantBody['shitTokenDecimals'],
                        importantBody['regTokenDecimals'],
                        importantBody['action']
                    );
                    let msg = `added token to listening with pair ${importantBody['pair']}`;
                    await sendInfoMQ(channelToMq, msg);
                }
                channel.ack(msg);
            });
        } catch (error) {
            let errMsg = `could not beginListening because ${error}`;
            errorLogger.error(errMsg);
            await sendErrorMessageMQ(channelToMq, errMsg);
        }

    } catch (error) {
        let errMsg = `could not establish connections because ${error}`;
        errorLogger.error(errMsg);
        setTimeout(() => {
            console.log('retrying connection');
            beginListening();
        }, 10000);
    }
}

async function restoreExistingTrendingRecords() {
    await retrieveAllItems().then(async (rows) => {
        for (let row of rows) {
            infoLogger.info(`restoring listening for the following ${JSON.stringify(row)}`);
            await addNewTokenToListening(
                row.pair,
                row.shitTokenAddress,
                row.regTokenAddress,
                row.shitTokenDecimals,
                row.regTokenDecimals,
                'create'
            );
        }
    })
        .catch(async err => {
            let errMsg = `db error of ${err}`;
            await sendErrorMessageMQ(channelToMq, errMsg)
            errorLogger.error(errMsg);
        })
    shouldRestore = false;
}


createDbConnection();
await createTable();
await beginListening();

