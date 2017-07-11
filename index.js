'use strict';

const debug = require('debug')('chaturbate:controller');
const {EventEmitter} = require('events');
const cheerio = require('cheerio');

const ChaturbateEvents = require('@paulallen87/chaturbate-events');
const panelParser = require('@paulallen87/chaturbate-panel-parser');

/**
 * Controller states.
 *
 * @enum {string}
 */
const State = {

  /** The websocket is connected. */
  CONNECTED: 'CONNECTED',

  /** The websocket is connecting. */
  CONNECTING: 'CONNECTING',

  /** The websocket has disconnected. */
  DISCONNECTED: 'DISCONNECTED',

  /** The websocket has thrown an error. */
  ERROR: 'ERROR',

  /** The websocket has filed to authenticate. */
  FAIL: 'FAIL',

  /** The controller is initializing. */
  INIT: 'INIT',

  /** The websocket has successfully joined the room. */
  JOINED: 'JOINED',

  /** You have been kicked from the room. */
  KICKED: 'KICKED',

  /** You have left the room. */
  LEAVE: 'LEAVE',

  /** The room is offline. */
  OFFLINE: 'OFFLINE',
};

/**
 * Model states.
 *
 * @enum {string}
 */
const ModelStatus = {

  /** The model is away from the room. */
  AWAY: 'AWAY',

  /** The model is in a group show. */
  GROUP: 'GROUP',

  /** The model is in a hidden show. */
  HIDDEN: 'HIDDEN',

  /** The model is in a private show. */
  PRIVATE: 'PRIVATE',

  /** The model is in a public show. */
  PUBLIC: 'PUBLIC',
};

/**
 * Transforms Panel HTML into an object.
 *
 * @param {string} html 
 * @return {Object}
 * @private
 */
const _transformPanelHtml = (html) => {
  const $ = cheerio.load(html);

  const transformed = $('tr').map((index, el) => {
    let label = $(el).find('th').text();
    label = label.replace(/\s*\n\s*/g, '');
    label = label.replace(/\s*:\s*$/g, '');
    label = label.replace(/\s*-\s*$/g, '');

    let value = $(el).find('td').text();
    value = value.replace(/\s*\n\s*/g, '');

    return {
      label: label,
      value: value,
    };
  });

  return transformed.get();
};

/**
 * A controller for tracking chaturbate events and states.
 */
class ChaturbateController extends EventEmitter {

  /**
   * Constructor.
   * 
   * @param {ChaturbateBrowser} browser
   * @constructor
   * @extends EventEmitter
   */
  constructor(browser) {
    super();
    this._browser = browser;

    this._events = new ChaturbateEvents(browser);
    this._events.on('init', (e) => this._onInit(e));
    this._events.on('socket_hooked', (e) => this._onInit(e));
    this._events.on('socket_open', () => this._onSocketOpen());
    this._events.on('socket_error', (e) => this._onSocketError(e));
    this._events.on('socket_close', (e) => this._onSocketClose(e));

    this._api = {};
    this._hooks = {};

    // State
    this._state = null;
    this._modelStatus = null;
    this._appInfo = [];
    this._goal = null;

    // General
    this.room = null;
    this.gender = null;
    this.welcomeMessage = null;
    this.subject = null;
    this.spyPrice = 0;
    this.viewCount = 0;

    // Ui
    this.panel = [];

    // Group shows
    this.groupsEnabled = false;
    this.groupPrice = 0;
    this.groupNumUsersRequired = 0;
    this.groupNumUsersWaiting = 0;

    // Private shows
    this.privatesEnabled = false;
    this.privatePrice = 0;

    this._initEventHooks();
    this._patchEvents();
  }

  /**
   * Gets a list of supported event names.
   * 
   * @type {Array<string>}
   */
  get eventNames() {
    return this._events.names.concat([
      'model_status_change',
      'state_change',
      'goal_progress',
      'goal_reached',
    ]);
  }

  /**
   * Getter for the current state of the controller.
   * 
   * @type {State}
   */
  get state() {
    return this._state;
  }

