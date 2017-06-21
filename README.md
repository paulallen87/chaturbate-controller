Chaturbate Controller
=========

![build status](https://travis-ci.org/paulallen87/chaturbate-controller.svg?branch=master)
![coverage status](https://coveralls.io/repos/github/paulallen87/chaturbate-controller/badge.svg?branch=master)
![dependencies](https://img.shields.io/david/paulallen87/chaturbate-controller.svg)
![dev dependencies](https://img.shields.io/david/dev/paulallen87/chaturbate-controller.svg)
![npm version](https://img.shields.io/npm/v/@paulallen87/chaturbate-controller.svg)


A client for storing and parsing chaturbate-browser events.

The events are published from the [chaturbate-browser](https://github.com/paulallen87/chaturbate-browser) module. Then they are transformed by the [chaturbate-events](https://github.com/paulallen87/chaturbate-events) module. Then this modules handles them to interpret the state of the chaturbate profile

All chaturbate events from [chaturbate-events](https://github.com/paulallen87/chaturbate-events) are proxied through this module. Any events containing a [User Object](#user-obects) will be enhanced with a "isHost" attribute.

## Installation

```shell
npm install @paulallen87/chaturbate-controller
```

## Usage

```javascript
const browser = new ChaturbateBrowser();
const controller = new ChaturbateController(browser);

controller.on('room_message', (e) => {
  console.log(`${e.user.username}: ${e.message}`);
})

controller.on('tip', (e) => {
  console.log(`${e.user.username} tipped ${e.amount} tokens`);
})

await browser.start();

browser.navigate('<username>');

setTimeout(() => browser.stop(), 10 * 1000);
```

## Properties
  * **state** (string)
  * **modelStatus** (string)
  * **appInfo** (Object)
  * **room** (string)
  * **gender** (string)
  * **welcomeMessage** (string)
  * **subject** (string)
  * **spyPrice** (number)
  * **viewCount** (number)
  * **panel** (Object)
  * **groupsEnabled** (boolean)
  * **groupPrice** (number)
  * **groupNumUsersRequired** (number)
  * **groupNumUsersWaiting** (number)
  * **privatesEnabled** (boolean)
  * **privatePrice** (number)

## Events

  ### **state_change**
  Called when the browser hook is initialized.

  ##### states
  * INIT
  * CONNECTING
  * CONNECTED
  * JOINED
  * LEAVE
  * KICKED
  * DISCONNECTED
  * ERROR
  * FAIL
  * OFFLINE

  ### **model_status_change**

  ##### statuses
  * PUBLIC
  * AWAY
  * PRIVATE
  * GROUP

## Chaturbate Events

All events from [chaturbate-events](https://github.com/paulallen87/chaturbate-events#events) are proxies through this module.

## User Objects

  User Objects from [tip](https://github.com/paulallen87/chaturbate-events#tip), [room_leave](https://github.com/paulallen87/chaturbate-events#room_leave), [room_join](https://github.com/paulallen87/chaturbate-events#room_join), and [room_message](https://github.com/paulallen87/chaturbate-events#room_message) events are enhanced with an **isHost** attribute.

  See [chaturbate-events](https://github.com/paulallen87/chaturbate-events#user-objects) for more details.

## Tests

```shell
npm test
```