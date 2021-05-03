const functions = require("firebase-functions");
const { RestClient } = require("bybit-api");
const cors = require("cors")({ origin: true });
const admin = require('firebase-admin');
//
// TODO:
// 1. Remove everything but scalper function and its dependencies, no database access and so on...
admin.initializeApp({
	credential: admin.credential.applicationDefault(),
});
/*
exports.CronUpdateLiveEventsWithNotification = functions.pubsub.schedule('every 1 minutes')
	.timeZone('Europe/Madrid')
	.onRun(async (context) =>
	{
		UpdateLiveEventsWithNotification(true);
		return null;
	});
*/
//
// TODO: this might be better in the webhook so it's totally dynamic? I feel it's better here and more safe...
//
const appVersion = "1.0.4.1";
const API_KEY_BOT_01 = "short-numbers";
const PRIVATE_KEY_BOT_01 = "long-numbers";
const API_KEY_BOT_02 = "short-number";
const PRIVATE_KEY_BOT_02 = "long-numbers";

function GetClient(signalDetails)
{
	const API_KEY = signalDetails.bot === 1 ? API_KEY_BOT_01 : API_KEY_BOT_02;
	const PRIVATE_KEY = signalDetails.bot === 1 ? PRIVATE_KEY_BOT_01 : PRIVATE_KEY_BOT_02;
	const client = new RestClient(API_KEY, PRIVATE_KEY);

	return client;
}

let cancelSameSideOrders = false;
let closePreviousPosition = true;
const sellOrderDisabled = true;

const BTC_orderIntervalLeader = "5m";
const BTC_timePivot = "1m";
const BTC_limitEntryPricePercentage = 0.05;

const ETH_orderIntervalLeader = "1h";
const ETH_timePivot = "1h";

const BOT1_LEVERAGE = 1;
const BOT1_CONTRACTS = 1000;

const BOT2_LEVERAGE = 5;
const BOT2_CONTRACTS = 1000;

const STOP_LOSS_PERCENTAGE = 0.5;
const TAKE_PROFIT_PERCENTAGE_BIG = 0.50;
const TAKE_PROFIT_PERCENTAGE_SMALL = 0.25;
const TAKE_PROFIT_FOR_SHORT_PERCENTAGE = 0.05;

function GetTimePivot(stock)
{
	if (stock === "BTCUSD")
	{
		return BTC_timePivot;
	}
	else if (stock === "ETHUSD")
	{
		return ETH_timePivot;
	}
	else
	{
		return "0m";
	}
}

function GetIntervalLeader(stock)
{
	if (stock === "BTCUSD")
	{
		return BTC_orderIntervalLeader;
	}
	else if (stock === "ETHUSD")
	{
		return ETH_orderIntervalLeader;
	}
	else
	{
		return "0m";
	}
}

async function UpdateCurrentTrade(data, signalDetails)
{
	const botSlot = `BOT-${signalDetails.bot}-${signalDetails.stock}`;
	console.log(`${appVersion} UpdateCurrentTrade - ${botSlot}: ${JSON.stringify(data)}`);
	try
	{
		const trade_docRef = await admin.firestore().collection('trade').doc(botSlot);
		await trade_docRef.get().then(async (doc) =>
		{
			const data = doc.data();
			console.log(`${appVersion} BEFORE ${botSlot}: ${JSON.stringify(doc.data())}`);
			if (!data)
			{
				await trade_docRef.set({
					m1_flag: 0,
					m1_order: 0,
					m1_prop: "",
					m2_flag: 0,
					m2_order: 0,
					m2_prop: "",
					m3_flag: 0,
					m3_order: 0,
					m3_prop: "",
					m4_flag: 0,
					m4_order: 0,
					m4_prop: "",
					m5_flag: 0,
					m5_order: 0,
					m6_prop: "",
					m15_flag: 0,
					m15_order: 0,
					m15_prop: "",
					m30_flag: 0,
					m30_order: 0,
					m30_prop: "",
					m45_flag: 0,
					m45_order: 0,
					m45_prop: "",
					h1_flag: 0,
					h1_order: 0,
					h1_prop: "",
				});
			}
			return true;
		}).catch((error) =>
		{
			console.error(error);
			return false;
		});

		await trade_docRef.update(data);
		return true;
	} catch (error)
	{
		console.error(`${appVersion} UpdateCurrentTrade: ${error}`);
		functions.logger.error(error);
		return false;
	}

}

async function UpdateCurrentFlag(signalDetails)
{
	//
	// Strategy
	//
	const signalData = GetFlagFromSignal(signalDetails);
	await UpdateCurrentTrade(signalData, signalDetails);
}

async function UpdateCurrentOrder(signalDetails)
{
	//
	// Strategy
	//
	const signalData = GetOrderFromSignal(signalDetails);
	await UpdateCurrentTrade(signalData, signalDetails);
}