  /**
   * Setter for the current state of the controller.
   * 
   * @param {State} val
   * @ignore
   */
  set state(val) {
    if (this._state !== val) {
      debug(`state changed to ${val}`);
      this._state = val;
      this.emit('state_change', {state: val});
    }
  }

  /**
   * Getter for the current model status.
   * 
   * @type {ModelStatus}
   */
  get modelStatus() {
    return this._modelStatus;
  }

  /**
   * Setter for the current model status.
   * 
   * @param {ModelStatus} val
   * @ignore
   */
  set modelStatus(val) {
    if (this._modelStatus !== val) {
      debug(`model status changed to ${val}`);
      this._modelStatus = val;
      this.emit('model_status_change', {status: val});
    }
  }

  /**
   * Getter for the current panel app (not bot).
   * 
   * @type {string}
   */
  get panelApp() {
    if (!this.appInfo) return undefined;
    if (!this.appInfo.length) return undefined;
    return this.appInfo[0].name;
  }

  /**
   * Getter for the current panel app (not bot).
   * 
   * @type {Object}
   */
  get goal() {
    return this._goal;
  }

  /**
   * Getter for the current panel app (not bot).
   * 
   * @param {Object} val
   * @ignore
   */
  set goal(val) {
    this._checkGoal(this._goal, val);
    this._goal = val;
  }

