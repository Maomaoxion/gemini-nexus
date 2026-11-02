import {
    LIVE_ARTIFACT_HTML_LANGUAGE,
    LIVE_ARTIFACT_MESSAGE_CHANNEL,
    LIVE_ARTIFACT_STREAM_EVENT,
} from '../core/live_artifacts.js';

const HTML_LANGUAGES = new Set([LIVE_ARTIFACT_HTML_LANGUAGE]);
const SVG_LANGUAGES = new Set(['svg']);
const MERMAID_LANGUAGES = new Set(['mermaid', 'mmd']);
const GRAPHVIZ_LANGUAGES = new Set(['graphviz', 'dot']);
const TEXT_LANGUAGES = new Set(['', 'plaintext', 'text', 'txt']);
const DANGEROUS_TAGS = new Set([
    'applet',
    'base',
    'embed',
    'iframe',
    'link',
    'meta',
    'object',
    'script',
]);
const BLOCKED_ATTRS = new Set(['srcdoc']);
const URI_ATTRS = new Set([
    'action',
    'background',
    'cite',
    'formaction',
    'href',
    'poster',
    'src',
    'xlink:href',
]);

// 嵌入到 live artifact iframe 中的脚本,负责尺寸上报与后续指令转发。
// 注意:该脚本运行在 sandbox iframe 内,无法访问 chrome.* API。
// 安全:postMessage 使用 targetOrigin:'*'。这是必要的——sandbox iframe
// (sandbox="allow-scripts allow-forms",srcdoc)具有不透明的 null origin,
// 无法指定精确的目标 origin。父端在 artifact_renderer.js 的 handleMessage 中
// 通过 event.source === frame.contentWindow 身份校验(每个 window 对象唯一、
// 不可伪造)来确保只接受我们自己创建的 iframe 发来的消息,channel 字段进一步
// 过滤,因此通配 targetOrigin 不构成跨源指令注入风险。
const ARTIFACT_BRIDGE_SCRIPT = `<script>
(() => {
  const channel = ${JSON.stringify(LIVE_ARTIFACT_MESSAGE_CHANNEL)};
  const notify = (event, payload) => {
    try {
      parent.postMessage(payload === undefined ? { channel, event } : { channel, event, payload }, '*');
    } catch {
      // 静默降级:sandbox iframe 中 postMessage 失败时忽略
    }
  };
  const notifyResize = () => {
    try {
      const body = document.body;
      const root = document.documentElement;
      const height = Math.max(
        body ? body.scrollHeight : 0,
        body ? body.offsetHeight : 0,
        root ? root.scrollHeight : 0,
        root ? root.offsetHeight : 0
      );
      parent.postMessage({ channel, event: 'resize', height }, '*');
    } catch {
      // 静默降级:sandbox iframe 中 postMessage 失败或 DOM 不可用时忽略
    }
  };
  let resizeFrame = 0;
  const scheduleResize = () => {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      notifyResize();
    });
  };
  if (document.readyState === 'complete') {
    Promise.resolve().then(scheduleResize);
  } else {
    window.addEventListener('load', scheduleResize, { once: true });
  }
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(scheduleResize);
    if (document.documentElement) observer.observe(document.documentElement);
    if (document.body) observer.observe(document.body);
  }
  if ('MutationObserver' in window) {
    const observer = new MutationObserver(scheduleResize);
    observer.observe(document.documentElement || document, { childList: true, subtree: true, attributes: true });
  }
  window.addEventListener('resize', scheduleResize);
  const parseFollowupPayload = (rawPayload) => {
    const trimmedPayload = String(rawPayload || '').trim();
    if (!trimmedPayload) return null;
    try {
      const parsedPayload = JSON.parse(trimmedPayload);
      if (typeof parsedPayload === 'string') {
        const instruction = parsedPayload.trim();
        return instruction ? { instruction } : null;
      }
      return parsedPayload;
    } catch {
      if (/^[{[]/.test(trimmedPayload)) return null;
      return { instruction: trimmedPayload };
    }
  };
  const resolveFollowupScope = (trigger) => {
    const scopeSelector = trigger.getAttribute('data-amc-followup-scope');
    if (scopeSelector && scopeSelector.trim()) {
      try {
        return document.querySelector(scopeSelector) || trigger.closest(scopeSelector) || document;
      } catch {
        return document;
      }
    }
    return trigger.closest('[data-amc-followup-scope]') || document;
  };
  const readStateValue = (element) => {
    if (element instanceof HTMLInputElement) {
      const inputType = element.type.toLowerCase();
      if (inputType === 'checkbox') return element.checked;
      if (inputType === 'radio') return element.checked ? element.value || true : undefined;
      if (inputType === 'number' || inputType === 'range') {
        return element.value === '' || Number.isNaN(element.valueAsNumber) ? element.value : element.valueAsNumber;
      }
      return element.value;
    }
    if (element instanceof HTMLSelectElement) {
      if (element.multiple) return Array.from(element.selectedOptions).map((option) => option.value);
      return element.value;
    }
    if (element instanceof HTMLTextAreaElement) return element.value;
    const stateValue = element.getAttribute('data-amc-state-value');
    if (stateValue !== null) {
      const isToggleLike =
        element.hasAttribute('aria-pressed') ||
        element.hasAttribute('aria-selected') ||
        element.hasAttribute('aria-checked');
      if (!isToggleLike) return stateValue;
      const isActive =
        element.getAttribute('aria-pressed') === 'true' ||
        element.getAttribute('aria-selected') === 'true' ||
        element.getAttribute('aria-checked') === 'true';
      return isActive ? stateValue : undefined;
    }
    const textValue = element.textContent ? element.textContent.trim() : '';
    return textValue || undefined;
  };
  const appendStateValue = (state, key, value) => {
    if (value === undefined) return;
    if (Object.prototype.hasOwnProperty.call(state, key)) {
      state[key] = Array.isArray(state[key]) ? [...state[key], value] : [state[key], value];
      return;
    }
    state[key] = value;
  };
  const collectFollowupState = (trigger) => {
    const scope = resolveFollowupScope(trigger);
    const state = {};
    const stateElements = [];
    if (scope instanceof Element && scope.matches('[data-amc-state-key]')) stateElements.push(scope);
    stateElements.push(...Array.from(scope.querySelectorAll('[data-amc-state-key]')));
    stateElements.forEach((element) => {
      const key = element.getAttribute('data-amc-state-key');
      if (!key || element.disabled) return;
      appendStateValue(state, key, readStateValue(element));
    });
    return state;
  };
  const mergeFollowupState = (payload, collectedState) => {
    if (!collectedState || Object.keys(collectedState).length === 0) return payload;
    const existingState =
      payload && typeof payload.state === 'object' && !Array.isArray(payload.state)
        ? payload.state
        : payload && payload.state !== undefined
          ? { value: payload.state }
          : {};
    return {
      ...payload,
      state: {
        ...existingState,
        ...collectedState,
      },
    };
  };
  const readFollowupPayload = (target) => {
    if (!(target instanceof Element)) return null;
    const trigger = target.closest('[data-amc-followup]');
    if (!trigger) return null;
    const payload = parseFollowupPayload(trigger.getAttribute('data-amc-followup'));
    return payload ? mergeFollowupState(payload, collectFollowupState(trigger)) : null;
  };
  document.addEventListener('click', (event) => {
    const payload = readFollowupPayload(event.target);
    if (!payload) return;
    event.preventDefault();
    notify('followup', payload);
  });
})();
</script>`;

