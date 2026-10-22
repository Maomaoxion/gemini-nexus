import { filterToolsForPreamble } from '../managers/mcp/preamble.js';

const str = (description) => ({ type: 'string', description });
const num = (description) => ({ type: 'number', description });
const bool = (description) => ({ type: 'boolean', description });
const arr = (items, description) => ({ type: 'array', items, description });
const obj = (properties, required = []) => ({
    type: 'object',
    properties,
    required,
});
const enumType = (values, description) => ({ type: 'string', enum: values, description });

function tool(name, description, parameters = obj({})) {
    return { name, description, parameters };
}

export const CONTROL_TOOL_SCHEMAS = [
    tool('take_snapshot', 'Return the page accessibility tree with UIDs.'),
    tool(
        'click',
        'Click an element by UID.',
        obj(
            {
                uid: str('Element UID'),
                dblClick: bool('Double click.'),
                includeSnapshot: bool('Return a fresh snapshot.'),
            },
            ['uid']
        )
    ),
    tool(
        'hover',
        'Hover an element by UID.',
        obj({ uid: str('Element UID'), includeSnapshot: bool('Return a fresh snapshot.') }, ['uid'])
    ),
    tool(
        'fill',
        'Replace an input/textarea/select/contenteditable value.',
        obj(
            {
                uid: str('Element UID'),
                value: str('New value'),
                includeSnapshot: bool('Return a fresh snapshot.'),
            },
            ['uid', 'value']
        )
    ),
    tool(
        'fill_form',
        'Fill multiple form fields in order.',
        obj(
            {
                elements: arr(
                    obj({ uid: str('Element UID'), value: str('New value') }, ['uid', 'value']),
                    'Fields to fill'
                ),
                includeSnapshot: bool('Return a fresh snapshot.'),
            },
            ['elements']
        )
    ),
    tool(
        'press_key',
        'Press a key or shortcut in the focused page.',
        obj(
            {
                key: str('Key or shortcut, e.g. Enter or Control+A'),
                includeSnapshot: bool('Return a fresh snapshot.'),
            },
            ['key']
        )
    ),
    tool(
        'type_text',
        'Type text into the already focused element.',
        obj({ text: str('Text to type'), includeSnapshot: bool('Return a fresh snapshot.') }, [
            'text',
        ])
    ),
    tool(
        'attach_file',
        'Attach files to a native file input.',
        obj(
            {
                uid: str('File input UID'),
                paths: arr(str('Absolute file path'), 'Absolute paths'),
                includeSnapshot: bool('Return a fresh snapshot.'),
            },
            ['uid', 'paths']
        )
    ),
    tool(
        'navigate_page',
        'Navigate, go back/forward, or reload the page.',
        obj({
            type: enumType(['url', 'back', 'forward', 'reload'], 'Navigation type'),
            url: str('Target URL when type=url'),
            ignoreCache: bool('Ignore cache when reloading.'),
        })
    ),
    tool(
        'evaluate_script',
        'Evaluate JavaScript in the page and return the result.',
        obj(
            {
                script: str('Async function body or expression'),
                args: arr(obj({}), 'Optional arguments'),
            },
            ['script']
        )
    ),
    tool(
        'wait_for',
        'Wait until the page shows specific text.',
        obj({ text: arr(str('Text'), 'Text or list of text'), timeout: num('Timeout in ms') }, [
            'text',
        ])
    ),
    tool(
        'handle_dialog',
        'Accept or dismiss a JavaScript dialog.',
        obj(
            {
                action: enumType(['accept', 'dismiss'], 'Dialog action'),
                promptText: str('Prompt value'),
            },
            ['action']
        )
    ),
    tool(
        'new_page',
        'Open a new page and switch control to it.',
        obj({ url: str('URL to open'), background: bool('Open as a background popup.') }, ['url'])
    ),
    tool(
        'close_page',
        'Close a controlled page by index.',
        obj({ index: num('Page index from list_pages') }, ['index'])
    ),
    tool('list_pages', 'List controllable pages with indices.'),
    tool(
        'select_page',
        'Switch control to a page by index.',
        obj({ index: num('Page index from list_pages') }, ['index'])
    ),
    tool(
        'drag',
        'Drag an element to a target UID or by an offset.',
        obj(
            {
                uid: str('Element UID'),
                target_uid: str('Target UID'),
                dx: num('Horizontal offset'),
                dy: num('Vertical offset'),
                includeSnapshot: bool('Return a fresh snapshot.'),
            },
            ['uid']
        )
    ),
    tool(
        'scroll',
        'Scroll the page or an element.',
        obj({
            uid: str('Optional element UID'),
            scroll_x: num('Horizontal delta'),
            scroll_y: num('Vertical delta'),
            includeSnapshot: bool('Return a fresh snapshot.'),
        })
    ),
    tool(
        'take_screenshot',
        'Capture a screenshot of the page.',
        obj({
            fullPage: bool('Capture beyond the viewport.'),
            x: num('Clip x'),
            y: num('Clip y'),
            width: num('Clip width'),
            height: num('Clip height'),
        })
    ),
    tool(
        'wait_for_url',
        'Wait until the URL matches a glob pattern.',
        obj({ url: str('URL glob with * wildcard'), timeout: num('Timeout in ms') }, ['url'])
    ),
    tool(
        'wait_for_load_state',
        'Wait for load or domcontentloaded.',
        obj(
            {
                state: enumType(['load', 'domcontentloaded'], 'Load state'),
                timeout: num('Timeout in ms'),
            },
            ['state']
        )
    ),
    tool(
        'wait_for_timeout',
        'Wait for a fixed duration (max 30000 ms).',
        obj({ timeout: num('Timeout in ms') }, ['timeout'])
    ),
    tool(
        'list_downloads',
        'List recent downloads.',
        obj({
            limit: num('Max entries'),
            filenameContains: str('Filename filter'),
            urlContains: str('URL filter'),
            status: enumType(['in_progress', 'complete', 'interrupted'], 'Status filter'),
        })
    ),
    tool(
        'wait_for_download',
        'Wait for a download to start or complete.',
        obj({
            timeout: num('Timeout in ms'),
            filenameContains: str('Filename filter'),
            urlContains: str('URL filter'),
            ignoreExisting: bool('Only new downloads'),
        })
    ),
    tool(
        'run_steps',
        'Run a branch-free sequence of tools.',
        obj(
            {
                steps: arr(
                    obj({ tool: str('Tool name'), args: obj({}) }, ['tool', 'args']),
                    'Steps to run'
                ),
                includeSnapshot: bool('Return a final snapshot.'),
            },
            ['steps']
        )
    ),
];

