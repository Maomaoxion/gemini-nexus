import { debugLog } from '../../shared/logging/debug.js';

const ALARM_NAME = 'gemini_cookie_rotate';
const ROTATE_URL = 'https://accounts.google.com/RotateCookies';
// Matches Python implementation (540s = 9 minutes)
const INTERVAL_MINUTES = 9;
const MIN_ROTATION_INTERVAL_MS = 60000;
const BACKOFF_MAX_MS = 30 * 60 * 1000; // 30 minutes
const LAST_ROTATION_ATTEMPT_KEY = 'geminiKeepAliveLastRotationAttempt';
// A short-interval alarm that fires while a stream is active. MV3 terminates an
// idle service worker after ~30s of inactivity; a reasoning/thinking model can
// spend far longer than that emitting no tokens, which would kill the in-flight
// stream and leave the UI stuck on a loading spinner forever. This alarm pokes
// the worker every 25s while streaming so the idle timer resets. (chrome.alarms
// has a 30s minimum granularity, which is just enough for MV3's 30s idle.)
const STREAM_HEARTBEAT_ALARM = 'gemini_stream_heartbeat';
const STREAM_HEARTBEAT_PERIOD_MIN = 0.5; // 30s, the MV3 minimum

class KeepAliveManager {
    constructor() {
        this.lastRotation = 0;
        this.isRotating = false;
        this.consecutiveErrors = 0;
        this.boundOnAlarm = this._onAlarm.bind(this);
        // Optional async () => void. When set (from background/index.js), 401/403
        // clears both in-memory AuthManager state and storage. Without it we
        // fall back to storage-only cleanup for standalone tests.
        this.onSessionExpired = null;
    }

    setSessionExpiredHandler(handler) {
        this.onSessionExpired = typeof handler === 'function' ? handler : null;
    }

    init() {
        chrome.alarms.get(ALARM_NAME, (alarm) => {
            if (!alarm) {
                chrome.alarms.create(ALARM_NAME, { periodInMinutes: INTERVAL_MINUTES });
            }
        });

        if (!chrome.alarms.onAlarm.hasListener(this.boundOnAlarm)) {
            chrome.alarms.onAlarm.addListener(this.boundOnAlarm);
        }

        this.performRotation();
    }

    _onAlarm(alarm) {
        if (alarm.name === ALARM_NAME) {
            this.performRotation();
            return;
        }
        // Stream heartbeat: just touching the SW resets the MV3 30s idle timer.
        // No work to do — the alarm firing while a stream is active is enough to
        // keep the worker alive through a long thinking/reasoning pause.
        if (alarm.name === STREAM_HEARTBEAT_ALARM) {
            debugLog('[Gemini Nexus] Keep-Alive: stream heartbeat');
        }
    }

    // Called when a streaming request starts. Arms a short-interval alarm that
    // resets the SW idle timer through reasoning/thinking pauses that emit no
    // tokens for >30s. Must be balanced by endStreamHeartbeat() when the stream
    // resolves or aborts, otherwise the alarm keeps firing indefinitely.
    beginStreamHeartbeat() {
        try {
            chrome.alarms.create(STREAM_HEARTBEAT_ALARM, {
                periodInMinutes: STREAM_HEARTBEAT_PERIOD_MIN,
            });
        } catch (error) {
            // 静默降级:心跳失败时不影响主流程,SW 仍可能因 token 流存活
            debugLog('[Gemini Nexus] Keep-Alive: failed to arm stream heartbeat', error);
        }
    }

    endStreamHeartbeat() {
        try {
            chrome.alarms.clear(STREAM_HEARTBEAT_ALARM);
        } catch {
            // 静默忽略:清除失败无副作用
        }
    }

