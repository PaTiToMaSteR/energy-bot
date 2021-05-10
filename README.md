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

## Supported Requests

### UP - Returns 200 if energy-bot is running
```http
GET /scalper/up
```

### Config Validate - Returns 200 if config validation passes and can connect to bybit

```http
GET /scalper/config/validate
```

### Places an order on bybit - Returns 200 if order was successful
```http
POST /scalper
```
| Parameter | Type | Description |
| :--- | :--- | :--- |
| `bot` | `string` | **Required**. Bot number you want the order to execute on |
| `order` | `string` | **Required**. Order type sell or buy |
| `symbol` | `string` | **Required**. Symbol order should be placed |
| `contracts` | `int` | **Required**. Number of contracts |
| `auth_key` | `string` | **Required**. Auth key set as part of configuration |
| `leverage` | `string` | **Required**. Leverage to use for the order |

```json
{
    "bot": "1",
    "order": "buy",
    "symbol": "BTCUSD",
    "contracts": 1000,
    "auth_key": "replace with auth key you configured",
    "leverage": "1"
}
```

## Installation

Follow setup instructions below

[Set Up Instructions](SETUP.md)

    
## Developing Locally

* Install Firebase CLI
* Run Following commands
```shell
mv ./functions/.runtimeconfig.json.tpl ./functions/.runtimeconfig.json.tpl
# Update .runtimeconfig.json with you keys and settings using your favorite IDE / text editor
vim .runtimeconfig.json
firebase use --add
firebase emulators:start
# Test it is online using your favorite api tests (curl example provided)
curl http://localhost:5001/energy-bot/europe-west1/scalper/up
```