function GetOrderFromSignal(signalDetails)
{
	try
	{
		let signalData = {};

		const value = signalDetails.order === "Buy" ? 1 : -1;

		if (signalDetails.interval === "1m")
		{
			signalData.m1_order = value;
		}
		else if (signalDetails.interval === "2m")
		{
			signalData.m2_order = value;
		}
		else if (signalDetails.interval === "3m")
		{
			signalData.m3_order = value;
		}
		else if (signalDetails.interval === "4m")
		{
			signalData.m4_order = value;
		}
		else if (signalDetails.interval === "5m")
		{
			signalData.m5_order = value;
		}
		else if (signalDetails.interval === "15m")
		{
			signalData.m15_order = value;
		}
		else if (signalDetails.interval === "30m")
		{
			signalData.m30_order = value;
		}
		else if (signalDetails.interval === "45m")
		{
			signalData.m45_order = value;
		}
		else if (signalDetails.interval === "1h")
		{
			signalData.h1_order = value;
		}
		return signalData;
	} catch (error)
	{
		console.error(`${appVersion} GetOrderFromSignal: ${error}`);
		functions.logger.error(error);
		return null;
	}

}

function GetPropFromSignal(signalDetails)
{
	let signalData = {};

	if (signalDetails.interval === "1m")
	{
		signalData.m1_prop = signalDetails.prop;
	}
	else if (signalDetails.interval === "2m")
	{
		signalData.m2_prop = signalDetails.prop;
	}
	else if (signalDetails.interval === "3m")
	{
		signalData.m3_prop = signalDetails.prop;
	}
	else if (signalDetails.interval === "4m")
	{
		signalData.m4_prop = signalDetails.prop;
	}
	else if (signalDetails.interval === "5m")
	{
		signalData.m5_prop = signalDetails.prop;
	}
	else if (signalDetails.interval === "15m")
	{
		signalData.m15_prop = signalDetails.prop;
	}
	else if (signalDetails.interval === "30m")
	{
		signalData.m30_prop = signalDetails.prop;
	}
	else if (signalDetails.interval === "45m")
	{
		signalData.m45_prop = signalDetails.prop;
	}
	else if (signalDetails.interval === "1h")
	{
		signalData.h1_prop = signalDetails.prop;
	}
	return signalData;
}

function GetFlagFromSignal(signalDetails)
{
	let signalData = {};

	if (signalDetails.interval === "1m")
	{
		signalData.m1_flag = signalDetails.flag;
	}
	else if (signalDetails.interval === "2m")
	{
		signalData.m2_flag = signalDetails.flag;
	}
	else if (signalDetails.interval === "3m")
	{
		signalData.m3_flag = signalDetails.flag;
	}
	else if (signalDetails.interval === "4m")
	{
		signalData.m4_flag = signalDetails.flag;
	}
	else if (signalDetails.interval === "5m")
	{
		signalData.m5_flag = signalDetails.flag;
	}
	else if (signalDetails.interval === "15m")
	{
		signalData.m15_flag = signalDetails.flag;
	}
	else if (signalDetails.interval === "30m")
	{
		signalData.m30_flag = signalDetails.flag;
	}
	else if (signalDetails.interval === "45m")
	{
		signalData.m45_flag = signalDetails.flag;
	}
	else if (signalDetails.interval === "1h")
	{
		signalData.h1_flag = signalDetails.flag;
	}
	return signalData;
}

function GetFlagFromTimeString(data, timeFrameString)
{
	if (timeFrameString === "1m")
	{
		return data.m1_flag;
	}
	else if (timeFrameString === "2m")
	{
		return data.m2_flag;
	}
	else if (timeFrameString === "3m")
	{
		return data.m3_flag;
	}
	else if (timeFrameString === "4m")
	{
		return data.m4_flag;
	}
	else if (timeFrameString === "5m")
	{
		return data.m5_flag;
	}
	else if (timeFrameString === "15m")
	{
		return data.m15_flag;
	}
	else if (timeFrameString === "30m")
	{
		return data.m30_flag;
	}
	else if (timeFrameString === "45m")
	{
		return data.m45_flag;
	}
	else if (timeFrameString === "1h")
	{
		return data.h1_flag;
	}
	return signalData;
}

function GetOrderFromTimeString(data, timeFrameString)
{
	if (timeFrameString === "1m")
	{
		return data.m1_order;
	}
	else if (timeFrameString === "2m")
	{
		return data.m2_order
	}
	else if (timeFrameString === "3m")
	{
		return data.m3_order;
	}
	else if (timeFrameString === "4m")
	{
		return data.m4_order;
	}
	else if (timeFrameString === "5m")
	{
		return data.m5_order;
	}
	else if (timeFrameString === "15m")
	{
		return data.m15_order;
	}
	else if (timeFrameString === "30m")
	{
		return data.m30_order;
	}
	else if (timeFrameString === "45m")
	{
		return data.m45_order;
	}
	else if (timeFrameString === "1h")
	{
		return data.h1_order;
	}
	else
	{
		return 0;
	}
}