    async _getLastRotationAttempt() {
        try {
            const result = await chrome.storage?.local?.get?.([LAST_ROTATION_ATTEMPT_KEY]);
            const storedValue = result?.[LAST_ROTATION_ATTEMPT_KEY];
            if (Number.isFinite(storedValue)) {
                this.lastRotation = storedValue;
            }
        } catch {
            // 静默降级:storage 读取失败时使用内存中的 lastRotation 默认值
        }

        return this.lastRotation;
    }

    async _setLastRotationAttempt(timestamp) {
        this.lastRotation = timestamp;
        try {
            await chrome.storage?.local?.set?.({
                [LAST_ROTATION_ATTEMPT_KEY]: timestamp,
            });
        } catch {
            // 静默降级:storage 写入失败时已更新内存状态,不影响当前轮转流程
        }
    }

    async performRotation() {
        if (this.isRotating) return;
        this.isRotating = true;

        const now = Date.now();

        try {
            const lastRotationAttempt = await this._getLastRotationAttempt();
            // Throttling: Don't rotate if attempted in last 60s
            // (Matches Python logic to avoid 429 Too Many Requests)
            if (now - lastRotationAttempt < MIN_ROTATION_INTERVAL_MS) {
                return;
            }

            // Back off after repeated failures so a dead network or expired
            // session does not retry RotateCookies every interval — that also
            // floods the console, which feeds the LogManager storage write path.
            // Doubles per failure, capped at 30 minutes.
            if (this.consecutiveErrors > 0) {
                const backoffMs = Math.min(
                    BACKOFF_MAX_MS,
                    MIN_ROTATION_INTERVAL_MS * 2 ** this.consecutiveErrors
                );
                if (now - lastRotationAttempt < backoffMs) {
                    return;
                }
            }

            await this._setLastRotationAttempt(now);
            debugLog('[Gemini Nexus] Keep-Alive: Rotating cookies...');

            // This endpoint refreshes __Secure-1PSIDTS
            // Browser automatically handles the Cookie header in request and Set-Cookie in response
            // due to host permissions.
            const response = await fetch(ROTATE_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                // Raw payload compatible with Google's endpoint logic
                // [000,"-0000000000000000000"]
                body: '[000,"-0000000000000000000"]',
            });

            if (response.ok) {
                this.consecutiveErrors = 0;
                debugLog('[Gemini Nexus] Keep-Alive: Rotation successful');
            } else {
                this.consecutiveErrors++;
                await this._handleError(response.status);
            }
        } catch (error) {
            this.consecutiveErrors++;
            // Avoid flooding LogManager / console on sustained offline or
            // blocked RotateCookies — backoff already slows retries.
            if (this.consecutiveErrors <= 2) {
                console.error('[Gemini Nexus] Keep-Alive: Network error', error);
            } else if (this.consecutiveErrors === 3 || this.consecutiveErrors % 5 === 0) {
                console.warn(
                    `[Gemini Nexus] Keep-Alive: Network error (x${this.consecutiveErrors})`,
                    error?.message || error
                );
            }
        } finally {
            this.isRotating = false;
        }
    }

    async _handleError(status) {
        console.warn(`[Gemini Nexus] Keep-Alive: Rotation failed with status ${status}`);

        // If 401 Unauthorized or 403 Forbidden, session is likely dead.
        // Clear both memory and storage so the next request re-fetches tokens.
        // Storage-only cleanup left AuthManager.currentContext serving stale
        // tokens for the rest of the service-worker lifetime.
        if (status === 401 || status === 403) {
            debugLog('[Gemini Nexus] Session expired. Clearing local context.');
            try {
                if (typeof this.onSessionExpired === 'function') {
                    await this.onSessionExpired();
                } else {
                    await chrome.storage.local.remove(['geminiContext']);
                }
            } catch (error) {
                console.warn('[Gemini Nexus] Keep-Alive: Failed to clear expired context:', error);
            }
        }

        // 429: extra backoff so cookie rotation does not stack with chat retries.
        if (status === 429) {
            this.consecutiveErrors = Math.max(this.consecutiveErrors, 3);
        }
    }
}

export const keepAliveManager = new KeepAliveManager();
