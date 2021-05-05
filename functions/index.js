const functions = require("firebase-functions");
const { RestClient } = require("bybit-api");
const admin = require('firebase-admin');

admin.initializeApp({
	credential: admin.credential.applicationDefault(),
});

const express = require('express');
const app = express();

const appVersion = "1.0.4.2";

let cancelSameSideOrders = false;
let closePreviousPosition = true;

function GetByBitClient(bot_number, response)
{
    // Use api and secret key for bot number passed in
    const config = functions.config();
    let bot_config_name = 'bot_' + bot_number;

    if (!config[bot_config_name]) {
        response.send(`bot ${bot_number} not found in config`).status(400)
        return false;
    }
    return new RestClient(config[bot_config_name]['api_key'], config[bot_config_name]['secret_key']);
}

exports.scalper = functions.region('europe-west1').https.onRequest(app);

// Basic up endpoint to that returns a 200 and api version
// Useful for debugging / monitoring
app.get('/up', async (request, response) => {
	response.send(`I'm alive running version ${appVersion}`).status(200);
});

// Confirms that configuration values can be loaded and that api keys can auth to ByBit
app.get('/config/validate', async (request, response) => {

	const config = functions.config();

    if (config.auth_key === undefined) {
        response.send(`Error auth_key config key not set`).status(500);
        return;
    }

	if (config.bot_1 === undefined) {
		response.send(`Error bot_1 config key not set at least one bot must be configured`).status(500);
		return;
	}


    // Test that each bot has api keys can connect to bybit looping through all config keys for bot_i
    let i = 1;
	let loop = true;
    while (loop) {

        let bot_number = 'bot_' + i

        // If bot number doesn't exist break we are done
        if (!config[bot_number]) {
            break
        }

        if (config[bot_number]['api_key'] === undefined) {
            response.send(`Error ${bot_number} api key not set`).status(500);
            return;
        }

        if (config[bot_number]['secret_key'] === undefined) {
            response.send(`Error ${bot_number} secret key not set`).status(500);
            return;
        }

        let client = new RestClient(config[bot_number]['api_key'], config[bot_number]['secret_key']);

        client.getApiKeyInfo().then((apiKeyInfoResponse) =>
        {
            if (apiKeyInfoResponse.ret_code !== 0 ) {
                apiKeyInfoResponse.ret_msg
                response.send(`Error could not connect to bybit ${apiKeyInfoResponse.ret_msg}`).status(500)

            } else {
                response.send(`Config validation successful`).status(200)
            }
            return;

        }).catch((err) =>
        {
            response.send(err).status(500)
        });

        i++
    }

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

	if (!await ValidateRequestBody({response, signalDetails})) return;

	//
	// Next Order
	//
	const orderDetails =
		{
			side: signalDetails.order === "buy" ? "Buy" : "Sell",	// tradingview strategy fix for bybit
			symbol: signalDetails.stock,
			leverage: signalDetails.leverage,
			time_in_force: "ImmediateOrCancel",
			qty: signalDetails.contracts,
		};

	if (!GetByBitClient(signalDetails.bot, response)) return;

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

async function ValidateRequestBody({ response, signalDetails}) {

	// TradingView does not support custom request headers adding basic auth key to request body to give basic
	// security to the api
	if (signalDetails.auth_key !== functions.config().auth_key) {
		functions.logger.error(`${appVersion} Error: auth_key in request body not valid`);
		response.status(403).send(`${appVersion} Error: unauthorized`);
		return false
	}

	// Check that all required parameters are in request body
	const body_parameters = ['bot', 'order', 'stock', 'contracts', 'leverage']

	for(const parameter of body_parameters) {
		if (!signalDetails[parameter]) {
			functions.logger.error(`${appVersion} Missing field ${parameter} in request body ${JSON.stringify(signalDetails)}`);
			response.status(400).send(`${appVersion} Missing field ${parameter} in request body ${JSON.stringify(signalDetails)}`);
			return false;
		}
	}

	return true;
}

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