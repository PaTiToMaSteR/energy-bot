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

## Upgrades

Remember to always test upgrades in testnet before using live!

```shell
cd energy-bot
git pull
firebase deploy
```

## Updating Configuration

```shell
cd energy-bot
firebase functions:config:set bot_1.api_key="REPLACE_WITH_BYBIT_API_KEY"
firebase functions:config:set bot_1.secret_key="REPLACE_WITH_BYBIT_SECRET_KEY"
firebase functions:config:set bot_1.mode="'test' for testnet bybit or 'live' for normal bybit"
firebase functions:config:set auth_key="REPLACE_WITH_RANDOM_STRING_OF_LETTERS_AND_NUMBERS"
firebase deploy
```

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
| `auth_key` | `string` | **Required**. Auth key set as part of configuration |
| `leverage` | `string` | **Required**. Leverage to use for the order |
    
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