  /**
   * Getter for the current room settings.
   *
   * @type {Object}
   */
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
      goal: this.goal,
    };
  }

  /**
   * Getter for API endpoints.
   *
   * @type {Object}
   */
  get api() {
    return this._api;
  }

  /**
   * Setter for API endpoints.
   *
   * @param {Object} settings
   * @ignore
   */
  set api(settings) {
    this._api = {
      getPanelUrl: settings.get_panel_url,
    };
  }

  /**
   * Getter for current app info.
   *
   * @type {Object}
   */
  get appInfo() {
    return this._appInfo;
  }

  /**
   * Setter for current app info.
   *
   * @param {string} val
   * @ignore
   */
  set appInfo(val) {
    this._appInfo = val.split(',').map((app) => {
      const [name, url] = app.split('|');
      if (!url) return {};
      // eslint-disable-next-line no-unused-vars
      const [unused, slot] = url.match(/\?slot=(\d+)/);
      return {
        name: name,
        url: url,
        slot: slot,
      };
    });
  }

  /**
   * Called when the websocket is initialized.
   *
   * @param {Object} e 
   * @private
   */
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
      this.groupNumUsersRequired =
          e.chatSettings.num_users_required_for_group_show || 0;
      this.groupNumUsersWaiting =
          e.chatSettings.num_users_waiting_for_group_show || 0;
      this.groupPrice = e.chatSettings.group_price || 0;
      this.subject = e.chatSettings.current_subject || '';
      this.gender = e.chatSettings.broadcaster_gender || '';
      this.appInfo = e.chatSettings.app_info_json || '';

      this.api = e.chatSettings;
      this.panel = _transformPanelHtml(
          await this._browser.fetch(this.api.getPanelUrl, {
            '_': (new Date()).getTime(),
          }));
      this.goal = panelParser(this.panelApp, this.panel);
    }

    if (e.settings) {
      this.groupsEnabled = Boolean(e.settings.groups_enabled);
      this.privatesEnabled = Boolean(e.settings.privates_enabled);
      this.room = e.settings.room || '';

      if (e.settings.connecting) {
        this.state = State.CONNECTING;
      }

      if (e.settings.connected) {
        this.state = State.CONNECTED;
      }
    }

    if (e.initializerSettings) {
      this.modelStatus = (e.initializerSettings.model_status || '')
          .toUpperCase();

      if (e.initializerSettings.joined) {
        this.state = State.JOINED;
      }
    }

    debug(this.settings);
    this.emit('init', this.settings);
  }

  /**
   * Called when the websocket is opened.
   * 
   * @private
   */
  _onSocketOpen() {
    this.state = State.CONNECTING;
  }

  /**
   * Called when the websocket throws an error.
   * 
   * @private
   */
  _onSocketError() {
    this.state = State.ERROR;
  }

  /**
   * Called when the websocket closes.
   * 
   * @private
   */
  _onSocketClose() {
    this.state = State.DISCONNECTED;
  }

  /**
   * Creates hooks for websock messages.
   * 
   * @private
   */
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
      'hidden_show_status_change': this._onHookHiddenShowStatusChange,
      'room_count': this._onHookRoomCount,
      'room_entry': this._onHookRoomEntry,
      'room_leave': this._onHookRoomLeave,
      'room_message': this._onHookRoomMessage,
      'tip': this._onHookTip,
    };
  }

  /**
   * Attaches hooks specific websock messages.
   * 
   * @private
   */
  _patchEvents() {
    this.eventNames.forEach((name) => {
      this._events.on(name, async(e) => {
        let result = e;
        if (this._hooks[name]) {
          debug(`hooked event ${name}`);
          try {
            result = await this._hooks[name].call(this, e);
            debug(result);
          } catch (err) {
            debug(`hook failed for ${name}`);
            debug(e);
          }
        }
        this.emit(name, result);
      });
    });
  }

  /**
   * Manually checks for Goal events.
   *
   * @param {Object} oldGoal 
   * @param {Object} newGoal 
   */
  _checkGoal(oldGoal, newGoal) {
    if (!oldGoal || !newGoal) return;

    if (newGoal.goalCurrent !== oldGoal.goalCurrent) {
      this.emit('goal_progress', newGoal);
    }

    if (this.hasMultipleGoals) {
      if (newGoal.goalCount > oldGoal.goalCount) {
        this.emit('goal_reached', newGoal);
      }
    } else if (!newGoal.goalRemaining && oldGoal.goalRemaining) {
        this.emit('goal_reached', newGoal);
      }
  }

  /**
   * Hooks the Auth event.
   *
   * @param {Object} e
   * @return {Object} 
   */
  _onHookAuth(e) {
    if (e.success) {
      this.state = State.CONNECTED;
    } else {
      this.state = State.FAIL;
    }
    return e;
  }

  /**
   * Hooks the Join Room event.
   *
   * @param {Object} e
   * @return {Object} 
   */
  _onHookJoinedRoom(e) {
    this.state = State.JOINED;
    return e;
  }

  /**
   * Hooks the Leave Room event.
   *
   * @param {Object} e
   * @return {Object} 
   */
  _onHookLeaveRoom(e) {
    this.state = State.LEAVE;
    return e;
  }

  /**
   * Hooks the Personally Kicked event.
   *
   * @param {Object} e
   * @return {Object} 
   */
  _onHookPersonallyKicked(e) {
    this.state = State.KICKED;
    return e;
  }

  /**
   * Hooks the App Tab Refresh event.
   *
   * @param {Object} e
   * @return {Object} 
   */
  async _onHookAppTabRefresh(e) {
    // Reload the page to get the new apps
    if (this.room && this.room.length) {
      await this._browser.profile(this.room);
    }

    const html = await this._browser.fetch(this.api.getPanelUrl);
    this.panel = _transformPanelHtml(html);
    this.goal = panelParser(this.panelApp, this.panel);
    return {
      'panel': this.panel,
      'goal': this.goal,
    };
  }

  /**
   * Hooks the App Clear event.
   *
   * @param {Object} e
   * @return {Object} 
   */
  async _onHookClearApp(e) {
    const html = await this._browser.fetch(this.api.getPanelUrl);
    this.panel = _transformPanelHtml(html);
    this.goal = panelParser(this.panelApp, this.panel);
    return {
      'panel': this.panel,
      'goal': this.goal,
    };
  }

  /**
   * Hooks the Refresh Panel event.
   *
   * @param {Object} e
   * @return {Object} 
   */
  async _onHookRefreshPanel(e) {
    const html = await this._browser.fetch(this.api.getPanelUrl);
    this.panel = _transformPanelHtml(html);
    this.goal = panelParser(this.panelApp, this.panel);
    return {
      'panel': this.panel,
      'goal': this.goal,
    };
  }

  /**
   * Hooks the Away Mode Cancel event.
   *
   * @param {Object} e
   * @return {Object} 
   */
  _onHookAwayModeCancel(e) {
    this.modelStatus = ModelStatus.PUBLIC;
    return e;
  }

  /**
   * Hooks the Settings Update event.
   *
   * @param {Object} e
   * @return {Object} 
   */
  _onHookSettingsUpdate(e) {
    this.spyPrice = e.spyPrice;
    this.privatePrice = e.privatePrice;
    this.privatesEnabled = e.privatesEnabled;
    this.groupNumUsersRequired = e.minimumUsersForGroupShow;
    this.groupPrice = e.groupPrice;
    this.groupsEnabled = e.allowGroups;
    return e;
  }

  /**
   * Hooks the Title Change event.
   *
   * @param {Object} e
   * @return {Object} 
   */
  _onHookTitleChange(e) {
    if (e.title === '') {
      e.title = this.subject;
    } else {
      this.subject = e.title;
    }
    return e;
  }

  /**
   * Hooks the Private Show Approve event.
   *
   * @param {Object} e
   * @return {Object} 
   */
  _onHookPrivateShowApproved(e) {
    this.modelStatus = ModelStatus.PRIVATE;
    this.privatePrice = e.tokensPerMinute;
    return e;
  }

  /**
   * Hooks the Private Show Cancel event.
   *
   * @param {Object} e
   * @return {Object} 
   */
  _onHookPrivateShowCancel(e) {
    this.modelStatus = ModelStatus.AWAY;
    return e;
  }

  /**
   * Hooks the Group Show Approve event.
   *
   * @param {Object} e
   * @return {Object} 
   */
  _onHookGroupShowApprove(e) {
    this.modelStatus = ModelStatus.GROUP;
    this.groupPrice = e.tokensPerMinute;
    return e;
  }

  /**
   * Hooks the Group Show Cancel event.
   *
   * @param {Object} e
   * @return {Object} 
   */
  _onHookGroupShowCancel(e) {
    this.modelStatus = ModelStatus.AWAY;
    return e;
  }

  /**
   * Hooks the Group Show Request event.
   *
   * @param {Object} e
   * @return {Object} 
   */
  _onHookGroupShowRequest(e) {
    this.groupNumUsersRequired = e.usersRequired;
    this.groupNumUsersWaiting = e.usersWaiting;
    this.groupPrice = e.tokensPerMinute;
    return e;
  }

  /**
   * Hooks the Hidden Show Status Change event.
   *
   * @param {Object} e
   * @return {Object} 
   */
  _onHookHiddenShowStatusChange(e) {
    this.modelStatus = e.isStarting ? ModelStatus.HIDDEN : ModelStatus.PUBLIC;
    return e;
  }

  /**
   * Hooks the Room Count event.
   *
   * @param {Object} e
   * @return {Object} 
   */
  _onHookRoomCount(e) {
    this.viewCount = e.count;
    return e;
  }

  /**
   * Hooks the Room Entry event.
   *
   * @param {Object} e
   * @return {Object} 
   */
  _onHookRoomEntry(e) {
    e.user.isHost = e.user.username === this.room;
    return e;
  }

  /**
   * Hooks the Room Leave event.
   *
   * @param {Object} e
   * @return {Object} 
   */
  _onHookRoomLeave(e) {
    e.user.isHost = e.user.username === this.room;
    return e;
  }

  /**
   * Hooks the Room Message event.
   *
   * @param {Object} e
   * @return {Object} 
   */
  _onHookRoomMessage(e) {
    e.user.isHost = e.user.username === this.room;
    return e;
  }

  /**
   * Hooks the Tip event.
   *
   * @param {Object} e
   * @return {Object} 
   */
  _onHookTip(e) {
    e.user.isHost = e.user.username === this.room;
    return e;
  }
}

module.exports = ChaturbateController;
