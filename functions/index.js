const functions = require("firebase-functions");
const { InverseClient, LinearClient } = require("bybit-api");
const admin = require('firebase-admin');

admin.initializeApp({
	credential: admin.credential.applicationDefault(),
});

const appVersion = "1.0.4.4";

let closeOppositeSidePositions = true; // If an order is received that is the opposite position it wil be closed.

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

    if (config.auth.key === undefined || config.auth.key === '') {
    	const error = new Error('auth.key config key not set with functions:config:set');
		error.http_status = 500;
		error.http_response = 'Error auth.key config key not set';
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

			let botNumber = 'bot_' + i;

			// If bot number doesn't exist break we are done
			if (!config[botNumber]) break;

			if (config[botNumber]['api_key'] === undefined) {
				const error = new Error('api_key not set with functions:config:set');
				error.http_status = 500;
				error.http_response = `Error ${botNumber} api_key not set`;
				return next(error);
			}

			if (config[botNumber]['secret_key'] === undefined) {
				const error = new Error(`${botNumber} secret_key not set with functions:config:set`);
				error.http_status = 500;
				error.http_response = `Error ${botNumber} secret_key not set`;
				return next(error);
			}

			if (config[botNumber]['mode'] !== 'test' && config[botNumber]['mode'] !== 'live') {
				const error = new Error(`${botNumber} mode must be set to either live or test with 
				functions:config:set`);
				error.http_status = 500;
				error.http_response = `Error ${botNumber} mode must be set to either live or test`;
				return next(error);
			}

			// We are only testing connection to bybit hard coding to BTCUSD is fine here
			const bybit_client  = getByBitClient('BTCUSD', i);

			bybit_client.getApiKeyInfo().then((apiKeyInfoResponse) => {
				functions.logger.debug(`${botNumber} connecting to bybit`);
				if (apiKeyInfoResponse.ret_code !== 0) {
					functions.logger.error(`${botNumber} connection failed ${JSON.stringify(apiKeyInfoResponse)}`);
					functions.logger.error(`${botNumber} connection failed`);
					throw new Error(`${botNumber} could not connect to bybit
					${JSON.stringify(apiKeyInfoResponse.ret_msg)}`);
				} else {
					functions.logger.debug(`${botNumber} connection successful`);
					return null;
				}
			}).catch((err) => {
				throw new Error(`${botNumber} could not connect to bybit ${err}`);
			})

			i++;
		}

		response.status(200).send('Configuration Validation Successful');
	} catch (error) {
		error.http_status = 500;
		error.http_response = `Error ${error}`;
		return next(error);
	}

	return next();

});

// Use auth for all other requests
app.use(authValidator);

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

		await validateRequestBody(signalDetails).catch();

		const totalOrderQty = await getTotalOrderQty(signalDetails).catch();

		const orderDetails =
			{
				side: signalDetails.order === "buy" ? "Buy" : "Sell",	// tradingview strategy fix for bybit
				symbol: signalDetails.symbol,
				leverage: signalDetails.leverage,
				time_in_force: "ImmediateOrCancel",
				reduce_only: false,
				close_on_trigger: false,
				qty: totalOrderQty
			};

		const bybitClient = getByBitClient(signalDetails.symbol, signalDetails.bot);

		//
		// Strategy
		//
		if (signalDetails.order === "buy") {
			functions.logger.info(`Opening trade: ${signalDetails.symbol}`);
			await createOrder({
				response: response,
				signalDetails: signalDetails,
				client: bybitClient,
				orderDetails: orderDetails
			});
		}
		//
        // Close order
		//
		else if (signalDetails.order === "sell") {
			functions.logger.info(`Closing trade: ${signalDetails.symbol}`);
			await stopOrder({response: response, client: bybitClient, signalDetails: signalDetails});
		}

	} catch (error) {
		return next(error);
	}

	return next()

});

// error handler middleware
app.use((error, request, response, next) => {
	functions.logger.error(error.message);
	response.status(error.http_status || 500).send(error.http_response || 'Internal Server Error');
});

async function authValidator (request, response, next) {

	functions.logger.debug('Running auth validator');

	// TradingView does not support custom request headers adding basic auth key to request body to give basic
	// security to the api
	if (!functions.config().auth.key) {
		const error = new Error('auth.key config key not found');
		error.http_status = 403;
		error.http_response = 'Unauthorized';
		return next(error);
	}

	if (request.body.auth_key === functions.config().auth.key) {
		functions.logger.info(`auth.key in request body valid`);
		return next();
	} else {
		const error = new Error('auth_key in request body not valid or not provided');
		error.http_status = 403;
		error.http_response = 'Unauthorized';
		return next(error);
	}

}

