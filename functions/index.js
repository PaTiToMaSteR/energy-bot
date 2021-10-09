const functions = require("firebase-functions");
const { InverseClient, LinearClient } = require("bybit-api");
const Binance = require('node-binance-api');
const admin = require('firebase-admin');
const axios = require('axios');

admin.initializeApp({
    credential: admin.credential.applicationDefault(),
});

const appVersion = "1.0.6.5";

let closeOppositeSidePositions = true; // If an order is received that is the opposite position it wil be closed.

const express = require('express');
const app = express();

exports.scalper = functions.region('europe-west1').https.onRequest(app);

// Basic up endpoint to that returns a 200 and api version
// Useful for debugging / monitoring
app.get('/up', async (request, response) =>
{
    const msg = `I'm alive running version ${appVersion}`;
    functions.logger.info(msg);
    response.status(200).send(msg);
});

// Confirms that configuration values can be loaded and that api keys can auth to ByBit
app.get('/config/validate', async (request, response, next) =>
{

    functions.logger.info(`${appVersion} Running config validation`);

    const config = functions.config();

    if (config.auth.key === undefined || config.auth.key === '')
    {
        const error = new Error('auth.key config key not set with functions:config:set');
        error.http_status = 500;
        error.http_response = 'Error auth.key config key not set';
        return next(error);
    }

    if (config.bot_1 === undefined)
    {
        const error = new Error('bot_1 config key not set with functions:config:set');
        error.http_status = 500;
        error.http_response = 'Error bot_1 config key not set at least one bot must be configured';
        return next(error);
    }

    // Test that each bot's api keys can connect to bybit looping through all config keys for bot_i
    let i = 1;
    let loop = true;
    let promiseArray = [];

    while (loop)
    {

        let botNumber = 'bot_' + i;

        // If bot number doesn't exist break we are done
        if (!config[botNumber]) break;

        if (config[botNumber]['api_key'] === undefined)
        {
            const error = new Error('api_key not set with functions:config:set');
            error.http_status = 500;
            error.http_response = `Error ${botNumber} api_key not set`;
            return next(error);
        }

        if (config[botNumber]['secret_key'] === undefined)
        {
            const error = new Error(`${botNumber} secret_key not set with functions:config:set`);
            error.http_status = 500;
            error.http_response = `Error ${botNumber} secret_key not set`;
            return next(error);
        }

        if (config[botNumber]['mode'] !== 'test' && config[botNumber]['mode'] !== 'live')
        {
            const error = new Error(`${botNumber} mode must be set to either live or test with 
			functions:config:set`);
            error.http_status = 500;
            error.http_response = `Error ${botNumber} mode must be set to either live or test`;
            return next(error);
        }

        if (config[botNumber]['platform'] === undefined)
        {
            const error = new Error('platform not set with functions:config:set');
            error.http_status = 500;
            error.http_response = `Error ${botNumber} platform not set, supported 'bybit' and 'binance' (spot trading)`;
            return next(error);
        }
        else if (config[botNumber]['platform'] === 'bybit')
        {
            // We are only testing connection to bybit hard coding to BTCUSD is fine here
            const bybit_client = getByBitClient('BTCUSD', i);

            promiseArray.push(new Promise((resolve, reject) =>
                bybit_client.getApiKeyInfo().then((apiKeyInfoResponse) =>
                {
                    functions.logger.debug(`${botNumber} connecting to bybit`);
                    if (apiKeyInfoResponse.ret_code !== 0)
                    {
                        functions.logger.error(`${botNumber} connection failed ${JSON.stringify(apiKeyInfoResponse)}`);
                        functions.logger.error(`${botNumber} connection failed`);
                        const error = new Error(`${botNumber} could not connect to bybit ${JSON.stringify(apiKeyInfoResponse.ret_msg)}`);
                        error.http_status = 500;
                        error.http_response = `Error ${botNumber} could not connect to bybit`;
                        return reject(error);
                    } else
                    {
                        functions.logger.debug(`${botNumber} connection successful`);
                        return resolve(`${botNumber} connection successful`);
                    }
                }).catch((error) =>
                {
                    return reject(error);
                })))

            i++;
        }
        else if (config[botNumber]['platform'] === 'binance')
        {
            // We are only testing connection to bybit hard coding to BTCUSD is fine here
            const binance = getBinanceClient(i);

            promiseArray.push(new Promise((resolve, reject) =>
                binance.prices()
                    .then((prices) =>
                    {
                        functions.logger.debug(`${botNumber} - BTCBUSD: ${JSON.stringify(prices.BTCBUSD)}`);
                        return resolve(`${botNumber} connection successful`);
                    })
                    .catch(error =>
                    {

                        return reject(error);
                    })));
            i++;
        }
    }

    await Promise.all(promiseArray).then(() =>
    {
        response.status(200).send('Configuration Validation Successful');
        return null;
    }).catch(error =>
    {
        return next(error);
    });

    return null;
});