export const DEBUG_TOOL_SCHEMAS = [
    tool('get_page_info', 'Inspect the current page: URL, title, viewport, detected frameworks.'),
    tool(
        'get_console_logs',
        'Read recent console entries.',
        obj({
            level: enumType(['all', 'log', 'info', 'warning', 'error'], 'Level filter'),
            limit: num('Max entries'),
            sinceMs: num('Only entries newer than this many ms'),
        })
    ),
    tool('get_page_errors', 'Read uncaught exceptions and console errors.'),
    tool(
        'get_network_requests',
        'Read recent network requests. HTTP 4xx/5xx responses appear as normal requests; use status to filter them.',
        obj({
            urlContains: str('URL filter'),
            method: str('HTTP method filter'),
            status: num('Status code filter'),
            failedOnly: bool(
                'Only network-layer failures (blocked/aborted/DNS); HTTP 4xx/5xx are not failures'
            ),
            limit: num('Max entries'),
        })
    ),
    tool(
        'get_network_detail',
        'Read one request: status, headers, and optional response body.',
        obj(
            {
                requestId: str('requestId from get_network_requests'),
                includeBody: bool('Include the response body'),
            },
            ['requestId']
        )
    ),
    tool(
        'get_storage',
        'Read localStorage, sessionStorage, or cookies (sensitive values redacted).',
        obj({
            type: enumType(['local', 'session', 'cookie'], 'Storage type'),
            keyContains: str('Key filter'),
        })
    ),
    tool(
        'get_dom_html',
        'Read the DOM HTML, optionally scoped to a selector.',
        obj({ selector: str('CSS selector'), maxLength: num('Max characters') })
    ),
    tool(
        'get_element_styles',
        'Read computed styles for one element.',
        obj(
            {
                selector: str('CSS selector'),
                properties: arr(str('CSS property'), 'Properties to read'),
            },
            ['selector']
        )
    ),
    tool(
        'get_script_sources',
        'List loaded scripts or read one script source.',
        obj({
            scriptId: str('scriptId from the list'),
            urlContains: str('URL filter'),
            limit: num('Max scripts'),
        })
    ),
    tool(
        'evaluate_script',
        'Evaluate a JavaScript expression in the page and return its value. Async/await is supported (up to 30s).',
        obj({ script: str('JavaScript expression; async/await supported') }, ['script'])
    ),
    tool('clear_debug_logs', 'Clear the console/network buffer.'),
];

function mcpToolToSchema(toolDefinition) {
    const parameters =
        toolDefinition?.inputSchema && typeof toolDefinition.inputSchema === 'object'
            ? toolDefinition.inputSchema
            : { type: 'object', properties: {} };

    return {
        name: toolDefinition._toolId || toolDefinition.name,
        description: toolDefinition.description || toolDefinition.name,
        parameters,
    };
}

export async function buildToolSchemas({ request, mcpManager }) {
    const schemas = [];

    if (request?.enableDebugTools === true) {
        schemas.push(...DEBUG_TOOL_SCHEMAS);
    } else if (request?.enableBrowserControl === true) {
        schemas.push(...CONTROL_TOOL_SCHEMAS);
    }

    if (request?.enableMcpTools === true && mcpManager) {
        const servers = Array.isArray(request.mcpServers) ? request.mcpServers : [];
        const isMulti = servers.length > 0;
        try {
            const allTools = await mcpManager.listAllActiveTools(servers);
            const enabledTools = filterToolsForPreamble(allTools, {
                isMulti,
                servers,
                config: request,
            });
            schemas.push(...enabledTools.map(mcpToolToSchema));
        } catch {
            // MCP discovery is best-effort; other tools still work.
        }
    }

    return schemas;
}

function stripGeminiUnsupported(schema) {
    if (Array.isArray(schema)) return schema.map(stripGeminiUnsupported);
    if (!schema || typeof schema !== 'object') return schema;

    const next = {};
    for (const [key, value] of Object.entries(schema)) {
        if (key === '$schema' || key === 'additionalProperties') continue;
        next[key] = stripGeminiUnsupported(value);
    }
    if (typeof next.type === 'string') next.type = next.type.toUpperCase();
    return next;
}

export function toGeminiFunctionDeclarations(schemas) {
    return (Array.isArray(schemas) ? schemas : []).map((schema) => ({
        name: schema.name,
        description: schema.description,
        parameters: stripGeminiUnsupported(schema.parameters),
    }));
}
