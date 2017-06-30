'use strict';

const debug = require('debug')('chaturbate:controller');
const EventEmitter = require('events').EventEmitter;
const cheerio = require('cheerio');

const ChaturbateEvents = require('@paulallen87/chaturbate-events');
const panelParser = require('@paulallen87/chaturbate-panel-parser');

const State = {
  INIT: 'INIT',
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED',
  JOINED: 'JOINED',
  LEAVE: 'LEAVE',
  KICKED: 'KICKED',
  DISCONNECTED: 'DISCONNECTED',
  ERROR: 'ERROR',
  FAIL: 'FAIL',
  OFFLINE: 'OFFLINE'
}

const ModelStatus = {
  PUBLIC: 'PUBLIC',
  AWAY: 'AWAY',
  PRIVATE: 'PRIVATE',
  GROUP: 'GROUP'
}

class ChaturbateController extends EventEmitter {

  constructor(browser) {
    super();
    this._browser = browser;

    this._events = new ChaturbateEvents(browser);
    this._events.on('init', (e) => this._onInit(e));
    this._events.on('socket_open', () => this._onSocketOpen());
    this._events.on('socket_error', (e) => this._onSocketError(e));
    this._events.on('socket_close', (e) => this._onSocketClose(e));

    this._api = {};
    this._hooks = {};
    
    // state
    this._state = null;
    this._modelStatus = null;
    this._appInfo = [];
    this._goal = null;

    // general
    this.room = null;
    this.gender = null;
    this.welcomeMessage = null;
    this.subject = null;
    this.spyPrice = 0;
    this.viewCount = 0;

    // ui
    this.panel = [];

    // group shows
    this.groupsEnabled = false;
    this.groupPrice = 0;
    this.groupNumUsersRequired = 0;
    this.groupNumUsersWaiting = 0;

    // private shows
    this.privatesEnabled = false;
    this.privatePrice = 0;

    // TODO: unknowns
    this.hidden = false;

    this._initEventHooks();
    this._patchEvents();
  }

  get eventNames() {
    return this._events.names.concat([
      'state_change',
      'model_status_change',
      'goal_progress',
      'goal_reached'
    ]);
  }

  get state() {
    return this._state;
  }

  set state(val) {
    if (this._state != val) {
      debug(`state changed to ${val}`)
      this._state = val;
      this.emit('state_change', {state: val});
    }
  }

  get modelStatus() {
    return this._modelStatus;
  }

  set modelStatus(val) {
    if (this._modelStatus != val) {
      debug(`model status changed to ${val}`)
      this._modelStatus = val;
      this.emit('model_status_change', {status: val});
    }
  }

  get panelApp() {
    if (!this.appInfo) return;
    if (!this.appInfo.length) return;
    return this.appInfo[0].name;
  }

  get goal() {
    return this._goal;
  }

  set goal(val) {
    this._checkGoal(this._goal, val);
    this._goal = val;
  }

  get settings() {
    return {
      state: this.state,
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
      privatePrice: this.privatePrice,
      modelStatus: this.modelStatus,
      panel: this.panel,
      appInfo: this.appInfo,
      goal: this.goal
    }
  }

  get api() {
    return this._api;
  }

  set api(settings) {
    this._api = {
      getPanelUrl: settings.get_panel_url
    }
  }

  get appInfo() {
    return this._appInfo;
  }

  set appInfo(val) {
    this._appInfo = val.split(',').map((app) => {
      const [name, url] = app.split('|');
      if (!url) return {};
      const [unused, slot] = url.match(/\?slot=(\d+)/);
      return {
        name: name,
        url: url,
        slot: slot
      }
    });
  }

