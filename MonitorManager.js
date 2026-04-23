const InstagramChecker = require('./InstagramChecker');
const config = require('./config');

class MonitorManager {
  constructor() {
    this.accounts = new Map(); // username -> AccountState
    this.alertChannelId = null;
    this.intervalMinutes = config.checkIntervalMinutes;
    this.loopTimer = null;
    this.onEvent = null;
    this.checker = new InstagramChecker();
  }

  // ─── Account Management ───────────────────────────────────────────────────

  async addAccount(username, label = username) {
    if (this.accounts.size >= config.maxAccounts) {
      return { success: false, message: `Maximum of ${config.maxAccounts} accounts reached. Remove one first.` };
    }
    if (this.accounts.has(username)) {
      return { success: false, message: `@${username} is already being monitored.` };
    }

    const state = {
      username,
      label,
      status: 'PENDING',
      previousStatus: null,
      addedAt: Date.now(),
      lastChecked: null,
      checkCount: 0,
    };

    this.accounts.set(username, state);
    console.log(`[MONITOR] Added @${username} (${label})`);

    // Do an immediate check in background
    this._checkAccount(username).catch(console.error);

    return { success: true };
  }

  removeAccount(username) {
    if (!this.accounts.has(username)) {
      return { success: false, message: `@${username} is not in the monitoring list.` };
    }
    this.accounts.delete(username);
    console.log(`[MONITOR] Removed @${username}`);
    return { success: true };
  }

  clearAll() {
    this.accounts.clear();
    console.log('[MONITOR] All accounts cleared.');
  }

  getAccounts() {
    return Array.from(this.accounts.values());
  }

  getCount() {
    return this.accounts.size;
  }

  // ─── Configuration ────────────────────────────────────────────────────────

  setInterval(minutes) {
    this.intervalMinutes = minutes;
    this._restartLoop();
    console.log(`[MONITOR] Interval set to ${minutes} min`);
  }

  getInterval() {
    return this.intervalMinutes;
  }

  setAlertChannel(channelId) {
    this.alertChannelId = channelId;
    console.log(`[MONITOR] Alert channel set: ${channelId}`);
  }

  getAlertChannel() {
    return this.alertChannelId;
  }

  // ─── Monitor Loop ─────────────────────────────────────────────────────────

  startLoop(onEvent) {
    this.onEvent = onEvent;
    this._scheduleNext();
  }

  _scheduleNext() {
    if (this.loopTimer) clearTimeout(this.loopTimer);
    const ms = this.intervalMinutes * 60 * 1000;
    this.loopTimer = setTimeout(() => this._runCycle(), ms);
  }

  _restartLoop() {
    this._scheduleNext();
  }

  async _runCycle() {
    const usernames = Array.from(this.accounts.keys());
    if (usernames.length === 0) {
      this._scheduleNext();
      return;
    }

    console.log(`[CYCLE] Checking ${usernames.length} account(s)...`);

    // Check all accounts concurrently (with concurrency limit)
    const CONCURRENCY = 3;
    for (let i = 0; i < usernames.length; i += CONCURRENCY) {
      const batch = usernames.slice(i, i + CONCURRENCY);
      await Promise.allSettled(batch.map(u => this._checkAccount(u)));
      // Small delay between batches to be gentle on the API
      if (i + CONCURRENCY < usernames.length) {
        await sleep(2000);
      }
    }

    console.log(`[CYCLE] Done.`);
    this._scheduleNext();
  }

  // ─── Account Check ────────────────────────────────────────────────────────

  async _checkAccount(username) {
    const state = this.accounts.get(username);
    if (!state) return;

    try {
      const result = await this.checker.check(username);
      const newStatus = result.status; // 'ACTIVE' or 'BANNED'
      const previousStatus = state.status;

      state.lastChecked = Date.now();
      state.checkCount++;

      const statusChanged = previousStatus !== 'PENDING' && previousStatus !== newStatus;
      const firstCheck = previousStatus === 'PENDING';

      state.previousStatus = previousStatus === 'PENDING' ? null : previousStatus;
      state.status = newStatus;

      console.log(`[CHECK] @${username} → ${newStatus}${statusChanged ? ` (was ${previousStatus})` : ''}`);

      // Fire event on first check or status change
      if ((firstCheck || statusChanged) && this.onEvent) {
        await this.onEvent({
          username,
          label: state.label,
          status: newStatus,
          previousStatus: state.previousStatus,
          checkedAt: state.lastChecked,
          isChange: statusChanged,
        });
      }
    } catch (err) {
      console.error(`[CHECK ERROR] @${username}: ${err.message}`);
    }
  }

  async forceCheck(username) {
    if (!this.accounts.has(username)) {
      return { success: false, message: `@${username} is not in the monitoring list.` };
    }

    try {
      const result = await this.checker.check(username);
      const state = this.accounts.get(username);
      const previousStatus = state.status;

      state.previousStatus = previousStatus === 'PENDING' ? null : previousStatus;
      state.status = result.status;
      state.lastChecked = Date.now();
      state.checkCount++;

      return {
        success: true,
        username,
        label: state.label,
        status: result.status,
        previousStatus: state.previousStatus,
        checkedAt: state.lastChecked,
        forced: true,
      };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = MonitorManager;
