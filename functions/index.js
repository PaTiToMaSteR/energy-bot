const functions = require("firebase-functions");
const { RestClient } = require("bybit-api");
const admin = require('firebase-admin');

admin.initializeApp({
	credential: admin.credential.applicationDefault(),
});

const express = require('express');
const app = express();

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

const BOT1_LEVERAGE = 1;
const BOT1_CONTRACTS = 1000;

const BOT2_LEVERAGE = 5;
const BOT2_CONTRACTS = 1000;

exports.scalper = functions.region('europe-west1').https.onRequest(app);

// Basic up endpoint to that returns a 200 and api version
// Useful for debugging / monitoring
app.get('/up', async (request, response) => {
	response.status(200);
	response.send(`I'm alive running version ${appVersion}`);
});

// Confirms that configuration values can be loaded and that api keys can auth to ByBit
app.get('/config/validate', async (request, response) => {

	try {
		functions.config().bybit
	} catch(e) {
		response.status(500);
		response.send(`Error bybit config key not set`);
		return;
	}

	if (functions.config().bybit.api_key === undefined) {
		response.status(500);
		response.send(`Error bybit.api_key config key not set`);
		return;
	}

	if (functions.config().bybit.secret_key === undefined) {
		response.status(500);
		response.send(`Error bybit.secret_key config key not set`);
		return;
	}

	if (functions.config().auth_key === undefined) {
		response.status(500);
		response.send(`Error auth_key config key not set`);
		return;
	}

	response.status(200);
	response.send(`Config validation successful`);

	// TODO  add bybit connection test

});

app.post('/', async (request, response) => {

	let signalDetails = null;

	try {
		if (request.accepts("application/json")) {
			signalDetails = request.body;
		} else {
			signalDetails = JSON.parse(request.body);
		}
	} catch (err) {
		functions.logger.error(`${appVersion} ${err}`);
		response.status(500);
		response.send(`Error: ${err}`);
		return;
	}
	functions.logger.info(JSON.stringify(signalDetails));

	// TradingView does not support custom request headers adding basic auth key to request body to give some basic
	// security to the api
	if (signalDetails.auth_key !== functions.config().auth_key) {
		functions.logger.error(`${appVersion} Error: auth_key in request body not valid`);
		response.status(403).send(`${appVersion} Error: unauthorized`);
		return;
	}

	//
	// Interval check
	//
	if (!signalDetails.interval) {
		functions.logger.error(`${appVersion} malformed JSON? ${request.accepts("application/json")} ${signalDetails} ${request.body}`);
		response.status(500).send(`${appVersion} Error: malformed JSON?`);
		return;
	}
	if (!signalDetails.bot) {
		functions.logger.error(`${appVersion} There's no bot assigned ${signalDetails}`);
		response.status(500).send(`${appVersion} There's no bot assigned ${signalDetails}`);
		return;
	}
	if (!signalDetails.prop) {
		functions.logger.error(`${appVersion} There's no prop assigned ${signalDetails}`);
		response.status(500).send(`${appVersion} There's no prop assigned ${signalDetails}`);
		return;
	}
	//
	// Strategy
	//
	if (signalDetails.interval === undefined) {
		response.status(500).send("interval is undefined");
		return;
	}

	QTY = 0;
	CONTRACTS = 0;
	LEVERAGE = 0;

	if (signalDetails.bot === 1) {
		CONTRACTS = BOT1_CONTRACTS;
		LEVERAGE = BOT1_LEVERAGE;
		QTY = CONTRACTS * LEVERAGE;
	} else if (signalDetails.bot === 2) {
		CONTRACTS = BOT2_CONTRACTS;
		LEVERAGE = BOT2_LEVERAGE;
		QTY = CONTRACTS * LEVERAGE;
	} else {
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
	if (signalDetails.order === "buy") {
		cancelSameSideOrders = true;
		closePreviousPosition = true;
		functions.logger.info(`${appVersion} OPEN TRADE ACTION: ${signalDetails.stock}`);
		await createOrder({
			response: response,
			signalDetails: signalDetails,
			client: client,
			orderDetails: orderDetails
		});
	}
		//
		// Close order
	//
	else if (signalDetails.order === "sell") {
		functions.logger.info(`${appVersion} CLOSE TRADE ACTION: ${signalDetails.stock}`);
		await StopOrder({response: response, client: client, signalDetails: signalDetails});
	}
		//
		// Bad conditions
	//
	else {
		const returnTxt = `${appVersion} Discarded action on interval: ${signalDetails.interval}`;
		functions.logger.info(returnTxt);
		response.status(200).send(returnTxt);
	}
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
	return await client.getPosition(data).then((positionsResponse) =>
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