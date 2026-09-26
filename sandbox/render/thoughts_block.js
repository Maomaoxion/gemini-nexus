import { renderContent } from './content.js';
import { hasDisplayableThoughts } from '../core/displayable_content.js';
import { t } from '../core/i18n.js';
import { createPrefixedId } from '../../shared/utils/index.js';

const THOUGHTS_REGION_PREFIX = 'thoughts-content';

function formatThoughtDuration(seconds) {
    if (!Number.isFinite(seconds)) return null;
    if (seconds > 0 && seconds < 1) return '1';
    return String(Math.max(0, Math.round(seconds)));
}

function getThoughtsStartedAtFromOptions(options) {
    if (Number.isFinite(options.thoughtsStartedAt)) {
        return options.thoughtsStartedAt;
    }
    if (Number.isFinite(options.thoughtsElapsedSeconds)) {
        return Date.now() - Math.max(0, options.thoughtsElapsedSeconds) * 1000;
    }
    return null;
}

export function createThoughtsBlock(initialThoughts = '', options = {}, onStateChange = () => {}) {
    const root = document.createElement('div');
    root.className = 'thoughts-container';
    root.hidden = !hasDisplayableThoughts(initialThoughts);

    const regionId = createPrefixedId(THOUGHTS_REGION_PREFIX);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'thoughts-toggle';
    toggle.setAttribute('aria-controls', regionId);

    const arrow = document.createElement('span');
    arrow.className = 'thoughts-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '›';

    const status = document.createElement('span');
    status.className = 'thoughts-status';

    const content = document.createElement('div');
    content.id = regionId;
    content.className = 'thoughts-content';
    renderContent(content, initialThoughts || '', 'ai');

    toggle.appendChild(arrow);
    toggle.appendChild(status);
    root.appendChild(toggle);
    root.appendChild(content);

    let currentThoughts = initialThoughts || '';
    let startedAt = getThoughtsStartedAtFromOptions(options);
    let durationSeconds = Number.isFinite(options.thoughtsDurationSeconds)
        ? options.thoughtsDurationSeconds
        : null;
    let expanded = false;
    let finished = Boolean(options.isFinal);
    let statusTimer = null;

    const getCompleteLabel = () => {
        if (durationSeconds !== null) {
            return t('thoughtsCompleteWithDuration').replace(
                '{seconds}',
                formatThoughtDuration(durationSeconds)
            );
        }
        return t('thoughtsComplete');
    };

    const getStreamingLabel = () => {
        if (!startedAt) return t('thoughtsStreaming');
        const elapsedSeconds = (Date.now() - startedAt) / 1000;
        return t('thoughtsCompleteWithDuration').replace(
            '{seconds}',
            formatThoughtDuration(elapsedSeconds)
        );
    };

    const updateStatus = (isStreaming) => {
        status.textContent = isStreaming ? getStreamingLabel() : getCompleteLabel();
    };

    const stopStatusTimer = () => {
        if (!statusTimer) return;
        clearInterval(statusTimer);
        statusTimer = null;
    };

    const setExpanded = (nextExpanded) => {
        expanded = Boolean(nextExpanded);
        root.classList.toggle('thoughts-expanded', expanded);
        toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        toggle.setAttribute('aria-label', expanded ? t('thoughtsCollapse') : t('thoughtsExpand'));
        content.hidden = !expanded;
    };

    const startStatusTimer = () => {
        if (statusTimer) return;
        statusTimer = setInterval(() => {
            if (finished) {
                stopStatusTimer();
                return;
            }
            updateStatus(true);
        }, 1000);
    };

    const finish = () => {
        if (finished) return;
        finished = true;
        durationSeconds = startedAt ? (Date.now() - startedAt) / 1000 : (durationSeconds ?? 0);
        stopStatusTimer();
        setExpanded(false);
    };

    const setVisible = (visible) => {
        root.hidden = !visible;
    };

    const update = (nextThoughts, state = {}) => {
        if (nextThoughts !== undefined) {
            currentThoughts = nextThoughts || '';
            renderContent(content, currentThoughts, 'ai');
        }

        const hasThoughts = hasDisplayableThoughts(currentThoughts);
        setVisible(hasThoughts);
        if (!hasThoughts) {
            stopStatusTimer();
            onStateChange();
            return;
        }

        if (state.isFinal || state.hasDisplayableText) {
            finish();
            updateStatus(false);
            onStateChange();
            return;
        }

        if (state.isStreaming && !finished) {
            if (!startedAt) {
                startedAt = getThoughtsStartedAtFromOptions(state) || Date.now();
            }
            updateStatus(true);
            startStatusTimer();
            setExpanded(true);
            onStateChange();
            return;
        }

        stopStatusTimer();
        updateStatus(false);
        onStateChange();
    };

    toggle.addEventListener('click', () => {
        setExpanded(!expanded);
    });

    setExpanded(options.isStreaming && hasDisplayableThoughts(currentThoughts));

    return {
        root,
        update,
        dispose: stopStatusTimer,
        getDurationSeconds: () => durationSeconds,
        setDurationSeconds: (seconds) => {
            if (Number.isFinite(seconds)) durationSeconds = seconds;
        },
    };
}