// 嵌入到流式 artifact iframe 中的脚本,负责把增量 HTML 合并进已有 DOM。
// 与整段 srcdoc 重建不同,这里按节点对比并 patch,保留已渲染节点、滚动位置
// 和交互状态,避免流式过程中整帧闪烁。
const STREAMING_PATCH_SCRIPT = `<script>
(() => {
  const channel = ${JSON.stringify(LIVE_ARTIFACT_MESSAGE_CHANNEL)};
  const streamEvent = ${JSON.stringify(LIVE_ARTIFACT_STREAM_EVENT)};
  const root = document.querySelector('[data-amc-artifact-root]');
  if (!root) return;

  const cloneNode = (node) => node.cloneNode(true);

  const syncAttributes = (currentElement, nextElement) => {
    Array.from(currentElement.attributes).forEach((attribute) => {
      if (!nextElement.hasAttribute(attribute.name)) currentElement.removeAttribute(attribute.name);
    });
    Array.from(nextElement.attributes).forEach((attribute) => {
      if (currentElement.getAttribute(attribute.name) !== attribute.value) {
        currentElement.setAttribute(attribute.name, attribute.value);
      }
    });
  };

  const patchNode = (currentNode, nextNode) => {
    if (currentNode.nodeType !== nextNode.nodeType) {
      currentNode.replaceWith(cloneNode(nextNode));
      return;
    }
    if (currentNode.nodeType === Node.TEXT_NODE) {
      if (currentNode.nodeValue !== nextNode.nodeValue) currentNode.nodeValue = nextNode.nodeValue;
      return;
    }
    if (currentNode.nodeType !== Node.ELEMENT_NODE) return;
    if (currentNode.nodeName !== nextNode.nodeName) {
      currentNode.replaceWith(cloneNode(nextNode));
      return;
    }
    syncAttributes(currentNode, nextNode);
    patchChildren(currentNode, nextNode);
  };

  const patchChildren = (currentParent, nextParent) => {
    const currentChildren = Array.from(currentParent.childNodes);
    const nextChildren = Array.from(nextParent.childNodes);
    const maxLength = Math.max(currentChildren.length, nextChildren.length);
    for (let index = 0; index < maxLength; index += 1) {
      const currentChild = currentChildren[index];
      const nextChild = nextChildren[index];
      if (!nextChild) {
        currentChild.remove();
        continue;
      }
      if (!currentChild) {
        currentParent.appendChild(cloneNode(nextChild));
        continue;
      }
      patchNode(currentChild, nextChild);
    }
  };

  const render = (html) => {
    try {
      const template = document.createElement('template');
      template.innerHTML = html;
      patchChildren(root, template.content);
    } catch {
      // A chunk that cannot be parsed keeps the previously rendered state.
    }
  };

  window.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.channel !== channel || data.event !== streamEvent || typeof data.html !== 'string') return;
    render(data.html);
  });
})();
</script>`;

export {
    HTML_LANGUAGES,
    SVG_LANGUAGES,
    MERMAID_LANGUAGES,
    GRAPHVIZ_LANGUAGES,
    TEXT_LANGUAGES,
    DANGEROUS_TAGS,
    BLOCKED_ATTRS,
    URI_ATTRS,
    ARTIFACT_BRIDGE_SCRIPT,
    STREAMING_PATCH_SCRIPT,
};
