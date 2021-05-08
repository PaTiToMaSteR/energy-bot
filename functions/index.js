const functions = require("firebase-functions");
const { InverseClient, LinearClient } = require("bybit-api");
const admin = require('firebase-admin');

admin.initializeApp({
	credential: admin.credential.applicationDefault(),
});

const appVersion = "1.0.4.2";

let cancelSameSideOrders = false;
let closePreviousPosition = true;

const express = require('express');
const app = express();

exports.scalper = functions.region('europe-west1').https.onRequest(app);

// Basic up endpoint to that returns a 200 and api version
// Useful for debugging / monitoring
app.get('/up', async (request, response) => {
	const msg = `I'm alive running version ${appVersion}`;
	functions.logger.info(msg);
	response.status(200).send(msg);
});

// Confirms that configuration values can be loaded and that api keys can auth to ByBit
app.get('/config/validate', async (request, response, next) => {

	functions.logger.info(`${appVersion} Running config validation`);

	const config = functions.config();

    if (config.auth_key === undefined || config.auth_key === '') {
    	const error = new Error('auth_key config key not set with functions:config:set');
		error.http_status = 500;
		error.http_response = 'Error auth_key config key not set';
		return next(error);
    }

	if (config.bot_1 === undefined) {
		const error = new Error('bot_1 config key not set with functions:config:set');
		error.http_status = 500;
		error.http_response = 'Error bot_1 config key not set at least one bot must be configured';
		return next(error);
	}

    // Test that each bot's api keys can connect to bybit looping through all config keys for bot_i
    let i = 1;
	let loop = true;

	try {
		while (loop) {

			let bot_number = 'bot_' + i;

			// If bot number doesn't exist break we are done
			if (!config[bot_number]) break;

			if (config[bot_number]['api_key'] === undefined) {
				const error = new Error('api_key not set with functions:config:set');
				error.http_status = 500;
				error.http_response = `Error ${bot_number} api_key not set`;
				return next(error);
			}

			if (config[bot_number]['secret_key'] === undefined) {
				const error = new Error(`${bot_number} secret_key not set with functions:config:set`);
				error.http_status = 500;
				error.http_response = `Error ${bot_number} secret_key not set`;
				return next(error);
			}

			if (config[bot_number]['mode'] !== 'test' && config[bot_number]['mode'] !== 'live') {
				const error = new Error(`${bot_number} mode must be set to either live or test with 
				functions:config:set`);
				error.http_status = 500;
				error.http_response = `Error ${bot_number} mode must be set to either live or test`;
				return next(error);
			}

			// We are only testing connection to bybit hard coding to BTCUSD is fine here
			const bybit_client  = GetByBitClient('BTCUSD', i);

			bybit_client.getApiKeyInfo().then((apiKeyInfoResponse) => {
				functions.logger.debug(`${bot_number} connecting to bybit`);
				if (apiKeyInfoResponse.ret_code !== 0) {
					functions.logger.error(`${bot_number} connection failed ${JSON.stringify(apiKeyInfoResponse)}`);
					functions.logger.error(`${bot_number} connection failed`);
					throw new Error(`${bot_number} could not connect to bybit
					${JSON.stringify(apiKeyInfoResponse.ret_msg)}`);
				} else {
					functions.logger.debug(`${bot_number} connection successful`);
					return null;
				}
			}).catch((err) => {
				throw new Error(`${bot_number} could not connect to bybit ${err}`);
			})

			i++;
		}

		response.status(200).send('Configuration Validation Successful');
	} catch (error) {
		error.http_status = 500;
		error.http_response = `Error ${error}`;
		return next(error);
	}

});

// Use auth for all other requests
app.use(AuthValidator);

