# energy-bot
Friendly and community driven bot to be used with Energy Blast TradingView script or any other to place bybit orders via
web hooks. Designed to be deployed to Google Firebase to allow users who are not tech-savvy to easily set up energy bot. 
The bot supports *Long market orders* and *Short market orders* at this time. All active orders and conditional orders 
are canceled when the bot receives an order. When energy bot receives a sell or buy order that is the opposite side of
current position the entire position is closed no matter the number of contracts in the request. 
The symbol you are training *must be set to isolated margin* or the bot will fail.

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
I'm alive running version 1.0.5.0
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
    "market_position": "",
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
| `market_position` | `string` | **Required**. Market Position long, short, or flat |
| `symbol` | `string` | **Required**. Symbol order should be placed |
| `contracts` | `int` | **Required**. Number of contracts in coin amounts |
| `order_price` | `int` | **Optional**. Entry price of order (required for inverse contracts only, bybit api requires amount in USD for inverse) |
| `auth_key` | `string` | **Required**. Auth key set as part of configuration |
| `leverage` | `string` | **Required**. Leverage to use for the order |

## Upgrades

Remember to always test upgrades in testnet before using live!

If this is your first time setting up energy-bot follow [Set Up Instructions](SETUP.md) instead of this section

* Windows
    * Open Program *firebase-tools-instant-win.exe*
* Mac OS
   * Open Program *Terminal*
* Run the following commands in firebase cli (windows) or terminal (mac os)
```shell
cd %USERPROFILE%\energy-bot # for windows
cd $HOME/energy-bot # for mac os
# Note if git is not found run the 2nd command
git pull https://github.com/PaTiToMaSteR/energy-bot.git
# This one is only needed if first one does not work 
"%ProgramFiles%\Git\cmd\git.exe" pull https://github.com/PaTiToMaSteR/energy-bot.git
cd functions
# NPM install might throw a warning it can be ignored
npm install
cd ../
firebase deploy
```
* Perform Step 6 in setup instructions to ensure your energy-bot is still running
  [Set Up Instructions](SETUP.md)
  
## Viewing Current Configuration

Run the following commands to see the current configuration values

```shell
cd %USERPROFILE% # for windows
cd $HOME # for mac os
cd energy-bot
firebase functions:config:get
```

## Updating Configuration

You only need to run the functions:config:set commands for the values you want to change

Deploy command must always be run for any config values to take

```shell
cd %USERPROFILE% # for windows
cd $HOME # for mac os
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
