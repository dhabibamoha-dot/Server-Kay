// ==UserScript==
// @name         Multi Tabs Controller — Modern UI Theme
// @namespace    https://github.com/dhabibamoha-dot/Server-Kay
// @version      1.0.0
// @description  CSS-only visual refresh for the Multi Tabs Controller interface. Does not alter game or network behavior.
// @match        https://agar-ar.com/*
// @match        https://*.agar-ar.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    const STYLE_ID = 'mtc-modern-ui-theme';
    const css = `
:root {
  --mtc-bg: #0b1020;
  --mtc-surface: #111a2c;
  --mtc-surface-raised: #172238;
  --mtc-surface-soft: #1d2a42;
  --mtc-line: rgba(166, 190, 225, .14);
  --mtc-line-strong: rgba(166, 190, 225, .24);
  --mtc-text: #edf4ff;
  --mtc-muted: #9aacc6;
  --mtc-accent: #45d6c5;
  --mtc-accent-2: #78a8ff;
  --mtc-good: #55d69e;
  --mtc-warn: #ffca72;
  --mtc-danger: #ff7185;
  --mtc-radius: 14px;
  --mtc-shadow: 0 24px 70px rgba(0, 0, 0, .52);
}

/* Main panel: scoped to the userscript UI only. */
#controlPanel.nm-menu-container {
  box-sizing: border-box !important;
  width: min(680px, calc(100vw - 24px)) !important;
  min-width: 0 !important;
  min-height: 0 !important;
  max-height: calc(100dvh - 24px) !important;
  padding: 18px !important;
  gap: 12px !important;
  overflow: hidden !important;
  color: var(--mtc-text) !important;
  background: linear-gradient(145deg, rgba(17, 26, 44, .98), rgba(9, 15, 28, .98)) !important;
  border: 1px solid var(--mtc-line-strong) !important;
  border-radius: 20px !important;
  box-shadow: var(--mtc-shadow), inset 0 1px rgba(255,255,255,.05) !important;
  font-family: Inter, "Segoe UI", Tahoma, Arial, sans-serif !important;
  isolation: isolate;
  backdrop-filter: blur(18px) saturate(130%);
}
#controlPanel.nm-menu-container::before {
  background:
    radial-gradient(420px 220px at 100% 0%, rgba(69, 214, 197, .13), transparent 72%),
    radial-gradient(360px 180px at 0% 100%, rgba(120, 168, 255, .09), transparent 70%) !important;
}
#controlPanel .nm-menu-header { gap: 7px !important; margin: 8px 0 2px !important; }
#controlPanel .nm-menu-header h2 {
  color: var(--mtc-text) !important;
  font-size: 21px !important;
  font-weight: 800 !important;
  letter-spacing: -.3px !important;
}
#controlPanel .nm-menu-header h2 span { color: var(--mtc-accent) !important; text-shadow: none !important; }
#controlPanel .nm-page-chip {
  padding: 4px 11px !important;
  color: var(--mtc-muted) !important;
  background: rgba(69, 214, 197, .08) !important;
  border: 1px solid rgba(69, 214, 197, .2) !important;
  border-radius: 999px !important;
}
#controlPanel .nm-page-chip b {
  color: #07151a !important;
  background: var(--mtc-accent) !important;
  box-shadow: none !important;
}
#controlPanel .nm-close-btn {
  color: var(--mtc-muted) !important;
  background: rgba(255,255,255,.045) !important;
  border: 1px solid var(--mtc-line) !important;
  border-radius: 10px !important;
}
#controlPanel .nm-close-btn:hover {
  color: #fff !important;
  background: rgba(255,113,133,.14) !important;
  border-color: rgba(255,113,133,.4) !important;
}
#controlPanel .nm-special-top-btn {
  color: #081719 !important;
  background: linear-gradient(135deg, #72e5d4, #45c8bd) !important;
  border-radius: 10px !important;
  box-shadow: 0 6px 18px rgba(69,214,197,.16) !important;
}

#controlPanel .nm-menu-body { gap: 12px !important; }
#controlPanel .nm-side-nav { width: 48px !important; gap: 8px !important; }
#controlPanel .nm-tab-btn {
  width: 46px !important;
  height: 46px !important;
  color: var(--mtc-muted) !important;
  background: rgba(255,255,255,.035) !important;
  border: 1px solid transparent !important;
  border-radius: 13px !important;
  transition: background .18s ease, color .18s ease, border-color .18s ease, transform .18s ease !important;
}
#controlPanel .nm-tab-btn:hover {
  color: var(--mtc-text) !important;
  background: rgba(120,168,255,.10) !important;
  border-color: rgba(120,168,255,.2) !important;
  transform: translateX(-2px);
}
#controlPanel .nm-tab-btn.active {
  color: var(--mtc-accent) !important;
  background: linear-gradient(145deg, rgba(69,214,197,.17), rgba(69,214,197,.06)) !important;
  border-color: rgba(69,214,197,.35) !important;
  box-shadow: inset 0 0 0 1px rgba(69,214,197,.06), 0 5px 16px rgba(0,0,0,.18) !important;
}
#controlPanel .nm-tab-content-container {
  min-width: 0 !important;
  padding: 14px !important;
  background: rgba(5, 11, 22, .45) !important;
  border: 1px solid var(--mtc-line) !important;
  border-radius: 16px !important;
}
#controlPanel .nm-tab-pane { gap: 12px !important; padding: 1px 2px 6px 1px !important; }
#controlPanel .nm-tab-pane::-webkit-scrollbar,
#controlPanel .nm-lines-column::-webkit-scrollbar,
#controlPanel .nm-customizations-list::-webkit-scrollbar,
#controlPanel .nm-modal-body::-webkit-scrollbar { width: 6px !important; }
#controlPanel .nm-tab-pane::-webkit-scrollbar-thumb,
#controlPanel .nm-lines-column::-webkit-scrollbar-thumb,
#controlPanel .nm-customizations-list::-webkit-scrollbar-thumb,
#controlPanel .nm-modal-body::-webkit-scrollbar-thumb {
  background: rgba(120,168,255,.32) !important;
  border-radius: 99px !important;
}

/* Cards, rows, and explanatory text. */
#controlPanel .nm-card,
#controlPanel .nm-lines-column,
#controlPanel .nm-timer-box,
#controlPanel .nm-colors-box,
#controlPanel .nm-cust-item,
#controlPanel .nm-action-row,
#controlPanel .nm-macro-row {
  color: var(--mtc-text) !important;
  background: linear-gradient(145deg, rgba(255,255,255,.045), rgba(255,255,255,.018)) !important;
  border: 1px solid var(--mtc-line) !important;
  border-radius: var(--mtc-radius) !important;
  box-shadow: 0 5px 16px rgba(0,0,0,.12) !important;
}
#controlPanel .nm-card { padding: 15px !important; }
#controlPanel .nm-card-title,
#controlPanel .nm-lines-title { color: var(--mtc-accent) !important; font-size: 14px !important; font-weight: 800 !important; }
#controlPanel .nm-note,
#controlPanel .nm-lines-hint,
#controlPanel .nm-opt,
#controlPanel .nm-line-name,
#controlPanel .nm-row-label { color: var(--mtc-muted) !important; }
#controlPanel .nm-lines-hint span {
  color: var(--mtc-text) !important;
  background: rgba(255,255,255,.04) !important;
  border: 1px solid var(--mtc-line) !important;
  border-radius: 9px !important;
}
#controlPanel .nm-lines-hint span.pin {
  color: var(--mtc-warn) !important;
  background: rgba(255,202,114,.08) !important;
  border-color: rgba(255,202,114,.24) !important;
}
#controlPanel .nm-line-row {
  min-height: 44px !important;
  padding: 6px 8px !important;
  gap: 9px !important;
  border-bottom: 1px solid rgba(166,190,225,.09) !important;
  border-radius: 9px !important;
}
#controlPanel .nm-line-row:hover { background: rgba(255,255,255,.025) !important; }
#controlPanel .nm-line-name { color: var(--mtc-text) !important; font-size: 12px !important; }
#controlPanel .nm-line-state {
  min-width: 58px !important;
  color: var(--mtc-muted) !important;
  background: rgba(255,255,255,.045) !important;
  border: 1px solid var(--mtc-line) !important;
  border-radius: 8px !important;
}
#controlPanel .nm-line-state.nm-st-line {
  color: var(--mtc-accent) !important;
  background: rgba(69,214,197,.09) !important;
  border-color: rgba(69,214,197,.28) !important;
  box-shadow: none !important;
}
#controlPanel .nm-line-state.nm-st-pin {
  color: var(--mtc-warn) !important;
  background: rgba(255,202,114,.10) !important;
  border-color: rgba(255,202,114,.34) !important;
  box-shadow: none !important;
  animation: none !important;
}
#controlPanel .nm-lines-toolbar { gap: 8px !important; flex-wrap: wrap !important; }

/* Buttons and form controls. */
#controlPanel button { font: inherit; }
#controlPanel .nm-btn-main,
#controlPanel .nm-chip-btn.primary {
  color: #07151a !important;
  background: linear-gradient(135deg, #72e5d4, #45c8bd) !important;
  border: 1px solid rgba(114,229,212,.45) !important;
  border-radius: 10px !important;
  box-shadow: 0 6px 18px rgba(69,214,197,.12) !important;
  transition: transform .16s ease, filter .16s ease, box-shadow .16s ease !important;
}
#controlPanel .nm-btn-main:hover,
#controlPanel .nm-chip-btn.primary:hover { filter: brightness(1.06) !important; transform: translateY(-1px) !important; }
#controlPanel .nm-chip-btn,
#controlPanel .nm-btn-mini,
#controlPanel .nm-btn-rec,
#controlPanel .nm-btn-icon {
  color: var(--mtc-text) !important;
  background: rgba(255,255,255,.045) !important;
  border: 1px solid var(--mtc-line-strong) !important;
  border-radius: 9px !important;
  transition: background .16s ease, border-color .16s ease, transform .16s ease !important;
}
#controlPanel .nm-chip-btn:hover,
#controlPanel .nm-btn-mini:hover,
#controlPanel .nm-btn-rec:hover,
#controlPanel .nm-btn-icon:hover {
  background: rgba(120,168,255,.11) !important;
  border-color: rgba(120,168,255,.32) !important;
}
#controlPanel .nm-btn-mini.danger,
#controlPanel .nm-danger-icon:hover {
  color: var(--mtc-danger) !important;
  background: rgba(255,113,133,.08) !important;
  border-color: rgba(255,113,133,.25) !important;
}
#controlPanel .nm-btn-rec.recording,
#controlPanel .nm-key-box.recording {
  color: var(--mtc-danger) !important;
  background: rgba(255,113,133,.1) !important;
  border-color: rgba(255,113,133,.5) !important;
  animation: none !important;
}
#controlPanel .nm-dark-input,
#controlPanel .nm-dark-select,
#controlPanel .nm-mini-select,
#controlPanel select,
#controlPanel input[type="text"],
#controlPanel input[type="number"] {
  box-sizing: border-box !important;
  min-height: 34px;
  color: var(--mtc-text) !important;
  background-color: #0d1627 !important;
  border: 1px solid var(--mtc-line-strong) !important;
  border-radius: 9px !important;
  outline: none !important;
}
#controlPanel .nm-dark-input:focus,
#controlPanel .nm-dark-select:focus,
#controlPanel .nm-mini-select:focus,
#controlPanel select:focus,
#controlPanel input:focus {
  border-color: rgba(69,214,197,.65) !important;
  box-shadow: 0 0 0 3px rgba(69,214,197,.12) !important;
}
#controlPanel select option { color: var(--mtc-text); background: #111a2c; }
#controlPanel .nm-key-box {
  color: var(--mtc-accent) !important;
  background: #0d1627 !important;
  border: 1px solid var(--mtc-line-strong) !important;
  border-radius: 8px !important;
}
#controlPanel .nm-toggle-switch .nm-slider {
  background: #27344a !important;
  border: 1px solid var(--mtc-line-strong) !important;
}
#controlPanel .nm-toggle-switch .nm-slider::before { background: #a7b6ca !important; }
#controlPanel .nm-toggle-switch input:checked + .nm-slider {
  background: rgba(69,214,197,.22) !important;
  border-color: rgba(69,214,197,.55) !important;
}
#controlPanel .nm-toggle-switch input:checked + .nm-slider::before {
  background: var(--mtc-accent) !important;
  box-shadow: 0 0 10px rgba(69,214,197,.36) !important;
}
#controlPanel :focus-visible { outline: 2px solid rgba(69,214,197,.8) !important; outline-offset: 2px; }

/* Popups and feedback. */
#controlPanel .nm-modal {
  color: var(--mtc-text) !important;
  background: rgba(7,12,23,.94) !important;
  border: 1px solid var(--mtc-line-strong) !important;
  border-radius: 16px !important;
}
#controlPanel .nm-cust-item:hover,
#controlPanel .nm-macro-row:hover { border-color: rgba(69,214,197,.28) !important; }
#controlPanel .nm-cust-key-badge { color: var(--mtc-accent) !important; background: rgba(69,214,197,.08) !important; border-color: rgba(69,214,197,.22) !important; }
#controlPanel .nm-empty-state { color: var(--mtc-muted) !important; }
#controlPanel .nm-status-text { color: var(--mtc-muted) !important; }
#controlPanel .nm-status-dot { background: var(--mtc-danger) !important; }
#controlPanel .nm-status-dot.connected { background: var(--mtc-good) !important; box-shadow: 0 0 10px rgba(85,214,158,.5) !important; animation: none !important; }
#nm-floating-circle {
  background-color: #14233a !important;
  border: 1px solid rgba(114,229,212,.48) !important;
  box-shadow: 0 12px 32px rgba(0,0,0,.42), 0 0 24px rgba(69,214,197,.2) !important;
}
#nm-floating-circle::before { opacity: .46; }
#nm-floating-circle:hover { box-shadow: 0 14px 36px rgba(0,0,0,.48), 0 0 28px rgba(69,214,197,.3) !important; }
#nm-floating-circle .nm-page-badge { color: #07151a !important; background: var(--mtc-accent) !important; border: 2px solid #0b1020 !important; }
#nm-hud .nm-hud-tag {
  color: var(--mtc-text) !important;
  background: rgba(11,16,32,.94) !important;
  border: 1px solid var(--mtc-line-strong) !important;
  border-radius: 10px !important;
  box-shadow: 0 8px 24px rgba(0,0,0,.3) !important;
}
#nm-hud .nm-hud-tag.nm-hud-line { border-color: rgba(69,214,197,.45) !important; }
#nm-hud .nm-hud-tag.nm-hud-pin { border-color: rgba(255,202,114,.5) !important; box-shadow: 0 8px 24px rgba(0,0,0,.3) !important; }
#nm-toast-stack .nm-toast {
  color: var(--mtc-text) !important;
  background: rgba(17,26,44,.96) !important;
  border: 1px solid var(--mtc-line-strong) !important;
  border-radius: 12px !important;
  box-shadow: 0 12px 30px rgba(0,0,0,.34) !important;
}
#nm-toast-stack .nm-toast-dot { background: var(--mtc-accent) !important; box-shadow: none !important; }
#nm-setup-overlay { font-family: Inter, "Segoe UI", Tahoma, Arial, sans-serif !important; }
#nm-setup-overlay .nm-setup-card {
  color: var(--mtc-text) !important;
  background: linear-gradient(145deg, #172238, #0b1020) !important;
  border: 1px solid var(--mtc-line-strong) !important;
  border-radius: 18px !important;
  box-shadow: var(--mtc-shadow) !important;
}

@media (max-width: 620px) {
  #controlPanel.nm-menu-container {
    width: calc(100vw - 16px) !important;
    max-height: calc(100dvh - 16px) !important;
    padding: 12px !important;
    border-radius: 15px !important;
  }
  #controlPanel .nm-menu-body { gap: 8px !important; }
  #controlPanel .nm-side-nav { width: 40px !important; gap: 6px !important; }
  #controlPanel .nm-tab-btn { width: 38px !important; height: 40px !important; border-radius: 10px !important; }
  #controlPanel .nm-tab-btn svg { width: 19px !important; height: 19px !important; }
  #controlPanel .nm-tab-content-container { padding: 9px !important; }
  #controlPanel .nm-menu-header h2 { font-size: 17px !important; }
  #controlPanel .nm-line-row { flex-wrap: wrap !important; justify-content: flex-start !important; }
  #controlPanel .nm-line-name { width: auto !important; min-width: 92px; flex: 1 1 110px; }
  #controlPanel .nm-mini-select { width: 96px !important; }
  #controlPanel .nm-footer-rights { display: none !important; }
  #controlPanel .nm-status-container { bottom: 10px !important; left: 12px !important; }
  #controlPanel .nm-action-buttons-row { flex-wrap: wrap !important; }
  #controlPanel .nm-action-buttons-row > * { min-width: 120px; }
}
@media (prefers-reduced-motion: reduce) {
  #controlPanel *, #nm-floating-circle, #nm-toast-stack * { animation-duration: .01ms !important; transition-duration: .01ms !important; }
}
`;

    function installTheme() {
        if (!document.documentElement || document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
    }

    installTheme();
    // Reinstall if the page replaces its head; only watches document structure, not game state.
    const observer = new MutationObserver(() => {
        if (!document.getElementById(STYLE_ID)) installTheme();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
})();
