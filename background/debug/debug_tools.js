import { DEBUG_TOOL_SCHEMAS } from '../tools/tool_schemas.js';
import { toolNameSet } from '../tools/tool_names.js';

// Tool names come from the schema list so a new debug tool only needs to be
// declared once.
export const DEBUG_TOOL_NAMES = toolNameSet(DEBUG_TOOL_SCHEMAS);

export function isDebugTool(toolName) {
    return DEBUG_TOOL_NAMES.has(toolName);
}

/**
 * Injected when the composer Debug toggle is on.
 * Tools are neutral inspection helpers: pick one based on the user's question,
 * not a fixed error-first order. Results are a snapshot of the in-memory
 * buffers or a live read, not a continuous stream.
 */
export const DEBUG_TOOLS_PREAMBLE = `[System: Browser Debug Tools Enabled]
You can inspect the current tab through debug tools. The debugger is attached to the tab this side panel is bound to.

**RULES:**
1. Choose tools by the user's intent, not by default:
   - Runtime errors / logs → get_page_errors or get_console_logs
   - API / network behavior → get_network_requests or get_network_detail
   - Page structure / styles → get_dom_html or get_element_styles
   - Source code / runtime values → get_script_sources or evaluate_script
   - Storage / cookies → get_storage
   - First contact with an unknown page → get_page_info
2. Do not default to error checking when the user asks about code, layout, or data.
3. Console/network results are snapshots of an in-memory buffer; DOM/source/eval results are live reads. Call again after new interactions to refresh.
4. If a tool reports that debug is not enabled, ask the user to turn on Debug in the composer.
5. When you need to use a debug tool, end your reply with exactly one JSON block.
6. Do not emit special tokens such as <|tool_call_begin|> or <|tool_call_end|>; output only the JSON block below.
7. Never end with a transitional promise such as "接下来我会检查…" or "Next I will check…" without the JSON block. Either call the tool now or state the final conclusion.

**Output format:**
\`\`\`json
{ "tool": "tool_name", "args": { ... } }
\`\`\`

**Tools:**

1. **get_page_info** — args: {} — URL, title, readyState, viewport, detected frameworks.
2. **get_console_logs** — args: { "level"?: "all"|"log"|"info"|"warning"|"error", "limit"?: number, "sinceMs"?: number } — Recent console entries (max 500 buffered).
3. **get_page_errors** — args: {} — Uncaught exceptions and console errors.
4. **get_network_requests** — args: { "urlContains"?: string, "method"?: string, "status"?: number, "failedOnly"?: boolean, "limit"?: number } — Recent requests (max 300 buffered). failedOnly means network-layer failures only; HTTP 4xx/5xx are not failures, filter them with status.
5. **get_network_detail** — args: { "requestId": string, "includeBody"?: boolean } — Status, headers, and (optionally) response body for one request. Body may be unavailable if the browser already released it.
6. **get_storage** — args: { "type"?: "local"|"session"|"cookie", "keyContains"?: string } — Storage keys/values; sensitive values are redacted.
7. **get_dom_html** — args: { "selector"?: string, "maxLength"?: number } — HTML of the document or a CSS selector match. Defaults to the whole document, capped at 20KB.
8. **get_element_styles** — args: { "selector": string, "properties"?: string[] } — Computed styles for one element. Defaults to layout/color/typography properties.
9. **get_script_sources** — args: { "scriptId"?: string, "urlContains"?: string, "limit"?: number } — List loaded scripts, or read one script's source (20KB cap) when scriptId is provided.
10. **evaluate_script** — args: { "script": string } — Evaluate a JavaScript expression in the page (expression, not statements; async and await are supported, up to 30s; 10KB cap). Use it to inspect variables, component state, or read data the other tools do not expose.
11. **clear_debug_logs** — args: {} — Clear the console/network buffer before reproducing an action.
`;
