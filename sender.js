import { errorLogger } from "./logger.js";

const buyQueueExchange = 'LatestBuysExchange';
const InfoBotExchange = "InfoBotExchange";

export async function sendBuyMessageMQ(channel, results) {
  try {
    channel.publish(buyQueueExchange, 'v3Base', Buffer.from(results));
    return true;
  } catch (err) {
    let errMsg = `[BASEV3] tried to send  BUY message but did not work for ${results} but failed because ${err}`;
    errorLogger.error(errMsg);
    return false;
  }
};

export async function sendInfoMQ(channel, results) {
  try {
    let msg = { message: `[BASEV3 ${results}]` };
    msg = JSON.stringify(msg);
    channel.publish(InfoBotExchange, 'info', Buffer.from(msg));
    return true;
  } catch (err) {
    let errMsg = `[BASEV3] tried to send info message but did not work for ${results} but failed because ${err}`;
    errorLogger.error(errMsg);
    return false;
  }
};


export async function sendErrorMessageMQ(channel, results) {
  try {
    let msg = { message: `[BASEV3 ${results}]` };
    msg = JSON.stringify(msg);
    channel.publish(InfoBotExchange, 'listener', Buffer.from(msg));
    return true;
  } catch (err) {
    let errMsg = `[BASEV3] tried to send  BUY message but did not work for ${results} but failed because ${err}`;
    errorLogger.error(errMsg);
    return false;
  }
};