app.post('/', async (request, response, next) => {

	functions.logger.info(`${appVersion} Scraper request received`);

	let signalDetails = null;

	try {
		if (request.accepts("application/json")) {
			signalDetails = request.body;
		} else {
			signalDetails = JSON.parse(request.body);
		}

		functions.logger.info(JSON.stringify(signalDetails));

		await ValidateRequestBody(signalDetails).catch();

		const orderDetails =
			{
				side: signalDetails.order === "buy" ? "Buy" : "Sell",	// tradingview strategy fix for bybit
				symbol: signalDetails.symbol,
				leverage: signalDetails.leverage,
				time_in_force: "ImmediateOrCancel",
				qty: signalDetails.contracts * signalDetails.leverage,
			};

		const bybit_client = GetByBitClient(signalDetails.symbol, signalDetails.bot);

		//
		// Strategy
		//
		if (signalDetails.order === "buy") {
			cancelSameSideOrders = true;
			closePreviousPosition = true;
			functions.logger.info(`${appVersion} OPEN TRADE ACTION: ${signalDetails.symbol}`);
			await createOrder({
				response: response,
				signalDetails: signalDetails,
				client: bybit_client,
				orderDetails: orderDetails
			});
		}
		//
        // Close order
		//
		else if (signalDetails.order === "sell") {
			functions.logger.info(`${appVersion} CLOSE TRADE ACTION: ${signalDetails.symbol}`);
			await StopOrder({response: response, client: bybit_client, signalDetails: signalDetails});
		}
        //
        // Bad conditions
		//
		else {
			const error = new Error(`Order field in request body must be set to buy or sell ${JSON.stringify(signalDetails)}`);
			error.http_status = 400;
			error.http_response = 'Order field in request body must be set to buy or sell';
			throw error;
		}

	} catch (error) {
		return next(error);
	}

});

// error handler middleware
app.use((error, request, response, next) => {
	functions.logger.error(error.message)
	response.status(error.http_status || 500).send({
		error: {
			status: error.http_status || 500,
			message: error.http_response || 'Internal Server Error',},
	});
});

async function AuthValidator (request, response, next) {
	// TradingView does not support custom request headers adding basic auth key to request body to give basic
	// security to the api
	if (!functions.config().auth_key) {
		const error = new Error('auth_key config key not found');
		error.http_status = 403;
		error.http_response = 'Unauthorized';
		return next(error);
	}

	if (request.body.auth_key === functions.config().auth_key) {
		functions.logger.info(`auth_key in request body valid`);
		return next();
	} else {
		const error = new Error('auth_key in request body not valid or not provided');
		error.http_status = 403;
		error.http_response = 'Unauthorized';
		return next(error);
	}

}

function GetByBitClient(symbol, bot_number) {
    // Use api and secret key for bot number passed in
    const config = functions.config();
    let bot_config_name = 'bot_' + bot_number;

    if (!config[bot_config_name]) {
		const error = new Error(`bot ${bot_config_name} not found in config`);
		error.http_status = 400;
		error.http_response = `bot ${bot_config_name} not found in config`;
		throw error;
    }

	let use_live_mode = config[bot_config_name]['mode'] === 'live';

    // Get the right client for the symbol in the request
	if (symbol.endsWith("USDT")) {
		return new LinearClient(config[bot_config_name]['api_key'], config[bot_config_name]['secret_key'], use_live_mode);
	} else {
		return new InverseClient(config[bot_config_name]['api_key'], config[bot_config_name]['secret_key'], use_live_mode);
	}

}

async function ValidateRequestBody(signalDetails) {

	// Check that all required parameters are in request body
	const body_parameters = ['bot', 'order', 'symbol', 'contracts', 'leverage'];

	for(const parameter of body_parameters) {
		if (!signalDetails[parameter]) {
			const error = new Error(`Missing field ${parameter} in request body ${JSON.stringify(signalDetails)}`);
			error.http_status = 400;
			error.http_response = `Missing field ${parameter} in request body ${JSON.stringify(signalDetails)}`;
			throw error;
		}
	}

}