app.get('/balances', async (request, response, next) =>
{

    functions.logger.info(`${appVersion} Running config validation`);

    const config = functions.config();

    if (config.auth.key === undefined || config.auth.key === '')
    {
        const error = new Error('auth.key config key not set with functions:config:set');
        error.http_status = 500;
        error.http_response = 'Error auth.key config key not set';
        return next(error);
    }

    if (config.bot_1 === undefined)
    {
        const error = new Error('bot_1 config key not set with functions:config:set');
        error.http_status = 500;
        error.http_response = 'Error bot_1 config key not set at least one bot must be configured';
        return next(error);
    }

    // Test that each bot's api keys can connect to bybit looping through all config keys for bot_i
    let i = 1;
    let loop = true;
    let promiseArray = [];
    let data = [];

    while (loop)
    {

        let botNumber = 'bot_' + i;

        // If bot number doesn't exist break we are done
        if (!config[botNumber]) break;

        if (config[botNumber]['api_key'] === undefined)
        {
            const error = new Error('api_key not set with functions:config:set');
            error.http_status = 500;
            error.http_response = `Error ${botNumber} api_key not set`;
            return next(error);
        }

        if (config[botNumber]['secret_key'] === undefined)
        {
            const error = new Error(`${botNumber} secret_key not set with functions:config:set`);
            error.http_status = 500;
            error.http_response = `Error ${botNumber} secret_key not set`;
            return next(error);
        }

        if (config[botNumber]['mode'] !== 'test' && config[botNumber]['mode'] !== 'live')
        {
            const error = new Error(`${botNumber} mode must be set to either live or test with 
			functions:config:set`);
            error.http_status = 500;
            error.http_response = `Error ${botNumber} mode must be set to either live or test`;
            return next(error);
        }

        if (config[botNumber]['platform'] === undefined)
        {
            const error = new Error('platform not set with functions:config:set');
            error.http_status = 500;
            error.http_response = `Error ${botNumber} platform not set`;
            return next(error);
        }
        else if (config[botNumber]['platform'] === 'bybit')
        {
            // We are only testing connection to bybit hard coding to BTCUSD is fine here
            const bybit_client = getByBitClient('BTCUSD', i);

            promiseArray.push(new Promise((resolve, reject) =>
                bybit_client.getApiKeyInfo().then((apiKeyInfoResponse) =>
                {
                    functions.logger.debug(`${botNumber} connecting to bybit`);
                    if (apiKeyInfoResponse.ret_code !== 0)
                    {
                        functions.logger.error(`${botNumber} connection failed ${JSON.stringify(apiKeyInfoResponse)}`);
                        functions.logger.error(`${botNumber} connection failed`);
                        const error = new Error(`${botNumber} could not connect to bybit ${JSON.stringify(apiKeyInfoResponse.ret_msg)}`);
                        error.http_status = 500;
                        error.http_response = `Error ${botNumber} could not connect to bybit`;
                        return reject(error);
                    } else
                    {
                        functions.logger.debug(`${botNumber} connection successful`);
                        return resolve(`${botNumber} connection successful`);
                    }
                }).catch((error) =>
                {
                    return reject(error);
                })))

            i++;
        }
        else if (config[botNumber]['platform'] === 'binance')
        {
            // We are only testing connection to bybit hard coding to BTCUSD is fine here
            const binance = getBinanceClient(i);

            promiseArray.push(new Promise((resolve, reject) =>
                binance.balance()
                    .then((info) =>
                    {
                        if (request.query.token)
                        {
                            data.push(info[request.query.token]);
                        }
                        else
                        {
                            data.push(info);
                        }

                        return resolve(`${botNumber} connection successful`);
                    })
                    .catch(error =>
                    {
                        return reject(error);
                    })));
            i++;
        }
    }

    await Promise.all(promiseArray).then(() =>
    {
        if (request.query.token)
        {
            response.status(200).send(JSON.stringify(data));
        }
        else
        {
            let hidden0balance = [];
            for (let i = 0; i < data.length; ++i)
            {
                for (const key in data[i])
                {
                    const token = data[i][key];
                    if (parseFloat(token.available) !== 0.0 || parseFloat(token.onOrder) !== 0.0)
                        hidden0balance.push({ token: key, available: token.available, onOrder: token.onOrder });

                }
            }
            response.status(200).send(JSON.stringify(hidden0balance));
        }

        return null;
    }).catch(error =>
    {
        return next(error);
    });
    return null;
});