function GetPropFromTimeString(data, timeFrameString)
{
	if (timeFrameString === "1m")
	{
		return data.m1_prop;
	}
	else if (timeFrameString === "2m")
	{
		return data.m2_prop
	}
	else if (timeFrameString === "3m")
	{
		return data.m3_prop;
	}
	else if (timeFrameString === "4m")
	{
		return data.m4_prop;
	}
	else if (timeFrameString === "5m")
	{
		return data.m5_prop;
	}
	else if (timeFrameString === "15m")
	{
		return data.m15_prop;
	}
	else if (timeFrameString === "30m")
	{
		return data.m30_prop;
	}
	else if (timeFrameString === "45m")
	{
		return data.m45_prop;
	}
	else if (timeFrameString === "1h")
	{
		return data.h1_prop;
	}
	else
	{
		return 0;
	}
}

function GetOrderValueFromTimeString(data, timeFrameString)
{
	return GetOrderFromTimeString(data, timeFrameString);
}

function IsBuySignal(data)
{
	return data.m1_order === 1 && data.m2_order === 1 /*&& data.m3_order === 1 && data.m4.order ===  1*/ && data.m30_order === 1;
}

function IsSellSignal(data)
{
	return data.m1_order === -1 && data.m2_order === -1 /*&& data.m3_order === -1 && data.m4_order === -1*/ && data.m30_order === -1;
}
//
// Only when the chosen signal is the same as the higher timeframe (pivot) we allow to trade
//
function CanTradeOrder(data, stock)
{
	const timePivotFlag = GetOrderValueFromTimeString(data, GetTimePivot(stock)); //GetFlagFromTimeString(data, GetTimePivot(stock));
	const timeLeaderOrder = GetOrderValueFromTimeString(data, GetIntervalLeader(stock));

	if (timeLeaderOrder === -1 && sellOrderDisabled)
	{
		const returnTxt = `${appVersion} SELL order DISABLED`;
		functions.logger.info(returnTxt);
		return false;
	}
	else if (timePivotFlag === timeLeaderOrder)
	{
		return true;
	}
	else
	{
		const returnTxt = `${appVersion} Bad conditions to open a trade: data -> ${JSON.stringify(data)} | timePivotFlag: ${timePivotFlag} timeLeaderData: ${timeLeaderOrder}`;
		functions.logger.info(returnTxt);
		return false;
	}
}

async function HasToCloseBuyTrade(data, signalDetails)
{
	const timePivotFlag = GetIntervalLeader(GetTimePivot(signalDetails.stock));
	const currentPosition = await GetCurrentPosition(client, { symbol: signalDetails.stock });
	console.log(`\n\ncurrentPosition.side: ${currentPosition.side} timePivotFlag: ${timePivotFlag}\n\n`);

	if (currentPosition && currentPosition.side !== undefined && currentPosition.side !== "None")
	{
		const side = currentPosition.side === "Buy" ? 1 : 0;
		if (side !== timePivotFlag)
		{
			const returnTxt = `${appVersion} HasToStopTrade: true`;
			functions.logger.info(returnTxt);
			return true;
		}
		else
		{
			const returnTxt = `${appVersion} HasToStopTrade: false`;
			functions.logger.info(returnTxt);
			return false;
		}
	}
	else
	{
		const returnTxt = `${appVersion} HasToStopTrade: there's no open position`;
		functions.logger.info(returnTxt);
		return false;
	}
}
//
// If we are shorting (selling)
//
async function HasToStopTrade(client, data, signalDetails)
{
	const timePivotFlag = GetFlagFromTimeString(data, GetTimePivot(signalDetails.stock));
	const currentPosition = await GetCurrentPosition(client, { symbol: signalDetails.stock });
	console.log(`\n\ncurrentPosition.side: ${currentPosition.side} timePivotFlag: ${timePivotFlag}\n\n`);

	if (currentPosition && currentPosition.side !== undefined && currentPosition.side !== "None")
	{
		const side = currentPosition.side === "Buy" ? 1 : 0;
		if (side !== timePivotFlag)
		{
			const returnTxt = `${appVersion} HasToStopTrade: true`;
			functions.logger.info(returnTxt);
			return true;
		}
		else
		{
			const returnTxt = `${appVersion} HasToStopTrade: false`;
			functions.logger.info(returnTxt);
			return false;
		}
	}
	else
	{
		const returnTxt = `${appVersion} HasToStopTrade: there's no open position`;
		functions.logger.info(returnTxt);
		return false;
	}
}