async function CancelAll(client, data)
{

	functions.logger.info(`Canceling all orders ${JSON.stringify(data)}`);
	//
	// Cancel ALL active orders
	//

	functions.logger.info(`Canceling all active orders ${JSON.stringify(data)}`);
	await client.cancelAllActiveOrders(data).then((cancelAllActiveOrdersResponse) => {
		if (cancelAllActiveOrdersResponse.ret_code !== 0 ) {
			const error = new Error(`Error canceling all active orders ${cancelAllActiveOrdersResponse.ret_msg}`);
			error.http_status = 500;
			error.http_response = 'Error canceling all active orders';
			throw error;
		}
		return true;
	}).catch((error) =>
	{
		error.http_status = 500;
		throw error;
	});

	functions.logger.info(`Canceling all conditional orders ${JSON.stringify(data)}`);
	await client.cancelAllConditionalOrders(data).then((cancelAllConditionalOrdersResponse) => {
		if (cancelAllConditionalOrdersResponse.ret_code !== 0 ) {
			const error = new Error(`Error canceling all conditional orders ${cancelAllConditionalOrdersResponse.ret_msg}`);
			error.http_status = 500;
			error.http_response = 'Error canceling all conditional orders';
			throw error;
		}
		return true;
	}).catch((error) =>
	{
		error.http_status = 500;
		throw error;
	});

}

async function GetCurrentPosition(client, data)
{
	return await client.getPosition(data).then((positionsResponse) =>
	{
		let currentPosition = null;
		for (let i = 0; i < positionsResponse.result.length; ++i)
		{
			const position = positionsResponse.result[i];
			if (position.symbol === data.symbol)
			{
				currentPosition = position;
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
		await CancelAll(client, { symbol: signalDetails.symbol });

		//
		// Current Position
		//
		const currentPosition = await GetCurrentPosition(client, { symbol: signalDetails.symbol });

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

async function createOrder({ response, client, orderDetails, conditionalOrderBuffer = null, tradingStopMultiplier = null, tradingStopActivationMultiplier = null, stopLossMargin = null, takeProfitMargin = null }) {

	await CancelAll(client, { symbol: orderDetails.symbol });

	//
	// Market Order
	//
	orderDetails.order_type = "Market";

	//
	// Current Position
	//
	const currentPosition = await GetCurrentPosition(client, { symbol: orderDetails.symbol });
	if (currentPosition) {
		functions.logger.info('There is a current position');
		//********************************************************************************************************** */
		//
		// Reject SAME order
		//
		//********************************************************************************************************** */
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

	}

	//********************************************************************************************************** */
	//
	// Update Leverage
	//
	//********************************************************************************************************** */
	functions.logger.debug(`Setting User leverage to ${orderDetails.leverage}`);
	await client.setUserLeverage({ symbol: orderDetails.symbol, leverage: orderDetails.leverage }).then((changeLeverageResponse) => {
		if (changeLeverageResponse.ret_code !== 0 ) {
			const error = new Error(`Error changing leverage ${changeLeverageResponse.ret_msg}`);
			error.http_status = 500;
			error.http_response = 'Error changing leverage';
			throw error;
		}
		return true;
	}).catch((error) =>
	{
		error.http_status = 500;
		throw error;
	});

	//********************************************************************************************************** */
	//
	// New Order
	//
	//********************************************************************************************************** */
	functions.logger.debug(`Placing order for ${JSON.stringify(orderDetails)}`);
	await PlaceNewOrder(response, client, orderDetails, conditionalOrderBuffer, tradingStopMultiplier, tradingStopActivationMultiplier, stopLossMargin, takeProfitMargin).then((placeActiveOrderResponse) => {
		if (placeActiveOrderResponse.ret_code !== 0 ) {
			const error = new Error(`Error placing order ${placeActiveOrderResponse.ret_msg}`);
			error.http_status = 500;
			error.http_response = 'Error placing order';
			throw error;
		}
		return true;
	}).catch((error) =>
	{
		error.http_status = 500;
		throw error;
	});

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