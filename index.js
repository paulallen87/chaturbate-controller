'use strict';

const debug = require('debug')('chaturbate:controller');
const EventEmitter = require('events').EventEmitter;

const ChaturbateEvents = require('@paulallen87/chaturbate-events');

class ChaturbateController extends EventEmitter {

  constructor(browser) {
    super();
    this._browser = browser;

    this._events = new ChaturbateEvents(browser);
    this._events.on('init', (e) => this._onInit(e));
    this._events.on('socket_open', () => this._onSocketOpen());
    this._events.on('socket_error', (e) => this._onSocketError(e));
    this._events.on('socket_disconnected', (e) => this._onSocketDisconnected(e));

    this._hooks = {};
    this._state = null;

    // general
    this.online = false;
    this.room = null;
    this.gender = null;
    this.welcomeMessage = null;
    this.subject = null;
    this.spyPrice = 0;
    this.viewCount = 0;

    // group shows
    this.groupsEnabled = false;
    this.groupPrice = 0;
    this.groupNumUsersRequired = 0;
    this.groupNumUsersWaiting = 0;

    // private shows
    this.privatesEnabled = false;
    this.privatePrice = 0;

    // unknowns
    this.hidden = false;
    this.privateShow = false;
    this.groupShow = false;

    this._initEventHooks();
    this._patchEvents();
  }

  get eventNames() {
    return this._events.names;
  }

  get state() {
    return this._state;
  }

  set state(val) {
    this._state = state;
    this.emit('state_change', val);
  }

  get settings() {
    return {
      state: this.state,
      online: this.online,
      room: this.room,
      welcomeMessage: this.welcomeMessage,
      subject: this.subject,
      gender: this.gender,
      viewCount: this.viewCount,
      spyPrice: this.spyPrice,
      groupsEnabled: this.groupsEnabled,
      groupPrice: this.groupPrice,
      groupNumUsersRequired: this.groupNumUsersRequired,
      groupNumUsersWaiting: this.groupNumUsersWaiting,
      privatesEnabled: this.privatesEnabled,
      privatePrice: this.privatePrice
    }
  }

  _onInit(e) {
    this.state = 'INIT';

    this.online = !!e.hasWebsocket;

    if (e.chatSettings) {
      this.welcomeMessage = e.chatSettings.welcome_message || '';
      this.spyPrice = e.chatSettings.spy_price || 0;
      this.privatePrice = e.chatSettings.private_price || 0;
      this.groupNumUsersRequired = e.chatSettings.num_users_required_for_group_show || 0;
      this.groupNumUsersWaiting = e.chatSettings.num_users_waiting_for_group_show || 0;
      this.groupPrice = e.chatSettings.group_price || 0;
      this.subject = e.chatSettings.current_subject || '';
      this.gender = e.chatSettings.broadcaster_gender || '';
    }

    if (e.settings) {
      this.groupsEnabled = !!e.settings.groups_enabled;
      this.privatesEnabled = !!e.settings.privates_enabled;
      this.room = e.settings.room || '';

      // TODO: maybe exclude 'connecting'?
      if (e.settings.connected || e.settings.connecting) {
        this._onSocketOpen();
      }
    }
  }

  _onSocketOpen() {
    this.state = 'SOCKET_OPEN';
  }

  _onSocketError() {
    this.state = 'SOCKET_ERROR';
  }

  _onSocketDisconnected() {
    this.state = 'SOCKET_DISCONNECTED';
  }

  _initEventHooks() {
    this._hooks = {
      'settings_update': (e) => this._onHookSettingsUpdate(e),
      'title_change': (e) => this._onHookTitleChange(e),
      'private_show_approved': (e) => this._onHookPrivateShowApproved(e),
      'group_show_request': (e) => this._onHookGroupShowRequest(e),
      'room_count': (e) => this._onHookRoomCount(e),
      'room_entry': (e) => this._onHookRoomEntry(e),
      'room_leave': (e) => this._onHookRoomLeave(e),
      'room_message': (e) => this._onHookRoomMessage(e),
      'tip': (e) => this._onHookTip(e)
    };
  }

  _patchEvents() {
    this.eventNames.forEach((name) => {
      this._events.on(name, (e) => {
        if (this._hooks[name]) {
          debug(`hooked event ${name}`);
          e = this._hooks[name](e);
        }
        this.emit(name, e);
      })
    });
  }

  _onHookSettingsUpdate(e) {
    this.spyPrice = e.spyPrice;
    this.privatePrice = e.privatePrice;
    this.privatesEnabled = e.privatesEnabled;
    this.groupNumUsersRequired = e.minimumUsersForGroupShow;
    this.groupPrice = e.groupPrice;
    this.groupsEnabled = e.allowGroups;
  }

  _onHookTitleChange(e) {
    if (e.title == '') {
      e.title = this.subject;
    } else {
      this.subject = e.title;
    }
    return e;
  }

  _onHookPrivateShowApproved(e) {
    this.privatePrice = e.tokensPerMinute;
    return e;
  }

  _onHookGroupShowRequest(e) {
    this.groupNumUsersRequired = e.usersRequired;
    this.groupNumUsersWaiting = e.usersWaiting;
    this.groupPrice = e.tokensPerMinute;
    return e;
  }

  _onHookRoomCount(e) {
    this.viewCount = e.count;
    return e;
  }

  _onHookRoomEntry(e) {
    e.user.isHost = e.username == this.room;
    return e;
  }

  _onHookRoomLeave(e) {
    e.user.isHost = e.username == this.room;
    return e;
  }

  _onHookRoomMessage(e) {
    e.user.isHost = e.username == this.room;
    return e;
  }

  _onHookTip(e) {
    e.user.isHost = e.username == this.room;
    return e;
  }
}

module.exports = ChaturbateController;