(function () {
    window.GeminiStyles = window.GeminiStyles || {};
    window.GeminiStyles.PanelFooter = `
        .window-footer {
            flex-shrink: 0;
            background: var(--gnx-bg);
            padding: 8px 16px;
            min-height: 48px;
            display: flex;
            align-items: center;
            justify-content: center; /* Centered by default for Stop button */
            box-sizing: border-box;
        }

        .window-footer.hidden { display: none; }

        .footer-actions {
            width: 100%;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .footer-actions.hidden { display: none; }

        .footer-left, .footer-right {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .footer-btn {
            background: transparent;
            border: none;
            cursor: pointer;
            padding: 6px;
            border-radius: 4px;
            color: var(--gnx-fg-subtle);
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.2s, color 0.2s;
        }
        .footer-btn:hover {
            background: var(--gnx-surface);
            color: var(--gnx-primary);
        }

        .footer-btn.text-btn {
            padding: 6px 10px;
            gap: 6px;
            font-size: 13px;
            font-weight: 500;
        }

        .footer-btn.text-btn.primary {
            background: var(--gnx-primary);
            color: var(--gnx-on-primary);
        }
        .footer-btn.text-btn.primary:hover {
            background: var(--gnx-primary-hover);
        }

        #btn-insert, #btn-replace {
            background: var(--gnx-chip-bg);
            color: var(--gnx-primary);
            border: 1px solid var(--gnx-primary);
        }
        #btn-insert:hover, #btn-replace:hover {
            background: var(--gnx-chip-bg-hover);
        }

        .footer-stop {
            width: 100%;
            display: flex;
            justify-content: center;
        }
        .footer-stop.hidden { display: none; }

        .stop-pill-btn {
            background: var(--gnx-bg);
            color: var(--gnx-fg);
            border: 1px solid var(--gnx-border);
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            padding: 6px 16px;
            border-radius: 20px;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: background 0.2s, box-shadow 0.2s;
        }
        .stop-pill-btn:hover {
            background: var(--gnx-surface);
            box-shadow: 0 2px 5px rgba(0,0,0,0.15);
        }
    `;
})();