async function getTotalOrderQty(signalDetails) {

	// If Inverse contracts convert to USD for bybit api trading view sends it as coin amount
	let totalOrderQty;
	if (signalDetails.symbol.endsWith('USD')) {
		if (!signalDetails.order_price) {
			const error = new Error(`order_price must be in request body for inverse contracts`);
			error.http_status = 400;
			error.http_response = `order_price must be in request body for inverse contracts`;
			throw error;
		} else {
			totalOrderQty = signalDetails.contracts * signalDetails.order_price ;
			return totalOrderQty;
		}

	} else {
		totalOrderQty = signalDetails.contracts;
		return totalOrderQty;
	}

}

function getByBitClient(symbol, bot_number) {

	functions.logger.debug('Getting bybit client');

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

async function validateRequestBody(signalDetails) {

	functions.logger.debug('Validating Request Body');

	// Check that all required parameters are in request body
	const bodyParameters = ['bot', 'order', 'symbol', 'contracts', 'leverage'];

	for(const parameter of bodyParameters) {
		if (!signalDetails[parameter]) {
			const error = new Error(`Missing field ${parameter} in request body ${JSON.stringify(signalDetails)}`);
			error.http_status = 400;
			error.http_response = `Missing field ${parameter} in request body ${JSON.stringify(signalDetails)}`;
			throw error;
		}
	}

	if (signalDetails.leverage < 1 || signalDetails.leverage > 100) {
		const error = new Error('Leverage field must be set between 1 and 100 in request body');
		error.http_status = 400;
		error.http_response = 'Leverage field must be set between 1 and 100 in request body';
		throw error;
	}

	if (signalDetails.order !== 'buy' && signalDetails.order !== 'sell') {
		const error = new Error('Order field must be set to either buy or sell');
		error.http_status = 400;
		error.http_response = 'Order field must be set to either buy or sell';
		throw error;
	}

	if (signalDetails.contracts < 0) {
		const error = new Error('Contracts field must be positive number');
		error.http_status = 400;
		error.http_response = 'Contracts field must be positive number';
		throw error;
	}

	if (signalDetails.order_price && signalDetails.order_price < 0) {
		const error = new Error('order_price field must be positive number');
		error.http_status = 400;
		error.http_response = 'order_price field must be positive number';
		throw error;
	}

}

async function cancelAll(client, data) {

	functions.logger.debug(`Canceling all orders ${JSON.stringify(data)}`);

	//
	// Cancel ALL active orders
	//

	functions.logger.debug(`Canceling all active orders ${JSON.stringify(data)}`);
	await client.cancelAllActiveOrders(data).then((cancelAllActiveOrdersResponse) => {
		if (cancelAllActiveOrdersResponse.ret_code !== 0 ) {
			const error = new Error(`Error canceling all active orders ${cancelAllActiveOrdersResponse.ret_msg}`);
			error.http_status = 500;
			error.http_response = 'Error canceling all active orders';
			throw error;
		}
		return true;
	}).catch((error) => {
		error.http_status = 500;
		error.http_response = 'Error canceling all active orders';
		throw error;
	});

	functions.logger.debug(`Canceling all conditional orders ${JSON.stringify(data)}`);
	await client.cancelAllConditionalOrders(data).then((cancelAllConditionalOrdersResponse) => {
		if (cancelAllConditionalOrdersResponse.ret_code !== 0 ) {
			const error = new Error(`Error canceling all conditional orders ${cancelAllConditionalOrdersResponse.ret_msg}`);
			error.http_status = 500;
			error.http_response = 'Error canceling all conditional orders';
			throw error;
		}
		return true;
	}).catch((error) => {
		error.http_status = 500;
		error.http_response = 'Error canceling all conditional orders';
		throw error;
	});

}

async function getCurrentPosition(client, data) {

	functions.logger.debug(`Getting current position ${JSON.stringify(data)}`);
	return await client.getPosition(data).then((positionsResponse) => {
		functions.logger.debug(`Positions response ${JSON.stringify(positionsResponse)}`)
		let currentPosition = null;
		if (data.symbol.endsWith("USDT")) {
			for (let i = 0; i < positionsResponse.result.length; ++i) {
				// API response is slightly different between Inverse and USDT
				const position = positionsResponse.result[i];

				if (position.symbol === data.symbol) {
					currentPosition = position;
					functions.logger.debug(`Current position - Side: ${position.side} Entry Price: ${position.entry_price} Position Value: ${position.position_value} Leverage: ${position.leverage}`);
					return currentPosition;
				}
			}
		} else {
			currentPosition = positionsResponse.result;
			return currentPosition;
		}
		return null;
	}).catch((error) => {
		error.http_status = 500;
		error.http_response = 'Error getting current position';
		throw error;
	});
}

async function closePreviousPosition(currentPosition, client) {
	if (currentPosition.side !== "None") {
		functions.logger.debug('Closing previous position');
		const closeOrderType = currentPosition.side === "Buy" ? "Sell" : "Buy";
		const closingOrder =
		{
			side: closeOrderType,
			symbol: currentPosition.symbol,
			order_type: "Market",	// Limit, for Buy lower than current market price triggers, for Sell higher than market price triggers
			time_in_force: "ImmediateOrCancel",
			reduce_only: true,
			qty: currentPosition.size,
			close_on_trigger: true,
		};

		// Close Previous order
		return await client.placeActiveOrder(closingOrder).then((closeActiveOrderResponse) => {
			if (closeActiveOrderResponse.ret_code !== 0 ) {
				const error = new Error(`Error placing order to close previous position ${closeActiveOrderResponse.ret_msg}`);
				error.http_status = 500;
				error.http_response = 'Error placing order to close previous position';
				throw error;
			}
			functions.logger.info(`ClosePreviousPosition: ${closeActiveOrderResponse.result.symbol} ${closeActiveOrderResponse.result.side} ${closeActiveOrderResponse.result.price} ${closeActiveOrderResponse.result.qty}`);
			return true;
		}).catch((error) => {
			error.http_status = 500;
			error.http_response = 'Error placing order to close previous position';
			throw error;
		});
	}
	else {
		return true;
	}
}

async function placeNewOrder(response, client, orderDetails, conditionalOrderBuffer = null, tradingStopMultiplier = null,
							 tradingStopActivationMultiplier = null, stopLossMargin = null, takeProfitMargin = null) {
	return await client.placeActiveOrder(orderDetails).then(async (placeActiveOrderResponse) => {
		functions.logger.info(`Place active order response ${JSON.stringify(placeActiveOrderResponse)}`);
		if (placeActiveOrderResponse.ret_code === 0) {
			if (conditionalOrderBuffer !== 0 || (tradingStopMultiplier === 0 && tradingStopActivationMultiplier === 0 &&
				stopLossMargin === 0 && takeProfitMargin === 0)) {
				return placeActiveOrderResponse;
			}
			else {
				//await secureTransaction(response, placeActiveOrderResponse, client, orderDetails, tradingStopMultiplier,
				//	tradingStopActivationMultiplier, stopLossMargin, takeProfitMargin);
				return placeActiveOrderResponse;
			}
		}
		return placeActiveOrderResponse;
	}).catch((error) => {
		error.http_status = 500;
		error.http_response = 'Place active order Error';
		throw error;
	});
}

async function stopOrder({ response, client, signalDetails }) {
	try {
		await cancelAll(client, { symbol: signalDetails.symbol });

		// Current Position
		const currentPosition = await getCurrentPosition(client, { symbol: signalDetails.symbol });

		// Close Previous Order
		if (currentPosition.size > 0) {
			const success = await closePreviousPosition(currentPosition, client);
			success ? response.status(200) : response.status(500);
			response.status(200).send('Sell order placed Successfully');
		}
		else {
			functions.logger.info('There is no current position open')
			response.status(200).send(`There is no current position open`);
		}
	}
	catch (error) {
		error.http_status = 500;
		error.http_response = 'Stop order error';
		throw error;
	}

}

async function createOrder({ response, client, orderDetails, conditionalOrderBuffer = null,
							   tradingStopMultiplier = null, tradingStopActivationMultiplier = null,
							   stopLossMargin = null, takeProfitMargin = null }) {

	await cancelAll(client, { symbol: orderDetails.symbol });

	// Market Order
	orderDetails.order_type = "Market";

	// Current Position
	const currentPosition = await getCurrentPosition(client, { symbol: orderDetails.symbol });
	if (currentPosition) {
		functions.logger.info('There is a current position');

		// If opposite side position exists for symbol close that position before opening opposite position
		if (closeOppositeSidePositions && currentPosition.side !== orderDetails.side) {
			functions.logger.info('Current position is not the same side as requested closing opposite side position');
			await closePreviousPosition(currentPosition, client);
		}

	}

	// Update Leverage
	functions.logger.debug(`Setting User leverage to ${orderDetails.leverage}`);

	// HACK TEST NET API leverage change request parameters are different from LIVE NET API
	// This is only needed until ByBit promotes their code to live.
	let setUserLeverageRequest;
	if (client.requestWrapper.baseUrl === "https://api.bybit.com" && orderDetails.symbol.endsWith("USD")) {
		setUserLeverageRequest = { symbol: orderDetails.symbol, leverage: orderDetails.leverage};
	} else {
		setUserLeverageRequest = { symbol: orderDetails.symbol, buy_leverage: orderDetails.leverage, sell_leverage: orderDetails.leverage };
	}

	await client.setUserLeverage(setUserLeverageRequest).then((changeLeverageResponse) => {
		functions.logger.debug(JSON.stringify(changeLeverageResponse))
		if (changeLeverageResponse.ret_code !== 0 && changeLeverageResponse.ret_code !== 34036 ) {
			const error = new Error(`Error changing leverage ${changeLeverageResponse.ret_msg}`);
			error.http_status = 500;
			error.http_response = 'Error changing leverage';
			throw error;
		}
		return true;
	}).catch((error) => {
		error.http_status = 500;
		throw error;
	});

	// New Order
	functions.logger.debug(`Placing order for ${JSON.stringify(orderDetails)}`);
	await placeNewOrder(response, client, orderDetails, conditionalOrderBuffer, tradingStopMultiplier,
		tradingStopActivationMultiplier, stopLossMargin, takeProfitMargin).then((placeActiveOrderResponse) => {
		if (placeActiveOrderResponse.ret_code !== 0 ) {
			const error = new Error(`Error placing order ${placeActiveOrderResponse.ret_msg}`);
			error.http_status = 500;
			error.http_response = 'Error placing order';
			throw error;
		}
		return true;
	}).catch((error) => {
		error.http_status = 500;
		throw error;
	});

	response.status(200).send('Buy Order Placed Successfully');
	return true;

}

// async function secureTransaction(response, placeActiveOrderResponse, client, orderDetails,
// 								 tradingStopMultiplier = null, tradingStopActivationMultiplier = null,
// 								 stopLossMargin = null, takeProfitMargin = null) {
// 	try {
// 		const currentPosition = await getCurrentPosition(client, { symbol: orderDetails.symbol });
// 		if (currentPosition.side === "None") {
// 			console.log(`${appVersion} \n\n\ncurrentPosition.side: ${currentPosition.side} | Trying again!\n\n\n`);
// 			//setTimeout(() =>
// 			//{
// 			await secureTransaction(response, placeActiveOrderResponse, client, orderDetails, tradingStopMultiplier,
// 				tradingStopActivationMultiplier, stopLossMargin, takeProfitMargin);
// 			//}, 100);
// 		}
// 		else {
// 			await setTradingStop(currentPosition, response, placeActiveOrderResponse, client, orderDetails,
// 				tradingStopMultiplier, tradingStopActivationMultiplier, stopLossMargin, takeProfitMargin);
// 		}
// 	}
// 	catch (error) {
// 		error.http_status = 500;
// 		error.http_response = 'Secure transaction error';
// 		throw error;
// 	}
// }

// let tradingStopTries = 0;
// const tradingStopTriesMax = 2;
// async function setTradingStop(currentPosition, response, placeActiveOrderResponse, client, orderDetails,
// 							  tradingStopMultiplier = null, tradingStopActivationMultiplier = null,
// 							  stopLossMargin = null, takeProfitMargin = null) {
// 	try {
// 		// 35581*(1-(0.25/25))
// 		/*
// 		const bufferPrice = 10;
// 		const minPriceUp = Math.trunc(currentPosition.side === "Buy" ? currentPosition.entry_price + bufferPrice : currentPosition.entry_price - bufferPrice);
// 		const minPriceDown = Math.trunc(currentPosition.side === "Buy" ? currentPosition.entry_price - bufferPrice : currentPosition.entry_price + bufferPrice);
// 		*/
// 		//
// 		// Calculate the price difference based on leverage
// 		//
// 		//const tradingStopPrice = Math.trunc(currentPosition.entry_price * tradingStopMultiplier);
// 		//const activationDiff = currentPosition.entry_price * tradingStopActivationMultiplier;
// 		const SL_multiplier = (stopLossMargin / orderDetails.leverage);
// 		const TP_multiplier = (takeProfitMargin / orderDetails.leverage);
//
// 		const stopLossCalc = currentPosition.entry_price * (currentPosition.side === "Sell" ? 1 + SL_multiplier : 1 - SL_multiplier);
// 		const takeProfitCalc = currentPosition.entry_price * (currentPosition.side === "Buy" ? 1 + TP_multiplier : 1 - TP_multiplier);
// 		//
// 		// Setup the strategy
// 		//
// 		const stopLossPrice = Math.trunc(stopLossCalc);
// 		const takeProfitPrice = Math.trunc(takeProfitCalc);
// 		console.log(`\n\n${appVersion} action: ${currentPosition.side}\n${appVersion} entry_price: ${currentPosition.entry_price}\n${appVersion} StopLoss -> Multiplier: ${stopLossMargin} -> price: ${stopLossPrice}\n${appVersion} TakeProfit -> Multiplier: ${takeProfitMargin} -> price: ${takeProfitPrice}\n\n`);
// 		/*
// 		const activationPrice = Math.max(minPriceUp,
// 			Number.isInteger(tradingStopActivationMultiplier) ? currentPosition.entry_price + tradingStopActivationMultiplier
// 				: Math.trunc(currentPosition.side === "Buy" ? currentPosition.entry_price + activationDiff : currentPosition.entry_price - activationDiff)
// 		);
// 		console.log(`${appVersion} \n\naction: ${currentPosition.side}\nentry_price: ${currentPosition.entry_price}\nminPriceUp: ${minPriceUp}\nminPriceDown: ${minPriceDown}\nTradingStop -> Multiplier: ${tradingStopMultiplier} -> price: ${tradingStopPrice}\nTradingStopActivation -> Multiplier: ${tradingStopActivationMultiplier} -> ${activationPrice} -> diff: ${activationDiff}\nStopLoss -> Multiplier: ${stopLossMargin} -> diff: ${stopLossDiff} -> price: ${stopLossPrice}\nTakeProfit -> Multiplier: ${takeProfitMargin} -> diff: ${takeProfitDiff} -> price: ${takeProfitPrice}\n\n`);
// 		*/
// 		//
// 		// Set STOP LOSS && TAKE PROFIT
// 		//
// 		await client.setTradingStop({ symbol: currentPosition.symbol, stop_loss: stopLossPrice, take_profit: takeProfitPrice }).then(tradingStopResponse => {
// 			functions.logger.info(`${appVersion} STOP LOSS: ${tradingStopResponse.result.stop_loss}`);
// 			functions.logger.info(`${appVersion} TAKE PROFIT: ${tradingStopResponse.result.take_profit}`);
// 			++tradingStopTries;
// 			return true;
// 		}).catch((error) => {
// 			error.http_status = 500;
// 			error.http_response = 'Set Trading Stop Error';
// 			throw error;
// 		});
// 		//if (tradingStopTries >= tradingStopTriesMax || (tradingStopMultiplier === 0 && tradingStopActivationMultiplier === 0))
// 		//
// 		// Trailing TAKE PROFIT
// 		//
// 		/*
// 		else
// 		{
// 			//
// 			// Trading STOP
// 			//
// 			client.setTradingStop({ symbol: currentPosition.symbol, trailing_stop: tradingStopPrice, new_trailing_active: activationPrice }).then(setTradingStopResponse =>
// 			{
// 				console.log(`${appVersion} setTradingStop ${JSON.stringify(setTradingStopResponse)}`);
// 				if (setTradingStopResponse.ret_code !== 0)
// 				{
// 					functions.logger.error(`${appVersion} ${setTradingStopResponse}`);
// 					console.log(`${appVersion} \n\n\ncurrentPosition.side: ${currentPosition.side} | Trying again!\n\n\n`);
// 					//const captureBuffer = 0.01;
// 					//tradingStopMultiplier = currentPosition.side === "Buy" ? tradingStopMultiplier + captureBuffer : tradingStopMultiplier - captureBuffer;
// 					setTimeout(() =>
// 					{
// 						SetTradingStop(currentPosition, response, placeActiveOrderResponse, client, SYMBOL, orderDetails, tradingStopMultiplier, tradingStopActivationMultiplier, stopLossMargin, takeProfitMargin);
// 					}, 1000);
// 				}
// 				else
// 				{
// 					//
// 					// Return result
// 					//
// 					placeActiveOrderResponse.ret_code !== 0 ? response.status(500) : response.status(200);
// 					response.send(placeActiveOrderResponse);
// 				}
// 				return true;
// 			}).catch((err) =>
// 			{
// 				functions.logger.error(`${appVersion} setTradingStop Error: ${err}`);
// 				response.status(500).send(err);
// 			});
// 		}
// 		*/
// 		return true;
// 	}
// 	catch (error) {
// 		error.http_status = 500;
// 		error.http_response = 'Set Trading Stop Error';
// 		throw error;
// 	}
// }