//
// TODO: 
// 1. If for whatever reason I'm in SELL and I'm getting SELL, do not close
// 2. Limit orders, for Buy lower than current market price triggers, for Sell higher than market price triggers
// 3. Cancel trades that are close in time (fluctuations)
//
exports.flag = functions.region('europe-west1').https.onRequest(async (request, response) =>
{
	return cors(request, response, async () =>
	{
		//
		// Alert
		//
		let signalDetails = null;
		try
		{
			if (request.accepts("application/json"))
			{
				signalDetails = request.body;
			}
			else
			{
				signalDetails = JSON.parse(request.body);
			}
		}
		catch (err)
		{
			functions.logger.error(`${appVersion} ${err}`);
			response.status(500);
			response.send(`Error: ${err}`);
			return;
		}
		//
		// Checks
		//
		if (signalDetails.flag === undefined)
		{
			functions.logger.error(`${appVersion} malformed JSON? ${request.accepts("application/json")} ${signalDetails} ${request.body}`);
			response.status(500).send(`${appVersion} Error: malformed JSON?`);
			return;
		}
		if (signalDetails.bot === undefined)
		{
			functions.logger.error(`${appVersion} There's no bot assigned ${signalDetails}`);
			response.status(500).send(`${appVersion} There's no bot assigned ${signalDetails}`);
			return;
		}
		//
		// Update current trade
		//
		await UpdateCurrentFlag(signalDetails);
		//
		// Conditions to create an order
		//
		const botSlot = `BOT-${signalDetails.bot}-${signalDetails.stock}`;
		const trade_docRef = await admin.firestore().collection('trade').doc(botSlot);
		const doc = await trade_docRef.get();
		if (!doc.exists)
		{
			response.status(500).send(`${appVersion} No such document: ${botSlot}`);
			return;
		}
		//
		// If the pivot changes; the bot stops
		// Is not the leading indicator but other thing is warning; the bot stops
		//
		const data = doc.data();
		const client = GetClient(signalDetails);
		if (await HasToStopTrade(client, data, signalDetails))
		{
			//console.log(`\n\n${JSON.stringify(data)}\n\n`);
			//console.log(`\n\n Stopping order: ${JSON.stringify(data)}\n\n`);
			await StopOrder({ response: response, client: client, signalDetails: signalDetails });
			return;
		}
		else
		{
			response.status(200).send(`OK`);
			return;
		}
	});
});

exports.alert = functions.region('europe-west1').https.onRequest(async (request, response) =>
{
	return cors(request, response, async () =>
	{
		//
		// Alert
		//
		let signalDetails = null;
		try
		{
			if (request.accepts("application/json"))
			{
				signalDetails = request.body;
			}
			else
			{
				signalDetails = JSON.parse(request.body);
			}
		}
		catch (err)
		{
			functions.logger.error(`${appVersion} ${err}`);
			response.status(500);
			response.send(`Error: ${err}`);
			return;
		}
		//functions.logger.info(JSON.stringify(signalDetails));
		//
		// Interval check
		//
		if (!signalDetails.interval)
		{
			functions.logger.error(`${appVersion} malformed JSON? ${request.accepts("application/json")} ${signalDetails} ${request.body}`);
			response.status(500).send(`${appVersion} Error: malformed JSON?`);
			return;
		}
		if (!signalDetails.bot)
		{
			functions.logger.error(`${appVersion} There's no bot assigned ${signalDetails}`);
			response.status(500).send(`${appVersion} There's no bot assigned ${signalDetails}`);
			return;
		}
		if (!signalDetails.prop)
		{
			functions.logger.error(`${appVersion} There's no prop assigned ${signalDetails}`);
			response.status(500).send(`${appVersion} There's no prop assigned ${signalDetails}`);
			return;
		}
		//
		// Notes regarding how to calculate SL/TP/TS
		// ----> 1235.60*(1+(0.25/25)) 
		//
		//
		// Update current trade
		//
		await UpdateCurrentOrder(signalDetails);
		//
		// Strategy
		//
		if (signalDetails.interval === undefined)
		{
			response.status(200).send("ok.");
			return;
		}
		//
		// Property modifier "small" and "big" types
		//
		const takeProfitPercentage = signalDetails.prop === "big" ? TAKE_PROFIT_PERCENTAGE_BIG : TAKE_PROFIT_PERCENTAGE_SMALL;

		functions.logger.info(`${appVersion} Signal: ${JSON.stringify(signalDetails)}`);

		QTY = 0;
		CONTRACTS = 0;
		LEVERAGE = 0;

		if (signalDetails.bot === 1)
		{
			CONTRACTS = BOT1_CONTRACTS;
			LEVERAGE = BOT1_LEVERAGE;
			QTY = CONTRACTS * LEVERAGE;
		}
		else if (signalDetails.bot === 2)
		{
			CONTRACTS = BOT2_CONTRACTS;
			LEVERAGE = BOT2_LEVERAGE;
			QTY = CONTRACTS * LEVERAGE;
		}
		else
		{
			functions.logger.error(`${appVersion} Bot ${signalDetails.bot} configuration not found`);
			response.status(500).send(`${appVersion} Bot ${signalDetails.bot} configuration not found`);
			return;
		}
		//
		// Next Order
		//
		const orderDetails =
		{
			side: signalDetails.order,
			symbol: signalDetails.stock,
			leverage: LEVERAGE,
			time_in_force: "ImmediateOrCancel",
			qty: QTY,
		};
		//
		// Conditions to create an order
		//
		const botSlot = `BOT-${signalDetails.bot}-${signalDetails.stock}`;
		const trade_docRef = await admin.firestore().collection('trade').doc(botSlot);
		const doc = await trade_docRef.get();
		if (!doc.exists)
		{
			response.status(500).send(`No such document: ${botSlot}`);
		}
		else
		{
			const client = GetClient(signalDetails);
			//
			// Strategy
			//
			const data = await doc.data();
			functions.logger.info(`${appVersion} STATUS: ${JSON.stringify(data)}`);
			if (signalDetails.test)
			{
				cancelSameSideOrders = true;
				functions.logger.info(`${appVersion} ACTION: ${signalDetails.order}`);

				await createOrder({ response: response, signalDetails: signalDetails, client: client, orderDetails: orderDetails, conditionalOrderBuffer: 0, tradingStopMultiplier: 0, tradingStopActivationMultiplier: 0, stopLossMargin: STOP_LOSS_PERCENTAGE, takeProfitMargin: takeProfitPercentage });
			}
			//
			// New order
			//
			else if (HasToOpenBuyTrade(data, signalDetails)) // TODO: still not finished
			{
				functions.logger.info(`${appVersion} ACTION: ${signalDetails.order}`);
				await createOrder({ response: response, signalDetails: signalDetails, client: client, orderDetails: orderDetails, conditionalOrderBuffer: 0, tradingStopMultiplier: 0, tradingStopActivationMultiplier: 0, stopLossMargin: STOP_LOSS_PERCENTAGE, takeProfitMargin: takeProfitPercentage });
			}
			//
			// Close order
			//
			else if (HasToCloseBuyTrade(client, data, signalDetails))
			{
				functions.logger.info(`${appVersion} CLOSE TRADE ACTION: ${signalDetails.stock}`);
				await StopOrder({ response: response, client: client, signalDetails: signalDetails });
			}
			//
			// Bad conditions
			//
			else
			{
				const returnTxt = `${appVersion} Discarded action on interval: ${signalDetails.interval}`;
				functions.logger.info(returnTxt);
				response.status(200).send(returnTxt);
			}
		}
	});
});

