import { t } from '../core/i18n.js';

const MAX_VISIBLE_SOURCES = 2;

function getSourceUrlSet(sourceList) {
    if (!Array.isArray(sourceList)) return new Set();
    return new Set(sourceList.map((source) => normalizeSourceUrl(source?.url)).filter(Boolean));
}

export function getSourceDomain(url) {
    try {
        const { hostname } = new URL(url);
        return hostname.replace(/^www\./, '');
    } catch {
        return '';
    }
}

function normalizeSourceTitle(source) {
    const url = source?.url || '';
    const title = typeof source?.title === 'string' ? source.title.trim() : '';
    if (title && title !== url) return title;
    return getSourceDomain(url) || url;
}

function normalizeSourceUrl(url) {
    return typeof url === 'string' ? url.trim() : '';
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createSourceUrlPattern(sourceUrls) {
    const urls = [...sourceUrls]
        .filter(Boolean)
        .sort((leftSourceUrl, rightSourceUrl) => rightSourceUrl.length - leftSourceUrl.length);
    if (urls.length === 0) return null;
    return new RegExp(`(?:<)?(${urls.map(escapeRegExp).join('|')})(?:>)?(?=$|[\\s).,，。:：;；>])`);
}

function hasStructuredSourceUrl(text, sourceUrlPattern) {
    return Boolean(sourceUrlPattern && sourceUrlPattern.test(text));
}

function lineHasOnlySourceUrl(line, sourceUrlPattern) {
    const trimmed = line.trim();
    if (!trimmed) return false;
    const listPrefix = String.raw`(?:[-*]\s*)?(?:\d+\.\s*)?`;
    const urlPattern = sourceUrlPattern?.source || '';
    if (!urlPattern) return false;
    return new RegExp(`^${listPrefix}${urlPattern}\\s*[.)，。,:：;；]*$`).test(trimmed);
}

function lineIsSourceLabel(line) {
    return /^\s*(?:来源|參考來源|参考来源|资料来源|Sources?|References?)\s*[:：]/i.test(line);
}

function splitLineAtSourceLabel(line) {
    const match = line.match(/(来源|參考來源|参考来源|资料来源|Sources?|References?)\s*[:：]/i);
    if (!match || match.index === undefined) return null;

    return {
        prefix: line.slice(0, match.index).trimEnd(),
        sourceText: line.slice(match.index),
    };
}

function lineHasOnlySourceLabel(line) {
    const split = splitLineAtSourceLabel(line);
    if (!split) return false;
    return split.prefix.trim() === '' || /^[-*]\s*$/.test(split.prefix.trim());
}

function cleanupInlineSourceReferences(lines, sourceUrlPattern) {
    const cleaned = [];

    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const split = splitLineAtSourceLabel(line);

        if (!split) {
            cleaned.push(line);
            continue;
        }

        const nextLine = lines[index + 1] || '';
        const sourceHasUrl = hasStructuredSourceUrl(split.sourceText, sourceUrlPattern);
        const nextLineHasOnlySourceUrl = lineHasOnlySourceUrl(nextLine, sourceUrlPattern);

        if (!sourceHasUrl && !nextLineHasOnlySourceUrl) {
            cleaned.push(line);
            continue;
        }

        if (split.prefix.trim()) {
            cleaned.push(split.prefix);
        } else if (!lineHasOnlySourceLabel(line)) {
            cleaned.push(line);
        }

        if (nextLineHasOnlySourceUrl) {
            index++;
        }
    }

    return cleaned;
}

export function cleanupStructuredSourceText(text, sourceList) {
    if (typeof text !== 'string' || !Array.isArray(sourceList) || sourceList.length === 0) {
        return text;
    }

    let lines = text.split('\n');

    const sourceUrls = getSourceUrlSet(sourceList);
    if (sourceUrls.size === 0) return text;
    const sourceUrlPattern = createSourceUrlPattern(sourceUrls);
    if (!sourceUrlPattern) return text;

    lines = cleanupInlineSourceReferences(lines, sourceUrlPattern);
    let end = lines.length - 1;
    while (end >= 0 && lines[end].trim() === '') end--;
    let start = end;

    while (
        start >= 0 &&
        (lines[start].trim() === '' || lineHasOnlySourceUrl(lines[start], sourceUrlPattern))
    ) {
        start--;
    }

    const removedUrlLines = end - start;
    if (removedUrlLines <= 0) return lines.join('\n');

    if (start >= 0 && lineIsSourceLabel(lines[start])) {
        return lines.slice(0, start).join('\n').trimEnd();
    }

    return lines
        .slice(0, start + 1)
        .join('\n')
        .trimEnd();
}

export function createSourcesElement(sourceList) {
    if (!Array.isArray(sourceList) || sourceList.length === 0) {
        return null;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'sources-container';

    const label = document.createElement('div');
    label.className = 'sources-label';
    label.textContent = t('sourcesLabel');
    wrapper.appendChild(label);

    const list = document.createElement('div');
    list.className = 'sources-list';

    let renderedCount = 0;

    sourceList.forEach((source) => {
        if (!source || !source.url) return;

        const sourceIndex = renderedCount + 1;
        const domain = getSourceDomain(source.url);
        const title = normalizeSourceTitle(source);
        const link = document.createElement('a');
        link.className = 'source-link';
        if (renderedCount >= MAX_VISIBLE_SOURCES) {
            link.classList.add('source-link-hidden');
        }
        link.href = source.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';

        const number = document.createElement('span');
        number.className = 'source-index';
        number.textContent = String(sourceIndex);

        const textWrap = document.createElement('span');
        textWrap.className = 'source-text';

        const titleSpan = document.createElement('span');
        titleSpan.className = 'source-title';
        titleSpan.textContent = title;

        textWrap.appendChild(titleSpan);
        if (domain && domain !== title) {
            const domainSpan = document.createElement('span');
            domainSpan.className = 'source-domain';
            domainSpan.textContent = domain;
            textWrap.appendChild(domainSpan);
        }

        link.title = source.url;
        link.appendChild(number);
        link.appendChild(textWrap);
        list.appendChild(link);
        renderedCount++;
    });

    if (!list.childNodes.length) {
        return null;
    }

    wrapper.appendChild(list);

    if (renderedCount > MAX_VISIBLE_SOURCES) {
        const hiddenCount = renderedCount - MAX_VISIBLE_SOURCES;
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'sources-toggle';

        const setToggleLabel = (expanded) => {
            toggle.textContent = expanded ? '▴' : '▾';
            const labelText = expanded
                ? t('showLessSources')
                : t('showMoreSources').replace('{count}', String(hiddenCount));
            toggle.title = labelText;
            toggle.setAttribute('aria-label', labelText);
            toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        };

        setToggleLabel(false);

        toggle.addEventListener('click', () => {
            const expanded = wrapper.classList.toggle('sources-expanded');
            setToggleLabel(expanded);
        });

        list.appendChild(toggle);
    }

    return wrapper;
}