// Use auth for all other requests
app.use(authValidator);

app.post('/', async (request, response, next) =>
{
    functions.logger.info(`${appVersion} Scraper request received`);

    let signalDetails = null;

    try
    {
        if (request.accepts("application/json"))
        {
            signalDetails = request.body;
        } else
        {
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

        let client = null;
        const config = functions.config();
        if (config[`bot_${signalDetails.bot}`]['platform'] === undefined)
        {
            const error = new Error('platform not set with functions:config:set');
            error.http_status = 500;
            error.http_response = `Error ${signalDetails.bot} platform not set`;
            return next(error);
        }
        else if (config[`bot_${signalDetails.bot}`]['platform'] === 'bybit')
        {
            client = getByBitClient(signalDetails.symbol, signalDetails.bot);

            // Open long position
            if (signalDetails.order === "buy" && signalDetails.market_position === "long")
            {
                functions.logger.info(`Opening long position: ${signalDetails.symbol}`);
                await createOrder({
                    response: response,
                    signalDetails: signalDetails,
                    client: client,
                    orderDetails: orderDetails
                });
            }

            // Open short position
            else if (signalDetails.order === "sell" && signalDetails.market_position === "short")
            {
                functions.logger.info(`Opening short position: ${signalDetails.symbol}`);
                await createOrder({
                    response: response,
                    signalDetails: signalDetails,
                    client: client,
                    orderDetails: orderDetails
                });
            }

            // Close long position
            else if (signalDetails.order === "sell" &&
                (signalDetails.market_position === "long" || signalDetails.market_position === "flat"))
            {
                functions.logger.info(`Closing long position: ${signalDetails.symbol}`);
                await stopOrder({
                    response: response, client: client,
                    signalDetails: signalDetails
                });
            }

            // Close short position
            else if (signalDetails.order === "buy" &&
                (signalDetails.market_position === "short" || signalDetails.market_position === "flat"))
            {
                functions.logger.info(`Closing short position: ${signalDetails.symbol}`);
                await stopOrder({
                    response: response, client: client,
                    signalDetails: signalDetails
                });
            }
        }
        //
        // Binance Spot Trading
        //
        else if (config[`bot_${signalDetails.bot}`]['platform'] === 'binance')
        {
            client = getBinanceClient(signalDetails.bot);

            //let exchangeInfo = await client.exchangeInfo();
            let exchangeInfo = await axios.get(`https://api.binance.com/api/v3/exchangeInfo?symbol=${signalDetails.symbol}`)
                .then(response =>
                {
                    let minimums = {};
                    for (let obj of response.data.symbols)
                    {
                        let filters = { status: obj.status };
                        for (let filter of obj.filters)
                        {
                            if (filter.filterType === "MIN_NOTIONAL")
                            {
                                filters.minNotional = filter.minNotional;
                            } else if (filter.filterType === "PRICE_FILTER")
                            {
                                filters.minPrice = filter.minPrice;
                                filters.maxPrice = filter.maxPrice;
                                filters.tickSize = filter.tickSize;
                            } else if (filter.filterType === "LOT_SIZE")
                            {
                                filters.stepSize = filter.stepSize;
                                filters.minQty = filter.minQty;
                                filters.maxQty = filter.maxQty;
                            }
                        }
                        //filters.baseAssetPrecision = obj.baseAssetPrecision;
                        //filters.quoteAssetPrecision = obj.quoteAssetPrecision;
                        filters.orderTypes = obj.orderTypes;
                        filters.icebergAllowed = obj.icebergAllowed;
                        minimums[obj.symbol] = filters;
                    }
                    //console.log(minimums);
                    //fs.writeFile("minimums.json", JSON.stringify(minimums, null, 4), function(err){});
                    return minimums;

                })
                .catch(error =>
                {
                    functions.logger.error(`axios error: ${error}`);
                });
            //functions.logger.debug(exchangeInfo);
            //
            // Correct the price
            //
            //{ "order": "buy", "symbol": "ADABUSD", "comment": "Blue Arrow", "contracts": "5", "order_price": "2.179", "market_position": "long", "market_position_size": "10", "prev_market_position": "long", "prev_market_position_size": "5", "auth_key": "PaTiToMaSteR", "leverage": "1", "bot": "1" }
            let amount = 0.0;
            //
            // Override TV contracts
            //
            if (signalDetails.usd)
            {
                amount = (1.0 / parseFloat(signalDetails.order_price)) * parseFloat(signalDetails.usd);
                functions.logger.info(`Overriding TV contracts variable with fixed usd amount in usd: (1.0 / ${parseFloat(signalDetails.order_price)}) * ${parseFloat(signalDetails.usd)} - contracts: ${amount}`);
            }
            else
            {
                amount = parseFloat(signalDetails.contracts);
            }
            //
            // Round to stepSize
            //
            amount = parseFloat(client.roundStep(amount, exchangeInfo[signalDetails.symbol].stepSize));
            // Set minimum order amount with minQty
            if (amount < parseFloat(exchangeInfo[signalDetails.symbol].minQty))
                amount = parseFloat(exchangeInfo[signalDetails.symbol].minQty);
            //
            // Set minimum order amount with minNotional
            //
            if (parseFloat(signalDetails.order_price) * amount < parseFloat(exchangeInfo[signalDetails.symbol].minNotional))
            {
                amount = parseFloat(exchangeInfo[signalDetails.symbol].minNotional) / parseFloat(signalDetails.order_price);
            }
            // Round to stepSize
            amount = parseFloat(client.roundStep(amount, exchangeInfo[signalDetails.symbol].stepSize));
            //
            // Double check
            //
            while (amount * parseFloat(signalDetails.order_price) <= (parseFloat(exchangeInfo[signalDetails.symbol].minNotional) + 1.0))
            {
                amount += parseFloat(exchangeInfo[signalDetails.symbol].stepSize);
                functions.logger.info(`correcting amount to ${amount} - price: ${amount * signalDetails.order_price}`);
            }
            amount = parseFloat(client.roundStep(amount, exchangeInfo[signalDetails.symbol].stepSize));
            functions.logger.info(`Spot ${signalDetails.order} of ${signalDetails.symbol} -> ${amount}`);

            if (signalDetails.order === 'buy')
            {
                await client.marketBuy(signalDetails.symbol, amount).then((info) =>
                {
                    //functions.logger.debug(JSON.stringify(info));
                    return true;
                }).catch((error) =>
                {
                    const msg = JSON.parse(error.body);
                    functions.logger.error(msg);
                    functions.logger.error(JSON.stringify(error));
                    error.http_status = 500;
                    error.http_response = 'Error canceling all orders';
                    throw error;
                });
            }
            else if (signalDetails.order === 'sell')
            {
                //
                // Sell everything you've got
                //
                /*
                let totalAmount = 0;    // meaning... do not sell everything
                if (parseFloat(signalDetails.market_position_size) === 0)
                {
                    totalAmount = await client.balance().then((balances) => //(error, balances) =>
                    {
                        let assetName;
                        if (signalDetails.symbol.endsWith('BUSD'))
                        {
                            assetName = signalDetails.symbol.split('BUSD')[0];
                        }
                        else if (signalDetails.symbol.endsWith('USDT'))
                        {
                            assetName = signalDetails.symbol.split('USDT')[0];
                        }
                        else if (signalDetails.symbol.endsWith('USDC'))
                        {
                            assetName = signalDetails.symbol.split('USDC')[0];
                        }
                        //functions.logger.debug(`How much I have of ${assetName}`);

                        if (assetName.length !== 0)
                        {
                            //
                            // In Binance fees are lower if you have BNB, so we leave never sell all our BNB
                            //
                            if (signalDetails.symbol === 'BNBBUSD' || signalDetails.symbol === 'BNBUSDT' || signalDetails.symbol === 'USDC')
                            {
                                //functions.logger.debug(`Never selling all BNB ${signalDetails.symbol}`);
                                return 0;
                            }
                            const obj = balances[assetName];
                            return obj.available = parseFloat(obj.available);
                        }
                        return 0;
                        //fs.writeFile("json/balance.json", JSON.stringify(global.balance, null, 4), (err)=>{});
                    }).catch((error) =>
                    {
                        const msg = JSON.parse(error.body);
                        functions.logger.error(msg);
                        functions.logger.error(JSON.stringify(error));
                        error.http_status = 500;
                        error.http_response = 'Error canceling all orders';
                        throw error;
                    });
                }
                const amountToSell = totalAmount !== 0 ? totalAmount : amount;
                functions.logger.debug(`totalAmount: ${totalAmount} amount: ${amount} totalAmount: ${totalAmount} signalDetails.market_position_size: ${signalDetails.market_position_size}`);
                */
                amountToSell = amount;
                await client.marketSell(signalDetails.symbol, amountToSell).then((info) =>
                {
                    //functions.logger.debug(JSON.stringify(info));
                    return true;
                }).catch((error) =>
                {
                    const msg = JSON.parse(error.body);
                    functions.logger.error(msg);
                    functions.logger.error(JSON.stringify(error));
                    error.http_status = 500;
                    error.http_response = 'Error canceling all orders';
                    throw error;
                });
            }
            else
            {
                const msg = `Invalid signalDetails.order: ${signalDetails.order}`;
                const error = new Error(msg);
                error.http_status = 500;
                error.http_response = msg;
                throw error;
            }
            response.status(200).send(`${signalDetails.order} Order Placed Successfully`);
            return true;
        }
    } catch (error)
    {
        return next(error);
    }

    return next()

});


async function authValidator(request, response, next)
{
    functions.logger.debug('Running auth validator');

    // TradingView does not support custom request headers adding basic auth key to request body to give basic
    // security to the api
    if (!functions.config().auth.key)
    {
        const error = new Error('auth.key config key not found');
        error.http_status = 403;
        error.http_response = 'Unauthorized';
        return next(error);
    }

    if (request.body.auth_key === functions.config().auth.key)
    {
        functions.logger.info(`auth.key in request body valid`);
        return next();
    } else
    {
        const error = new Error('auth_key in request body not valid or not provided');
        error.http_status = 403;
        error.http_response = 'Unauthorized';
        return next(error);
    }

}

async function getTotalOrderQty(signalDetails)
{

    // If Inverse contracts convert to USD for bybit api trading view sends it as coin amount
    let totalOrderQty;

    // When trading view goes change market directions it sends the entire size in contracts need to convert to the
    // correct order size when changing directions
    if ((signalDetails.prev_market_position === 'short' && signalDetails.market_position === 'long') ||
        (signalDetails.prev_market_position === 'long' && signalDetails.market_position === 'short'))
    {
        signalDetails.contracts = round((signalDetails.contracts - signalDetails.prev_market_position_size), 6);
        functions.logger.info(`Position changed directions updating contract size to ${signalDetails.contracts}`);
    }

    if (signalDetails.symbol.endsWith('USD'))
    {
        if (!signalDetails.order_price)
        {
            const error = new Error(`order_price must be in request body for inverse contracts`);
            error.http_status = 400;
            error.http_response = `order_price must be in request body for inverse contracts`;
            throw error;
        } else
        {
            totalOrderQty = signalDetails.contracts * signalDetails.order_price;
            return totalOrderQty;
        }

    } else
    {
        totalOrderQty = signalDetails.contracts;
        return totalOrderQty;
    }

}

function round(value, decimals)
{
    return Number(Math.round(value + 'e' + decimals) + 'e-' + decimals);
}


function getByBitClient(symbol, bot_number)
{

    functions.logger.debug('Getting bybit client');

    // Use api and secret key for bot number passed in
    const config = functions.config();
    let bot_config_name = 'bot_' + bot_number;

    if (!config[bot_config_name])
    {
        const error = new Error(`bot ${bot_config_name} not found in config`);
        error.http_status = 400;
        error.http_response = `bot ${bot_config_name} not found in config`;
        throw error;
    }

    let use_live_mode = config[bot_config_name]['mode'] === 'live';

    // Get the right client for the symbol in the request
    if (symbol.endsWith("USDT"))
    {
        return new LinearClient(config[bot_config_name]['api_key'], config[bot_config_name]['secret_key'], use_live_mode);
    } else
    {
        return new InverseClient(config[bot_config_name]['api_key'], config[bot_config_name]['secret_key'], use_live_mode);
    }

}

function getBinanceClient(bot_number)
{
    functions.logger.debug('Getting binance client');

    // Use api and secret key for bot number passed in
    const config = functions.config();
    let bot_config_name = 'bot_' + bot_number;

    if (!config[bot_config_name])
    {
        const error = new Error(`bot ${bot_config_name} not found in config`);
        error.http_status = 400;
        error.http_response = `bot ${bot_config_name} not found in config`;
        throw error;
    }

    let use_live_mode = config[bot_config_name]['mode'] === 'live';

    return new Binance().options({
        APIKEY: config[bot_config_name]['api_key'],
        APISECRET: config[bot_config_name]['secret_key']
    });
}

async function validateRequestBody(signalDetails)
{
    functions.logger.debug('Validating Request Body');

    // Check that all required parameters are in request body
    const bodyParameters = ['bot', 'order', 'symbol', 'contracts', 'leverage', 'market_position'];

    for (const parameter of bodyParameters)
    {
        if (!signalDetails[parameter])
        {
            const error = new Error(`Missing field ${parameter} in request body ${JSON.stringify(signalDetails)}`);
            error.http_status = 400;
            error.http_response = `Missing field ${parameter} in request body ${JSON.stringify(signalDetails)}`;
            throw error;
        }
    }

    if (signalDetails.leverage < 1 || signalDetails.leverage > 100)
    {
        const error = new Error('leverage field must be set between 1 and 100 in request body');
        error.http_status = 400;
        error.http_response = 'leverage field must be set between 1 and 100 in request body';
        throw error;
    }

    if (signalDetails.order !== 'buy' && signalDetails.order !== 'sell')
    {
        const error = new Error('order field must be set to either buy or sell');
        error.http_status = 400;
        error.http_response = 'order field must be set to either buy or sell';
        throw error;
    }

    if (signalDetails.contracts < 0)
    {
        const error = new Error('contracts field must be positive number');
        error.http_status = 400;
        error.http_response = 'contracts field must be positive number';
        throw error;
    }

    if (signalDetails.order_price && signalDetails.order_price < 0)
    {
        const error = new Error('order_price field must be positive number');
        error.http_status = 400;
        error.http_response = 'order_price field must be positive number';
        throw error;
    }

    if (signalDetails.market_position !== 'long' && signalDetails.market_position !== 'short' &&
        signalDetails.market_position !== 'flat')
    {
        const error = new Error('market_position field must be long, short, or flat');
        error.http_status = 400;
        error.http_response = 'market_position field must be long, short, or flat';
        throw error;
    }

    if (signalDetails.prev_market_position)
    {
        if (signalDetails.prev_market_position !== 'long' && signalDetails.prev_market_position !== 'short' &&
            signalDetails.prev_market_position !== 'flat')
        {
            const error = new Error('prev_market_position field must be long, short, or flat');
            error.http_status = 400;
            error.http_response = 'prev_market_position field must be long, short, or flat';
            throw error;
        }
    }

    if (signalDetails.prev_market_position_size)
    {
        if (signalDetails.prev_market_position_size < 0)
        {
            const error = new Error('prev_market_position_size field must be positive number');
            error.http_status = 400;
            error.http_response = 'prev_market_position_size field must be positive number';
            throw error;
        }
    }


}

async function cancelAll(client, signalDetails)
{
    functions.logger.debug(`Canceling all orders ${JSON.stringify(signalDetails)}`);
    const config = functions.config();
    const platform = config[`bot_${signalDetails.bot}`]['platform'];
    //
    // Cancel ALL active orders
    //
    if (platform === 'bybit')
    {
        functions.logger.debug(`Canceling all active orders ${JSON.stringify(signalDetails)}`);
        await client.cancelAllActiveOrders(signalDetails).then((cancelAllActiveOrdersResponse) =>
        {
            if (cancelAllActiveOrdersResponse.ret_code !== 0)
            {
                const error = new Error(`Error canceling all active orders ${cancelAllActiveOrdersResponse.ret_msg}`);
                error.http_status = 500;
                error.http_response = 'Error canceling all active orders';
                throw error;
            }
            return true;
        }).catch((error) =>
        {
            error.http_status = 500;
            error.http_response = 'Error canceling all active orders';
            throw error;
        });

        functions.logger.debug(`Canceling all conditional orders ${JSON.stringify(signalDetails)}`);
        await client.cancelAllConditionalOrders(signalDetails).then((cancelAllConditionalOrdersResponse) =>
        {
            if (cancelAllConditionalOrdersResponse.ret_code !== 0)
            {
                const error = new Error(`Error canceling all conditional orders ${cancelAllConditionalOrdersResponse.ret_msg}`);
                error.http_status = 500;
                error.http_response = 'Error canceling all conditional orders';
                throw error;
            }
            return true;
        }).catch((error) =>
        {
            error.http_status = 500;
            error.http_response = 'Error canceling all conditional orders';
            throw error;
        });
    }
    else if (platform === 'binance')
    {
        functions.logger.debug(`${signalDetails.symbol} ----------------------------------------------`);
        await client.cancelAll(signalDetails.symbol).then((info) =>
        {
            functions.logger.info(JSON.stringify(info));
            return true;
        }).catch((error) =>
        {
            const msg = JSON.parse(error.body);
            //functions.logger.error(msg.code);
            if (msg.code === -2011)    // Nothing to cancel
            {
                functions.logger.info(`Nothing to cancel... ${JSON.stringify(msg)}`);
                return true;
            }
            else
            {
                functions.logger.error(JSON.stringify(error));
                error.http_status = 500;
                error.http_response = 'Error canceling all orders';
                throw error;
            }
        });
    }
    else
    {
        error.http_status = 500;
        error.http_response = 'Platform not defined';
        throw error;
    }
}

async function getCurrentPosition(client, signalDetails, data)
{
    const config = functions.config();
    const platform = config[`bot_${signalDetails.bot}`]['platform'];
    if (platform === 'bybit')
    {
        functions.logger.debug(`Getting current position ${JSON.stringify(data)}`);
        return await client.getPosition(data).then((positionsResponse) =>
        {
            functions.logger.debug(`Positions response ${JSON.stringify(positionsResponse)}`)
            let currentPosition = null;

            // API response is slightly different between Inverse and USDT
            if (data.symbol.endsWith("USDT"))
            {

                let opposite_position_side;
                if (data.order_side === "buy" || data.order_side === "Buy")
                {
                    opposite_position_side = "Sell"
                } else
                {
                    opposite_position_side = "Buy"
                }

                for (let i = 0; i < positionsResponse.result.length; ++i)
                {
                    const position = positionsResponse.result[i];

                    if (position.symbol === data.symbol && position.side === opposite_position_side)
                    {
                        currentPosition = position;
                        return currentPosition;
                    }
                }
            } else
            {
                currentPosition = positionsResponse.result;
                return currentPosition;
            }
            return null;
        }).catch((error) =>
        {
            error.http_status = 500;
            error.http_response = 'Error getting current position';
            throw error;
        });
    }
    else if (platform === 'binance')
    {
        functions.logger.debug(`Getting current position ${JSON.stringify(data)}`);
        const openOrders = await binance.openOrders(data.symbol);
        functions.logger.debug(`openOrders ${JSON.stringify(openOrders)}`);
        return openOrders;
    }
    else
    {
        error.http_status = 500;
        error.http_response = 'Platform not defined';
        throw error;
    }
}

async function closePreviousPosition(signalDetails, currentPosition, client)
{
    const config = functions.config();
    const platform = config[`bot_${signalDetails.bot}`]['platform'];
    if (platform === 'bybit')
    {
        if (currentPosition.side !== "None")
        {
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
            return await client.placeActiveOrder(closingOrder).then((closeActiveOrderResponse) =>
            {
                if (closeActiveOrderResponse.ret_code !== 0)
                {
                    const error = new Error(`Error placing order to close previous position ${closeActiveOrderResponse.ret_msg}`);
                    error.http_status = 500;
                    error.http_response = 'Error placing order to close previous position';
                    throw error;
                }
                functions.logger.info(`ClosePreviousPosition: ${closeActiveOrderResponse.result.symbol} ${closeActiveOrderResponse.result.side} ${closeActiveOrderResponse.result.price} ${closeActiveOrderResponse.result.qty}`);
                return true;
            }).catch((error) =>
            {
                error.http_status = 500;
                error.http_response = 'Error placing order to close previous position';
                throw error;
            });
        }
        else
        {
            return true;
        }
    }
    else if (platform === 'binance')
    {
        return false;
    }
    else
    {
        error.http_status = 500;
        error.http_response = 'Platform not defined';
        throw error;
    }

}

async function placeNewOrder(response, client, orderDetails, conditionalOrderBuffer = null, tradingStopMultiplier = null,
    tradingStopActivationMultiplier = null, stopLossMargin = null, takeProfitMargin = null)
{
    return await client.placeActiveOrder(orderDetails).then(async (placeActiveOrderResponse) =>
    {
        functions.logger.info(`Place active order response ${JSON.stringify(placeActiveOrderResponse)}`);
        if (placeActiveOrderResponse.ret_code === 0)
        {
            if (conditionalOrderBuffer !== 0 || (tradingStopMultiplier === 0 && tradingStopActivationMultiplier === 0 &&
                stopLossMargin === 0 && takeProfitMargin === 0))
            {
                return placeActiveOrderResponse;
            }
            else
            {
                //await secureTransaction(response, placeActiveOrderResponse, client, orderDetails, tradingStopMultiplier,
                //	tradingStopActivationMultiplier, stopLossMargin, takeProfitMargin);
                return placeActiveOrderResponse;
            }
        }
        return placeActiveOrderResponse;
    }).catch((error) =>
    {
        error.http_status = 500;
        error.http_response = 'Place active order Error';
        throw error;
    });
}

async function stopOrder({ response, client, signalDetails })
{
    try
    {
        const config = functions.config();
        const platform = config[`bot_${signalDetails.bot}`]['platform'];
        if (platform === 'bybit')
        {
            await cancelAll(client, signalDetails);

            // Current Position
            const currentPosition = await getCurrentPosition(client, signalDetails, { symbol: signalDetails.symbol, order_side: signalDetails.order });

            // Close Previous Order
            if (currentPosition.size > 0)
            {
                const success = await closePreviousPosition(signalDetails, currentPosition, client);
                success ? response.status(200) : response.status(500);
                response.status(200).send(`${signalDetails.order} order placed successfully`);
            }
            else
            {
                functions.logger.info('There is no current position open')
                response.status(200).send(`There is no current position open`);
            }
        }
        else if (platform === 'binance')
        {
            return;
        }
        else
        {
            error.http_status = 500;
            error.http_response = 'Platform not defined';
            throw error;
        }
    }
    catch (error)
    {
        error.http_status = 500;
        error.http_response = 'Stop order error';
        throw error;
    }

}

async function createOrder({ response, signalDetails, client, orderDetails, conditionalOrderBuffer = null,
    tradingStopMultiplier = null, tradingStopActivationMultiplier = null,
    stopLossMargin = null, takeProfitMargin = null })
{
    const config = functions.config();
    const platform = config[`bot_${signalDetails.bot}`]['platform'];
    if (platform === 'bybit')
    {
        await cancelAll(client, signalDetails);
        // Market Order
        orderDetails.order_type = "Market";

        // Current Position
        const currentPosition = await getCurrentPosition(client, signalDetails, { symbol: orderDetails.symbol, order_side: orderDetails.side });
        if (currentPosition)
        {

            // If opposite side position exists for symbol close that position before opening opposite position
            if (closeOppositeSidePositions && currentPosition.side !== orderDetails.side && currentPosition.size > 0)
            {
                functions.logger.info('Current position is not the same side as requested closing opposite side position');
                await closePreviousPosition(signalDetails, currentPosition, client);
            }

        }

        // Update Leverage
        functions.logger.debug(`Setting User leverage to ${orderDetails.leverage}`);

        // HACK TEST NET API leverage change request parameters are different from LIVE NET API
        // This is only needed until ByBit promotes their code to live.
        let setUserLeverageRequest;
        if (orderDetails.symbol.endsWith("USD"))
        {
            setUserLeverageRequest = { symbol: orderDetails.symbol, leverage: orderDetails.leverage };
        } else
        {
            setUserLeverageRequest = { symbol: orderDetails.symbol, buy_leverage: orderDetails.leverage, sell_leverage: orderDetails.leverage };
        }

        await client.setUserLeverage(setUserLeverageRequest).then((changeLeverageResponse) =>
        {
            functions.logger.debug(JSON.stringify(changeLeverageResponse))
            if (changeLeverageResponse.ret_code !== 0 && changeLeverageResponse.ret_code !== 34036)
            {
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

        // New Order
        functions.logger.debug(`Placing order for ${JSON.stringify(orderDetails)}`);
        await placeNewOrder(response, client, orderDetails, conditionalOrderBuffer, tradingStopMultiplier,
            tradingStopActivationMultiplier, stopLossMargin, takeProfitMargin).then((placeActiveOrderResponse) =>
            {
                if (placeActiveOrderResponse.ret_code !== 0)
                {
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

        response.status(200).send(`${orderDetails.side} Order Placed Successfully`);
        return true;
    }
    else if (platform === 'binance')
    {
        return true;
    }

    response.status(500).send(`Platform for bot ${signalDetails.bot} not defined`);
    return false;
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