exports.scalper = functions.region('europe-west1').https.onRequest(async (request, response) =>
{
	return cors(request, response, async () =>
	{
		//
		// Alert
		//
		let signalDetails = null;
		try
		{
			if (request.accepts("application/json"))
			{
				signalDetails = request.body;
			}
			else
			{
				signalDetails = JSON.parse(request.body);
			}
		}
		catch (err)
		{
			functions.logger.error(`${appVersion} ${err}`);
			response.status(500);
			response.send(`Error: ${err}`);
			return;
		}
		functions.logger.info(JSON.stringify(signalDetails));
		//
		// Interval check
		//
		if (!signalDetails.interval)
		{
			functions.logger.error(`${appVersion} malformed JSON? ${request.accepts("application/json")} ${signalDetails} ${request.body}`);
			response.status(500).send(`${appVersion} Error: malformed JSON?`);
			return;
		}
		if (!signalDetails.bot)
		{
			functions.logger.error(`${appVersion} There's no bot assigned ${signalDetails}`);
			response.status(500).send(`${appVersion} There's no bot assigned ${signalDetails}`);
			return;
		}
		if (!signalDetails.prop)
		{
			functions.logger.error(`${appVersion} There's no prop assigned ${signalDetails}`);
			response.status(500).send(`${appVersion} There's no prop assigned ${signalDetails}`);
			return;
		}
		//
		// Strategy
		//
		if (signalDetails.interval === undefined)
		{
			response.status(500).send("interval is undefined");
			return;
		}
		//
		// Property modifier "small" and "big" types
		//
		//const takeProfitPercentage = signalDetails.prop === "big" ? TAKE_PROFIT_PERCENTAGE_BIG : TAKE_PROFIT_PERCENTAGE_SMALL;

		//functions.logger.info(`${appVersion} Signal: ${JSON.stringify(signalDetails)}`);

		QTY = 0;
		CONTRACTS = 0;
		LEVERAGE = 0;

		if (signalDetails.bot === 1)
		{
			CONTRACTS = BOT1_CONTRACTS;
			LEVERAGE = BOT1_LEVERAGE;
			QTY = CONTRACTS * LEVERAGE;
		}
		else if (signalDetails.bot === 2)
		{
			CONTRACTS = BOT2_CONTRACTS;
			LEVERAGE = BOT2_LEVERAGE;
			QTY = CONTRACTS * LEVERAGE;
		}
		else
		{
			functions.logger.error(`${appVersion} Bot ${signalDetails.bot} configuration not found`);
			response.status(500).send(`${appVersion} Bot ${signalDetails.bot} configuration not found`);
			return;
		}
		//
		// Next Order
		//
		const orderDetails =
		{
			side: signalDetails.order === "buy" ? "Buy" : "Sell",	// tradingview strategy fix for bybit
			symbol: signalDetails.stock,
			leverage: LEVERAGE,
			time_in_force: "ImmediateOrCancel",
			qty: QTY,
		};

		const client = GetClient(signalDetails);
		//
		// Strategy
		//
		if (signalDetails.order === "buy")
		{
			cancelSameSideOrders = true;
			closePreviousPosition = true;
			functions.logger.info(`${appVersion} OPEN TRADE ACTION: ${signalDetails.stock}`);
			await createOrder({ response: response, signalDetails: signalDetails, client: client, orderDetails: orderDetails });
		}
		//
		// Close order
		//
		else if (signalDetails.order === "sell")
		{
			functions.logger.info(`${appVersion} CLOSE TRADE ACTION: ${signalDetails.stock}`);
			await StopOrder({ response: response, client: client, signalDetails: signalDetails });
		}
		//
		// Bad conditions
		//
		else
		{
			const returnTxt = `${appVersion} Discarded action on interval: ${signalDetails.interval}`;
			functions.logger.info(returnTxt);
			response.status(200).send(returnTxt);
		}
	});
});