  async _onInit(e) {

    if (e.hasWebsocket) {
      this.state = State.INIT;
    } else {
      this.state = State.OFFLINE;
    }

    if (e.chatSettings) {
      this.welcomeMessage = e.chatSettings.welcome_message || '';
      this.spyPrice = e.chatSettings.spy_price || 0;
      this.privatePrice = e.chatSettings.private_price || 0;
      this.groupNumUsersRequired = e.chatSettings.num_users_required_for_group_show || 0;
      this.groupNumUsersWaiting = e.chatSettings.num_users_waiting_for_group_show || 0;
      this.groupPrice = e.chatSettings.group_price || 0;
      this.subject = e.chatSettings.current_subject || '';
      this.gender = e.chatSettings.broadcaster_gender || '';
      this.appInfo = e.chatSettings.app_info_json || '';

      this.api = e.chatSettings;
      this.panel = this._transformPanelHtml(await this._browser.fetch(this.api.getPanelUrl, {
        '_': (new Date()).getTime()
      }));
      this.goal = panelParser(this.panelApp, this.panel);;
    }

    if (e.settings) {
      this.groupsEnabled = !!e.settings.groups_enabled;
      this.privatesEnabled = !!e.settings.privates_enabled;
      this.room = e.settings.room || '';

      if (e.settings.connecting) {
        this.state = State.CONNECTING;
      }

      if (e.settings.connected) {
        this.state = State.CONNECTED;
      }
    }

    if (e.initializerSettings) {
      this.modelStatus = (e.initializerSettings.model_status || '').toUpperCase();

      if (e.initializerSettings.joined) {
        this.state = State.JOINED;
      }
    }

    debug(this.settings);
    this.emit('init', this.settings)
  }

  
  _onSocketOpen() {
    this.state = State.CONNECTING;
  }

  _onSocketError() {
    this.state = State.ERROR;
  }

  _onSocketClose() {
    this.state = State.DISCONNECTED;
  }

  _initEventHooks() {
    this._hooks = {
      'auth': this._onHookAuth,
      'joined_room': this._onHookJoinedRoom,
      'leave_room': this._onHookLeaveRoom,
      'personally_kicked': this._onHookPersonallyKicked,
      'away_mode_cancel': this._onHookAwayModeCancel,
      'app_tab_refresh': this._onHookAppTabRefresh,
      'clear_app': this._onHookClearApp,
      'refresh_panel': this._onHookRefreshPanel,
      'settings_update': this._onHookSettingsUpdate,
      'title_change': this._onHookTitleChange,
      'private_show_approved': this._onHookPrivateShowApproved,
      'private_show_cancel': this._onHookPrivateShowCancel,
      'group_show_approve': this._onHookGroupShowApprove,
      'group_show_cancel': this._onHookGroupShowCancel,
      'group_show_request': this._onHookGroupShowRequest,
      'room_count': this._onHookRoomCount,
      'room_entry': this._onHookRoomEntry,
      'room_leave': this._onHookRoomLeave,
      'room_message': this._onHookRoomMessage,
      'tip': this._onHookTip
    };
  }

  _patchEvents() {
    this.eventNames.forEach((name) => {
      this._events.on(name, async (e) => {
        if (this._hooks[name]) {
          debug(`hooked event ${name}`);
          try {
            e = await this._hooks[name].call(this, e);
          } catch(e) {
            debug(`hook failed for ${name}`)
            debug(e)
          }
        }
        this.emit(name, e);
      })
    });
  }

  _transformPanelHtml(html) {
    const $ = cheerio.load(html);

    const transformed = $('tr').map((index, el) => {
      let label = $(el).find('th').text()
      label = label.replace(/\s*\n\s*/g, '');
      label = label.replace(/\s*:\s*$/g, '');
      label = label.replace(/\s*-\s*$/g, '');

      let value = $(el).find('td').text()
      value = value.replace(/\s*\n\s*/g, '');

      return {
        label: label,
        value: value
      };
    });

    return transformed.get();
  }

