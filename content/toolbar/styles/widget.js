(function () {
    window.GeminiStyles = window.GeminiStyles || {};
    window.GeminiStyles.Widget = `
        /* Toolbar Styles — token-driven, follows prefers-color-scheme */
        .toolbar {
            position: absolute;
            display: flex;
            align-items: center;
            gap: 4px;
            background: var(--gnx-toolbar-bg);
            padding: 4px;
            border-radius: 12px;
            box-shadow: var(--gnx-shadow-toolbar), 0 0 0 1px var(--gnx-toolbar-border);
            opacity: 0;
            transform: translateY(8px);
            transition: opacity 0.2s cubic-bezier(0.2, 0, 0, 1), transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
            pointer-events: none;
            font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Noto Sans SC", Roboto, Helvetica, Arial, sans-serif;
            z-index: 999999;
        }
        .toolbar.visible {
            opacity: 1;
            pointer-events: auto;
            transform: translateY(0);
        }
        .btn {
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0;
            background: transparent;
            border: none;
            color: var(--gnx-toolbar-fg);
            padding: 6px;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            transition: background 0.15s cubic-bezier(0.2, 0, 0, 1), color 0.15s cubic-bezier(0.2, 0, 0, 1);
            white-space: nowrap;
            width: 32px;
            height: 32px;
        }
        .btn:hover {
            background: var(--gnx-hover);
            color: var(--gnx-toolbar-fg-hover);
        }
        .btn.hidden {
            display: none;
        }

        .btn[data-tooltip]::after {
            content: attr(data-tooltip);
            position: absolute;
            bottom: calc(100% + 8px);
            left: 50%;
            transform: translateX(-50%) translateY(4px);
            background: #2f3036;
            color: #e8eaed;
            padding: 6px 8px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 400;
            line-height: 1;
            white-space: nowrap;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.12s ease, transform 0.12s ease;
            box-shadow: 0 4px 12px rgba(0,0,0,0.36), 0 0 0 1px rgba(255,255,255,0.08);
            z-index: 9999999;
            will-change: opacity, transform;
        }
        .btn[data-tooltip]:hover::after,
        .btn[data-tooltip]:focus-visible::after {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
        }

        .toolbar-logo {
            width: 20px;
            height: 20px;
            display: block;
        }

        .custom-selection-tools {
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .btn.custom-selection-tool-btn {
            width: auto;
            min-width: 32px;
            max-width: 64px;
            padding: 6px 8px;
            overflow: hidden;
            text-overflow: ellipsis;
            font-size: 11px;
            letter-spacing: 0;
        }

        .custom-selection-more {
            position: relative;
            display: flex;
        }

        .custom-selection-more.hidden {
            display: none;
        }

        .custom-selection-more-menu {
            position: absolute;
            top: calc(100% + 6px);
            right: 0;
            min-width: 160px;
            max-width: 240px;
            display: none;
            flex-direction: column;
            gap: 2px;
            padding: 4px;
            border-radius: 12px;
            background: var(--gnx-menu-bg);
            border: 1px solid var(--gnx-toolbar-border);
            box-shadow: var(--gnx-shadow-panel);
        }

        .custom-selection-more:hover .custom-selection-more-menu,
        .custom-selection-more:focus-within .custom-selection-more-menu {
            display: flex;
        }

        .custom-selection-more-item {
            width: 100%;
            min-width: 0;
            padding: 8px 10px;
            border: none;
            border-radius: 6px;
            background: transparent;
            color: var(--gnx-fg-muted);
            font: inherit;
            font-size: 13px;
            text-align: left;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            cursor: pointer;
        }

        .custom-selection-more-item:hover,
        .custom-selection-more-item:focus-visible {
            background: var(--gnx-hover);
            color: var(--gnx-fg);
            outline: none;
        }

        /* Toolbar Drag Handle */
        .toolbar-drag-handle {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 16px;
            height: 32px;
            color: var(--gnx-fg-subtle);
            cursor: grab;
            transition: color 0.15s;
            flex-shrink: 0;
            margin-right: 2px;
        }
        .toolbar-drag-handle:hover {
            color: var(--gnx-fg-muted);
        }
        .toolbar-drag-handle:active {
            cursor: grabbing;
            color: var(--gnx-fg);
        }
        .toolbar.dragging {
            cursor: grabbing;
            user-select: none;
        }
        .toolbar.dragging .toolbar-drag-handle {
            cursor: grabbing;
            color: var(--gnx-fg);
        }

        .image-btn {
            position: absolute;
            z-index: 1000000;
            opacity: 0;
            pointer-events: none;
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            transition: opacity 0.2s;
            width: auto;
            height: auto;
            background: transparent;
            border: none;
            box-shadow: none;
        }

        .image-btn.visible {
            opacity: 1;
            pointer-events: auto;
        }

        /* The trigger button (AI Tools) */
        .ai-tool-trigger {
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--gnx-menu-bg);
            color: var(--gnx-fg-muted);
            width: 20px;
            height: 20px;
            border-radius: 5px;
            box-sizing: border-box;
            cursor: pointer;
            box-shadow: 0 2px 8px rgba(0,0,0,0.22), 0 0 0 1px var(--gnx-toolbar-border);
            border: none;
            transition: background 0.2s, color 0.2s, box-shadow 0.2s, transform 0.1s;
        }
        .ai-tool-trigger:hover {
            background: var(--gnx-surface-hover);
            color: var(--gnx-fg);
            box-shadow: 0 3px 10px rgba(0,0,0,0.28), 0 0 0 1px var(--gnx-toolbar-border);
        }
        .ai-tool-trigger:active {
            transform: scale(0.95);
        }

        /* The dropdown menu */
        .ai-tool-menu {
            margin-top: 6px;
            background: var(--gnx-menu-bg);
            border-radius: 8px;
            padding: 4px;
            width: 200px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.4);
            border: 1px solid var(--gnx-toolbar-border);
            display: none;
            flex-direction: column;
            gap: 2px;
            font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Noto Sans SC", Roboto, Helvetica, Arial, sans-serif;
        }

        /* Show menu on hover */
        .image-btn:hover .ai-tool-menu,
        .image-btn:focus-within .ai-tool-menu {
            display: flex;
        }

        .menu-item {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 8px 10px;
            color: var(--gnx-fg-muted);
            font-size: 13px;
            border-radius: 6px;
            cursor: pointer;
            transition: background 0.15s, color 0.15s;
            position: relative;
            user-select: none;
        }
        .menu-item:hover,
        .menu-item:focus-visible {
            background: var(--gnx-hover);
            color: var(--gnx-fg);
            outline: none;
        }
        .menu-item:focus-visible {
            box-shadow: 0 0 0 2px var(--gnx-primary-ring);
        }

        .menu-item svg {
            width: 16px;
            height: 16px;
            flex-shrink: 0;
            color: var(--gnx-fg-subtle);
        }
        .menu-item:hover svg,
        .menu-item:focus-visible svg {
            color: var(--gnx-fg);
        }

        .menu-item span {
            flex: 1;
        }

        .submenu-arrow {
            width: 14px;
            height: 14px;
            opacity: 0.7;
            display: flex;
            align-items: center;
        }

        /* Submenu */
        .submenu {
            position: absolute;
            left: 100%;
            top: var(--submenu-offset-y, 0px);
            margin-left: 8px;
            background: var(--gnx-menu-bg);
            border-radius: 8px;
            padding: 4px;
            width: 180px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.4);
            border: 1px solid var(--gnx-toolbar-border);
            display: none;
            flex-direction: column;
            gap: 2px;
            z-index: 10;
        }

        /* Invisible bridge to prevent submenu closing when hovering gap */
        .submenu::before {
            content: "";
            position: absolute;
            top: 0;
            bottom: 0;
            left: -10px; /* Bridge the 8px margin gap + overlap */
            width: 10px;
            background: transparent;
        }

        .menu-item.has-submenu.submenu-open-left .submenu {
            left: auto;
            right: 100%;
            margin-left: 0;
            margin-right: 8px;
        }

        .menu-item.has-submenu.submenu-open-left .submenu::before {
            left: auto;
            right: -10px;
        }

        .menu-item.has-submenu:hover .submenu,
        .menu-item.has-submenu:focus-within .submenu,
        .menu-item.has-submenu.submenu-open .submenu {
            display: flex;
        }
    `;
})();