async function CancelAll(client, data)
{
	//
	// Cancel ALL active orders
	//
	console.log(`${appVersion} CancelAll ${JSON.stringify(data)}`);
	await client.cancelAllActiveOrders(data).then((cancelAllActiveOrdersResponse) =>
	{
		console.log(`${appVersion} cancelAllActiveOrdersResponse ${JSON.stringify(cancelAllActiveOrdersResponse)}`);
		return true;
	}).catch((err) =>
	{
		functions.logger.error(`${appVersion} cancelAllActiveOrders Error: ${err}`);
	});
	//
	// Cancel ALL conditional orders
	//
	/*
	await client.cancelAllConditionalOrders(data).then((cancelAllConditionalOrdersResponse) =>
	{
		console.log(`${appVersion} cancelAllConditionalOrdersResponse ${JSON.stringify(cancelAllConditionalOrdersResponse)}`);
		return true;
	}).catch((err) => 
	{
		functions.logger.error(`${appVersion} cancelAllConditionalOrders Error: ${err}`);
	});
	*/
}

async function GetCurrentPosition(client, data)
{
	return await client.getPositions(data).then((positionsResponse) =>
	{
		//console.log(`${appVersion} GetCurrentPosition::getPositions ${JSON.stringify(positionsResponse)}`);
		let currentPosition = null;
		for (let i = 0; i < positionsResponse.result.length; ++i)
		{
			const position = positionsResponse.result[i];
			if (position.symbol === data.symbol)
			{
				currentPosition = position;
				//console.log(`${appVersion} GetCurrentPosition ${JSON.stringify(position)}`);
				functions.logger.info(`${appVersion} GetCurrentPosition - Side: ${position.side} Entry Price: ${position.entry_price} Position Value: ${position.position_value} Leverage: ${position.leverage}`);
				return currentPosition;
			}
		}
		return null;
	}).catch((err) => 
	{
		functions.logger.error(`${appVersion} getPositions Error: ${err}`);
		return null;
	});
}

async function ClosePreviousPosition(currentPosition, client)
{
	if (currentPosition.side !== "None")
	{
		const closeOrderType = currentPosition.side === "Buy" ? "Sell" : "Buy";
		const closingOrder =
		{
			side: closeOrderType,
			symbol: currentPosition.symbol,
			order_type: "Market",	// Limit, for Buy lower than current market price triggers, for Sell higher than market price triggers
			time_in_force: "ImmediateOrCancel",
			qty: currentPosition.size,
			close_on_trigger: true,
		};
		//console.log(`${appVersion} ClosePreviousPosition ${JSON.stringify(closingOrder)}`);
		//
		// Close Previous order
		//
		return await client.placeActiveOrder(closingOrder).then((closeActiveOrderResponse) =>
		{
			//console.log(`${appVersion} ClosePreviousPosition: closeActiveOrderResponse ${JSON.stringify(closeActiveOrderResponse)}`);
			functions.logger.info(`${appVersion} ClosePreviousPosition: ${closeActiveOrderResponse.symbol} ${closeActiveOrderResponse.side} ${closeActiveOrderResponse.price} ${closeActiveOrderResponse.qty}`)
			return true;
		}).catch((err) => 
		{
			functions.logger.error(`${appVersion} ClosePreviousPosition: placeActiveOrder Error: ${err}`)
			return false;
		});
	}
	else
	{
		return true;
	}
}

async function PlaceNewOrder(response, client, orderDetails, conditionalOrderBuffer = null, tradingStopMultiplier = null, tradingStopActivationMultiplier = null, stopLossMargin = null, takeProfitMargin = null)
{
	return await client.placeActiveOrder(orderDetails).then(async (placeActiveOrderResponse) =>
	{
		console.log(`${appVersion} PlaceNewOrder ${JSON.stringify(placeActiveOrderResponse)}`);
		if (placeActiveOrderResponse.ret_code === 0)
		{
			if (conditionalOrderBuffer !== 0 || (tradingStopMultiplier === 0 && tradingStopActivationMultiplier === 0 && stopLossMargin === 0 && takeProfitMargin === 0))
			{
				return placeActiveOrderResponse;
			}
			else
			{
				//setTimeout(() =>
				//{
				await SecureTransaction(response, placeActiveOrderResponse, client, orderDetails, tradingStopMultiplier, tradingStopActivationMultiplier, stopLossMargin, takeProfitMargin);
				//}, 300);

				return placeActiveOrderResponse;
			}
		}
		return placeActiveOrderResponse;
	}).catch((err) => 
	{
		functions.logger.error(`${appVersion} PlaceNewOrder: placeActiveOrder Error: ${err}`);
	});
}

