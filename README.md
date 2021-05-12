# energy-bot
Friendly and community driven bot to be used with Energy Blast TradingView script or any other to place bybit orders via
web hooks. Designed to be deployed to Google Firebase to allow users who are not tech-savvy to easily set up energy bot. 
The bot only supports *Long market orders* at this time. All active orders and conditional orders are canceled when 
the bot receives an order. When energy bot receives a sell order the entire long position is closed no matter the number 
of contracts in the request.

*THIS SOFTWARE COMES WITH NO WARRANTY!*

*USE AT YOUR OWN RISK! ALWAYS TEST IN BYBIT TEST BEFORE USING ON REAL MONEY!*

## Features

* Places orders on Bybit via post webhook
* Easy to deploy on Google Firebase
* Cheap to run
* Supports unlimited Bybit accounts via dynamic configuration
* Basic authentication via an auth key

## Pre-requirements for Installation

The following are required before beginning the Installation

* Bybit Account
* TradingView Account
* Google Account
* Modern Web browser
* Git

## Installation

Follow setup instructions below

[Set Up Instructions](SETUP.md)

## Supported Requests

### UP - Returns 200 if energy bot is up and running

Request
```http
GET /scalper/up
```
Response
```http
I'm alive running version 1.0.4.2
```

### Config Validate - Returns 200 if config validation passes and can connect to bybit

Request
```http
GET /scalper/config/validate
```
Response
```http
Configuration Validation Successful
```

### Places an order on bybit - Returns 200 if order was successful
Request
```http
POST /scalper
Content-Type: application/json
{
    "bot": "",
    "order": "",
    "symbol": "",
    "contracts": "",
    "auth_key": "",
    "leverage": ""
}
```

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `bot` | `string` | **Required**. Bot number you want the order to execute on |
| `order` | `string` | **Required**. Order type sell or buy |
| `symbol` | `string` | **Required**. Symbol order should be placed |
| `contracts` | `int` | **Required**. Number of contracts |
| `order_price` | `int` | **Optional**. Entry price of order (if set total order is contracts * order_price * leverage) |
| `auth_key` | `string` | **Required**. Auth key set as part of configuration |
| `leverage` | `string` | **Required**. Leverage to use for the order |

## Upgrades

Remember to always test upgrades in testnet before using live!

```shell
cd energy-bot
git pull
cd functions
npm install
cd ../
firebase deploy
```

## Updating Configuration

You only need to run the functions:config:set commands for the values you want to change

Deploy command must always be run for any config values to take

```shell
cd energy-bot
firebase functions:config:set bot_1.api_key="REPLACE_WITH_BYBIT_API_KEY"
firebase functions:config:set bot_1.secret_key="REPLACE_WITH_BYBIT_SECRET_KEY"
firebase functions:config:set bot_1.mode="'test' for testnet bybit or 'live' for normal bybit"
firebase functions:config:set auth.key="REPLACE_WITH_RANDOM_STRING_OF_LETTERS_AND_NUMBERS"
# NOTE you can repeat the bot config keys to support multiple bots by adding bot_2.api_key bot_2.secret_key bot_2.mode
# This can be repeated any number of times but must go in number order i.e. you cannot add bot_4.api_key without
# having a bot 1, 2, and 3 configured first
firebase deploy
```

## Logs

you can see the logs by TODO

## Developing Locally

* Install Firebase CLI https://firebase.google.com/docs/cli
* Run Following commands
```shell
git clone https://github.com/PaTiToMaSteR/energy-bot.git
cd energy-bot
mv ./functions/.runtimeconfig.json.tpl ./functions/.runtimeconfig.json.tpl
# Update .runtimeconfig.json with you keys and settings using your favorite IDE / text editor
vim .runtimeconfig.json
firebase use --add
firebase emulators:start
# Test it is online using your favorite api tests (curl example provided)
curl http://localhost:5001/energy-bot/europe-west1/scalper/up
```