  _checkGoal(oldGoal, newGoal) {
    if (!oldGoal || !newGoal) return;

    if (newGoal.goalCurrent != oldGoal.goalCurrent) {
      this.emit('goal_progress', newGoal);
    }

    if (this.hasMultipleGoals) {
      if (newGoal.goalCount > oldGoal.goalCount) {
        this.emit('goal_reached', newGoal);
      }
    }
    else {
      if (!newGoal.goalRemaining && oldGoal.goalRemaining) {
        this.emit('goal_reached', newGoal);
      }
    }
  }

  async _onHookAuth(e) {
    if (e.success) {
      this.state = State.CONNECTED;
    } else {
      this.state = State.FAIL;
    }
    return e;
  }

  async _onHookJoinedRoom(e) {
    this.state = State.JOINED;
    return e;
  }

  async _onHookLeaveRoom(e) {
    this.state = State.LEAVE;
    return e;
  }

  async _onHookPersonallyKicked(e) {
    this.state = State.KICKED;
  }

  async _onHookAppTabRefresh(e) {
    // Reload the page to get the new apps
    if (this.room && this.room.length) {
      await this._browser.profile(this.room);
    }

    const html = await this._browser.fetch(this.api.getPanelUrl);
    this.panel = this._transformPanelHtml(html);
    this.goal = panelParser(this.panelApp, this.panel);;
    return {
      'panel': this.panel,
      'goal': this.goal
    }
  }

  async _onHookClearApp(e) {
    const html = await this._browser.fetch(this.api.getPanelUrl);
    this.panel = this._transformPanelHtml(html);
    this.goal = panelParser(this.panelApp, this.panel);;
    return {
      'panel': this.panel,
      'goal': this.goal
    }
  }

  async _onHookRefreshPanel(e) {
    const html = await this._browser.fetch(this.api.getPanelUrl);
    this.panel = this._transformPanelHtml(html);
    this.goal = panelParser(this.panelApp, this.panel);;
    return {
      'panel': this.panel,
      'goal': this.goal
    }
  }

  async _onHookAwayModeCancel(e) {
    this.modelStatus = ModelStatus.PUBLIC;
    return e;
  }

  async _onHookSettingsUpdate(e) {
    this.spyPrice = e.spyPrice;
    this.privatePrice = e.privatePrice;
    this.privatesEnabled = e.privatesEnabled;
    this.groupNumUsersRequired = e.minimumUsersForGroupShow;
    this.groupPrice = e.groupPrice;
    this.groupsEnabled = e.allowGroups;
    return e;
  }

  async _onHookTitleChange(e) {
    if (e.title == '') {
      e.title = this.subject;
    } else {
      this.subject = e.title;
    }
    return e;
  }

  async _onHookPrivateShowApproved(e) {
    this.modelStatus = ModelStatus.PRIVATE;
    this.privatePrice = e.tokensPerMinute;
    return e;
  }

  async _onHookPrivateShowCancel(e) {
    this.modelStatus = ModelStatus.AWAY;
    return e;
  }

  async _onHookGroupShowApprove(e) {
    this.modelStatus = ModelStatus.GROUP;
    this.groupPrice = e.tokensPerMinute;
    return e;
  }

  async _onHookGroupShowCancel() {
    this.modelStatus = ModelStatus.AWAY;
    return e;
  }

  async _onHookGroupShowRequest(e) {
    this.groupNumUsersRequired = e.usersRequired;
    this.groupNumUsersWaiting = e.usersWaiting;
    this.groupPrice = e.tokensPerMinute;
    return e;
  }

  async _onHookRoomCount(e) {
    this.viewCount = e.count;
    return e;
  }

  async _onHookRoomEntry(e) {
    e.user.isHost = e.user.username == this.room;
    return e;
  }

  async _onHookRoomLeave(e) {
    e.user.isHost = e.user.username == this.room;
    return e;
  }

  async _onHookRoomMessage(e) {
    e.user.isHost = e.user.username == this.room;
    return e;
  }

  async _onHookTip(e) {
    e.user.isHost = e.user.username == this.room;
    return e;
  }
}

module.exports = ChaturbateController;