async function StopOrder({ response, client, signalDetails })
{
	try
	{
		CancelAll(client, { symbol: signalDetails.stock });
		//
		// Current Position
		//
		const currentPosition = await GetCurrentPosition(client, { symbol: signalDetails.stock });
		//********************************************************************************************************** */
		//
		// Close Previous Order
		//
		//********************************************************************************************************** */
		if (currentPosition)
		{
			const success = await ClosePreviousPosition(currentPosition, client);
			//
			// Return result
			//
			success ? response.status(200) : response.status(500);
			response.send(`${appVersion} OK`);
			return true;
		}
		else
		{
			response.status(200).send(`${appVersion} There's not current position open`);
		}
	}
	catch (err)
	{
		functions.logger.error(`${appVersion} stopOrder Error: ${err}`);
		response.status(500).send(err);
		return false;
	}
}

async function createOrder({ response, client, orderDetails, conditionalOrderBuffer = null, tradingStopMultiplier = null, tradingStopActivationMultiplier = null, stopLossMargin = null, takeProfitMargin = null })
{
	try
	{
		CancelAll(client, { symbol: orderDetails.symbol });
		//
		// Market Order
		//
		orderDetails.order_type = "Market";
		//
		// Current Position
		//
		const currentPosition = await GetCurrentPosition(client, { symbol: orderDetails.symbol });
		if (currentPosition)
		{
			//********************************************************************************************************** */
			//
			// Reject SAME order
			//
			//********************************************************************************************************** */
			//console.log(`${appVersion} currentPosition ${currentPosition.sid}e closeOrderType ${closeOrderType}`);
			if (cancelSameSideOrders === false && currentPosition.side === orderDetails.side)
			{
				const msg = `${appVersion} SAME ALERT: ${currentPosition.side}`;

				functions.logger.warn(msg);
				response.status(200).send(msg);
				return true;
			}
			//********************************************************************************************************** */
			//
			// Close Previous Order
			//
			//********************************************************************************************************** */
			if (closePreviousPosition)
			{
				await ClosePreviousPosition(currentPosition, client);
			}
			//********************************************************************************************************** */
			//
			// Update Leverage
			//
			//********************************************************************************************************** */
			await client.changeUserLeverage({ symbol: orderDetails.symbol, leverage: orderDetails.leverage }).then((changeLeverageResponse) =>
			{
				//console.log(`${appVersion} ${JSON.stringify(changeLeverageResponse)}`);
				return changeLeverageResponse;
			}).catch((err) =>
			{
				functions.logger.error(`${appVersion} changeUserLeverage Error: ${err}`);
			});
			//********************************************************************************************************** */
			//
			// New Order
			//
			//********************************************************************************************************** */
			const placeActiveOrderResponse = await PlaceNewOrder(response, client, orderDetails, conditionalOrderBuffer, tradingStopMultiplier, tradingStopActivationMultiplier, stopLossMargin, takeProfitMargin)
			//
			// Return result
			//
			placeActiveOrderResponse.ret_code !== 0 ? response.status(500) : response.status(200);
			response.send(placeActiveOrderResponse);
			return true;
		}
		else
		{
			const msgText = `${appVersion} createOrder GetCurrentPosition: ${currentPosition}`;
			functions.logger.error(msgText);
			response.status(500).send(msgText);
			return false;
		}
	}
	catch (err)
	{
		functions.logger.error(`${appVersion} createOrder Error: ${err}`);
		response.status(500).send(err);
		return false;
	}
}

async function SecureTransaction(response, placeActiveOrderResponse, client, orderDetails, tradingStopMultiplier = null, tradingStopActivationMultiplier = null, stopLossMargin = null, takeProfitMargin = null)
{
	try
	{
		const currentPosition = await GetCurrentPosition(client, { symbol: orderDetails.symbol });
		if (currentPosition.side === "None")
		{
			console.log(`${appVersion} \n\n\ncurrentPosition.side: ${currentPosition.side} | Trying again!\n\n\n`);
			//setTimeout(() =>
			//{
			await SecureTransaction(response, placeActiveOrderResponse, client, orderDetails, tradingStopMultiplier, tradingStopActivationMultiplier, stopLossMargin, takeProfitMargin);
			//}, 100);
		}
		else
		{
			await SetTradingStop(currentPosition, response, placeActiveOrderResponse, client, orderDetails, tradingStopMultiplier, tradingStopActivationMultiplier, stopLossMargin, takeProfitMargin);
		}
	}
	catch (err)
	{
		functions.logger.error(`${appVersion} SecureTransaction Error: ${err}`);
		response.status(500).send(err);
	}
}

