# Shortcut System Optimization & Feature Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve system-level key collisions (`Ctrl+B`), eliminate international keyboard input hijacking on macOS/European layouts, fix the WCAG 2.1.2 keyboard trap in the chat prompt (`Tab`), register browser-level command for browser control in `manifest.json`, align Iframe bridge commands, and introduce high-value workflow shortcuts (`Alt+N`, `Alt+T`, `Alt+H`, `Ctrl+M`) with discoverable tooltips.

---

## File Structure

- **`manifest.json`**: Register `browser-control` command (`Alt+Shift+B` default / mac `Alt+Shift+B`).
- **`background/index.js`**: Add `browser-control` to `chrome.commands.onCommand` and wire to browser control toggle.
- **`shared/config/constants_global.js` & `shared/config/constants.js`**: Update default `browserControl` to `'Alt+Shift+B'`, add `'Ctrl+B'` to `LEGACY_DEFAULT_SHORTCUTS` for seamless migration.
- **`content/shortcuts.js`**:
  - Update `isEditableShortcutTarget` to recognize `element.isContentEditable` and `[contenteditable="plaintext-only"]`.
  - Guard `quickAsk` and `ocrCapture` when `isEditableShortcutTarget` is true to avoid hijacking non-US keyboard characters (`œ`, `ø`, etc.).
- **`content/shortcut_frame_bridge.js`**:
  - Update `DEFAULT_SHORTCUTS.browserControl` to `'Alt+Shift+B'`.
  - Add `refreshChromeCommandShortcuts()` with `chrome.commands.getAll()` sync on init and window focus.
  - Guard editable targets from character hijacking.
- **`sandbox/boot/input_events.js`**:
  - Replace prompt `Tab` key interception with `(keyEvent.ctrlKey || keyEvent.metaKey) && keyEvent.key.toLowerCase() === 'm'` (`Ctrl+M` / `Cmd+M`).
  - Restore native `Tab` focus navigation from `#prompt`.
  - Add global hotkeys: `Alt+N` (New Chat), `Alt+T` (Toggle Thinking Mode), `Alt+H` (Toggle History Sidebar).
- **`sandbox/ui/templates/settings/shortcuts.js`**:
  - Update `browserControl` default display to `Alt+Shift+B`.
  - Update `shortcutSwitchModel` display to `Ctrl+M` / `Cmd+M`.
  - Add static rows for `Alt+N` (New Chat), `Alt+T` (Thinking Toggle), `Alt+H` (History Drawer).
- **`sandbox/core/translations.js`**:
  - Update `modelSelectTooltip` and `shortcutSwitchModel` text.
  - Add translations for new shortcuts.
- **`sandbox/ui/templates/header.js` & `footer.js`**:
  - Update tooltips (`data-i18n-title`) to reflect new shortcuts (`Enter`, `Alt+N`, `Alt+T`, `Alt+H`, `Ctrl+M`).
- **Test files**:
  - `scripts/manifest.test.js`
  - `content/shortcuts.test.js`
  - `content/shortcut_frame_bridge.test.js`
  - `sandbox/boot/input_events.test.js`
  - `sandbox/ui/settings/sections/shortcuts.test.js`

---

## Tasks

- [x] **Task 1: P0 - Update `manifest.json`, `constants_global.js`, and `background/index.js` for `browser-control` command**
  - [x] Add `browser-control` command to `manifest.json` (`Alt+Shift+B`).
  - [x] Update `scripts/manifest.test.js` to assert `manifest.commands['browser-control']`.
  - [x] Update `shared/config/constants_global.js` default `browserControl` to `'Alt+Shift+B'`, add `'Ctrl+B'` to `LEGACY_DEFAULT_SHORTCUTS`.
  - [x] Wire `browser-control` in `background/index.js` `chrome.commands.onCommand`.
  - [x] Update `sandbox/ui/settings/sections/shortcuts.js` and `sandbox/ui/templates/settings/shortcuts.js` default value.
  - [x] Run test: `npx vitest run scripts/manifest.test.js` and `npx vitest run shared/config/constants.test.js`.

- [x] **Task 2: P0 - Protect editable fields from `Alt+Q` and `Alt+O` character hijacking & align `isEditableShortcutTarget`**
  - [x] In `content/shortcuts.js`, update `isEditableShortcutTarget` to include `element.isContentEditable` and `[contenteditable="plaintext-only"]`.
  - [x] In `content/shortcuts.js`, prevent `quickAsk` and `ocrCapture` from executing when `isEditableTarget` is true and modifiers are plain `Alt` (letting native text typing through).
  - [x] Update `content/shortcuts.test.js` to assert that typing in editable fields is not intercepted for OCR/Quick Ask.
  - [x] Run test: `npx vitest run content/shortcuts.test.js`.

- [x] **Task 3: P0 - Eliminate Tab keyboard trap, adopt `Ctrl+M` / `Cmd+M` for model cycling**
  - [x] In `sandbox/boot/input_events.js`, remove `Tab` interception from `#prompt`.
  - [x] In `sandbox/boot/input_events.js`, handle `(Ctrl/Cmd)+M` on `#prompt` and model picker to cycle models.
  - [x] In `sandbox/boot/input_events.test.js`, update tests from `Tab` to `Ctrl+M` / `Cmd+M` and assert Tab is uninhibited.
  - [x] In `sandbox/core/translations.js`, update `modelSelectTooltip` and `shortcutSwitchModel`.
  - [x] In `sandbox/ui/templates/header.js`, update title text to reflect `Ctrl+M`.
  - [x] In `sandbox/ui/templates/settings/shortcuts.js`, update static row from `Tab` to `Ctrl+M`.
  - [x] Run test: `npx vitest run sandbox/boot/input_events.test.js`.

- [x] **Task 4: P1 - Synchronize `content/shortcut_frame_bridge.js` with Chrome Commands and defaults**
  - [x] In `content/shortcut_frame_bridge.js`, update default `browserControl` to `'Alt+Shift+B'`.
  - [x] In `content/shortcut_frame_bridge.js`, add `refreshChromeCommandShortcuts()` using `chrome.commands.getAll()`.
  - [x] Align `isEditableShortcutTarget` in frame bridge.
  - [x] Update `content/shortcut_frame_bridge.test.js`.
  - [x] Run test: `npx vitest run content/shortcut_frame_bridge.test.js`.

- [x] **Task 5: P1 & P2 - Add high-value hotkeys (`Alt+N`, `Alt+T`, `Alt+H`) and tooltip shortcut labels**
  - [x] In `sandbox/boot/input_events.js`, add global key listeners for `Alt+N` (New Chat), `Alt+T` (Toggle Thinking Mode), and `Alt+H` (Toggle History Sidebar).
  - [x] In `sandbox/ui/templates/settings/shortcuts.js`, add static rows for `Alt+N`, `Alt+T`, and `Alt+H`.
  - [x] In `sandbox/core/translations.js`, add i18n keys and update tooltip labels.
  - [x] In `sandbox/ui/templates/header.js` and `footer.js`, update `title` attributes.
  - [x] Add tests in `sandbox/boot/input_events.test.js` verifying `Alt+N`, `Alt+T`, and `Alt+H`.
  - [x] Run test: `npx vitest run sandbox/boot/input_events.test.js`.

- [x] **Task 6: Full verification, formatting, and packaging**
  - [x] Run `npm run format`.
  - [x] Run `npm run check` (TypeScript, Vite build, Knip, Vitest 201 suites).
  - [x] Run `npm run package:local` to sync to `~/Extensions/gemini-nexus`.