let tradingStopTries = 0;
const tradingStopTriesMax = 2;
async function SetTradingStop(currentPosition, response, placeActiveOrderResponse, client, orderDetails, tradingStopMultiplier = null, tradingStopActivationMultiplier = null, stopLossMargin = null, takeProfitMargin = null)
{
	try
	{
		// 35581*(1-(0.25/25))
		/*
		const bufferPrice = 10;
		const minPriceUp = Math.trunc(currentPosition.side === "Buy" ? currentPosition.entry_price + bufferPrice : currentPosition.entry_price - bufferPrice);
		const minPriceDown = Math.trunc(currentPosition.side === "Buy" ? currentPosition.entry_price - bufferPrice : currentPosition.entry_price + bufferPrice);
		*/
		//
		// Calculate the price difference based on leverage
		//
		//const tradingStopPrice = Math.trunc(currentPosition.entry_price * tradingStopMultiplier);
		//const activationDiff = currentPosition.entry_price * tradingStopActivationMultiplier;
		const SL_multiplier = (stopLossMargin / orderDetails.leverage);
		const TP_multiplier = (takeProfitMargin / orderDetails.leverage);

		const stopLossCalc = currentPosition.entry_price * (currentPosition.side === "Sell" ? 1 + SL_multiplier : 1 - SL_multiplier);
		const takeProfitCalc = currentPosition.entry_price * (currentPosition.side === "Buy" ? 1 + TP_multiplier : 1 - TP_multiplier);
		//
		// Setup the strategy
		//
		const stopLossPrice = Math.trunc(stopLossCalc);
		const takeProfitPrice = Math.trunc(takeProfitCalc);
		console.log(`\n\n${appVersion} action: ${currentPosition.side}\n${appVersion} entry_price: ${currentPosition.entry_price}\n${appVersion} StopLoss -> Multiplier: ${stopLossMargin} -> price: ${stopLossPrice}\n${appVersion} TakeProfit -> Multiplier: ${takeProfitMargin} -> price: ${takeProfitPrice}\n\n`);
		/*
		const activationPrice = Math.max(minPriceUp,
			Number.isInteger(tradingStopActivationMultiplier) ? currentPosition.entry_price + tradingStopActivationMultiplier
				: Math.trunc(currentPosition.side === "Buy" ? currentPosition.entry_price + activationDiff : currentPosition.entry_price - activationDiff)
		);
		console.log(`${appVersion} \n\naction: ${currentPosition.side}\nentry_price: ${currentPosition.entry_price}\nminPriceUp: ${minPriceUp}\nminPriceDown: ${minPriceDown}\nTradingStop -> Multiplier: ${tradingStopMultiplier} -> price: ${tradingStopPrice}\nTradingStopActivation -> Multiplier: ${tradingStopActivationMultiplier} -> ${activationPrice} -> diff: ${activationDiff}\nStopLoss -> Multiplier: ${stopLossMargin} -> diff: ${stopLossDiff} -> price: ${stopLossPrice}\nTakeProfit -> Multiplier: ${takeProfitMargin} -> diff: ${takeProfitDiff} -> price: ${takeProfitPrice}\n\n`);
		*/
		//
		// Set STOP LOSS && TAKE PROFIT
		//
		await client.setTradingStop({ symbol: currentPosition.symbol, stop_loss: stopLossPrice, take_profit: takeProfitPrice }).then(tradingStopResponse =>
		{
			functions.logger.info(`${appVersion} STOP LOSS: ${tradingStopResponse.result.stop_loss}`);
			functions.logger.info(`${appVersion} TAKE PROFIT: ${tradingStopResponse.result.take_profit}`);
			++tradingStopTries;
			return true;
		}).catch((err) => 
		{
			functions.logger.error(`${appVersion} setTradingStop - STOP LOSS - Error: ${err}`);
			return false;
		});
		//if (tradingStopTries >= tradingStopTriesMax || (tradingStopMultiplier === 0 && tradingStopActivationMultiplier === 0))
		//
		// Trailing TAKE PROFIT
		//
		/*
		else
		{
			//
			// Trading STOP
			//
			client.setTradingStop({ symbol: currentPosition.symbol, trailing_stop: tradingStopPrice, new_trailing_active: activationPrice }).then(setTradingStopResponse =>
			{
				console.log(`${appVersion} setTradingStop ${JSON.stringify(setTradingStopResponse)}`);
				if (setTradingStopResponse.ret_code !== 0)
				{
					functions.logger.error(`${appVersion} ${setTradingStopResponse}`);
					console.log(`${appVersion} \n\n\ncurrentPosition.side: ${currentPosition.side} | Trying again!\n\n\n`);
					//const captureBuffer = 0.01;
					//tradingStopMultiplier = currentPosition.side === "Buy" ? tradingStopMultiplier + captureBuffer : tradingStopMultiplier - captureBuffer;
					setTimeout(() =>
					{
						SetTradingStop(currentPosition, response, placeActiveOrderResponse, client, SYMBOL, orderDetails, tradingStopMultiplier, tradingStopActivationMultiplier, stopLossMargin, takeProfitMargin);
					}, 1000);
				}
				else
				{
					//
					// Return result
					//
					placeActiveOrderResponse.ret_code !== 0 ? response.status(500) : response.status(200);
					response.send(placeActiveOrderResponse);
				}
				return true;
			}).catch((err) => 
			{
				functions.logger.error(`${appVersion} setTradingStop Error: ${err}`);
				response.status(500).send(err);
			});
		}
		*/
		return true;
	}
	catch (err)
	{
		functions.logger.error(`${appVersion} SetTradingStop Error: ${err}`);
		response.status(500).send(err);
		return false;
	}
}