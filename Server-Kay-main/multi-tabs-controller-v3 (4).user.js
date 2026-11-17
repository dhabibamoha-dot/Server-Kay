// ==UserScript==
// @name         Nightmare Controller | Anas Sherif
// @namespace    http://tampermonkey.net/
// @version      4.0.0
// @description  Nightmare Controller v4 — physics-aware lines & corners, instant pins, macros, clip recorder, size alerts, profiles, server-driven updates
// @author       Anas Sherif
// @match        https://agar-ar.com/*
// @match        https://*.agar-ar.com/*
// @icon         https://agar-ar.com/favicon.ico
// @grant        none
// @run-at       document-start
// ==/UserScript==

// ── v4 build identity (checked against the update server) ─────────────────────
const NM_VERSION = "4.0.0";

// ── nativeify: make functions look like native code to anti-tamper checks ─
function nativeify(fn, name) {
    try {
        const tag = `function ${name || fn.name || ''}() { [native code] }`;
        try { Object.defineProperty(fn, 'name', { value: name || fn.name, configurable: true }); } catch (_) { }
        fn.toString = function () { return tag; };
        fn.toString.toString = function () { return 'function toString() { [native code] }'; };
    } catch (_) { }
    return fn;
}

const _spoofedFns = new WeakMap();
const _maskedDescriptors = new WeakMap();
const hookedTargets = new WeakSet();
const _origGOPD = Object.getOwnPropertyDescriptor;
const _origToString = Function.prototype.toString;

function defineHidden(obj, key, val) {
    try {
        Object.defineProperty(obj, key, { value: val, enumerable: false, writable: true, configurable: true });
    } catch (_) { }
}

(async function () {
    'use strict';

    try {
        const _maskedDescriptors = new WeakMap();
        const isObj = (o) => o !== null && (typeof o === 'object' || typeof o === 'function');

        Function.prototype.toString = nativeify(function toString() {
            try {
                if (typeof this === 'function') {
                    const tag = _spoofedFns.get(this);
                    if (tag) return tag;
                    if (this === Function.prototype.toString) return 'function toString() { [native code] }';
                }
            } catch (_) { }
            return _origToString.call(this);
        }, 'toString');
        _spoofedFns.set(Function.prototype.toString, 'function toString() { [native code] }');

        Object.getOwnPropertyDescriptor = nativeify(function getOwnPropertyDescriptor(obj, prop) {
            if (isObj(obj)) {
                try {
                    const m = _maskedDescriptors.get(obj);
                    if (m && m.has(prop)) return m.get(prop);
                } catch (_) { }
            }
            return _origGOPD.call(Object, obj, prop);
        }, 'getOwnPropertyDescriptor');
        _spoofedFns.set(Object.getOwnPropertyDescriptor, 'function getOwnPropertyDescriptor() { [native code] }');

        function maskDescriptor(proto, key, originalDesc) {
            if (!isObj(proto)) return;
            try {
                let m = _maskedDescriptors.get(proto);
                if (!m) { m = new Map(); _maskedDescriptors.set(proto, m); }
                m.set(key, originalDesc);
            } catch (_) { }
        }
        defineHidden(window, '__mask', maskDescriptor);
        _spoofedFns.set(maskDescriptor, 'function maskDescriptor() { [native code] }');
    } catch (_) { }
    (function initEventHooks() {
        const _wrapMap = new WeakMap();
        const mask = window.__mask;

        /**
         * getTrustWrapper(target, original)
         * Wraps an event listener to deliver a "Trusted" Proxy of the event.
         * Uses Proxy to maintain 'instanceof' and native behavior.
         */
        function getTrustWrapper(target, original) {
            if (!target || (typeof target !== 'object' && typeof target !== 'function')) return original;
            let m = _wrapMap.get(target);
            if (!m) { m = new Map(); _wrapMap.set(target, m); }
            if (m.has(original)) return m.get(original);

            const wrapper = nativeify(function (ev) {
                if (!ev) return original.call(this, ev);
                const proxy = new Proxy(ev, {
                    get(t, prop) {
                        if (prop === 'isTrusted') return true;
                        const val = t[prop];
                        if (typeof val === 'function') {
                            try {
                                return (typeof val.bind === 'function') ? val.bind(t) : val;
                            } catch (_) { return val; }
                        }
                        return val;
                    }
                });
                try { return original.call(this, proxy); } catch (e) { throw e; }
            }, original.name || 'wrapper');

            m.set(original, wrapper);
            return wrapper;
        }

        /**
         * patchProto(proto, name)
         * Stealth-hooks addEventListener/removeEventListener.
         */
        const patchProto = (proto, name) => {
            try {
                if (!proto || !proto.addEventListener || hookedTargets.has(proto)) return;
                hookedTargets.add(proto);

                const _origAEL = proto.addEventListener;
                const _origRAEL = proto.removeEventListener;
                const descAEL = Object.getOwnPropertyDescriptor(proto, 'addEventListener');
                const descRAEL = Object.getOwnPropertyDescriptor(proto, 'removeEventListener');

                proto.addEventListener = nativeify(function (type, listener, options) {
                    try {
                        if (typeof listener === 'function') {
                            return _origAEL.call(this, type, getTrustWrapper(this, listener), options);
                        }
                    } catch (_) { }
                    return _origAEL.call(this, type, listener, options);
                }, 'addEventListener');

                proto.removeEventListener = nativeify(function (type, listener, options) {
                    try {
                        if (typeof listener === 'function') {
                            const m = _wrapMap.get(this);
                            if (m && m.has(listener)) {
                                const w = m.get(listener); m.delete(listener);
                                return _origRAEL.call(this, type, w, options);
                            }
                        }
                    } catch (_) { }
                    return _origRAEL.call(this, type, listener, options);
                }, 'removeEventListener');

                if (mask) {
                    mask(proto, 'addEventListener', descAEL);
                    mask(proto, 'removeEventListener', descRAEL);
                }
            } catch (e) { }
        };

        patchProto(EventTarget.prototype, 'EventTarget');
        patchProto(HTMLElement.prototype, 'HTMLElement');
        if (typeof Element !== 'undefined') patchProto(Element.prototype, 'Element');
        if (typeof Node !== 'undefined') patchProto(Node.prototype, 'Node');

        /**
         * patchTrustedProperty(proto)
         * Stealth-shadows 'isTrusted' to return true globally.
         */
        const patchTrustedProperty = (proto) => {
            try {
                if (!proto) return;
                const desc = Object.getOwnPropertyDescriptor(proto, 'isTrusted');
                Object.defineProperty(proto, 'isTrusted', {
                    get: nativeify(function () { return true; }, 'get isTrusted'),
                    configurable: true,
                    enumerable: true
                });
                if (mask) mask(proto, 'isTrusted', desc);
            } catch (e) { }
        };

        patchTrustedProperty(Event.prototype);
        patchTrustedProperty(MouseEvent.prototype);
        if (typeof KeyboardEvent !== 'undefined') patchTrustedProperty(KeyboardEvent.prototype);
        if (typeof PointerEvent !== 'undefined') patchTrustedProperty(PointerEvent.prototype);
        if (typeof TouchEvent !== 'undefined') patchTrustedProperty(TouchEvent.prototype);

        /**
         * startInlineHooking()
         * Handles 'on***' property assignments and inline attributes.
         */
        function startInlineHooking() {
            const wrapInline = (target) => {
                try {
                    if (!target || !target.onmousemove || hookedTargets.has(target.onmousemove)) return;
                    const orig = target.onmousemove;
                    if (typeof orig !== 'function') return;

                    const wrapped = nativeify(function (ev) {
                        const proxy = new Proxy(ev, {
                            get(t, p) { return (p === 'isTrusted') ? true : (typeof t[p] === 'function' ? t[p].bind(t) : t[p]); }
                        });
                        return orig.call(this, proxy);
                    }, 'onmousemove');
                    hookedTargets.add(wrapped);
                    target.onmousemove = wrapped;
                } catch (_) { }
            };

            const scan = () => {
                try {
                    wrapInline(window);
                    wrapInline(document);
                    const all = document.getElementsByTagName('*');
                    for (let i = 0; i < all.length; i++) wrapInline(all[i]);
                } catch (_) { }
            };

            try {
                const mo = new MutationObserver((mutations) => {
                    for (const m of mutations) {
                        if (m.addedNodes) m.addedNodes.forEach(n => {
                            if (n.nodeType === 1) {
                                wrapInline(n);
                                if (n.getElementsByTagName) {
                                    const sub = n.getElementsByTagName('*');
                                    for (let i = 0; i < sub.length; i++) wrapInline(sub[i]);
                                }
                            }
                        });
                        if (m.type === 'attributes' && m.attributeName?.toLowerCase() === 'onmousemove') {
                            wrapInline(m.target);
                        }
                    }
                });
                mo.observe(document.documentElement || document, { childList: true, subtree: true, attributes: true });
            } catch (_) { }

            let count = 0;
            const timer = setInterval(() => {
                scan();
                if (++count > 150) clearInterval(timer);
            }, 200);
            scan();
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', startInlineHooking, { once: true });
        } else {
            startInlineHooking();
        }
    })();
    // ─── System Hooks (WebSocket / Networking) ──────────────────────────────────
    defineHidden(window, '__loader_sessions', []);
    window.activeMovementLock = null;
    window.activeNormalLock = null;

    // A line never breaks by itself. Optional (OFF by default): release a normal line after the real mouse travelled far.
    let _nmLastMx = null, _nmLastMy = null, _nmTravel = 0;
    window.addEventListener('mousemove', nativeify((e) => {
        try {
            if (!e.isTrusted) return;
            const x = e.clientX, y = e.clientY;
            const d = (_nmLastMx === null) ? 0 : Math.hypot(x - _nmLastMx, y - _nmLastMy);
            _nmLastMx = x; _nmLastMy = y;
            if (!NMCFG.breakOnMove || !(window.activeMovementLock || window.activeNormalLock)) { _nmTravel = 0; return; }
            _nmTravel += d;
            if (_nmTravel >= NMCFG.breakPx) { _nmTravel = 0; nmReleaseLine(); }
        } catch (_) { }
    }, 'unlockOnMove'), { passive: true });

    const wsCallbacks = [];
    const wsSendCallbacks = [];

    defineHidden(window, '__loader_on_ws', (cb) => {
        wsCallbacks.push(cb);
        // Also notify about already captured sessions
        window.__loader_sessions.forEach(s => { try { cb(s); } catch (e) { } });
    });

    defineHidden(window, '__loader_on_ws_send', (cb) => {
        wsSendCallbacks.push(cb);
    });

    function log(...args) { }

    function isIgnored(url) {
        try {
            url = String(url || '');
            if (/socket\.io/i.test(url)) return true;
            if (/[?&]EIO=\d/.test(url)) return true;
            if (url.includes("127.0.0.1")) return true;
            if (/[?&]transport=(polling|websocket)/i.test(url)) return true;
        } catch (_) { }
        return false;
    }

    function captureWS(ws) {
        ws.addEventListener('open', () => {
            if (!isIgnored(ws.url)) {
                log('Session captured:', ws.url.split('?')[0]);
                window.__loader_sessions.push(ws);
                wsCallbacks.forEach(cb => { try { cb(ws); } catch (e) { } });
            }
        }, { once: true });
    }

    function WrapWS(NativeWS) {
        if (!NativeWS || hookedTargets.has(NativeWS)) return NativeWS;
        hookedTargets.add(NativeWS);

        const descWS = Object.getOwnPropertyDescriptor(window, 'WebSocket');

        function ProxyWS(u, p) {
            try {
                if (window.__loader_ws_urls) window.__loader_ws_urls.push(String(u || ''));
                const ws = p ? new NativeWS(u, p) : new NativeWS(u);
                document.cachedWS = ws;

                const origSend = ws.send;
                ws._clRawSend = origSend.bind(ws); // raw send for corner lock bypass
                ws.send = nativeify(function (data) {
                    try {
                        // 1) Corner Lock Absolute Override (highest priority)
                        // NOTE: _clBypass must NOT skip this filter. It only tells the DOM
                        // mouse-event blocker to let our own cosmetic synthetic events through
                        // to the canvas. If a packet send is also let through unfiltered here,
                        // any handler reacting to that synthetic event (the page's own native
                        // "send a move packet on mousemove" logic) can fire a packet built from
                        // the event's clientX/clientY - which is a viewport-clamped cosmetic
                        // value, not the real locked coordinate - and that packet would escape
                        // untouched. Always apply the opcode-16 drop-while-active rule below,
                        // bypass or not; forceSend() sends its own correct packet separately via
                        // the raw, unwrapped send, so it never needs to pass through here at all.
                        if (window.clActive && Object.values(window.clActive).some(Boolean)) {
                            let opcode = -1;
                            let buffer = (data instanceof ArrayBuffer) ? data : (data.buffer || data);
                            if (buffer && buffer.byteLength >= 1) {
                                opcode = new Uint8Array(buffer, data.byteOffset || 0, 1)[0];
                            }
                            if (opcode === 16) {
                                try { if (window.__nmPhys) window.__nmPhys.notePacket(data); } catch (_) { }
                                if (window._clAllowNext) {
                                    window._clAllowNext = false;
                                    return origSend.call(this, data);
                                }
                                window.__nmStat.drop++; return; // SILENTLY DROP
                            }
                        }

                        // 2) Normal/Movement Locks
                        nmApplyLockToPacket(data);
                    } catch (_) { }

                    let blocked = false;
                    for (const cb of wsSendCallbacks) {
                        try {
                            if (cb(ws, data) === false) blocked = true;
                        } catch (_) { }
                    }
                    if (blocked) return;

                    return origSend.call(this, data);
                }, 'send');

                captureWS(ws);
                return ws;
            } catch (e) {
                return new NativeWS(u, p);
            }
        }
        ProxyWS.prototype = NativeWS.prototype;
        Object.setPrototypeOf(ProxyWS, NativeWS);

        // Explicitly mirror WebSocket constants (they are often non-enumerable)
        const constants = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
        constants.forEach(c => {
            try {
                Object.defineProperty(ProxyWS, c, { value: NativeWS[c], enumerable: true, configurable: true });
            } catch (_) { }
        });

        if (window.__mask) window.__mask(window, 'WebSocket', descWS);
        return nativeify(ProxyWS, 'WebSocket');
    }

    let targetWin = null;
    function HookWindow(win) {
        try {
            if (!win || !win.WebSocket || hookedTargets.has(win.WebSocket)) return;
            win.WebSocket = WrapWS(win.WebSocket);
            targetWin = win;
        } catch (e) { }
    }

    function HookElement(node) {
        try {
            if (!node || hookedTargets.has(node)) return;
            hookedTargets.add(node);
            const hook = (orig) => {
                const fn = function (child) {
                    const r = orig.apply(this, arguments);
                    try { if (child && child.tagName === 'IFRAME') HookWindow(child.contentWindow); } catch (_) { }
                    return r;
                };
                return nativeify(fn, orig.name);
            };
            node.appendChild = hook(node.appendChild);
            node.insertBefore = hook(node.insertBefore);
        } catch (_) { }
    }

    (function hookShadowDom() {
        try {
            const rawGOPD = Object.getOwnPropertyDescriptor;
            if (!rawGOPD || hookedTargets.has(rawGOPD)) return;
            function HookedGOPD(o, p) {
                const desc = rawGOPD.call(Object, o, p);
                try {
                    if (p === 'attachShadow' && desc && typeof desc.value === 'function' && !hookedTargets.has(desc.value)) {
                        const raw = desc.value;
                        const W = function () {
                            const r = raw.apply(this, arguments);
                            try { HookElement(r); } catch (_) { }
                            return r;
                        };
                        hookedTargets.add(W);
                        desc.value = nativeify(W, raw.name);
                        return desc;
                    }
                } catch (_) { }
                return desc;
            }
            Object.getOwnPropertyDescriptor = nativeify(HookedGOPD, rawGOPD.name || 'getOwnPropertyDescriptor');
            hookedTargets.add(Object.getOwnPropertyDescriptor);
        } catch (_) { }
    })();

    // Hook top window
    HookWindow(window);

})();


(function () {
    "use strict";
    try {
        const blockRightClick = nativeify(function (e) {
            try {
                if (e.button === 2) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                }
            } catch (_) { }
        }, 'blockRightClick');

        const blockRightMove = nativeify(function (e) {
            try {
                if (e.buttons & 2) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                }
            } catch (_) { }
        }, 'blockRightMove');

        ["mousedown", "mouseup", "pointerdown", "pointerup", "auxclick", "contextmenu"].forEach(t => {
            try { document.addEventListener(t, blockRightClick, true); } catch (_) { }
        });
        try { document.addEventListener("mousemove", blockRightMove, true); } catch (_) { }
        try { document.addEventListener("pointermove", blockRightMove, true); } catch (_) { }
    } catch (_) { }
    (function initEventHooks() {
        const _wrapMap = new WeakMap();
        const mask = window.__mask;

        /**
         * getTrustWrapper(target, original)
         * Wraps an event listener to deliver a "Trusted" Proxy of the event.
         * Uses Proxy to maintain 'instanceof' and native behavior.
         */
        function getTrustWrapper(target, original) {
            if (!target || (typeof target !== 'object' && typeof target !== 'function')) return original;
            let m = _wrapMap.get(target);
            if (!m) { m = new Map(); _wrapMap.set(target, m); }
            if (m.has(original)) return m.get(original);

            const wrapper = nativeify(function (ev) {
                if (!ev) return original.call(this, ev);
                const proxy = new Proxy(ev, {
                    get(t, prop) {
                        if (prop === 'isTrusted') return true;
                        const val = t[prop];
                        if (typeof val === 'function') {
                            try {
                                return (typeof val.bind === 'function') ? val.bind(t) : val;
                            } catch (_) { return val; }
                        }
                        return val;
                    }
                });
                try { return original.call(this, proxy); } catch (e) { throw e; }
            }, original.name || 'wrapper');

            m.set(original, wrapper);
            return wrapper;
        }

        /**
         * patchProto(proto, name)
         * Stealth-hooks addEventListener/removeEventListener.
         */
        const patchProto = (proto, name) => {
            try {
                if (!proto || !proto.addEventListener || hookedTargets.has(proto)) return;
                hookedTargets.add(proto);

                const _origAEL = proto.addEventListener;
                const _origRAEL = proto.removeEventListener;
                const descAEL = Object.getOwnPropertyDescriptor(proto, 'addEventListener');
                const descRAEL = Object.getOwnPropertyDescriptor(proto, 'removeEventListener');

                proto.addEventListener = nativeify(function (type, listener, options) {
                    try {
                        if (typeof listener === 'function') {
                            return _origAEL.call(this, type, getTrustWrapper(this, listener), options);
                        }
                    } catch (_) { }
                    return _origAEL.call(this, type, listener, options);
                }, 'addEventListener');

                proto.removeEventListener = nativeify(function (type, listener, options) {
                    try {
                        if (typeof listener === 'function') {
                            const m = _wrapMap.get(this);
                            if (m && m.has(listener)) {
                                const w = m.get(listener); m.delete(listener);
                                return _origRAEL.call(this, type, w, options);
                            }
                        }
                    } catch (_) { }
                    return _origRAEL.call(this, type, listener, options);
                }, 'removeEventListener');

                if (mask) {
                    mask(proto, 'addEventListener', descAEL);
                    mask(proto, 'removeEventListener', descRAEL);
                }
            } catch (e) { }
        };

        patchProto(EventTarget.prototype, 'EventTarget');
        patchProto(HTMLElement.prototype, 'HTMLElement');
        if (typeof Element !== 'undefined') patchProto(Element.prototype, 'Element');
        if (typeof Node !== 'undefined') patchProto(Node.prototype, 'Node');

        /**
         * patchTrustedProperty(proto)
         * Stealth-shadows 'isTrusted' to return true globally.
         */
        const patchTrustedProperty = (proto) => {
            try {
                if (!proto) return;
                const desc = Object.getOwnPropertyDescriptor(proto, 'isTrusted');
                Object.defineProperty(proto, 'isTrusted', {
                    get: nativeify(function () { return true; }, 'get isTrusted'),
                    configurable: true,
                    enumerable: true
                });
                if (mask) mask(proto, 'isTrusted', desc);
            } catch (e) { }
        };

        patchTrustedProperty(Event.prototype);
        patchTrustedProperty(MouseEvent.prototype);
        if (typeof KeyboardEvent !== 'undefined') patchTrustedProperty(KeyboardEvent.prototype);
        if (typeof PointerEvent !== 'undefined') patchTrustedProperty(PointerEvent.prototype);
        if (typeof TouchEvent !== 'undefined') patchTrustedProperty(TouchEvent.prototype);

        /**
         * startInlineHooking()
         * Handles 'on***' property assignments and inline attributes.
         */
        function startInlineHooking() {
            const wrapInline = (target) => {
                try {
                    if (!target || !target.onmousemove || hookedTargets.has(target.onmousemove)) return;
                    const orig = target.onmousemove;
                    if (typeof orig !== 'function') return;

                    const wrapped = nativeify(function (ev) {
                        const proxy = new Proxy(ev, {
                            get(t, p) { return (p === 'isTrusted') ? true : (typeof t[p] === 'function' ? t[p].bind(t) : t[p]); }
                        });
                        return orig.call(this, proxy);
                    }, 'onmousemove');
                    hookedTargets.add(wrapped);
                    target.onmousemove = wrapped;
                } catch (_) { }
            };

            const scan = () => {
                try {
                    wrapInline(window);
                    wrapInline(document);
                    const all = document.getElementsByTagName('*');
                    for (let i = 0; i < all.length; i++) wrapInline(all[i]);
                } catch (_) { }
            };

            try {
                const mo = new MutationObserver((mutations) => {
                    for (const m of mutations) {
                        if (m.addedNodes) m.addedNodes.forEach(n => {
                            if (n.nodeType === 1) {
                                wrapInline(n);
                                if (n.getElementsByTagName) {
                                    const sub = n.getElementsByTagName('*');
                                    for (let i = 0; i < sub.length; i++) wrapInline(sub[i]);
                                }
                            }
                        });
                        if (m.type === 'attributes' && m.attributeName?.toLowerCase() === 'onmousemove') {
                            wrapInline(m.target);
                        }
                    }
                });
                mo.observe(document.documentElement || document, { childList: true, subtree: true, attributes: true });
            } catch (_) { }

            let count = 0;
            const timer = setInterval(() => {
                scan();
                if (++count > 150) clearInterval(timer);
            }, 200);
            scan();
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', startInlineHooking, { once: true });
        } else {
            startInlineHooking();
        }
    })();
    defineHidden(window, '__loader_sessions', []);
    const wsCallbacks = [];
    const wsSendCallbacks = [];

    defineHidden(window, '__loader_on_ws', (cb) => {
        wsCallbacks.push(cb);
        // Also notify about already captured sessions
        window.__loader_sessions.forEach(s => { try { cb(s); } catch (e) { } });
    });

    defineHidden(window, '__loader_on_ws_send', (cb) => {
        wsSendCallbacks.push(cb);
    });

    function log(...args) { }

    function isIgnored(url) {
        try {
            url = String(url || '');
            if (/socket\.io/i.test(url)) return true;
            if (/[?&]EIO=\d/.test(url)) return true;
            if (url.includes("127.0.0.1")) return true;
            if (/[?&]transport=(polling|websocket)/i.test(url)) return true;
        } catch (_) { }
        return false;
    }

    function captureWS(ws) {
        ws.addEventListener('open', () => {
            if (!isIgnored(ws.url)) {
                log('Session captured:', ws.url.split('?')[0]);
                window.__loader_sessions.push(ws);
                wsCallbacks.forEach(cb => { try { cb(ws); } catch (e) { } });
            }
        }, { once: true });
    }

    function WrapWS(NativeWS) {
        if (!NativeWS || hookedTargets.has(NativeWS)) return NativeWS;
        hookedTargets.add(NativeWS);

        const descWS = Object.getOwnPropertyDescriptor(window, 'WebSocket');

        function ProxyWS(u, p) {
            try {
                if (window.__loader_ws_urls) window.__loader_ws_urls.push(String(u || ''));
                const ws = p ? new NativeWS(u, p) : new NativeWS(u);
                document.cachedWS = ws;

                const origSend = ws.send;
                ws.send = nativeify(function (data) {
                    try {
                        nmApplyLockToPacket(data);
                    } catch (_) { }
                    wsSendCallbacks.forEach(cb => { try { cb(ws, data); } catch (_) { } });
                    return origSend.call(this, data);
                }, 'send');

                captureWS(ws);
                return ws;
            } catch (e) {
                return new NativeWS(u, p);
            }
        }
        ProxyWS.prototype = NativeWS.prototype;
        Object.setPrototypeOf(ProxyWS, NativeWS);

        // Explicitly mirror WebSocket constants (they are often non-enumerable)
        const constants = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
        constants.forEach(c => {
            try {
                Object.defineProperty(ProxyWS, c, { value: NativeWS[c], enumerable: true, configurable: true });
            } catch (_) { }
        });

        if (window.__mask) window.__mask(window, 'WebSocket', descWS);
        return nativeify(ProxyWS, 'WebSocket');
    }

    let targetWin = null;
    function HookWindow(win) {
        try {
            if (!win || !win.WebSocket || hookedTargets.has(win.WebSocket)) return;
            win.WebSocket = WrapWS(win.WebSocket);
            targetWin = win;
        } catch (e) { }
    }

    function HookElement(node) {
        try {
            if (!node || hookedTargets.has(node)) return;
            hookedTargets.add(node);
            const hook = (orig) => {
                const fn = function (child) {
                    const r = orig.apply(this, arguments);
                    try { if (child && child.tagName === 'IFRAME') HookWindow(child.contentWindow); } catch (_) { }
                    return r;
                };
                return nativeify(fn, orig.name);
            };
            node.appendChild = hook(node.appendChild);
            node.insertBefore = hook(node.insertBefore);
        } catch (_) { }
    }

    (function hookShadowDom() {
        try {
            const rawGOPD = Object.getOwnPropertyDescriptor;
            if (!rawGOPD || hookedTargets.has(rawGOPD)) return;
            function HookedGOPD(o, p) {
                const desc = rawGOPD.call(Object, o, p);
                try {
                    if (p === 'attachShadow' && desc && typeof desc.value === 'function' && !hookedTargets.has(desc.value)) {
                        const raw = desc.value;
                        const W = function () {
                            const r = raw.apply(this, arguments);
                            try { HookElement(r); } catch (_) { }
                            return r;
                        };
                        hookedTargets.add(W);
                        desc.value = nativeify(W, raw.name);
                        return desc;
                    }
                } catch (_) { }
                return desc;
            }
            Object.getOwnPropertyDescriptor = nativeify(HookedGOPD, rawGOPD.name || 'getOwnPropertyDescriptor');
            hookedTargets.add(Object.getOwnPropertyDescriptor);
        } catch (_) { }
    })();

    // Hook top window
    HookWindow(window);
})();
const PAIR_KEY = "___paired_tabs___";
const SIGNAL_KEY = "___focus_bus___";
const SEQ_KEY = "___focus_seq_counter___";
let myId = null;
let openedTabHandle = null;
// ── Storage: localStorage only (no GM functions) ──────────────────────────
// Line settings live under a NEW namespace (nm3_), so every old key definition is ignored.
const _NM_LINE_KEY_RE = /^(movement|normal)[A-Za-z]+(Enabled|Key|Page)$/;
const S = {
    _k(key) { return _NM_LINE_KEY_RE.test(key) ? "nm3_" + key : key; },
    get(key, def = null) {
        try {
            const v = localStorage.getItem(S._k(key));
            return v !== null ? v : def;
        } catch (_) { return def; }
    },
    set(key, val) {
        try { localStorage.setItem(S._k(key), val); } catch (_) { }
    }
};

// ── IndexedDB image store (no size limit, unlike localStorage) ────────────
const ImageStore = (() => {
    const DB_NAME = 'nm_script_images';
    const DB_VER = 1;
    const STORE = 'images';
    let _db = null;

    function _open() {
        if (_db) return Promise.resolve(_db);
        return new Promise((res, rej) => {
            const req = indexedDB.open(DB_NAME, DB_VER);
            req.onupgradeneeded = e => e.target.result.createObjectStore(STORE);
            req.onsuccess = e => { _db = e.target.result; res(_db); };
            req.onerror = e => rej(e.target.error);
        });
    }
    return {
        set(key, dataUrl) {
            return _open().then(db => new Promise((res, rej) => {
                const tx = db.transaction(STORE, 'readwrite');
                const req = tx.objectStore(STORE).put(dataUrl, key);
                req.onsuccess = () => res();
                req.onerror = e => rej(e.target.error);
            })).catch(() => {
                // Fallback to localStorage for small images
                try { localStorage.setItem('img_' + key, dataUrl); } catch (_) { }
            });
        },
        get(key) {
            return _open().then(db => new Promise((res, rej) => {
                const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
                req.onsuccess = e => res(e.target.result || null);
                req.onerror = e => rej(e.target.error);
            })).catch(() => {
                // Fallback to localStorage
                try { return Promise.resolve(localStorage.getItem('img_' + key)); } catch (_) { }
                return Promise.resolve(null);
            });
        },
        del(key) {
            return _open().then(db => new Promise((res) => {
                db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key);
                res();
            })).catch(() => {
                try { localStorage.removeItem('img_' + key); } catch (_) { }
            });
        }
    };
})();
const boolFrom = e => e === true || e === "true" || e === 1 || e === "1";
// ══════════════════════════════════════════════════════════════════════════════
// v3.2 modules that must exist BEFORE the game starts:  FPS unlocker + colors
// ══════════════════════════════════════════════════════════════════════════════

// run `fn` as soon as <html> exists (a userscript starts before the page is built)
function nmOnDocReady(fn) {
    if (document.documentElement) { try { fn(); } catch (_) { } return; }
    let n = 0;
    const iv = setInterval(() => {
        if (document.documentElement || ++n > 1000) { clearInterval(iv); if (document.documentElement) { try { fn(); } catch (_) { } } }
    }, 5);
}

// ── FPS unlocker ────────────────────────────────────────────────────────────
// Replaces requestAnimationFrame with a loop that is not tied to the monitor refresh,
// and keeps the game running at full speed even in a background tab.
const NMFPS = (function () {
    try {
        const w = window;
        if (!w.requestAnimationFrame) return null;
        const nativeRAF = w.requestAnimationFrame.bind(w);
        const nativeCAF = w.cancelAnimationFrame.bind(w);
        const cfg = {
            mode: S.get("fpsMode", "unlimited"),                  // off | unlimited | custom
            cap: parseInt(S.get("fpsCap", "240"), 10) || 240,
            bgOn: S.get("fpsBgOn", "true") !== "false",
            bg: parseInt(S.get("fpsBg", "60"), 10) || 60,
            show: S.get("fpsShow", "false") === "true"
        };
        let nextId = 1, queue = new Map(), current = null;
        let gen = 0, armed = false, nativeHandle = 0;
        let lastRun = 0, frames = 0, fpsNow = 0, lastFrames = 0, lastT = performance.now();
        let bgWorker = null, bgTimer = 0;
        const mc = new MessageChannel();

        function runFrame() {
            const now = performance.now();
            lastRun = now;
            frames++;
            const list = queue; queue = new Map(); current = list;
            list.forEach((cb) => { try { cb(now); } catch (err) { setTimeout(() => { throw err; }); } });
            current = null;
            if (queue.size) arm();
        }
        function onNative() { nativeHandle = 0; armed = false; runFrame(); }
        function startBg() {
            if (bgWorker || bgTimer) return;
            const ms = Math.max(2, Math.round(1000 / Math.max(1, cfg.bg)));
            const tick = () => { if (!document.hidden) return; if (!queue.size) return; armed = false; runFrame(); };
            try {
                const url = URL.createObjectURL(new Blob(["setInterval(function(){postMessage(0)}," + ms + ")"], { type: "text/javascript" }));
                bgWorker = new Worker(url);
                bgWorker.onmessage = tick;
                bgWorker.onerror = () => { try { bgWorker.terminate(); } catch (_) { } bgWorker = null; bgTimer = setInterval(tick, ms); };
            } catch (_) { bgTimer = setInterval(tick, ms); }
        }
        function stopBg() {
            try { if (bgWorker) bgWorker.terminate(); } catch (_) { }
            bgWorker = null;
            if (bgTimer) { clearInterval(bgTimer); bgTimer = 0; }
        }
        function arm() {
            if (armed) return;
            armed = true;
            if (document.hidden) {
                if (cfg.bgOn) { startBg(); return; }
                nativeHandle = nativeRAF(onNative); return;
            }
            if (cfg.mode === "off") { nativeHandle = nativeRAF(onNative); return; }
            mc.port2.postMessage(gen);
        }
        mc.port1.onmessage = (e) => {
            if (e.data !== gen) return;                               // stale driver
            if (cfg.mode === "custom") {
                const minDt = 1000 / Math.max(1, cfg.cap);
                const wait = minDt - (performance.now() - lastRun);
                if (wait > 0.25) {
                    if (wait > 2.5) { const g = gen; setTimeout(() => { if (g === gen) mc.port2.postMessage(gen); }, wait - 1.5); }
                    else mc.port2.postMessage(gen);
                    return;
                }
            }
            armed = false;
            runFrame();
        };
        function reset() {                                             // mode / visibility changed: re-create the driver
            gen++; armed = false;
            if (nativeHandle) { try { nativeCAF(nativeHandle); } catch (_) { } nativeHandle = 0; }
            if (!document.hidden) stopBg(); else if (cfg.bgOn) { stopBg(); }
            if (queue.size) arm();
        }
        const rafFn = nativeify(function requestAnimationFrame(cb) {
            if (typeof cb !== "function") throw new TypeError("Failed to execute 'requestAnimationFrame' on 'Window': The callback provided as parameter 1 is not a function.");
            const id = nextId++;
            queue.set(id, cb);
            arm();
            return id;
        }, "requestAnimationFrame");
        const cafFn = nativeify(function cancelAnimationFrame(id) {
            queue.delete(id);
            if (current) current.delete(id);
        }, "cancelAnimationFrame");
        // keep the native cancel for ids we never issued
        w.requestAnimationFrame = rafFn;
        w.cancelAnimationFrame = cafFn;

        document.addEventListener("visibilitychange", () => { try { reset(); } catch (_) { } });

        // live FPS counter
        let fpsEl = null;
        setInterval(() => {
            const t = performance.now();
            fpsNow = Math.round((frames - lastFrames) * 1000 / Math.max(1, t - lastT));
            lastFrames = frames; lastT = t;
            if (!cfg.show) { if (fpsEl) fpsEl.style.display = "none"; return; }
            if (!document.body) return;
            if (!fpsEl || !fpsEl.isConnected) { fpsEl = document.createElement("div"); fpsEl.id = "nm-fps"; document.body.appendChild(fpsEl); }
            fpsEl.style.display = "block";
            fpsEl.textContent = fpsNow + " FPS";
        }, 500);

        function set(k, v) {
            if (k === "cap") { cfg.cap = Math.max(10, parseInt(v, 10) || 240); S.set("fpsCap", String(cfg.cap)); }
            else if (k === "bg") { cfg.bg = Math.max(5, parseInt(v, 10) || 60); S.set("fpsBg", String(cfg.bg)); stopBg(); }
            else if (k === "bgOn") { cfg.bgOn = !!v; S.set("fpsBgOn", String(!!v)); stopBg(); }
            else if (k === "show") { cfg.show = !!v; S.set("fpsShow", String(!!v)); }
            else if (k === "mode") { cfg.mode = (v === "off" || v === "custom") ? v : "unlimited"; S.set("fpsMode", cfg.mode); }
            reset();
        }
        function reload() {
            cfg.mode = S.get("fpsMode", "unlimited"); cfg.cap = parseInt(S.get("fpsCap", "240"), 10) || 240;
            cfg.bgOn = S.get("fpsBgOn", "true") !== "false"; cfg.bg = parseInt(S.get("fpsBg", "60"), 10) || 60;
            cfg.show = S.get("fpsShow", "false") === "true";
            stopBg(); reset();
        }
        window.addEventListener("storage", (ev) => { if (ev.key && ev.key.indexOf("fps") === 0) { try { reload(); } catch (_) { } } });
        return { cfg: cfg, set: set, fps: () => fpsNow };
    } catch (_) { return null; }
})();

// ── Colors: my ball / my name / my text (Canvas 2D hooks) ───────────────────
const NMCOL = (function () {
    try {
        if (typeof CanvasRenderingContext2D === "undefined") return null;
        const P = CanvasRenderingContext2D.prototype;
        const cfg = {
            ballOn: S.get("colBallOn", "false") === "true", ball: S.get("colBall", "#00e5ff"),
            nameOn: S.get("colNameOn", "false") === "true", name: S.get("colName", "#ffe600"),
            textOn: S.get("colTextOn", "false") === "true", text: S.get("colText", "#ffffff"),
            allNames: S.get("colAllNames", "false") === "true", myName: S.get("colMyName", "")
        };
        const st = { arcs: 0, texts: 0, found: false, foundAt: 0, myFill: null, kinds: {} };
        const mine = [];                                          // my circles seen in the last ~250ms
        const path = new WeakMap();                               // ctx -> {arc, mine}
        const mainCache = new WeakMap();                          // ctx -> {t, v}
        const raw = { arc: P.arc, fill: P.fill, stroke: P.stroke, fillText: P.fillText, beginPath: P.beginPath };
        const track = () => cfg.ballOn || cfg.nameOn || cfg.textOn;

        function isMain(ctx) {
            const now = performance.now();
            let c = mainCache.get(ctx);
            if (!c || now - c.t > 1000) {
                const cv = ctx.canvas;
                c = { t: now, v: !!(cv && cv.isConnected && cv.width >= 200 && cv.height >= 200) };
                mainCache.set(ctx, c);
            }
            return c.v;
        }
        let lastR = 0;
        function pushMine(a) {
            const now = performance.now();
            while (mine.length && now - mine[0].t > 250) mine.shift();
            mine.push({ x: a.x, y: a.y, r: a.r, t: now });
            if (mine.length > 24) mine.shift();
            lastR = a.r;
        }
        function nearMine(x, y, f) {
            const now = performance.now();
            for (let i = mine.length - 1; i >= 0; i--) {
                const m = mine[i];
                if (now - m.t > 250) break;
                if (Math.hypot(x - m.x, y - m.y) <= m.r * f) return true;
            }
            return false;
        }
        function sameAsMine(a) {
            const now = performance.now();
            for (let i = mine.length - 1; i >= 0; i--) {
                const m = mine[i];
                if (now - m.t > 250) break;
                if (Math.abs(a.x - m.x) < 3 && Math.abs(a.y - m.y) < 3 && Math.abs(a.r - m.r) < Math.max(4, m.r * 0.35)) return true;
            }
            return false;
        }
        function darker(hex) {
            const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
            if (!m) return hex;
            const n = parseInt(m[1], 16);
            const r = Math.round(((n >> 16) & 255) * 0.72), g = Math.round(((n >> 8) & 255) * 0.72), b = Math.round((n & 255) * 0.72);
            return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
        }

        P.beginPath = nativeify(function beginPath() {
            const s = path.get(this);
            if (s) { s.arc = null; s.mine = false; }
            return raw.beginPath.apply(this, arguments);
        }, "beginPath");

        P.arc = nativeify(function arc(x, y, r, a0, a1) {
            try {
                if (track() && r > 0 && (a1 - a0) >= 6.2) {
                    const m = this.getTransform();
                    const sr = r * Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
                    if (sr >= 5) {
                        let s = path.get(this);
                        if (!s) { s = { arc: null, mine: false }; path.set(this, s); }
                        s.arc = { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f, r: sr };
                        s.mine = false;
                    }
                }
            } catch (_) { }
            return raw.arc.apply(this, arguments);
        }, "arc");

        P.fill = nativeify(function fill() {
            try {
                const s = path.get(this);
                if (s && s.arc && track() && isMain(this)) {
                    const a = s.arc, c = this.canvas, fs = this.fillStyle, now = performance.now();
                    let isMine = false;
                    if (typeof fs === "string") {
                        if (Math.hypot(a.x - c.width / 2, a.y - c.height / 2) <= a.r + 6) { isMine = true; st.myFill = fs; st.foundAt = now; }
                        else if (st.myFill && fs === st.myFill && now - st.foundAt < 4000) isMine = true;
                    }
                    st.arcs++;
                    if (isMine) {
                        st.found = true; pushMine(a); s.mine = true;
                        if (cfg.ballOn) {
                            const prev = this.fillStyle;
                            this.fillStyle = cfg.ball;
                            try { return raw.fill.apply(this, arguments); } finally { this.fillStyle = prev; }
                        }
                    }
                }
            } catch (_) { }
            return raw.fill.apply(this, arguments);
        }, "fill");

        P.stroke = nativeify(function stroke() {
            try {
                const s = path.get(this);
                if (cfg.ballOn && s && s.arc && isMain(this) && (s.mine || sameAsMine(s.arc))) {
                    const prev = this.strokeStyle;
                    this.strokeStyle = darker(cfg.ball);
                    try { return raw.stroke.apply(this, arguments); } finally { this.strokeStyle = prev; }
                }
            } catch (_) { }
            return raw.stroke.apply(this, arguments);
        }, "stroke");

        function textColorFor(ctx, text, x, y) {
            if (!(cfg.nameOn || cfg.textOn)) return null;
            const s = String(text).trim();
            if (!s) return null;
            st.texts++;
            const numeric = /^[0-9][0-9.,]*[kKmM]?$/.test(s);
            let onMine = false;
            if (isMain(ctx)) {
                const m = ctx.getTransform();
                onMine = nearMine(m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f, 1.15);
            }
            if (numeric) return (cfg.textOn && onMine) ? cfg.text : null;
            const isMy = !!cfg.myName && s.toLowerCase() === cfg.myName.trim().toLowerCase();
            if (cfg.nameOn && (isMy || onMine || cfg.allNames)) return cfg.name;
            return null;
        }
        P.fillText = nativeify(function fillText(text, x, y) {
            let col = null;
            try { col = textColorFor(this, text, x, y); } catch (_) { }
            if (col) {
                const prev = this.fillStyle;
                this.fillStyle = col;
                try { return raw.fillText.apply(this, arguments); } finally { this.fillStyle = prev; }
            }
            return raw.fillText.apply(this, arguments);
        }, "fillText");

        try {
            const rawGC = HTMLCanvasElement.prototype.getContext;
            HTMLCanvasElement.prototype.getContext = nativeify(function getContext(type) {
                try { st.kinds[type] = (st.kinds[type] || 0) + 1; } catch (_) { }
                return rawGC.apply(this, arguments);
            }, "getContext");
        } catch (_) { }

        const KEYS = { ballOn: "colBallOn", ball: "colBall", nameOn: "colNameOn", name: "colName", textOn: "colTextOn", text: "colText", allNames: "colAllNames", myName: "colMyName" };
        function set(k, v) {
            if (!(k in KEYS)) return;
            cfg[k] = v;
            S.set(KEYS[k], typeof v === "boolean" ? String(v) : v);
        }
        window.addEventListener("storage", (ev) => {
            try {
                Object.keys(KEYS).forEach(k => {
                    if (ev.key === KEYS[k]) {
                        if (typeof cfg[k] === "boolean") cfg[k] = ev.newValue === "true"; else cfg[k] = ev.newValue || "";
                    }
                });
            } catch (_) { }
        });
        let pa = 0, pt = 0, pT = performance.now(), rateA = 0, rateT = 0;
        setInterval(() => {
            const t = performance.now(), dt = Math.max(0.2, (t - pT) / 1000);
            rateA = Math.round((st.arcs - pa) / dt); rateT = Math.round((st.texts - pt) / dt);
            pa = st.arcs; pt = st.texts; pT = t;
            if (performance.now() - st.foundAt > 2500) st.found = false;
        }, 500);
        return { cfg: cfg, set: set, radius: () => lastR, diag: () => ({ kinds: st.kinds, arcsPerSec: rateA, textsPerSec: rateT, found: st.found, myFill: st.myFill }) };
    } catch (_) { return null; }
})();

function ensureMyTabId() {
    return new Promise(resolve => {
        // Fresh id per page load. (sessionStorage is COPIED into tabs opened with window.open,
        // which used to hand both pages the very same id.)
        if (!myId) myId = Math.random().toString(36).slice(2) + Date.now().toString(36);
        resolve({ id: myId });
    });
}

// ══════════════════════════════════════════════════════════════════════════════
// v3.2 core: page numbering · line / pin engine · fresh key system · skip screen
// ══════════════════════════════════════════════════════════════════════════════
const NMCFG = {
    dblMs: parseInt(S.get("nmDblMs", "700"), 10) || 700,           // two presses inside this window = PIN
    breakOnMove: S.get("nmBreakOnMove", "false") === "true",       // OFF by default: a line never breaks by itself
    breakPx: parseInt(S.get("nmBreakPx", "300"), 10) || 300,
    diag: S.get("nmDiag", "false") === "true"
};
const NM_PAGE_STALE_MS = 20000;
const NM_ALL_DIRS = ["Right", "Left", "Up", "Down", "TopLeft", "TopRight", "BottomLeft", "BottomRight"];
window.__nmStat = { rew: 0, drop: 0, forced: 0, key: "", act: "", x: 0, y: 0 };

// ── Ticker that is NOT throttled when the tab is in the background ───────────
function nmTicker(fn, ms) {
    try {
        const url = URL.createObjectURL(new Blob(
            ["var t=setInterval(function(){postMessage(0)}," + ms + ");onmessage=function(e){if(e.data==='stop')clearInterval(t)};"],
            { type: "text/javascript" }));
        const w = new Worker(url);
        let fell = false;
        const fallback = () => { if (fell) return; fell = true; try { w.terminate(); } catch (_) { } setInterval(fn, ms); };
        w.onmessage = () => { try { fn(); } catch (_) { } };
        w.onerror = fallback;
        return w;
    } catch (_) { setInterval(fn, ms); return null; }
}

// ── Page numbering (1 / 2) ───────────────────────────────────────────────────
let myPage = 0;
const _pageChangeCbs = [];
function nmPageKey(n) { return "___nm_page_" + n + "___"; }
function nmReadPage(n) {
    try { const r = JSON.parse(localStorage.getItem(nmPageKey(n)) || "null"); return (r && typeof r === "object") ? r : null; } catch (_) { return null; }
}
function nmPageFree(n) {
    const r = nmReadPage(n);
    return !r || r.id === myId || (Date.now() - r.ts) > NM_PAGE_STALE_MS;
}
function nmWritePage(n) { try { localStorage.setItem(nmPageKey(n), JSON.stringify({ id: myId, ts: Date.now() })); } catch (_) { } }
function nmSetPage(n) {
    if (n === myPage) return;
    myPage = n;
    try { sessionStorage.setItem("__nm_page_num__", String(n)); } catch (_) { }
    _pageChangeCbs.forEach(cb => { try { cb(n); } catch (_) { } });
}
function nmClaimPage() {
    if (!myId) myId = Math.random().toString(36).slice(2) + Date.now().toString(36);
    let want = 0;
    const m = String(location.hash || "").match(/[#&?]nmpage=(\d+)/i);
    if (m) want = parseInt(m[1], 10) || 0;
    if (!want) { try { want = parseInt(sessionStorage.getItem("__nm_page_num__") || "0", 10) || 0; } catch (_) { } }
    let n = 0;
    if (want > 0 && want < 10 && nmPageFree(want)) n = want;
    else { for (let i = 1; i < 10; i++) { if (nmPageFree(i)) { n = i; break; } } }
    if (!n) n = 1;
    nmWritePage(n);
    nmSetPage(n);
    setTimeout(nmBeat, 250);
}
function nmBeat() {
    try {
        if (!myPage) return;
        const r = nmReadPage(myPage);
        if (r && r.id !== myId && (Date.now() - r.ts) < NM_PAGE_STALE_MS) {
            for (let i = 1; i < 10; i++) { if (nmPageFree(i)) { nmWritePage(i); nmSetPage(i); return; } }
            return;
        }
        nmWritePage(myPage);
    } catch (_) { }
}
function nmOtherPage() { return myPage === 1 ? 2 : 1; }
function nmOtherPageAlive() {
    const r = nmReadPage(nmOtherPage());
    return !!r && r.id !== myId && (Date.now() - r.ts) < NM_PAGE_STALE_MS;
}
// every cross-page message carries from/to so the two pages never act on each other's own commands
function nmPostToOther(payload) {
    try { actionChannel.postMessage(Object.assign({}, payload, { from: myPage, to: nmOtherPage() })); } catch (_) { }
}
function nmPageLabel(v) {
    if (v === "current") return "هذه الصفحة (" + (myPage || 1) + ")";
    if (v === "opposite") return "الصفحة " + nmOtherPage();
    if (v === "both") return "الصفحتين";
    return v;
}
function nmRefreshPageLabels() {
    try {
        document.querySelectorAll(".nm-mini-select[id$='PageSelect'], .nm-action-page").forEach(sel => {
            Array.from(sel.options).forEach(o => { o.textContent = nmPageLabel(o.value); });
        });
    } catch (_) { }
}
let _pageUIBound = false;
function nmBindPageUI() {
    const apply = () => {
        try {
            const b = document.getElementById("nm-page-badge"); if (b) b.textContent = String(myPage || 1);
            const c = document.getElementById("nm-page-chip-num"); if (c) c.textContent = String(myPage || 1);
            nmRefreshPageLabels();
        } catch (_) { }
    };
    if (!_pageUIBound) { _pageUIBound = true; _pageChangeCbs.push(apply); }
    apply();
}
function nmToast(msg) {
    try {
        let stack = document.getElementById("nm-toast-stack");
        if (!stack) {
            stack = document.createElement("div");
            stack.id = "nm-toast-stack";
            document.body.appendChild(stack);
        }
        const t = document.createElement("div");
        t.className = "nm-toast";
        t.innerHTML = '<span class="nm-toast-dot"></span><span class="nm-toast-msg"></span>';
        t.querySelector(".nm-toast-msg").textContent = msg;
        stack.appendChild(t);
        // keep the stack from growing forever if toasts fire faster than they expire
        while (stack.children.length > 4) stack.removeChild(stack.firstChild);
        setTimeout(() => { try { t.classList.add("out"); } catch (_) { } }, 2600);
        setTimeout(() => { try { t.remove(); } catch (_) { } }, 3100);
    } catch (_) { }
}
function nmOpenOtherPage() {
    try {
        if (openedTabHandle && !openedTabHandle.closed) {
            try { openedTabHandle.focus(); } catch (_) { }
            nmToast("الصفحة " + nmOtherPage() + " مفتوحة بالفعل");
            return;
        }
        if (nmOtherPageAlive()) { nmToast("الصفحة " + nmOtherPage() + " مفتوحة بالفعل"); return; }
        if (window.openPairedTab) gmOppositeTabHandle = window.openPairedTab(location.origin + "/");
    } catch (_) { }
}

// ══════════════════════════════════════════════════════════════════════════════
// NMPHYS — "game physics" aware aiming engine (v4).
//
// The old line/pin code sent one hard-coded coordinate pair per direction
// (x = ±9999999, y = innerHeight/2 …). That only *looks* right while the game
// server does not clamp the mouse position: the direction a cell actually
// travels is (mouseTarget - cellPosition), so a fixed far-away point only gives
// a clean 45° corner as long as nothing normalises or clamps that point. As soon
// as the server clamps the cursor to the map border (which is what makes corner
// lines curve into a wall-slide), the real angle drifts away from 45°.
//
// This module does what the game client itself does instead of guessing:
//
//   1. It listens to the real move packets the game sends (opcode 16) together
//      with the mouse position that produced them, and fits the exact affine
//      mapping   packetX = a * clientX + b   (same for Y).  That is the camera +
//      zoom + any viewport offset, measured — not assumed.
//   2. It aims at the screen point that is one visible radius away from the
//      player in the requested direction. That point is always inside the
//      viewport, so no client-side or server-side clamp can ever bend it, and
//      the resulting direction is exactly the angle asked for.
//   3. It keeps re-sending that aim every tick (the ticker already does 20 ms),
//      so as the cell (and therefore the camera) moves the aim point moves with
//      it and the angle never drifts.
//   4. It closes the loop: it tracks the player's own position in packet space
//      (= the mapping of the canvas centre) over time, measures the direction
//      the cell really moved in, and if it differs from the requested angle it
//      applies a small, capped per-direction correction. That covers server
//      quirks we cannot model (anisotropic speed, integer rounding, clamps).
//
// Everything is bounded: the fit is validated before use, corrections are
// capped at ±22°, and if anything looks off the caller falls back to the old
// coordinates, so this can never make a line worse than it was.
// ══════════════════════════════════════════════════════════════════════════════
const NMPHYS = (function () {
    'use strict';

    const K_ON = 'nm3_physOn', K_AUTO = 'nm3_physAuto', K_RANGE = 'nm3_physRange';
    const K_ANGLES = 'nm3_physAngles', K_CORR = 'nm3_physCorr';
    const DIRS = ['Up', 'TopRight', 'Right', 'BottomRight', 'Down', 'BottomLeft', 'Left', 'TopLeft'];
    const DEF_ANGLES = { Up: 0, TopRight: 45, Right: 90, BottomRight: 135, Down: 180, BottomLeft: 225, Left: 270, TopLeft: 315 };
    const RANGE_F = { near: 0.22, mid: 0.34, far: 0.45 };
    const MAX_CORR = 22;

    function readJSON(key, def) {
        try {
            const raw = S.get(key, null);
            if (!raw) return def;
            const o = JSON.parse(raw);
            return (o && typeof o === 'object') ? o : def;
        } catch (_) { return def; }
    }
    function writeJSON(key, obj) { try { S.set(key, JSON.stringify(obj)); } catch (_) { } }

    const st = {
        on: S.get(K_ON, 'true') !== 'false',
        auto: S.get(K_AUTO, 'true') !== 'false',
        range: S.get(K_RANGE, 'mid') || 'mid',
        angles: Object.assign({}, DEF_ANGLES, readJSON(K_ANGLES, {})),
        corr: readJSON(K_CORR, {}),
        // measured mapping
        fx: null, fy: null,                 // {a, b}
        fitAt: 0, fitRes: 0,
        samples: [],                        // {sx, sy, px, py}
        lastMouse: null,                    // last known aim point, client space
        realMouse: null,                    // last REAL mouse position (trusted)
        lastPkt: null,                      // last observed move packet {x, y, t}
        pktCount: 0,
        cell: null, prevCell: null,
        errEma: 0, bias: 0,
        bounds: null,                       // {minx, miny, maxx, maxy} when discovered
        calBusy: false, calAt: 0,
        lastAim: null, lastAimAt: 0,
        aimCount: 0
    };

    // ── canvas helpers ───────────────────────────────────────────────────────
    function rectOf() {
        try {
            const c = (typeof canvasElement !== 'undefined' && canvasElement) || getCanvasElement();
            if (c && c.getBoundingClientRect) {
                const r = c.getBoundingClientRect();
                if (r.width >= 80 && r.height >= 80) return r;
            }
        } catch (_) { }
        try {
            return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight, right: window.innerWidth, bottom: window.innerHeight };
        } catch (_) { return null; }
    }
    function centerOf(r) { return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }

    // ── fit from samples: robust median-of-pairs, no least-squares blow-up ───
    function median(arr) {
        if (!arr.length) return null;
        const a = arr.slice().sort((x, y) => x - y);
        return a[a.length >> 1];
    }
    function slopeOf(points, uKey, vKey) {
        const slopes = [];
        const pts = points.filter(p => isFinite(p[uKey]) && isFinite(p[vKey]));
        for (let i = 0; i < pts.length; i++) {
            for (let j = i + 1; j < pts.length; j++) {
                const du = pts[j][uKey] - pts[i][uKey];
                if (Math.abs(du) < 18) continue;
                slopes.push((pts[j][vKey] - pts[i][vKey]) / du);
            }
        }
        const a = median(slopes);
        if (a === null || !isFinite(a) || a <= 0.005 || a > 40) return null;
        const bs = pts.map(p => p[vKey] - a * p[uKey]);
        const b = median(bs);
        if (b === null || !isFinite(b)) return null;
        const res = median(pts.map(p => Math.abs(p[vKey] - (a * p[uKey] + b))));
        return { a: a, b: b, res: res || 0 };
    }
    function refit() {
        const pts = st.samples.slice(-40);
        if (pts.length < 3) return false;
        const fx = slopeOf(pts, 'sx', 'px');
        const fy = slopeOf(pts, 'sy', 'py');
        if (!fx || !fy) return false;
        // reject garbage: residual must be small compared to the packet scale
        if (fx.res > 60 || fy.res > 60) return false;
        st.fx = { a: fx.a, b: fx.b }; st.fy = { a: fy.a, b: fy.b };
        st.fitAt = Date.now(); st.fitRes = Math.max(fx.res, fy.res);
        updateSelf();
        return true;
    }

    // ── the mapping itself ───────────────────────────────────────────────────
    function pktOf(sx, sy) {
        if (!st.fx || !st.fy) return null;
        return { x: st.fx.a * sx + st.fx.b, y: st.fy.a * sy + st.fy.b };
    }
    function ready() { return !!(st.fx && st.fy); }

    function updateSelf() {
        try {
            const r = rectOf(); if (!r) return;
            const c = centerOf(r);
            const p = pktOf(c.x, c.y);
            if (!p) return;
            const now = performance.now();
            if (st.prevCell) {
                const dt = now - st.prevCell.t;
                const dx = p.x - st.prevCell.x, dy = p.y - st.prevCell.y;
                if (dt > 90) {
                    const dist = Math.hypot(dx, dy);
                    const dir = activeDir();
                    if (dist >= 5 && dir && st.auto) {
                        const want = angleOf(dir);
                        const actual = Math.atan2(dx, -dy) * 180 / Math.PI;
                        let err = ((want - actual + 540) % 360) - 180;
                        if (Math.abs(err) <= 50) {
                            st.errEma = st.errEma * 0.86 + err * 0.14;
                            if (Math.abs(st.errEma) > 1.2) {
                                const c0 = st.corr[dir] || 0;
                                const next = Math.max(-MAX_CORR, Math.min(MAX_CORR, c0 + st.errEma * 0.3));
                                if (Math.abs(next - c0) > 0.05) {
                                    st.corr[dir] = Math.round(next * 10) / 10;
                                    writeJSON(K_CORR, st.corr);
                                }
                            }
                        }
                    }
                    st.prevCell = { x: p.x, y: p.y, t: now };
                }
            } else {
                st.prevCell = { x: p.x, y: p.y, t: now };
            }
            st.cell = { x: p.x, y: p.y };
        } catch (_) { }
    }

    function angleOf(dir) {
        const v = Number(st.angles[dir]);
        return isFinite(v) ? (((v % 360) + 360) % 360) : (DEF_ANGLES[dir] || 0);
    }
    function aimedAngle(dir) {
        return angleOf(dir) + (st.corr[dir] || 0);
    }
    function activeDir() {
        try {
            const cl = window.clActive;
            if (cl) {
                for (let i = 0; i < DIRS.length; i++) if (cl[DIRS[i]]) return DIRS[i];
            }
            if (window.activeMovementLock) return window.activeMovementLock;
        } catch (_) { }
        return null;
    }

    // ── aim point ────────────────────────────────────────────────────────────
    function aim(dir) {
        if (!st.on || !ready()) return null;
        const r = rectOf(); if (!r) return null;
        const key = RANGE_F[st.range] || RANGE_F.mid;
        const rad = Math.max(120, Math.min(r.width, r.height) * key);
        const c = centerOf(r);
        const a = aimedAngle(dir) * Math.PI / 180;
        let ux = Math.sin(a), uy = -Math.cos(a);
        // keep the point comfortably inside the canvas: R <= 0.46 * min(w,h)
        let sx = c.x + ux * rad, sy = c.y + uy * rad;
        sx = Math.max(r.left + 4, Math.min(r.left + r.width - 4, sx));
        sy = Math.max(r.top + 4, Math.min(r.top + r.height - 4, sy));

        let p = pktOf(sx, sy);
        if (!p) return null;
        // stay inside the map when we know where its borders are
        if (st.bounds) {
            for (let i = 0; i < 8; i++) {
                if (p.x > st.bounds.minx && p.x < st.bounds.maxx && p.y > st.bounds.miny && p.y < st.bounds.maxy) break;
                ux *= 0.72; uy *= 0.72;
                sx = Math.max(r.left + 4, Math.min(r.left + r.width - 4, c.x + ux * rad));
                sy = Math.max(r.top + 4, Math.min(r.top + r.height - 4, c.y + uy * rad));
                p = pktOf(sx, sy);
                if (!p) break;
            }
        }
        const out = { x: Math.round(p.x), y: Math.round(p.y), sx: sx, sy: sy };
        st.lastAim = { dir: dir, x: out.x, y: out.y, sx: sx, sy: sy, t: Date.now() };
        st.aimCount++;
        return out;
    }

    // ── observation hooks ────────────────────────────────────────────────────
    function markMouse(x, y, trusted) {
        st.lastMouse = { x: x, y: y, t: performance.now() };
        if (trusted) st.realMouse = { x: x, y: y };
    }
    function notePacket(data) {
        try {
            if (!data) return;
            if (window.__nmOwnMove) return;   // our own generated packet: not a measurement
            let dv = null;
            if (data instanceof ArrayBuffer) dv = new DataView(data);
            else if (data && data.buffer instanceof ArrayBuffer) dv = new DataView(data.buffer, data.byteOffset || 0, data.byteLength);
            if (!dv || dv.byteLength !== 13 || dv.getUint8(0) !== 16) return;
            const x = dv.getInt32(1, true), y = dv.getInt32(5, true);
            const now = performance.now();
            st.pktCount++;
            st.lastPkt = { x: x, y: y, t: now };
            const m = st.lastMouse;
            if (!m || (now - m.t) > 220) return;
            // reject obviously mechanical packets (the legacy ±1e7 style)
            if (!isFinite(x) || !isFinite(y) || Math.abs(x) > 4e6 || Math.abs(y) > 4e6) return;
            st.samples.push({ sx: m.x, sy: m.y, px: x, py: y });
            if (st.samples.length > 60) st.samples.splice(0, st.samples.length - 60);
            if (st.samples.length >= 3) refit();
        } catch (_) { }
    }
    function noteIncoming(data) {
        // border packet (agar-style opcode 64): gives us the real map box, so the
        // aim point can be kept strictly inside it and never get clamped.
        try {
            let dv = null;
            if (data instanceof ArrayBuffer) dv = new DataView(data);
            else if (data && data.buffer instanceof ArrayBuffer) dv = new DataView(data.buffer, data.byteOffset || 0, data.byteLength);
            if (!dv || dv.byteLength < 9) return;
            if (dv.getUint8(0) !== 64) return;
            let b = null;
            if (dv.byteLength >= 33) {          // float64 borders
                b = { minx: dv.getFloat64(1, true), miny: dv.getFloat64(9, true), maxx: dv.getFloat64(17, true), maxy: dv.getFloat64(25, true) };
            } else if (dv.byteLength >= 17) {   // int32 borders
                b = { minx: dv.getInt32(1, true), miny: dv.getInt32(5, true), maxx: dv.getInt32(9, true), maxy: dv.getInt32(13, true) };
            } else {                            // int16 borders
                b = { minx: dv.getInt16(1, true), miny: dv.getInt16(3, true), maxx: dv.getInt16(5, true), maxy: dv.getInt16(7, true) };
            }
            if (!b) return;
            const w = b.maxx - b.minx, h = b.maxy - b.miny;
            if (w > 300 && h > 300 && w < 1e6 && h < 1e6) st.bounds = b;
        } catch (_) { }
    }

    // ── active calibration: three synthetic points the game maps for us ──────
    function fireMove(x, y) {
        try {
            const el = document.querySelector('canvas') || document.documentElement;
            const opts = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, buttons: 0 };
            window._clBypass = true;
            try {
                if (window.PointerEvent) {
                    try { el.dispatchEvent(new PointerEvent('pointermove', Object.assign({}, opts, { pointerId: 1, pointerType: 'mouse', isPrimary: true }))); } catch (_) { }
                }
                el.dispatchEvent(new MouseEvent('mousemove', opts));
            } finally { window._clBypass = false; }
        } catch (_) { window._clBypass = false; }
    }
    function sampleAt(x, y, waitMs) {
        return new Promise((resolve) => {
            try {
                st.lastPkt = null;
                markMouse(x, y, false);
                fireMove(x, y);
            } catch (_) { }
            setTimeout(() => { resolve(st.lastPkt ? { x: st.lastPkt.x, y: st.lastPkt.y } : null); }, waitMs);
        });
    }
    function calibrate() {
        if (st.calBusy) return Promise.resolve(false);
        st.calBusy = true;
        return new Promise((resolve) => {
            (async () => {
                let ok = false;
                try {
                    const r = rectOf();
                    if (!r) { resolve(false); return; }
                    const c = centerOf(r);
                    const D = Math.max(55, Math.min(150, Math.round(Math.min(r.width, r.height) * 0.2)));
                    const p0 = await sampleAt(c.x, c.y, 130);
                    const p1 = await sampleAt(c.x + D, c.y, 130);
                    const p2 = await sampleAt(c.x, c.y + D, 130);
                    if (p0 && p1 && p2) {
                        const ax = (p1.x - p0.x) / D, ay = (p2.y - p0.y) / D;
                        if (isFinite(ax) && isFinite(ay) && ax > 0.005 && ax < 40 && ay > 0.005 && ay < 40) {
                            st.fx = { a: ax, b: p0.x - ax * c.x };
                            st.fy = { a: ay, b: p0.y - ay * c.y };
                            st.fitAt = Date.now(); st.fitRes = 0;
                            // seed the passive sampler with these three real points
                            st.samples.push({ sx: c.x, sy: c.y, px: p0.x, py: p0.y },
                                { sx: c.x + D, sy: c.y, px: p1.x, py: p1.y },
                                { sx: c.x, sy: c.y + D, px: p2.x, py: p2.y });
                            if (st.samples.length > 60) st.samples.splice(0, st.samples.length - 60);
                            st.calAt = Date.now();
                            ok = true;
                        }
                    }
                } catch (_) {
                } finally {
                    // put the game's aim back where the player had it
                    try {
                        const rm = st.realMouse;
                        if (rm) { setTimeout(() => { try { fireMove(rm.x, rm.y); } catch (_) { } }, 40); }
                    } catch (_) { }
                    st.calBusy = false;
                    try { updateSelf(); } catch (_) { }
                    resolve(ok);
                }
            })();
        });
    }

    // ── api ──────────────────────────────────────────────────────────────────
    function diag() {
        let src = '—';
        try {
            if (st.fx) {
                const r = rectOf();
                const a = st.fx.a;
                const looksScreen = Math.abs(a - 1) < 0.12 && r && Math.abs(st.fx.b + r.width / 2) < 44;
                if (looksScreen) src = 'شاشة (viewport)';
                else if (a > 0.12 && a < 4) src = 'عالم (زووم ≈ ' + (1 / a).toFixed(2) + ')';
                else src = 'مخصص (' + a.toFixed(3) + ')';
            }
        } catch (_) { }
        return {
            on: st.on, auto: st.auto, range: st.range,
            ready: ready(), fitAt: st.fitAt, res: st.fitRes,
            scaleX: st.fx ? st.fx.a : null, scaleY: st.fy ? st.fy.a : null,
            cell: st.cell, corr: Object.assign({}, st.corr), angles: Object.assign({}, st.angles),
            errEma: st.errEma, src: src, bounds: st.bounds, pktCount: st.pktCount,
            calBusy: st.calBusy, lastAim: st.lastAim, samples: st.samples.length
        };
    }
    function setAngles(o) {
        if (!o) return;
        Object.keys(DEF_ANGLES).forEach(d => {
            if (o[d] === undefined) return;
            const v = Number(o[d]);
            if (isFinite(v)) st.angles[d] = ((v % 360) + 360) % 360;
        });
        writeJSON(K_ANGLES, st.angles);
    }
    function setAngle(d, v) {
        const n = Number(v);
        if (!DIRS.includes(d) || !isFinite(n)) return;
        st.angles[d] = ((n % 360) + 360) % 360;
        writeJSON(K_ANGLES, st.angles);
    }
    function resetAngles() {
        st.angles = Object.assign({}, DEF_ANGLES);
        writeJSON(K_ANGLES, st.angles);
    }
    function resetCorr() {
        st.corr = {}; st.errEma = 0; st.bias = 0;
        writeJSON(K_CORR, st.corr);
    }
    function set(k, v) {
        if (k === 'on') { st.on = !!v; S.set(K_ON, String(!!v)); }
        else if (k === 'auto') { st.auto = !!v; S.set(K_AUTO, String(!!v)); }
        else if (k === 'range') { st.range = RANGE_F[v] ? v : 'mid'; S.set(K_RANGE, st.range); }
    }

    // feed the engine from whatever the game already does
    try {
        window.addEventListener('mousemove', nativeify((ev) => {
            try {
                if (ev && ev.isTrusted) markMouse(ev.clientX, ev.clientY, true);
            } catch (_) { }
        }, 'nmPhysMouse'), { capture: true, passive: true });
    } catch (_) { }
    try {
        if (window.__loader_on_ws_send) window.__loader_on_ws_send((ws, data) => { try { notePacket(data); } catch (_) { } });
    } catch (_) { }
    try {
        if (window.__loader_on_ws) window.__loader_on_ws((ws) => {
            try {
                ws.addEventListener('message', (ev) => { try { noteIncoming(ev.data); } catch (_) { } });
            } catch (_) { }
        });
    } catch (_) { }
    // self-tracking runs on its own clock so the correction loop works even when
    // no game packet arrives (a pinned cell still moves, the camera still moves).
    try { setInterval(() => { try { updateSelf(); } catch (_) { } }, 200); } catch (_) { }
    // one automatic calibration shortly after start (so corners are exact from
    // the first press) and again if the fit goes stale for a long time.
    try {
        setTimeout(() => { try { if (!ready()) calibrate(); } catch (_) { } }, 3500);
        setTimeout(() => { try { if (!ready()) calibrate(); } catch (_) { } }, 12000);
    } catch (_) { }

    const API = {
        aim: aim, ready: ready, calibrate: calibrate, diag: diag, notePacket: notePacket,
        markMouse: markMouse, angleOf: angleOf, aimedAngle: aimedAngle, activeDir: activeDir,
        setAngles: setAngles, setAngle: setAngle, resetAngles: resetAngles, resetCorr: resetCorr,
        set: set, dirs: DIRS, defaults: DEF_ANGLES, st: st
    };
    try { defineHidden(window, '__nmPhys', API); } catch (_) { try { window.__nmPhys = API; } catch (__) { } }
    return API;
})();

// ── Lock engine: coordinates + packet rewriting ─────────────────────────────
function nmLockCoords() {
    if (window.activeMovementLock) {
        // v4: the physics engine measures the game's own screen→packet mapping and
        // aims one visible radius ahead in the requested direction, so a corner is
        // an exact 45° whatever the zoom, camera or map borders are doing.
        try {
            if (window.__nmPhys) {
                const p = window.__nmPhys.aim(window.activeMovementLock);
                if (p) return p;
            }
        } catch (_) { }
        const cfg = MOUSE_MOVE_COORDS[window.activeMovementLock];
        return cfg ? { x: cfg.x(window.innerWidth), y: cfg.y(window.innerHeight) } : null;
    }
    if (window.activeNormalLock) return getNormalLineCoords(window.activeNormalLock);
    return null;
}
// rewrites the game's own mouse packet (opcode 16, 13 bytes) in place so it can never pull the line away
function nmApplyLockToPacket(data) {
    try {
        if (!(window.activeMovementLock || window.activeNormalLock)) return;
        let dv = null;
        if (data instanceof ArrayBuffer) dv = new DataView(data);
        else if (data && data.buffer instanceof ArrayBuffer) dv = new DataView(data.buffer, data.byteOffset || 0, data.byteLength);
        if (!dv || dv.byteLength !== 13 || dv.getUint8(0) !== 16) return;
        // measure the packet the game itself produced *before* we overwrite it
        try { if (window.__nmPhys) window.__nmPhys.notePacket(data); } catch (_) { }
        const c = nmLockCoords();
        if (!c) return;
        dv.setInt32(1, c.x, true);
        dv.setInt32(5, c.y, true);
        window.__nmStat.rew++; window.__nmStat.x = c.x; window.__nmStat.y = c.y;
    } catch (_) { }
}

// ── Line state machine ───────────────────────────────────────────────────────
//   1 press  = LINE  (strong, never breaks by itself, no mouse movement can pull it away)
//   2 quick presses = PIN (absolute: mouse events blocked + the game's own packets dropped)
//   next press = OFF
const _lineSeq = {};
function nmCornerReleaseAll() { try { if (window.__nmCorner) window.__nmCorner.releaseAll(); } catch (_) { } }
function nmReleaseLine() {
    window.activeMovementLock = null;
    window.activeNormalLock = null;
    window.nmLinePinned = false;
}
function nmReleaseAll() {
    nmReleaseLine();
    nmCornerReleaseAll();
    NM_ALL_DIRS.forEach(d => { _lineSeq[d] = null; });
    nmRefreshLineUI();
}
// A plain line no longer depends only on rewriting the game's own outgoing
// packets - it also actively RESENDS the locked direction on its own clock.
// This keeps it holding through anything that could briefly change or delay
// the game's own packet stream (e.g. splitting), instead of waiting for the
// game to send the next one.
let _nmLineTickerStarted = false;
function nmEnsureLineTicker() {
    if (_nmLineTickerStarted) return;
    _nmLineTickerStarted = true;
    nmTicker(() => {
        try {
            if (window.nmLinePinned) return;                 // pins are handled by __nmCorner already
            if (!(window.activeMovementLock || window.activeNormalLock)) return;
            const c = nmLockCoords();
            if (c) sendMovePacket(c.x, c.y);
        } catch (_) { }
    }, 45);
}
function nmStartLine(dir, pinned) {
    nmEnsureLineTicker();
    nmCornerReleaseAll();
    window.activeNormalLock = null;
    window.activeMovementLock = dir;
    window.nmLinePinned = !!pinned;
    window.nmLineSince = Date.now();
    window.nmLineTravel = 0;
    try { const c = nmLockCoords(); if (c) sendMovePacket(c.x, c.y); } catch (_) { }
}
function nmLineState(dir) {
    try {
        if (window.__nmCorner && window.__nmCorner.isActive(dir)) return "pin";
        if (window.activeMovementLock === dir) return "line";
    } catch (_) { }
    return "off";
}
function nmLinePress(dir, ts) {
    ts = ts || Date.now();
    const st = nmLineState(dir);
    const seq = _lineSeq[dir];
    if (st === "line" && seq && seq.activated && (ts - seq.ts) <= NMCFG.dblMs) {
        _lineSeq[dir] = null;
        if (window.__nmCorner) { nmReleaseLine(); window.__nmCorner.activate(dir); }
        else nmStartLine(dir, true);
        window.__nmStat.act = dir + " · pin";
        return "pin";
    }
    if (st === "off") {
        nmStartLine(dir, false);
        _lineSeq[dir] = { ts: ts, activated: true };
        window.__nmStat.act = dir + " · line";
        return "line";
    }
    nmCornerReleaseAll();
    if (window.activeMovementLock === dir) nmReleaseLine();
    _lineSeq[dir] = { ts: ts, activated: false };
    window.__nmStat.act = dir + " · off";
    return "off";
}

// ── Live line state in the panel + HUD on the game screen ────────────────────
let _hudEl = null, _hudKey = "";
function nmRefreshLineUI() {
    try {
        const states = {};
        for (let i = 0; i < NM_ALL_DIRS.length; i++) states[NM_ALL_DIRS[i]] = nmLineState(NM_ALL_DIRS[i]);
        document.querySelectorAll(".nm-line-state").forEach(el => {
            const st = states[el.getAttribute("data-dir")] || "off";
            if (el.getAttribute("data-st") !== st) {
                el.setAttribute("data-st", st);
                el.className = "nm-line-state nm-st-" + st;
                el.textContent = st === "pin" ? "📌 مثبت" : (st === "line" ? "لاين" : "—");
            }
        });
        const act = NM_ALL_DIRS.filter(d => states[d] !== "off");
        const key = myPage + "|" + act.map(d => d + states[d]).join(",");
        if (key === _hudKey) return;
        if (!act.length) { if (_hudEl) _hudEl.style.display = "none"; _hudKey = key; return; }
        if (!_hudEl || !_hudEl.isConnected) {
            if (!document.body) return;
            _hudEl = document.createElement("div");
            _hudEl.id = "nm-hud";
            document.body.appendChild(_hudEl);
        }
        _hudEl.style.display = "flex";
        _hudEl.innerHTML = act.map(d =>
            '<span class="nm-hud-tag nm-hud-' + states[d] + '">صفحة ' + myPage + ' · ' + getDirectionLabel(d) +
            (states[d] === "pin" ? ' · 📌 مثبت' : ' · لاين') + '</span>').join("");
        _hudKey = key;
    } catch (_) { }
}

// ── Fresh key system: ONE key = ONE owner (lines, release key, customizations) ─
let nmReleaseKey = S.get("nmReleaseKey", "None") || "None";
function nmKeyLabel(code) {
    try { return (typeof _codeToDisplay !== "undefined" && _codeToDisplay[code]) || String(code).replace(/^Key|^Digit/, ""); } catch (_) { return String(code); }
}
function nmOwnerLabel(o) {
    if (o.type === "line") return getDirectionLabel(o.id.replace("movement", ""));
    if (o.type === "release") return "فك كل اللاينات";
    if (o.type === "cust") return "تخصيص: " + ((customizations[o.idx] && customizations[o.idx].name) || "");
    return "";
}
function nmAllOwners() {
    const out = [];
    try {
        NM_ALL_DIRS.forEach(d => { const vb = "movement" + d; if (_lineVarMap[vb]) out.push({ type: "line", id: vb, key: _lineVarMap[vb].getKey() }); });
        out.push({ type: "release", key: nmReleaseKey });
        customizations.forEach((c, i) => out.push({ type: "cust", idx: i, key: c.shortcut }));
    } catch (_) { }
    return out;
}
function nmSameOwner(a, b) {
    return !!a && !!b && a.type === b.type && (a.id === b.id) && (a.idx === b.idx);
}
function nmWriteOwnerKey(o, code) {
    try {
        if (o.type === "line") { _lineVarMap[o.id].setKey(code); S.set(o.id + "Key", code); }
        else if (o.type === "release") { nmReleaseKey = code; S.set("nmReleaseKey", code); }
        else if (o.type === "cust" && customizations[o.idx]) {
            customizations[o.idx].shortcut = code;
            S.set("customizations", JSON.stringify(customizations));
            try { settingsChannel.postMessage({ type: "update_customizations", data: customizations }); } catch (_) { }
        }
    } catch (_) { }
}
// give `code` to `owner`; every other owner that had it loses it (and the player is told)
function nmClaimKey(code, owner) {
    try {
        if (!code || code === "None") return;
        const lost = [];
        nmAllOwners().forEach(o => {
            if (nmSameOwner(o, owner)) return;
            if (o.key === code) { nmWriteOwnerKey(o, "None"); lost.push(nmOwnerLabel(o)); }
        });
        if (lost.length) nmToast("الزر " + nmKeyLabel(code) + " اتنقل من: " + lost.join("، ") + " (زر واحد = أمر واحد)");
        nmRefreshKeyUI();
    } catch (_) { }
}
function nmDedupeKeys() {
    try {
        const seen = {}; let n = 0;
        nmAllOwners().forEach(o => {
            const k = o.key;
            if (!k || k === "None") return;
            if (seen[k]) { nmWriteOwnerKey(o, "None"); n++; } else seen[k] = true;
        });
        if (n) nmToast("اتشال " + n + " تداخل في المفاتيح - اضبطها من جديد");
        nmRefreshKeyUI();
    } catch (_) { }
}
function nmRefreshKeyUI() {
    try {
        updateMovementUIElements();
        const rb = document.getElementById("nmReleaseKeyBox");
        if (rb) rb.textContent = nmReleaseKey !== "None" ? nmKeyLabel(nmReleaseKey) : "";
        updateCustomizationsUI();
    } catch (_) { }
}
function nmClearAllKeys() {
    try {
        nmAllOwners().forEach(o => { if (o.key && o.key !== "None") nmWriteOwnerKey(o, "None"); });
        nmRefreshKeyUI();
        nmToast("اتمسحت كل المفاتيح - ابدأ ضبط جديد");
    } catch (_) { }
}
function nmSetLineKey(varBase, code) {
    // assigning a key also switches the line ON, so it works right away
    try {
        const en = _lineVarMap[varBase];
        if (!en) return;
        nmClaimKey(code, { type: "line", id: varBase });
        en.setKey(code); S.set(varBase + "Key", code);
        if (code !== "None" && !en.get()) { en.set(true); S.set(varBase + "Enabled", "true"); }
        try { settingsChannel.postMessage({ type: "update_movement_settings", data: getAllDirections() }); } catch (_) { }
        nmRefreshKeyUI();
    } catch (_) { }
}

// ── Guided key setup: press the key for each action, one by one ─────────────
let _setupRun = null;
function nmGuidedSetup() {
    try {
        if (_setupRun) return;
        _stopRec();
        const steps = NM_ALL_DIRS.map(d => ({ owner: { type: "line", id: "movement" + d }, label: getDirectionLabel(d) }));
        steps.push({ owner: { type: "release" }, label: "فك كل اللاينات (زر الطوارئ)" });
        let i = 0;
        const ov = document.createElement("div");
        ov.id = "nm-setup-overlay";
        document.body.appendChild(ov);
        window.__nmSetupActive = true;
        const draw = () => {
            const s = steps[i];
            ov.innerHTML = '<div class="nm-setup-card"><div class="nm-setup-step">' + (i + 1) + ' / ' + steps.length + '</div>' +
                '<div class="nm-setup-title">اضغط الزر الخاص بـ</div><div class="nm-setup-name">' + s.label + '</div>' +
                '<div class="nm-setup-help">Esc = تخطي · Backspace = بدون زر · أي زر تاني = تعيين</div></div>';
        };
        const finish = () => {
            window.removeEventListener("keydown", onKey, true);
            window.__nmSetupActive = false; _setupRun = null;
            try { ov.remove(); } catch (_) { }
            nmRefreshKeyUI();
            nmToast("تم ضبط المفاتيح");
        };
        const onKey = (ev) => {
            try {
                ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
                if (ev.repeat) return;
                const s = steps[i];
                if (ev.code === "Escape") { /* skip */ }
                else if (ev.code === "Backspace" || ev.code === "Delete") {
                    if (s.owner.type === "line") nmSetLineKey(s.owner.id, "None"); else nmWriteOwnerKey(s.owner, "None");
                } else {
                    if (s.owner.type === "line") nmSetLineKey(s.owner.id, ev.code);
                    else { nmClaimKey(ev.code, s.owner); nmWriteOwnerKey(s.owner, ev.code); }
                }
                i++;
                if (i >= steps.length) finish(); else draw();
            } catch (_) { finish(); }
        };
        window.addEventListener("keydown", onKey, true);
        _setupRun = { stop: finish };
        draw();
    } catch (_) { window.__nmSetupActive = false; _setupRun = null; }
}

// ── Debug box (optional) ─────────────────────────────────────────────────────
let _diagEl = null, _diagPrev = { rew: 0, drop: 0, forced: 0 }, _diagT = 0;
function nmDiagTick() {
    try {
        if (!NMCFG.diag) { if (_diagEl) _diagEl.style.display = "none"; return; }
        if (!document.body) return;
        if (!_diagEl || !_diagEl.isConnected) { _diagEl = document.createElement("div"); _diagEl.id = "nm-diag"; document.body.appendChild(_diagEl); }
        const s = window.__nmStat, now = Date.now(), dt = Math.max(0.2, (now - _diagT) / 1000);
        const r = Math.round((s.rew - _diagPrev.rew) / dt), d = Math.round((s.drop - _diagPrev.drop) / dt), f = Math.round((s.forced - _diagPrev.forced) / dt);
        _diagPrev = { rew: s.rew, drop: s.drop, forced: s.forced }; _diagT = now;
        _diagEl.style.display = "block";
        _diagEl.textContent = "صفحة " + myPage + " | آخر زر: " + (s.key || "-") + " | آخر أمر: " + (s.act || "-") +
            " | إحداثيات: " + s.x + "," + s.y + " | معاد كتابته/ث: " + r + " | مُسقَط/ث: " + d + " | مُجبَر/ث: " + f;
    } catch (_) { }
}

// ── Skip the "نتيجة الجولة / الإستمرار" screen as if it never existed ───────
let _skipOn = true;
try { _skipOn = S.get("skipResults", "true") !== "false"; } catch (_) { }
let _skipSeenAt = 0, _skipLastClick = 0, _skipGaveUp = false, _skipClassUsed = false;
function nmSkipEnabled() { return _skipOn; }
function nmSetSkip(v) {
    _skipOn = !!v;
    S.set("skipResults", _skipOn ? "true" : "false");
    nmSkipTick();
}
function nmNorm(s) {
    return String(s || "").replace(/[ً-ٟـ]/g, "").replace(/[إأآ]/g, "ا").replace(/\s+/g, " ").trim();
}
function nmFindResultsPopup() {
    const ps = document.getElementById("playscore");
    if (!ps) return null;
    const group = ps.closest(".form-group") || ps.parentElement;
    const inner = group && group.parentElement;           // the results panel itself
    if (!inner) return null;
    let btn = null;
    const btns = inner.querySelectorAll("button");
    for (let i = 0; i < btns.length; i++) { if (nmNorm(btns[i].textContent).indexOf("الاستمرار") !== -1) { btn = btns[i]; break; } }
    if (!btn && btns.length === 1) btn = btns[0];
    return { box: inner, btn: btn };
}
function nmPopupShown(box) {
    try {
        if (!box || !box.isConnected) return false;
        const cs = getComputedStyle(box);
        if (cs.display === "none" || cs.visibility === "hidden") return false;
        let el = box;
        for (let i = 0; i < 5 && el && el !== document.body; i++, el = el.parentElement) {
            if (el.style && el.style.opacity === "0") return false;
        }
        return true;
    } catch (_) { return false; }
}
function nmClearSkipClass() {
    const hid = document.querySelectorAll(".nm-skip-hide");
    for (let i = 0; i < hid.length; i++) hid[i].classList.remove("nm-skip-hide");
    _skipClassUsed = false;
}
function nmSkipTick() {
    try {
        if (!_skipOn) { if (_skipClassUsed) nmClearSkipClass(); return; }
        const f = nmFindResultsPopup();
        if (!f || !f.box || !f.btn || !nmPopupShown(f.box)) {
            if (_skipClassUsed) nmClearSkipClass();
            _skipSeenAt = 0; _skipGaveUp = false;
            return;
        }
        const now = Date.now();
        if (!_skipSeenAt) _skipSeenAt = now;
        if (_skipGaveUp) return;
        if (now - _skipSeenAt > 2500) {           // could not dismiss it: show it so the player is never stuck
            _skipGaveUp = true;
            nmClearSkipClass();
            return;
        }
        f.box.classList.add("nm-skip-hide");
        const par = f.box.parentElement;
        if (par && par !== document.body && par.children.length === 1 && !par.querySelector("canvas")) par.classList.add("nm-skip-hide");
        _skipClassUsed = true;
        if (!f.btn.disabled && now - _skipLastClick > 250) {
            _skipLastClick = now;
            f.btn.click();
        }
    } catch (_) { }
}
function nmSkipInit() {
    try {
        const st = document.createElement("style");
        st.textContent = ".nm-skip-hide{position:fixed!important;left:-99999px!important;top:-99999px!important;opacity:0!important;pointer-events:none!important}";
        (document.head || document.documentElement).appendChild(st);
        new MutationObserver(() => nmSkipTick()).observe(document.documentElement,
            { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });
        setInterval(nmSkipTick, 200);
        window.addEventListener("storage", ev => {
            if (ev.key === "skipResults") { _skipOn = ev.newValue !== "false"; nmSkipTick(); }
        });
    } catch (_) { }
}

// ── Panel toggle (shared by every way of opening the panel) ─────────────────
let _nmTogT = 0, _nmSyncedPanel = null;
function nmGetPanel() { return document.querySelector(".nm-menu-container") || document.getElementById("controlPanel"); }
// The panel's visibility is forced with inline !important styles that follow the `show` class,
// so page CSS / a missing stylesheet / a running animation can never keep it hidden.
function nmSyncPanel(panel) {
    try {
        const on = panel.classList.contains("show");
        const set = (k, v) => panel.style.setProperty(k, v, "important");
        if (on) { set("display", "flex"); set("visibility", "visible"); set("opacity", "1"); set("pointer-events", "auto"); set("position", "fixed"); }
        else set("display", "none");
    } catch (_) { }
}
function nmWatchPanel(panel) {
    try {
        if (!panel || _nmSyncedPanel === panel) return;
        _nmSyncedPanel = panel;
        new MutationObserver(() => nmSyncPanel(panel)).observe(panel, { attributes: true, attributeFilter: ["class"] });
        nmSyncPanel(panel);
    } catch (_) { }
}
function nmPanelState() {
    try {
        const p = nmGetPanel(), c = document.getElementById("nm-floating-circle");
        const cs = p && getComputedStyle(p), pr = p && p.getBoundingClientRect(), cr = c && c.getBoundingClientRect();
        let cover = null;
        if (cr) { const el = document.elementFromPoint(cr.x + cr.width / 2, cr.y + cr.height / 2); cover = el ? (el.tagName + (el.id ? "#" + el.id : "") + (el.className && el.className.baseVal === undefined ? "." + String(el.className).split(" ")[0] : "")) : null; }
        return {
            panels: document.querySelectorAll(".nm-menu-container").length, panelsById: document.querySelectorAll("#controlPanel").length,
            show: !!p && p.classList.contains("show"), display: cs && cs.display, visibility: cs && cs.visibility, opacity: cs && cs.opacity, z: cs && cs.zIndex,
            panelRect: pr && [Math.round(pr.x), Math.round(pr.y), Math.round(pr.width), Math.round(pr.height)],
            iconRect: cr && [Math.round(cr.x), Math.round(cr.y), Math.round(cr.width), Math.round(cr.height)],
            elementOnTopOfIcon: cover, viewport: [innerWidth, innerHeight], page: myPage
        };
    } catch (e) { return { error: String(e) }; }
}
function nmTogglePanel() {
    try {
        const now = Date.now();
        if (now - _nmTogT < 350) return;                   // the icon has several click paths: only one may act
        _nmTogT = now;
        let panel = nmGetPanel();
        if (!panel) {                                      // the panel was never built / got removed: build it again
            try { createControlPanel(); nmInitV32UI(); } catch (e) { try { console.error("[Nightmare] تعذر بناء اللوحة", e); } catch (_) { } }
            panel = nmGetPanel();
            if (!panel) { nmToast("اللوحة مش اتبنت - شوف الـ Console"); return; }
        }
        nmWatchPanel(panel);
        if (panel.classList.contains("show")) { panel.classList.remove("show"); }
        else {
            const circle = document.getElementById("nm-floating-circle");
            const cr = circle ? circle.getBoundingClientRect() : { left: 30, bottom: 90, top: 30 };
            const W = Math.min(780, window.innerWidth - 20), H = Math.min(640, window.innerHeight - 20), m = 12;
            let top = cr.bottom + m;
            if (top + H > window.innerHeight) top = Math.max(m, cr.top - H - m);
            let left = cr.left;
            if (left + W > window.innerWidth) left = Math.max(m, window.innerWidth - W - m);
            panel.style.top = top + "px"; panel.style.left = left + "px";
            panel.classList.add("show");
            try { if (window.NMUPDATE) NMUPDATE.check(true); } catch (_) { }
            try { nmRefreshPhysStats(); } catch (_) { }
        }
        nmSyncPanel(panel);
        try { console.log("[Nightmare] اللوحة " + (panel.classList.contains("show") ? "اتفتحت" : "اتقفلت"), JSON.stringify(nmPanelState())); } catch (_) { }
    } catch (e) { try { console.error("[Nightmare] toggle failed", e); } catch (_) { } }
}
// handy from the Console:  __MTC.open()   /   __MTC.state()
try { Object.defineProperty(window, "__MTC", { value: { open: nmTogglePanel, state: () => { const s = nmPanelState(); console.log(JSON.stringify(s)); return s; } }, configurable: true }); } catch (_) { }
// Registered at document-start on `window` in the capture phase => they run BEFORE the game's handlers,
// so a game that swallows mouse events can no longer stop the icon from working.
(function nmOpenFallbacks() {
    try {
        let sx = null, sy = 0;
        const inC = (t) => { try { return !!(t && t.closest && t.closest("#nm-floating-circle")); } catch (_) { return false; } };
        window.addEventListener("mousedown", (e) => { if (e.button === 0 && inC(e.target)) { sx = e.clientX; sy = e.clientY; try { console.log("[Nightmare] ضغطة على الأيقونة"); } catch (_) { } } else sx = null; }, true);
        window.addEventListener("mouseup", (e) => {
            if (sx !== null && inC(e.target) && Math.hypot(e.clientX - sx, e.clientY - sy) < 5) nmTogglePanel();
            sx = null;
        }, true);
        // keyboard way in, works even if something covers the icon:  Ctrl + Shift + M
        window.addEventListener("keydown", (e) => {
            if (e.ctrlKey && e.shiftKey && e.code === "KeyM") { e.preventDefault(); e.stopPropagation(); nmTogglePanel(); }
        }, true);
    } catch (_) { }
})();

// ── boot ─────────────────────────────────────────────────────────────────────
try { console.log("[Nightmare] السكريبت اشتغل"); } catch (_) { }
try { nmClaimPage(); } catch (_) { }
try { nmTicker(nmBeat, 2000); } catch (_) { }
try {
    window.addEventListener("pagehide", () => {
        try { const r = nmReadPage(myPage); if (r && r.id === myId) localStorage.removeItem(nmPageKey(myPage)); } catch (_) { }
    });
} catch (_) { }
nmOnDocReady(nmSkipInit);
setInterval(nmRefreshLineUI, 250);
setInterval(nmDiagTick, 400);

// ══════════════════════════════════════════════════════════════════════════════
// v3.2 UI: extra css, new panes (Performance / Colors) and wiring
// ══════════════════════════════════════════════════════════════════════════════
// v4: every component style lives in loadAllStyle() now (single source of truth).
(function nmStyleMergedV4() { /* no-op: see loadAllStyle */ })();

// ══════════════════════════════════════════════════════════════════════════════
// v4 panel wiring: physics/angle card, live dial, update entry points.
// Everything here is defensive: a missing element never breaks the panel.
// ══════════════════════════════════════════════════════════════════════════════

// Keeps the game's own aim glued to our locked direction (cosmetic: it never
// decides the direction, the packet we send does) and — more importantly — it
// makes the game itself emit a move packet for a *known* screen point, which is
// exactly the measurement the physics engine needs to keep its fit fresh.
function nmPhysPing(c) {
    try {
        const P = window.__nmPhys;
        if (!P || !c || c.sx == null || c.sy == null) return;
        if (performance.now() - (window.__nmAimPingAt || 0) < 170) return;
        window.__nmAimPingAt = performance.now();
        const el = (typeof canvasElement !== 'undefined' && canvasElement) || getCanvasElement() || document.documentElement;
        P.markMouse(c.sx, c.sy, false);
        const opts = { bubbles: true, cancelable: true, composed: true, clientX: c.sx, clientY: c.sy, button: 0, buttons: 0 };
        window._clBypass = true;
        try {
            if (window.PointerEvent) {
                try { el.dispatchEvent(new PointerEvent('pointermove', Object.assign({}, opts, { pointerId: 1, pointerType: 'mouse', isPrimary: true }))); } catch (_) { }
            }
            el.dispatchEvent(new MouseEvent('mousemove', opts));
        } finally { window._clBypass = false; }
    } catch (_) { window._clBypass = false; }
}

function nmDrawAngleDial() {
    try {
        const cv = document.getElementById('nm-angle-dial');
        const P = window.__nmPhys;
        if (!cv || !P) return;
        const SZ = 132;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        if (cv.width !== Math.round(SZ * dpr)) { cv.width = Math.round(SZ * dpr); cv.height = Math.round(SZ * dpr); }
        const ctx = cv.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, SZ, SZ);
        const cx = SZ / 2, cy = SZ / 2, R = SZ / 2 - 9;
        ctx.strokeStyle = 'rgba(150,182,226,.14)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, R * 0.6, 0, Math.PI * 2); ctx.stroke();
        for (let i = 0; i < 8; i++) {
            const a = i * Math.PI / 4;
            const x1 = cx + Math.sin(a) * (R - 5), y1 = cy - Math.cos(a) * (R - 5);
            const x2 = cx + Math.sin(a) * (R - 1), y2 = cy - Math.cos(a) * (R - 1);
            ctx.strokeStyle = i % 2 ? 'rgba(150,182,226,.18)' : 'rgba(150,182,226,.34)';
            ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        }
        const active = P.activeDir();
        P.dirs.forEach((d) => {
            const ang = P.aimedAngle(d) * Math.PI / 180;
            const on = d === active;
            const len = on ? R - 1 : R * 0.56;
            const x = cx + Math.sin(ang) * len, y = cy - Math.cos(ang) * len;
            ctx.save();
            if (on) { ctx.shadowColor = 'rgba(61,220,191,.85)'; ctx.shadowBlur = 9; }
            ctx.strokeStyle = on ? 'rgba(125,240,217,.98)' : 'rgba(147,167,198,.32)';
            ctx.lineWidth = on ? 2.6 : 1.2;
            ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();
            ctx.restore();
            ctx.fillStyle = on ? '#7df0d9' : 'rgba(147,167,198,.55)';
            ctx.beginPath(); ctx.arc(x, y, on ? 3.4 : 2, 0, Math.PI * 2); ctx.fill();
        });
        ctx.fillStyle = '#eaf2ff';
        ctx.beginPath(); ctx.arc(cx, cy, 2.8, 0, Math.PI * 2); ctx.fill();
    } catch (_) { }
}

function nmSyncAngleInputs() {
    try {
        const grid = document.getElementById('nm-angle-grid');
        const P = window.__nmPhys;
        if (!grid || !P) return;
        P.dirs.forEach((d) => {
            const inp = grid.querySelector('input[data-dir="' + d + '"]');
            if (!inp) return;
            const v = P.angleOf(d);
            inp.value = String(v);
            inp.classList.toggle('dirty', Math.abs(v - (P.defaults[d] || 0)) > 0.01);
        });
    } catch (_) { }
}

function nmInitV4UI() {
    try {
        const $ = (id) => document.getElementById(id);
        const ver = $('nm-ver-chip-num'); if (ver) ver.textContent = NM_VERSION;

        const P = window.__nmPhys;
        if (P) {
            // ── angle editor ────────────────────────────────────────────────
            const grid = $('nm-angle-grid');
            if (grid && !grid.children.length) {
                P.dirs.forEach((d) => {
                    const row = document.createElement('div');
                    row.className = 'nm-angle-row';
                    row.innerHTML =
                        '<span>' + getDirectionLabel(d) + '</span>' +
                        '<input type="number" class="nm-dark-input" min="0" max="359" step="1" data-dir="' + d + '">' +
                        '<button data-reset="' + d + '" title="استعادة الافتراضي">↺</button>';
                    grid.appendChild(row);
                });
                grid.addEventListener('input', (ev) => {
                    const inp = ev.target && ev.target.closest ? ev.target.closest('input[data-dir]') : null;
                    if (!inp) return;
                    P.setAngle(inp.dataset.dir, inp.value);
                    inp.classList.toggle('dirty', Math.abs(P.angleOf(inp.dataset.dir) - (P.defaults[inp.dataset.dir] || 0)) > 0.01);
                    nmDrawAngleDial();
                });
                grid.addEventListener('click', (ev) => {
                    const b = ev.target && ev.target.closest ? ev.target.closest('button[data-reset]') : null;
                    if (!b) return;
                    P.setAngle(b.dataset.reset, P.defaults[b.dataset.reset] || 0);
                    nmSyncAngleInputs();
                    nmDrawAngleDial();
                });
                nmSyncAngleInputs();
            }
            const snapCardinal = (btnId, fn) => {
                const b = $(btnId);
                if (b) b.onclick = () => { fn(); nmSyncAngleInputs(); nmDrawAngleDial(); nmToast('اتظبطت الزوايا'); };
            };
            snapCardinal('nm-angles-reset', () => P.resetAngles());
            snapCardinal('nm-angles-cardinal', () => {
                P.dirs.forEach((d) => P.setAngle(d, Math.round(P.angleOf(d) / 45) * 45));
            });

            // ── physics switches ───────────────────────────────────────────
            const onEl = $('nm-phys-use'), autoEl = $('nm-phys-autocorr'), rangeEl = $('nm-phys-range');
            if (onEl) { onEl.checked = P.st.on; onEl.onchange = () => { P.set('on', onEl.checked); nmToast(onEl.checked ? 'محرك الفيزياء شغال' : 'رجعت للإحداثيات القديمة'); }; }
            if (autoEl) { autoEl.checked = P.st.auto; autoEl.onchange = () => { P.set('auto', autoEl.checked); }; }
            if (rangeEl) { rangeEl.value = P.st.range; rangeEl.onchange = () => { P.set('range', rangeEl.value); }; }

            const calBtn = $('nm-phys-cal');
            if (calBtn) calBtn.onclick = async () => {
                const old = calBtn.textContent;
                calBtn.disabled = true; calBtn.textContent = '… جارٍ المعايرة';
                const ok = await P.calibrate();
                calBtn.disabled = false; calBtn.textContent = old;
                nmToast(ok ? 'تمت المعايرة — الزوايا هتطلع مضبوطة' : 'المعايرة فشلت: حرّك الماوس في اللعبة وجرب تاني');
                nmRefreshPhysStats();
            };
            const rstBtn = $('nm-phys-reset');
            if (rstBtn) rstBtn.onclick = () => { P.resetCorr(); nmToast('اتصفّر تصحيح الزوايا'); nmRefreshPhysStats(); };
            const dgBtn = $('nm-phys-diag');
            if (dgBtn) dgBtn.onclick = () => {
                try {
                    NMCFG.diag = !NMCFG.diag;
                    S.set('nmDiag', String(NMCFG.diag));
                    const dt = $('nm-diagToggle'); if (dt) dt.checked = NMCFG.diag;
                    const d = P.diag();
                    try { console.log('[NMPHYS]', JSON.stringify(d)); } catch (_) { }
                    nmToast('فيزياء: ' + (d.ready ? 'معايرة ✔' : 'غير معايرة') + ' · مقياس ' + (d.scaleX ? d.scaleX.toFixed(3) : '—') +
                        ' · تصحيح ' + ((d.corr[P.activeDir() || 'Up'] || 0).toFixed(1)) + '°');
                } catch (_) { }
            };
            nmSyncAngleInputs();
            nmDrawAngleDial();
        }

        // ── update entry points ────────────────────────────────────────────
        try { if (window.NMUPDATE) { NMUPDATE.renderPanel(); } } catch (_) { }
        const chip = $('nm-update-chip');
        if (chip) chip.onclick = () => { try { NMUPDATE.openModal(); } catch (_) { } };
        const go = $('nm-ub-go');
        if (go) go.onclick = () => { try { NMUPDATE.openModal(); } catch (_) { } };
        const close = $('nm-ub-close');
        if (close) close.onclick = () => {
            try {
                const b = $('nm-update-banner'); if (b) b.classList.remove('show');
                const info = NMUPDATE.info();
                if (info && info.version) S.set('nm3_updSeen', String(info.version));
            } catch (_) { }
        };

        const lbl = $('nm-lines-page-label');
        if (lbl) lbl.textContent = 'صفحة ' + (myPage || 1);
    } catch (_) { }
}

let _nmPhysTickOn = false;
function nmRefreshPhysStats() {
    try {
        const P = window.__nmPhys;
        if (!P) return;
        const $ = (id) => document.getElementById(id);
        const d = P.diag();
        const okEl = $('nm-phys-ok');
        if (okEl) {
            okEl.className = d.on ? (d.ready ? 'ok' : 'warn') : 'bad';
            okEl.textContent = !d.on ? 'مطفية (إحداثيات قديمة)' : (d.ready ? 'معايرة ✔ (' + d.samples + ' عيّنة)' : 'في انتظار معايرة…');
        }
        const scEl = $('nm-phys-scale');
        if (scEl) scEl.textContent = (d.scaleX === null) ? '—' : d.scaleX.toFixed(3) + ' × ' + d.scaleY.toFixed(3);
        const cellEl = $('nm-phys-cell');
        if (cellEl) cellEl.textContent = d.cell ? (Math.round(d.cell.x) + ' , ' + Math.round(d.cell.y)) : '—';
        const act = P.activeDir();
        const corrEl = $('nm-phys-corr');
        if (corrEl) {
            const val = act ? (d.corr[act] || 0) : 0;
            corrEl.textContent = val.toFixed(1) + '°' + (act ? (' · ' + act) : '') + (Math.abs(d.errEma) > 1.2 && act ? ' (Δ ' + d.errEma.toFixed(1) + '°)' : '');
            corrEl.className = Math.abs(val) > 6 ? 'warn' : 'ok';
        }
        const srcEl = $('nm-phys-src');
        if (srcEl) srcEl.textContent = d.src;
        const degEl = $('nm-dial-deg');
        if (degEl) degEl.textContent = Math.round(act ? P.aimedAngle(act) : 0) + '°';
        nmDrawAngleDial();
    } catch (_) { }
}
function nmStartPhysTick() {
    if (_nmPhysTickOn) return;
    _nmPhysTickOn = true;
    setInterval(() => {
        try {
            const pane = document.getElementById('nm-tab-lines');
            const panel = document.getElementById('controlPanel');
            if (!pane || !panel || !panel.classList.contains('show') || !pane.classList.contains('active')) return;
            nmRefreshPhysStats();
        } catch (_) { }
    }, 400);
}

function nmPerfPaneHTML() {
    return `
          <div id="nm-tab-perf" class="nm-tab-pane" dir="rtl">
            <div class="nm-card">
              <div class="nm-card-title">⚡ فتح الفريمات</div>
              <div class="nm-opt"><span>الوضع</span>
                <select id="nm-fpsMode" class="nm-mini-select" style="width:190px">
                  <option value="unlimited">بلا حد (أقصى قوة الجهاز)</option>
                  <option value="custom">حد مخصص</option>
                  <option value="off">طبيعي (بدون تعديل)</option>
                </select>
              </div>
              <div class="nm-opt" id="nm-fpsCapRow"><span>الحد الأقصى (FPS)</span><input type="number" id="nm-fpsCap" class="nm-dark-input mini" min="30" max="2000" step="10"></div>
              <div class="nm-opt"><span>الصفحة في الخلفية تفضل شغالة بدون تجميد</span>
                <label class="nm-toggle-switch"><input type="checkbox" id="nm-fpsBgOn"><span class="nm-slider"></span></label></div>
              <div class="nm-opt" id="nm-fpsBgRow"><span>فريمات الصفحة الخلفية</span><input type="number" id="nm-fpsBg" class="nm-dark-input mini" min="10" max="240" step="5"></div>
              <div class="nm-opt"><span>عداد FPS على الشاشة</span>
                <label class="nm-toggle-switch"><input type="checkbox" id="nm-fpsShow"><span class="nm-slider"></span></label></div>
              <div class="nm-live">الآن: <b id="nm-fpsLive">0</b> FPS</div>
              <div class="nm-note">الوضع "بلا حد" بيشغّل منطق ورسم اللعبة بأقصى سرعة من غير ما ينتظر تحديث الشاشة. الشاشة نفسها مش هتعرض أكتر من معدل تحديثها (Hz)؛ لفك ده كمان شغّل Chrome بالخيارين <span dir="ltr">--disable-frame-rate-limit --disable-gpu-vsync</span>. لو العداد فضل 0 يبقى اللعبة مش بتستخدم requestAnimationFrame. لو الحركة بقت سريعة زيادة اختار "حد مخصص".</div>
            </div>
          </div>`;
}

function nmRecPaneHTML() {
    return `
          <div id="nm-tab-rec" class="nm-tab-pane" dir="rtl">
            <div class="nm-card">
              <div class="nm-card-title">🔬 مسجّل الحزم</div>
              <div class="nm-note">بيسجّل اللي صفحتك بتبعته للسيرفر. شغّل التسجيل، اعمل الأمر اللي عايزه في اللعبة مرة واحدة (ميوت، لوحة الأدمن...) بالطريقة اللي اللعبة بتديهالك، بعدين اضغط "نسخ الكل" وابعت النص لـ Claude.</div>
              <div class="nm-opt"><span>تسجيل اللي بيتبعت للسيرفر</span><label class="nm-toggle-switch"><input type="checkbox" id="nm-recOn"><span class="nm-slider"></span></label></div>
              <div class="nm-opt"><span>إخفاء حزم الماوس</span><label class="nm-toggle-switch"><input type="checkbox" id="nm-recHideMouse"><span class="nm-slider"></span></label></div>
              <div class="nm-lines-toolbar">
                <button class="nm-chip-btn primary" id="nm-recCopy">📋 نسخ الكل</button>
                <button class="nm-chip-btn" id="nm-recClear">🗑 مسح</button>
              </div>
              <div class="nm-live">اتسجّل: <b id="nm-recCount">0</b> حزمة</div>
              <pre id="nm-recList" class="nm-rec-list"></pre>
            </div>
          </div>`;
}

function nmAdvPaneHTML() {
    return `
          <div id="nm-tab-adv" class="nm-tab-pane" dir="rtl">
            <div class="nm-card">
              <div class="nm-card-title">🎬 المسجّل الحركي</div>
              <div class="nm-note">سجّل سلسلة ضغطات مفاتيح حقيقية بتوقيتها الحقيقي، واربطها بمفتاح واحد يشغّلها تاني زي ما سجّلتها بالظبط.</div>
              <div class="nm-lines-toolbar">
                <input type="text" id="nm-macroName" class="nm-dark-input" placeholder="اسم الماكرو" style="max-width:150px">
                <button class="nm-chip-btn primary" id="nm-macroRecBtn">⏺ تسجيل</button>
              </div>
              <div class="nm-live" id="nm-macroRecLive" style="display:none">بيسجّل «<b id="nm-macroRecName"></b>»: <b id="nm-macroRecCount">0</b> ضغطة — اضغط "إيقاف" لما تخلص</div>
              <div id="nm-macroList" class="nm-macro-list"></div>
            </div>
            <div class="nm-card">
              <div class="nm-card-title">🔔 تنبيهات الحجم</div>
              <div class="nm-note">صوت وفلاش على الشاشة لما كرتك تكبر فجأة (نجحت في أكل حاجة كبيرة) أو تصغر فجأة (خطر).</div>
              <div class="nm-opt"><span>تفعيل التنبيهات</span><label class="nm-toggle-switch"><input type="checkbox" id="nm-alOn"><span class="nm-slider"></span></label></div>
              <div class="nm-opt"><span>صوت التنبيه</span><label class="nm-toggle-switch"><input type="checkbox" id="nm-alSound"><span class="nm-slider"></span></label></div>
              <div class="nm-opt"><span>نسبة الزيادة المفاجئة (%)</span><input type="number" id="nm-alGrow" class="nm-dark-input mini" min="5" max="100" step="1"></div>
              <div class="nm-opt"><span>نسبة النقصان المفاجئ (%)</span><input type="number" id="nm-alShrink" class="nm-dark-input mini" min="5" max="100" step="1"></div>
              <div class="nm-lines-toolbar"><button class="nm-chip-btn" id="nm-alTest">🔊 جرّب الصوت</button></div>
            </div>
            <div class="nm-card">
              <div class="nm-card-title">📹 تسجيل لقطات</div>
              <div class="nm-note">يسجّل شاشة اللعبة نفسها عندك (الكانفس) لملف فيديو .webm ينزل على جهازك أول ما توقف — زي برنامج تصوير شاشة بسيط، من غير أي برنامج خارجي.</div>
              <div class="nm-lines-toolbar">
                <button class="nm-chip-btn primary" id="nm-capBtn">⏺ ابدأ التسجيل</button>
              </div>
              <div class="nm-live" id="nm-capLive" style="display:none">بيسجّل... <b id="nm-capSec">0</b> ثانية</div>
            </div>
            <div class="nm-card">
              <div class="nm-card-title">💾 بروفايلات الإعدادات</div>
              <div class="nm-note">احفظ إعداداتك الحالية (الألوان، الفريمات، التنبيهات) تحت اسم، وبدّل بينهم في أي وقت.</div>
              <div class="nm-lines-toolbar">
                <input type="text" id="nm-profName" class="nm-dark-input" placeholder="اسم البروفايل" style="max-width:150px">
                <button class="nm-chip-btn primary" id="nm-profSaveBtn">💾 حفظ الحالي</button>
              </div>
              <div id="nm-profList" class="nm-macro-list"></div>
            </div>
          </div>`;
}

function nmColorsPaneHTML() {
    const row = (id, label) => `
              <div class="nm-color-row">
                <label class="nm-toggle-switch"><input type="checkbox" id="nm-${id}On"><span class="nm-slider"></span></label>
                <span class="nm-color-name">${label}</span>
                <input type="color" id="nm-${id}">
              </div>`;
    return `
          <div id="nm-tab-colors" class="nm-tab-pane" dir="rtl">
            <div class="nm-card">
              <div class="nm-card-title">🎨 ألوان اللعب</div>
              ${row("colBall", "لون الكرة اللي بلعب بيها")}
              <div class="nm-swatches" id="nm-ballSwatches" style="justify-content:center"></div>
              ${row("colName", "لون اسمي")}
              ${row("colText", "لون الكتابة (الكتلة) على كرتي")}
              <div class="nm-opt"><span>اسمي في اللعبة</span>
                <input type="text" id="nm-colMyName" class="nm-dark-input" style="max-width:190px" placeholder="زي ما بيظهر في اللعبة">
                <button class="nm-chip-btn" id="nm-grabName">التقاط</button></div>
              <div class="nm-opt"><span>لون الاسم يتطبق على كل اللاعبين</span>
                <label class="nm-toggle-switch"><input type="checkbox" id="nm-colAllNames"><span class="nm-slider"></span></label></div>
              <div class="nm-diag-line" id="nm-colDiag">...</div>
              <div class="nm-note">كرتك بتتعرف تلقائياً (الكرة اللي في نص الشاشة، وأي كرة بنفس لونها). لو اللعبة بترسم الأسماء مرة واحدة وتخزنها، اكتب اسمك في الخانة عشان يتلون. ملحوظة: الكشف شغال لو اللعبة بترسم بـ Canvas 2D بس.</div>
            </div>
          </div>`;
}

function nmInitV32UI() {
    try {
        try { nmWatchPanel(nmGetPanel()); } catch (_) { }
        const $ = (id) => document.getElementById(id);
        const bind = (id, ev, fn) => { const el = $(id); if (el) el["on" + ev] = fn; return el; };

        // ── Lines tab extras
        bind("nm-guidedSetup", "click", () => nmGuidedSetup());
        bind("nm-clearKeys", "click", () => { if (confirm("مسح كل المفاتيح (اللاينات + فك اللاينات + التخصيصات)؟")) nmClearAllKeys(); });
        bind("nm-releaseAllBtn", "click", () => nmReleaseAll());
        const rb = $("nmReleaseKeyBox"), rr = $("nmReleaseRec");
        if (rb) rb.textContent = nmReleaseKey !== "None" ? nmKeyLabel(nmReleaseKey) : "";
        if (rr) rr.onclick = () => {
            if (_recBoxId === "nmReleaseKeyBox") { _stopRec(); return; }
            _recOnComplete = (code) => {
                const o = { type: "release" };
                if (code !== "None") nmClaimKey(code, o);
                nmWriteOwnerKey(o, code);
                nmRefreshKeyUI();
            };
            _startRec("nmReleaseKeyBox", rr);
        };
        const dbl = $("nm-dblMs"); if (dbl) { dbl.value = NMCFG.dblMs; dbl.onchange = () => { NMCFG.dblMs = Math.min(1500, Math.max(200, parseInt(dbl.value, 10) || 700)); dbl.value = NMCFG.dblMs; S.set("nmDblMs", String(NMCFG.dblMs)); }; }
        const bom = $("nm-breakOnMove"), bpx = $("nm-breakPx"), bpr = $("nm-breakPxRow");
        const showBp = () => { if (bpr) bpr.style.display = NMCFG.breakOnMove ? "flex" : "none"; };
        if (bom) { bom.checked = NMCFG.breakOnMove; bom.onchange = () => { NMCFG.breakOnMove = bom.checked; S.set("nmBreakOnMove", String(bom.checked)); showBp(); }; }
        if (bpx) { bpx.value = NMCFG.breakPx; bpx.onchange = () => { NMCFG.breakPx = Math.min(2000, Math.max(50, parseInt(bpx.value, 10) || 300)); bpx.value = NMCFG.breakPx; S.set("nmBreakPx", String(NMCFG.breakPx)); }; }
        showBp();
        const dg = $("nm-diagToggle"); if (dg) { dg.checked = NMCFG.diag; dg.onchange = () => { NMCFG.diag = dg.checked; S.set("nmDiag", String(dg.checked)); nmDiagTick(); }; }

        // ── Performance tab
        if (NMFPS) {
            const mode = $("nm-fpsMode"), cap = $("nm-fpsCap"), bgOn = $("nm-fpsBgOn"), bg = $("nm-fpsBg"), show = $("nm-fpsShow");
            const sync = () => {
                if (mode) mode.value = NMFPS.cfg.mode;
                if (cap) cap.value = NMFPS.cfg.cap;
                if (bgOn) bgOn.checked = NMFPS.cfg.bgOn;
                if (bg) bg.value = NMFPS.cfg.bg;
                if (show) show.checked = NMFPS.cfg.show;
                const cr = $("nm-fpsCapRow"); if (cr) cr.style.display = NMFPS.cfg.mode === "custom" ? "flex" : "none";
                const br = $("nm-fpsBgRow"); if (br) br.style.display = NMFPS.cfg.bgOn ? "flex" : "none";
            };
            sync();
            if (mode) mode.onchange = () => { NMFPS.set("mode", mode.value); sync(); };
            if (cap) cap.onchange = () => { NMFPS.set("cap", cap.value); sync(); };
            if (bgOn) bgOn.onchange = () => { NMFPS.set("bgOn", bgOn.checked); sync(); };
            if (bg) bg.onchange = () => { NMFPS.set("bg", bg.value); sync(); };
            if (show) show.onchange = () => { NMFPS.set("show", show.checked); };
            setInterval(() => { const l = $("nm-fpsLive"); const p = $("nm-tab-perf"); if (l && p && p.classList.contains("active")) l.textContent = String(NMFPS.fps()); }, 500);
        }

        // ── Packet recorder tab
        if (typeof NMREC !== "undefined") {
            const on = $("nm-recOn"), hm = $("nm-recHideMouse");
            if (on) { on.checked = NMREC.st.on; on.onchange = () => NMREC.set("on", on.checked); }
            if (hm) { hm.checked = NMREC.st.hideMouse; hm.onchange = () => NMREC.set("hideMouse", hm.checked); }
            bind("nm-recClear", "click", () => { NMREC.clear(); const l = $("nm-recList"); if (l) l.textContent = ""; });
            bind("nm-recCopy", "click", () => {
                const txt = NMREC.text();
                const fallback = () => { const ta = document.createElement("textarea"); ta.value = txt; ta.style.cssText = "position:fixed;left:-9999px"; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch (_) { } ta.remove(); };
                try { navigator.clipboard.writeText(txt).catch(fallback); } catch (_) { fallback(); }
                nmToast(txt ? "اتنسخ " + NMREC.st.rows.length + " سطر" : "مفيش حاجة متسجلة لسه");
            });
            setInterval(() => {
                const p = $("nm-tab-rec"); if (!p || !p.classList.contains("active")) return;
                const l = $("nm-recList"), c = $("nm-recCount");
                if (c) c.textContent = String(NMREC.st.rows.length);
                if (l) l.textContent = NMREC.st.rows.slice(-40).reverse().map(r => "[" + (r.t / 1000).toFixed(1) + "s] len=" + r.len + (r.op >= 0 ? " op=" + r.op : "") + (r.n > 1 ? " x" + r.n : "") + (r.text ? "  «" + r.text + "»" : "") + "  " + r.hex).join("\n");
            }, 600);
        }

        // ── Colors tab
        if (NMCOL) {
            [["colBall", "ball"], ["colName", "name"], ["colText", "text"]].forEach(([id, key]) => {
                const on = $("nm-" + id + "On"), col = $("nm-" + id);
                if (on) { on.checked = NMCOL.cfg[key + "On"]; on.onchange = () => NMCOL.set(key + "On", on.checked); }
                if (col) { col.value = NMCOL.cfg[key]; col.oninput = () => NMCOL.set(key, col.value); }
            });
            const all = $("nm-colAllNames"); if (all) { all.checked = NMCOL.cfg.allNames; all.onchange = () => NMCOL.set("allNames", all.checked); }
            const nm = $("nm-colMyName"); if (nm) { nm.value = NMCOL.cfg.myName; nm.oninput = () => NMCOL.set("myName", nm.value); }
            bind("nm-grabName", "click", () => {
                try {
                    const cands = Array.from(document.querySelectorAll("input[type=text],input:not([type])")).filter(i => !i.closest("#controlPanel") && i.value && i.value.trim());
                    const pick = cands.find(i => /nick|name|اسم|لقب/i.test((i.id || "") + (i.name || "") + (i.placeholder || ""))) || cands[0];
                    if (pick && nm) { nm.value = pick.value.trim(); NMCOL.set("myName", nm.value); nmToast("اتلقط الاسم: " + nm.value); }
                    else nmToast("مش لاقي خانة اسم في اللعبة - اكتبه بإيدك");
                } catch (_) { }
            });
            const sw = $("nm-ballSwatches");
            if (sw && !sw.children.length) {
                ["#00e5ff", "#ff2d55", "#7CFF4F", "#ffd400", "#b36bff", "#ff8a00", "#ffffff", "#111111"].forEach(c => {
                    const b = document.createElement("button");
                    b.className = "nm-swatch"; b.style.background = c; b.title = c;
                    b.onclick = () => { const col = $("nm-colBall"); if (col) col.value = c; NMCOL.set("ball", c); NMCOL.set("ballOn", true); const on = $("nm-colBallOn"); if (on) on.checked = true; };
                    sw.appendChild(b);
                });
            }
            setInterval(() => {
                const el = $("nm-colDiag"), p = $("nm-tab-colors");
                if (!el || !p || !p.classList.contains("active")) return;
                const d = NMCOL.diag();
                const kinds = Object.keys(d.kinds).map(k => k + "×" + d.kinds[k]).join(" ") || "لسه";
                const gl = Object.keys(d.kinds).some(k => /webgl/i.test(k));
                el.innerHTML = "نوع الرسم: <b>" + kinds + "</b>" + (gl ? " (WebGL: التلوين مش هيشتغل عليه)" : "") +
                    " | دوائر/ث: <b>" + d.arcsPerSec + "</b> | نصوص/ث: <b>" + d.textsPerSec + "</b> | كرتي: <b>" + (d.found ? "اتلقت ✔" : "لسه ✖") + "</b>";
            }, 500);
        }
        // ── Advanced tools tab: macros / alerts / profiles
        if (typeof NMMACRO !== "undefined") {
            const recBtn = $("nm-macroRecBtn"), nameInp = $("nm-macroName"), live = $("nm-macroRecLive"), liveName = $("nm-macroRecName"), liveCount = $("nm-macroRecCount");
            function renderMacros() {
                const box = $("nm-macroList"); if (!box) return;
                const items = NMMACRO.all();
                box.innerHTML = items.length ? "" : '<div class="nm-empty-state" style="padding:10px">لسه مفيش ماكروهات محفوظة</div>';
                items.forEach((m, i) => {
                    const row = document.createElement("div");
                    row.className = "nm-macro-row";
                    row.innerHTML = `<span class="nm-macro-name">${m.name} <small>(${m.steps.length} ضغطة)</small></span>
                        <button class="nm-chip-btn mini" data-act="play">▶</button>
                        <div class="nm-key-box mini" data-act="key">${m.key !== "None" ? nmKeyLabel(m.key) : "بدون"}</div>
                        <button class="nm-chip-btn mini" data-act="del">🗑</button>`;
                    row.querySelector('[data-act="play"]').onclick = () => NMMACRO.play(i);
                    row.querySelector('[data-act="del"]').onclick = () => { if (confirm("مسح الماكرو ده؟")) { NMMACRO.removeAt(i); renderMacros(); } };
                    const kb = row.querySelector('[data-act="key"]');
                    kb.onclick = () => {
                        if (_recBoxId === kb) { _stopRec(); return; }
                        _recOnComplete = (code) => { NMMACRO.setKeyFor(i, code); renderMacros(); };
                        _startRec(kb, kb);
                    };
                    box.appendChild(row);
                });
            }
            if (recBtn) recBtn.onclick = () => {
                if (NMMACRO.isRecording()) {
                    NMMACRO.stopRecord();
                    if (live) live.style.display = "none";
                    recBtn.textContent = "⏺ تسجيل";
                    renderMacros();
                } else {
                    NMMACRO.startRecord(nameInp ? nameInp.value : "");
                    if (live) live.style.display = "flex";
                    if (liveName) liveName.textContent = NMMACRO.recName();
                    recBtn.textContent = "⏹ إيقاف";
                }
            };
            setInterval(() => { if (liveCount && NMMACRO.isRecording()) liveCount.textContent = String(NMMACRO.recLen()); }, 300);
            renderMacros();
        }
        if (typeof NMCAP !== "undefined") {
            const capBtn = $("nm-capBtn"), capLive = $("nm-capLive"), capSec = $("nm-capSec");
            if (capBtn) capBtn.onclick = () => {
                if (NMCAP.isRecording()) {
                    NMCAP.stop();
                    capBtn.textContent = "⏺ ابدأ التسجيل";
                    if (capLive) capLive.style.display = "none";
                    nmToast("اتسجّل اللقطة ونزلت");
                } else {
                    if (NMCAP.start()) {
                        capBtn.textContent = "⏹ إيقاف وحفظ";
                        if (capLive) capLive.style.display = "flex";
                    } else nmToast("مش لاقي شاشة اللعبة أسجّلها");
                }
            };
            setInterval(() => { if (capSec && NMCAP.isRecording()) capSec.textContent = String(NMCAP.seconds()); }, 500);
        }
        if (typeof NMALERT !== "undefined") {
            const on = $("nm-alOn"), snd = $("nm-alSound"), grow = $("nm-alGrow"), shrink = $("nm-alShrink");
            if (on) { on.checked = NMALERT.cfg.on; on.onchange = () => NMALERT.set("on", on.checked); }
            if (snd) { snd.checked = NMALERT.cfg.sound; snd.onchange = () => NMALERT.set("sound", snd.checked); }
            if (grow) { grow.value = NMALERT.cfg.growPct; grow.onchange = () => NMALERT.set("growPct", Math.max(5, Math.min(100, parseInt(grow.value, 10) || 18))); }
            if (shrink) { shrink.value = NMALERT.cfg.shrinkPct; shrink.onchange = () => NMALERT.set("shrinkPct", Math.max(5, Math.min(100, parseInt(shrink.value, 10) || 22))); }
            bind("nm-alTest", "click", () => NMALERT.testSound());
        }
        if (typeof NMPROFILES !== "undefined") {
            const profInp = $("nm-profName");
            function renderProfiles() {
                const box = $("nm-profList"); if (!box) return;
                const names = NMPROFILES.names();
                box.innerHTML = names.length ? "" : '<div class="nm-empty-state" style="padding:10px">لسه مفيش بروفايلات محفوظة</div>';
                names.forEach(name => {
                    const row = document.createElement("div");
                    row.className = "nm-macro-row";
                    row.innerHTML = `<span class="nm-macro-name">${name}</span>
                        <button class="nm-chip-btn mini" data-act="load">تحميل</button>
                        <button class="nm-chip-btn mini" data-act="del">🗑</button>`;
                    row.querySelector('[data-act="load"]').onclick = () => { if (NMPROFILES.load(name)) nmToast("اتحمّل بروفايل: " + name); };
                    row.querySelector('[data-act="del"]').onclick = () => { if (confirm("مسح البروفايل ده؟")) { NMPROFILES.remove(name); renderProfiles(); } };
                    box.appendChild(row);
                });
            }
            bind("nm-profSaveBtn", "click", () => {
                const name = profInp ? profInp.value : "";
                if (!name || !name.trim()) { nmToast("اكتب اسم للبروفايل الأول"); return; }
                NMPROFILES.saveAs(name);
                if (profInp) profInp.value = "";
                renderProfiles();
                nmToast("اتحفظ البروفايل");
            });
            renderProfiles();
        }
        try { nmRefreshPageLabels(); } catch (_) { }
    } catch (_) { }
}

function nmExportExtra() {
    const keys = ["nmReleaseKey", "nmDblMs", "nmBreakOnMove", "nmBreakPx", "fpsMode", "fpsCap", "fpsBgOn", "fpsBg", "fpsShow", "colBallOn", "colBall", "colNameOn", "colName", "colTextOn", "colText", "colAllNames", "colMyName", "skipResults", "alOn", "alGrowPct", "alShrinkPct", "alSound"];
    const o = {};
    keys.forEach(k => { const v = S.get(k, null); if (v !== null) o[k] = v; });
    return o;
}
function nmImportExtra(o) {
    if (!o || typeof o !== "object") return;
    Object.keys(o).forEach(k => { S.set(k, String(o[k])); });
    try { nmReleaseKey = S.get("nmReleaseKey", "None") || "None"; } catch (_) { }
    try { NMCFG.dblMs = parseInt(S.get("nmDblMs", "700"), 10) || 700; NMCFG.breakOnMove = S.get("nmBreakOnMove", "false") === "true"; NMCFG.breakPx = parseInt(S.get("nmBreakPx", "300"), 10) || 300; } catch (_) { }
    try { if (NMFPS) { NMFPS.set("mode", S.get("fpsMode", "unlimited")); NMFPS.set("cap", S.get("fpsCap", "240")); NMFPS.set("bgOn", S.get("fpsBgOn", "true") !== "false"); NMFPS.set("bg", S.get("fpsBg", "60")); NMFPS.set("show", S.get("fpsShow", "false") === "true"); } } catch (_) { }
    try { if (NMCOL) { NMCOL.set("ballOn", S.get("colBallOn", "false") === "true"); NMCOL.set("ball", S.get("colBall", "#00e5ff")); NMCOL.set("nameOn", S.get("colNameOn", "false") === "true"); NMCOL.set("name", S.get("colName", "#ffe600")); NMCOL.set("textOn", S.get("colTextOn", "false") === "true"); NMCOL.set("text", S.get("colText", "#ffffff")); NMCOL.set("allNames", S.get("colAllNames", "false") === "true"); NMCOL.set("myName", S.get("colMyName", "")); } } catch (_) { }
    try { nmDedupeKeys(); nmInitV32UI(); } catch (_) { }
}

function setupFocusSignalListener() {
    try {
        window.addEventListener('storage', nativeify((ev) => {
            try {
                if (ev.key !== SIGNAL_KEY) return;
                const o = ev.newValue ? JSON.parse(ev.newValue) : null;
                if (o && typeof o === 'object' && o.to === myId) {
                    freezeMouseTemporarily(500);
                    try { window.focus(); } catch (_) { }
                }
            } catch (_) { }
        }, 'storageSignal'));
    } catch (_) { }
}
function nextSeq() {
    try {
        const e = 1 + (S.get(SEQ_KEY, 0) | 0);
        S.set(SEQ_KEY, e);
        return e;
    } catch (_) { return 0; }
}
window.freezeMouseTracking = window.freezeMouseTracking || false;
let freezeTimeout = null;
function freezeMouseTemporarily(e = 1500) {
    try {
        window.freezeMouseTracking = true;
        if (freezeTimeout) { try { clearTimeout(freezeTimeout); } catch (_) { } }
        try { document.body.style.pointerEvents = "none"; } catch (_) { }
        freezeTimeout = setTimeout(nativeify(() => {
            try {
                window.freezeMouseTracking = false;
                document.body.style.pointerEvents = "";
            } catch (_) { }
        }), e);
    } catch (_) { }
}
const blockMouseDuringFreeze = nativeify(function blockMouseDuringFreeze(e) {
    try {
        if (window.freezeMouseTracking) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
        }
    } catch (_) { }
}, 'blockMouseDuringFreeze');
try { document.addEventListener("mousemove", blockMouseDuringFreeze, true); } catch (_) { }
try { document.addEventListener("mouseenter", blockMouseDuringFreeze, true); } catch (_) { }
try { document.addEventListener("mouseover", blockMouseDuringFreeze, true); } catch (_) { }
try { document.addEventListener("mouseout", blockMouseDuringFreeze, true); } catch (_) { }
try { document.addEventListener("mouseleave", blockMouseDuringFreeze, true); } catch (_) { }
const originalAddEventListener = document.addEventListener;
function signalPeer(e) {
    try {
        if (!e) return;
        const t = nextSeq();
        S.set(SIGNAL_KEY, JSON.stringify({ to: e, from: myId, seq: t, ts: Date.now() }));
    } catch (_) { }
}
function getPair() {
    try {
        const raw = S.get(PAIR_KEY, null);
        if (!raw) return null;
        const e = typeof raw === 'object' ? raw : JSON.parse(raw);
        return (e && typeof e === 'object') ? e : null;
    } catch (_) { return null; }
}
function hasActivePair() {
    try {
        const e = getPair();
        return !!e && !!e.token && (e.a === myId || e.b === myId);
    } catch (_) { return false; }
}
function getPeerId() {
    try {
        const e = getPair();
        if (e) {
            if (e.a === myId) { return e.b || null; }
            else { return e.b === myId && e.a || null; }
        }
        return null;
    } catch (_) { return null; }
}
function maybeClaimPairFromHash() {
    try {
        const e = String(location.hash || "").match(/(?:^|[#&?])paired=([a-z0-9]+)/i);
        if (!e) return;
        const t = e[1];
        let o = getPair();
        if (o && o.token === t) {
            if (!o.b || o.b === myId) {
                if (o.a !== myId) {
                    o = { ...o, b: myId };
                    S.set(PAIR_KEY, JSON.stringify(o));
                }
            }
        }
    } catch (_) { }
}
document.addEventListener = nativeify(function addEventListener(e, t, o) {
    try {
        if (!window.freezeMouseTracking || e !== "mousemove" && e !== "mouseenter" && e !== "mouseover") {
            return originalAddEventListener.call(this, e, t, o);
        }
    } catch (_) { }
}, 'addEventListener');
window.focusPeer = nativeify(function focusPeer() {
    try {
        const e = getPair();
        if (!e || !e.token) return;
        freezeMouseTemporarily(2000);
        if (openedTabHandle && !openedTabHandle.closed) {
            try { openedTabHandle.focus(); return; } catch (_) { }
        }
        const t = getPeerId();
        if (t) signalPeer(t);
    } catch (_) { }
}, 'focusPeer');
window.openPairedTab = nativeify(function openPairedTab(e) {
    try {
        if (!myId) return;
        const t = Math.random().toString(36).slice(2);
        const o = e || location.origin + "/";
        const n = o + (o.includes("#") ? "&" : "#") + "paired=" + t + "&nmpage=" + nmOtherPage();
        S.set(PAIR_KEY, JSON.stringify({ a: myId, b: null, url: o, token: t, createdAt: Date.now() }));
        try {
            openedTabHandle = window.open(n, '_blank');
            if (openedTabHandle) { try { openedTabHandle.focus(); } catch (_) { } }
        } catch (_) { }
    } catch (_) { }
}, 'openPairedTab');
const MIG_KEYS = ["customizations", "textColor", "buttonColor", "backgroundColor", "panelBackgroundImage", "buttonBackgroundImage", "buttonShape", "buttonSize", "oppositeHashName", "controlButtonPosition", "movementLeftEnabled", "movementLeftKey", "movementLeftPage", "movementRightEnabled", "movementRightKey", "movementRightPage", "movementUpEnabled", "movementUpKey", "movementUpPage", "movementDownEnabled", "movementDownKey", "movementDownPage", "movementTopLeftEnabled", "movementTopLeftKey", "movementTopLeftPage", "movementTopRightEnabled", "movementTopRightKey", "movementTopRightPage", "movementBottomLeftEnabled", "movementBottomLeftKey", "movementBottomLeftPage", "movementBottomRightEnabled", "movementBottomRightKey", "movementBottomRightPage", "normalBottomLeftEnabled", "normalBottomLeftKey", "normalBottomLeftPage", "normalMiddleBottomEnabled", "normalMiddleBottomKey", "normalMiddleBottomPage", "normalBottomRightEnabled", "normalBottomRightKey", "normalBottomRightPage", "normalLeftEnabled", "normalLeftKey", "normalLeftPage", "normalCenterEnabled", "normalCenterKey", "normalCenterPage", "normalRightEnabled", "normalRightKey", "normalRightPage", "normalTopLeftEnabled", "normalTopLeftKey", "normalTopLeftPage", "normalTopEnabled", "normalTopKey", "normalTopPage", "normalTopRightEnabled", "normalTopRightKey", "normalTopRightPage", "normalTopcEnabled", "normalTopcKey", "normalTopcPage", "timerEnabled", "timerColorMode", "timerFixedColor"];
// Migration: copy any keys from old GM storage to localStorage (now no-op since both use localStorage)
// Left as comment for backward compat
let settingsChannel = new BroadcastChannel("settings_channel");
let actionChannel = new BroadcastChannel("action_channel");
let customizations = [];
let canvasElement = null;
let activeCustomizations = {};
let intervals = {};
let panelBackgroundImage = null;
let buttonBackgroundImage = null;
let buttonShape = "rectangle";
let buttonSize = "medium";
let oppositeHashName = "dream-land";
let movementLeftEnabled = false;
let movementLeftKey = "None";
let movementLeftPage = "current";
let movementRightEnabled = false;
let movementRightKey = "None";
let movementRightPage = "current";
let movementUpEnabled = false;
let movementUpKey = "None";
let movementUpPage = "current";
let movementDownEnabled = false;
let movementDownKey = "None";
let movementDownPage = "current";
let movementTopLeftEnabled = false;
let movementTopLeftKey = "None";
let movementTopLeftPage = "current";
let movementTopRightEnabled = false;
let movementTopRightKey = "None";
let movementTopRightPage = "current";
let movementBottomLeftEnabled = false;
let movementBottomLeftKey = "None";
let movementBottomLeftPage = "current";
let movementBottomRightEnabled = false;
let movementBottomRightKey = "None";
let movementBottomRightPage = "current";
let normalBottomLeftEnabled = false;
let normalBottomLeftKey = "None";
let normalBottomLeftPage = "current";
let normalMiddleBottomEnabled = false;
let normalMiddleBottomKey = "None";
let normalMiddleBottomPage = "current";
let normalBottomRightEnabled = false;
let normalBottomRightKey = "None";
let normalBottomRightPage = "current";
let normalLeftEnabled = false;
let normalLeftKey = "None";
let normalLeftPage = "current";
let normalCenterEnabled = false;
let normalCenterKey = "None";
let normalCenterPage = "current";
let normalRightEnabled = false;
let normalRightKey = "None";
let normalRightPage = "current";
let normalTopLeftEnabled = false;
let normalTopLeftKey = "None";
let normalTopLeftPage = "current";
let normalTopEnabled = false;
let normalTopKey = "None";
let normalTopPage = "current";
let normalTopRightEnabled = false;
let normalTopRightKey = "None";
let normalTopRightPage = "current";
let normalTopcEnabled = false;
let normalTopcKey = "None";
let normalTopcPage = "current";
let timerEnabled = false;
let timerColorMode = "random";
let timerFixedColor = "#FFFFFF";
let gmOppositeTabHandle = null;
let hookingSuccess = false;
// WS is auto-updated in document.cachedWS by the game
function getLastWS() {
    try {
        // Try both casings — game may set either
        const ws = document.cachedWS || document.cachedWs
            || window.gfokhokgkhgfdfghfghfghghfokhfgdokhfgokh
            || window.ghfdh4hg5hgfghhghghfghghffdg
            || null;
        return ws;
    } catch (_) { return null; }
}
function startWSMonitoring() { /* no-op: WS is auto-updated on document */ }
function updateHIndicatorColor() {
    try {
        const e = document.getElementById("HIndicator");
        if (!e) return;
        const t = getLastWS();
        hookingSuccess = t && t.readyState === WebSocket.OPEN;
        if (hookingSuccess) { e.classList.add("connected"); }
        else { e.classList.remove("connected"); }
    } catch (_) { }
}

// Continuous movement packet injection for perfectly stable lines
nmTicker(nativeify(() => {
    try {
        if (!window.activeMovementLock && !window.activeNormalLock) return;
        const c = nmLockCoords();
        if (c) sendMovePacket(c.x, c.y);
        try { nmPhysPing(c); } catch (_) { }
    } catch (_) { }
}, 'movementLoop'), 20);
const knownWsMessages = [{
    label: "None (لا شيء)",
    value: "None"
}, {
    label: "انقسام البوت",
    value: "0x16"
}, {
    label: "فيد البوت",
    value: "0x17"
}, {
    label: "فيد عادي",
    value: "0x15"
}, {
    label: "فيد سريع",
    value: "0x1a"
}, {
    label: "سبيس (Space)",
    value: "0x11"
}, {
    label: "split 4",
    value: "0x1b"
}, {
    label: "split 16",
    value: "0x1c"
}, {
    label: "split 32",
    value: "0x1d"
}, {
    label: "split 64",
    value: "0x1e"
}];
const UINT8_CACHE = {
    1: new Uint8Array([1]),
    17: new Uint8Array([17]),
    21: new Uint8Array([21]),
    18: new Uint8Array([18]),
    19: new Uint8Array([19]),
    22: new Uint8Array([22]),
    23: new Uint8Array([23]),
    24: new Uint8Array([24]),
    25: new Uint8Array([25]),
    26: new Uint8Array([26]),
    27: new Uint8Array([27]),
    28: new Uint8Array([28]),
    29: new Uint8Array([29]),
    30: new Uint8Array([30]),
    254: new Uint8Array([254])
};
function sendGamePacket(e) {
    try {
        const t = getLastWS();
        if (!t) {
            return false;
        }
        try { updateHIndicatorColor(); } catch (_) { }
        let o = typeof e == "string" ? e.startsWith("0x") || e.startsWith("0X") ? parseInt(e, 16) : parseInt(e, 10) : Number(e);
        if (!Number.isFinite(o) || o < 0 || o > 255) {
            return false;
        }
        const n = new Uint8Array([o & 255]);
        const a = n.buffer.slice(n.byteOffset, n.byteOffset + n.byteLength);
        if (t.readyState === WebSocket.OPEN) {
            try {
                t.send(a);
                return true;
            } catch (e) {
                return false;
            }
        }
        if (t.readyState === WebSocket.CONNECTING) {
            const e = () => {
                try {
                    t.send(a);
                } catch (e) { } finally {
                    try {
                        t.removeEventListener("open", e);
                    } catch (e) { }
                }
            };
            try {
                t.addEventListener("open", e);
            } catch (e) { }
            return true;
        }
        return false;
    } catch (_) { return false; }
}

// ── pkt_move: opcode 16 move packet — matches Python's pkt_move(x, y) ──
// Packet: [0x10, x(i32le), y(i32le), 0x00000000] = 9 bytes
function pkt_move(x, y) {
    try {
        // Matches Python: struct.pack("<B ii I", 16, x, y, 0) = 13 bytes
        // B=opcode(1) + i=x(4) + i=y(4) + I=padding(4) = 13
        const buf = new ArrayBuffer(13);
        const view = new DataView(buf);
        view.setUint8(0, 16);           // opcode 16 = 0x10
        view.setInt32(1, x, true);      // x as signed int32 little-endian
        view.setInt32(5, y, true);      // y as signed int32 little-endian
        view.setUint32(9, 0, true);     // 4-byte zero padding (the "I" in "<B ii I")
        return buf;
    } catch (_) { return null; }
}
function sendMovePacket(x, y) {
    try {
        const ws = getLastWS();
        if (!ws || ws.readyState !== WebSocket.OPEN) return false;
        const pkt = pkt_move(x, y);
        if (!pkt) return false;
        // mark our own packet so the physics engine never mistakes it for a
        // measurement of the game's own mapping (it would feed itself back)
        window.__nmOwnMove = true;
        try { ws.send(pkt); } finally { window.__nmOwnMove = false; }
        return true;
    } catch (_) { return false; }
}
let settingsChannelLocal = settingsChannel;
let actionChannelLocal = actionChannel;
function executeReceivedActions(e) {
    try {
        let t = 0;
        (function o() {
            try {
                if (!(t >= e.length)) {
                    try { sendBinaryMessage(e[t].message); } catch (_) { }
                    t++;
                    setTimeout(nativeify(o, 'recvActions'), 50);
                }
            } catch (_) { }
        })();
    } catch (_) { }
}
function sendBinaryMessage(e) {
    try {
        if (e !== "None") { sendGamePacket(e); }
    } catch (_) { }
}

// ── Load images from IndexedDB after UI is ready ─────────────────────────
function _loadStoredImages() {
    try {
        ImageStore.get("buttonBackgroundImage").then(img => {
            try {
                if (!img) return;
                buttonBackgroundImage = img;
                const circle = document.getElementById("nm-floating-circle");
                if (circle) circle.style.backgroundImage = `url(${img})`;
            } catch (_) { }
        }).catch(() => { });
        ImageStore.get("panelBackgroundImage").then(img => {
            try {
                if (!img) return;
                panelBackgroundImage = img;
                const panel = document.getElementById("controlPanel");
                if (panel) {
                    panel.style.backgroundImage = `linear-gradient(rgba(26,26,36,0.85),rgba(15,15,19,0.95)),url(${img})`;
                    panel.style.backgroundSize = "cover";
                    panel.style.backgroundPosition = "center";
                }
            } catch (_) { }
        }).catch(() => { });
    } catch (_) { }
}
function init() {
    try {
        if (window.__nmInited) return true;
        if (!document.body) return false;
        window.__nmInited = true;
        const run = (name, fn) => { try { fn(); } catch (e) { try { console.error("[Nightmare] خطأ في: " + name, e); } catch (_) { } } };
        run("loadStoredCustomizations", loadStoredCustomizations);
        run("loadAllStyle", loadAllStyle);
        run("createControlPanel", createControlPanel);
        run("createControlButton", createControlButton);
        run("nmInitV32UI", nmInitV32UI);
        run("NMAUTH.applyPermissionUI", () => NMAUTH.applyPermissionUI());
        run("applyStoredCustomizations", applyStoredCustomizations);
        run("addEventListeners", addEventListeners);
        run("loadStoredImages", _loadStoredImages);
        run("observeCanvas", observeCanvas);
        run("observeChatMessages", observeChatMessages);
        run("hIndicator", () => setInterval(nativeify(updateHIndicatorColor, 'hIndicator'), 1000));
        setTimeout(nmDedupeKeys, 800);
        try { console.log("[Nightmare] جاهز - صفحة " + myPage); } catch (_) { }
        return true;
    } catch (e) {
        try { console.error("[Nightmare] init failed", e); } catch (_) { }
        return false;
    }
}
function initWithRetry(e = 20, t = 1) {
    try {
        if (!init() && !(t >= e)) {
            setTimeout(nativeify(() => {
                try { initWithRetry(e, t + 1); } catch (_) { }
            }, 'initRetry'), 1000);
        }
    } catch (_) { }
}
function observeCanvas() {
    try {
        const e = new MutationObserver(nativeify(() => {
            try {
                const t = document.querySelector("canvas");
                if (t) { canvasElement = t; try { e.disconnect(); } catch (_) { } }
            } catch (_) { }
        }));
        try { e.observe(document.body, { childList: true, subtree: true }); } catch (_) { }
    } catch (_) { }
}
function loadStoredCustomizations() {
    try {
        let e = S.get("customizations", null);
        if (e) {
            try { customizations = JSON.parse(e); } catch (_) { }
        }
        let t = S.get("textColor", null);
        if (t) {
            document.documentElement.style.setProperty("--text-color", t);
        }
        let o = S.get("buttonColor", null);
        if (o) {
            document.documentElement.style.setProperty("--button-color", o);
        }
        let n = S.get("backgroundColor", null);
        if (n) {
            document.documentElement.style.setProperty("--background-color", n);
        }
        // Images are stored in IndexedDB (no size limit) - load them async after DOM is ready
        // panelBackgroundImage and buttonBackgroundImage will be populated by _loadStoredImages()
        let i = S.get("buttonShape", null);
        if (i) {
            buttonShape = i;
        }
        let m = S.get("buttonSize", null);
        if (m) {
            buttonSize = m;
        }
        let r = S.get("oppositeHashName", null);
        if (r) {
            oppositeHashName = r;
        }
        let d = S.get("movementLeftEnabled", null);
        if (d) {
            movementLeftEnabled = d === "true";
        }
        let s = S.get("movementLeftKey", null);
        if (s) {
            movementLeftKey = s;
        }
        let c = S.get("movementLeftPage", null);
        if (c) {
            movementLeftPage = c;
        }
        let g = S.get("movementRightEnabled", null);
        if (g) {
            movementRightEnabled = g === "true";
        }
        let u = S.get("movementRightKey", null);
        if (u) {
            movementRightKey = u;
        }
        let p = S.get("movementRightPage", null);
        if (p) {
            movementRightPage = p;
        }
        let b = S.get("movementUpEnabled", null);
        if (b) {
            movementUpEnabled = b === "true";
        }
        let h = S.get("movementUpKey", null);
        if (h) {
            movementUpKey = h;
        }
        let y = S.get("movementUpPage", null);
        if (y) {
            movementUpPage = y;
        }
        let f = S.get("movementDownEnabled", null);
        if (f) {
            movementDownEnabled = f === "true";
        }
        let v = S.get("movementDownKey", null);
        if (v) {
            movementDownKey = v;
        }
        let E = S.get("movementDownPage", null);
        if (E) {
            movementDownPage = E;
        }
        let L = S.get("movementTopLeftEnabled", null);
        if (L) {
            movementTopLeftEnabled = L === "true";
        }
        let k = S.get("movementTopLeftKey", null);
        if (k) {
            movementTopLeftKey = k;
        }
        let B = S.get("movementTopLeftPage", null);
        if (B) {
            movementTopLeftPage = B;
        }
        let T = S.get("movementTopRightEnabled", null);
        if (T) {
            movementTopRightEnabled = T === "true";
        }
        let R = S.get("movementTopRightKey", null);
        if (R) {
            movementTopRightKey = R;
        }
        let P = S.get("movementTopRightPage", null);
        if (P) {
            movementTopRightPage = P;
        }
        let K = S.get("movementBottomLeftEnabled", null);
        if (K) {
            movementBottomLeftEnabled = K === "true";
        }
        let C = S.get("movementBottomLeftKey", null);
        if (C) {
            movementBottomLeftKey = C;
        }
        let x = S.get("movementBottomLeftPage", null);
        if (x) {
            movementBottomLeftPage = x;
        }
        let w = S.get("movementBottomRightEnabled", null);
        if (w) {
            movementBottomRightEnabled = w === "true";
        }
        let I = S.get("movementBottomRightKey", null);
        if (I) {
            movementBottomRightKey = I;
        }
        let M = S.get("movementBottomRightPage", null);
        if (M) {
            movementBottomRightPage = M;
        }
        let _ = S.get("normalBottomLeftEnabled", null);
        if (_) {
            normalBottomLeftEnabled = _ === "true";
        }
        let D = S.get("normalBottomLeftKey", null);
        if (D) {
            normalBottomLeftKey = D;
        }
        let z = S.get("normalBottomLeftPage", null);
        if (z) {
            normalBottomLeftPage = z;
        }
        let N = S.get("normalMiddleBottomEnabled", null);
        if (N) {
            normalMiddleBottomEnabled = N === "true";
        }
        let F = S.get("normalMiddleBottomKey", null);
        if (F) {
            normalMiddleBottomKey = F;
        }
        let U = S.get("normalMiddleBottomPage", null);
        if (U) {
            normalMiddleBottomPage = U;
        }
        let A = S.get("normalBottomRightEnabled", null);
        if (A) {
            normalBottomRightEnabled = A === "true";
        }
        let $ = S.get("normalBottomRightKey", null);
        if ($) {
            normalBottomRightKey = $;
        }
        let H = S.get("normalBottomRightPage", null);
        if (H) {
            normalBottomRightPage = H;
        }
        let W = S.get("normalLeftEnabled", null);
        if (W) {
            normalLeftEnabled = W === "true";
        }
        let O = S.get("normalLeftKey", null);
        if (O) {
            normalLeftKey = O;
        }
        let q = S.get("normalLeftPage", null);
        if (q) {
            normalLeftPage = q;
        }
        let j = S.get("normalCenterEnabled", null);
        if (j) {
            normalCenterEnabled = j === "true";
        }
        let Y = S.get("normalCenterKey", null);
        if (Y) {
            normalCenterKey = Y;
        }
        let G = S.get("normalCenterPage", null);
        if (G) {
            normalCenterPage = G;
        }
        let J = S.get("normalRightEnabled", null);
        if (J) {
            normalRightEnabled = J === "true";
        }
        let X = S.get("normalRightKey", null);
        if (X) {
            normalRightKey = X;
        }
        let V = S.get("normalRightPage", null);
        if (V) {
            normalRightPage = V;
        }
        let Q = S.get("normalTopLeftEnabled", null);
        if (Q) {
            normalTopLeftEnabled = Q === "true";
        }
        let Z = S.get("normalTopLeftKey", null);
        if (Z) {
            normalTopLeftKey = Z;
        }
        let ee = S.get("normalTopLeftPage", null);
        if (ee) {
            normalTopLeftPage = ee;
        }
        let te = S.get("normalTopEnabled", null);
        if (te) {
            normalTopEnabled = te === "true";
        }
        let oe = S.get("normalTopKey", null);
        if (oe) {
            normalTopKey = oe;
        }
        let ne = S.get("normalTopPage", null);
        if (ne) {
            normalTopPage = ne;
        }
        let ae = S.get("normalTopRightEnabled", null);
        if (ae) {
            normalTopRightEnabled = ae === "true";
        }
        let le = S.get("normalTopRightKey", null);
        if (le) {
            normalTopRightKey = le;
        }
        let ie = S.get("normalTopRightPage", null);
        if (ie) {
            normalTopRightPage = ie;
        }
        let me = S.get("normalTopcEnabled", null);
        if (me) {
            normalTopcEnabled = me === "true";
        }
        let re = S.get("normalTopcKey", null);
        if (re) {
            normalTopcKey = re;
        }
        let de = S.get("normalTopcPage", null);
        if (de) {
            normalTopcPage = de;
        }
        let se = S.get("timerEnabled", null);
        if (se) {
            timerEnabled = se === "true";
        }
        let ce = S.get("timerColorMode", null);
        if (ce) {
            timerColorMode = ce;
        }
        let ge = S.get("timerFixedColor", null);
        if (ge) {
            timerFixedColor = ge;
        }
    } catch (_) { }
}
function _buildLinesRows(directions, idPrefix, labelFn) {
    return directions.map(dir => {
        return `
          <div class="nm-line-row">
            <div class="nm-line-name">${labelFn(dir)}</div>
            <span class="nm-line-state nm-st-off" data-dir="${dir}" data-st="off">—</span>
            <label class="nm-toggle-switch"><input type="checkbox" id="${idPrefix}${dir}Enabled"><span class="nm-slider"></span></label>
            <select class="nm-mini-select" id="${idPrefix}${dir}PageSelect">
              <option value="current">الحالية</option><option value="opposite">المعاكسة</option><option value="both">كلاهما</option>
            </select>
            <button class="nm-btn-rec" data-boxid="${idPrefix}${dir}KeyBox">REC</button>
            <div class="nm-key-box" id="${idPrefix}${dir}KeyBox"></div>
          </div>`;
    }).join("");
}

function createControlPanel() {
    try {
        const panel = document.createElement("div");
        panel.id = "controlPanel";
        panel.className = "nm-menu-container";
        panel.setAttribute("dir", "rtl");

        const movDirs = ["Right", "Left", "Up", "Down", "TopLeft", "TopRight", "BottomLeft", "BottomRight"];

        panel.innerHTML = `
      <button class="nm-close-btn" id="nm-closePanelBtn" title="إغلاق">&times;</button>
      <button class="nm-special-top-btn" id="nm-openOppositePage" title="فتح الصفحة الثانية">فتح الصفحة الأخرى</button>

      <div class="nm-menu-header">
        <div class="nm-brand-row">
          <span class="nm-brand-mark">N</span>
          <h2>إضافة <span>الصفحتين</span></h2>
        </div>
        <div class="nm-header-meta">
          <span class="nm-page-chip">أنت في صفحة <b id="nm-page-chip-num">1</b></span>
          <span class="nm-ver-chip">الإصدار <b id="nm-ver-chip-num">4.0.0</b></span>
          <button class="nm-update-chip" id="nm-update-chip" hidden>⬆ تحديث متاح</button>
        </div>
        <div class="nm-menu-sub">لاينات بفيزياء اللعبة · تثبيت لحظي · تحكم كامل في الصفحتين</div>
      </div>

      <div class="nm-menu-body">
        <div class="nm-side-nav">
          <button class="nm-tab-btn active" data-tab="nm-tab-settings" title="الإعدادات">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="1.9" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            <em>الإعدادات</em>
          </button>
          <button class="nm-tab-btn" data-tab="nm-tab-customizations" title="تخصيصات">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="1.9" fill="none" stroke-linecap="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>
            <em>تخصيصات</em>
          </button>
          <button class="nm-tab-btn" data-tab="nm-tab-lines" title="اللاينات والزوايا">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="1.9" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>
            <em>اللاينات</em>
          </button>
          <button class="nm-tab-btn" data-tab="nm-tab-perf" title="الأداء والفريمات">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="1.9" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
            <em>الأداء</em>
          </button>
          <button class="nm-tab-btn" data-tab="nm-tab-colors" title="الألوان">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="1.9" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="1.5"/><circle cx="17.5" cy="10.5" r="1.5"/><circle cx="8.5" cy="7.5" r="1.5"/><circle cx="6.5" cy="12.5" r="1.5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.5-.7 1.5-1.5 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.8.7-1.5 1.5-1.5H16c3 0 6-2.5 6-5.5C22 6 17.5 2 12 2z"/></svg>
            <em>الألوان</em>
          </button>
          <button class="nm-tab-btn" data-tab="nm-tab-rec" title="مسجّل الحزم">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="1.9" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5" fill="currentColor"/></svg>
            <em>الحزم</em>
          </button>
          <button class="nm-tab-btn" data-tab="nm-tab-adv" title="أدوات متقدمة">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="1.9" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/></svg>
            <em>متقدم</em>
          </button>
        </div>

        <div class="nm-tab-content-container">

          <div id="nm-update-banner" role="status">
            <span class="nm-ub-text" id="nm-ub-text">يوجد تحديث جديد للأداة</span>
            <button id="nm-ub-go">تحديث</button>
            <button class="nm-ub-close" id="nm-ub-close" title="لاحقًا">×</button>
          </div>

          <!-- Settings Tab -->
          <div id="nm-tab-settings" class="nm-tab-pane active">
            <div class="nm-section-title">التحكم العام<span class="nm-spacer"></span></div>
            <div class="nm-tile-grid">
              <div class="nm-tile"><span>تشغيل كل أوامر الأداة</span>
                <label class="nm-toggle-switch"><input type="checkbox" id="multi-toggle"><span class="nm-slider"></span></label></div>
              <div class="nm-tile"><span>تخطي شاشة الاستمرار</span>
                <label class="nm-toggle-switch"><input type="checkbox" id="nm-skipResults"><span class="nm-slider"></span></label></div>
            </div>

            <div class="nm-section-title">التايمر<span class="nm-spacer"></span></div>
            <div class="nm-tile-grid">
              <div class="nm-tile"><span>تفعيل التايمر</span>
                <label class="nm-toggle-switch"><input type="checkbox" id="timerEnabled"><span class="nm-slider"></span></label></div>
              <div class="nm-tile" id="timerSettingsContainer" style="display:none">
                <span>لون العداد</span>
                <div class="nm-tile-controls">
                  <select id="timerColorMode" class="nm-mini-select" style="width:96px">
                    <option value="random">عشوائي</option>
                    <option value="fixed">ثابت</option>
                  </select>
                  <input type="color" id="timerFixedColor" value="#FFFFFF" style="display:none;width:32px;height:30px;border:1px solid var(--nm-line-strong);border-radius:8px;padding:0;background:none;cursor:pointer">
                </div>
              </div>
            </div>

            <div class="nm-section-title">المظهر والألوان<span class="nm-spacer"></span></div>
            <div class="nm-card">
              <div class="nm-color-row" style="flex-wrap:wrap;gap:10px">
                <span class="nm-color-name" style="flex:0 0 auto">ألوان الواجهة</span>
                <div class="nm-color-pickers-group">
                  <div class="nm-color-wrapper" title="لون خلفية القائمة"><input type="color" id="nm-color-menu-bg" value="#0b1220"></div>
                  <div class="nm-color-wrapper" title="لون الظل"><input type="color" id="nm-color-menu-shadow" value="#3ddcbf"></div>
                  <div class="nm-color-wrapper" title="لون الدائرة العائمة"><input type="color" id="nm-color-circle-bg" value="#3ddcbf"></div>
                  <div class="nm-color-wrapper" title="اللون الأساسي (كل التدرجات)"><input type="color" id="nm-color-primary" value="#3ddcbf"></div>
                  <div class="nm-color-wrapper" title="لون النص الأساسي"><input type="color" id="nm-color-text-light" value="#eaf2ff"></div>
                  <div class="nm-color-wrapper" title="لون النص الثانوي"><input type="color" id="nm-color-text-dim" value="#93a7c6"></div>
                  <div class="nm-color-wrapper" title="لون زر الصفحة الأخرى"><input type="color" id="nm-color-special-btn" value="#eaf6ff"></div>
                </div>
              </div>
              <div class="nm-note">اللون الرابع (الأساسي) بيتغيّر معاه كل التدرجات والحدود في الأداة.</div>
            </div>
            <div class="nm-upload-group">
              <label class="nm-upload-label"><input type="file" id="nm-buttonBackgroundImage" accept="image/*"><span>▣ خلفية الدائرة</span></label>
              <label class="nm-upload-label"><input type="file" id="nm-panelBackgroundImage" accept="image/*"><span>▣ خلفية الإضافة</span></label>
            </div>

            <div class="nm-section-title">النسخ الاحتياطي<span class="nm-spacer"></span></div>
            <div class="nm-action-buttons-row">
              <button class="nm-btn-main" id="nm-exportSettingsBtn">📤 تصدير الإعدادات</button>
              <button class="nm-btn-main" id="nm-importSettingsBtn">📥 استيراد الإعدادات</button>
              <input type="file" id="nm-importSettingsFile" accept=".json" style="display:none">
            </div>
          </div>

          <!-- Customizations Tab -->
          <div id="nm-tab-customizations" class="nm-tab-pane">
            <div class="nm-tab-header" dir="rtl">
              <div class="nm-section-title" style="margin:0">تخصيصات جاهزة</div>
              <button class="nm-chip-btn primary" id="nm-createCustomization">＋ إنشاء تخصيص جديد</button>
            </div>
            <div class="nm-customizations-list" id="customizationsContainer" dir="rtl"></div>
            <div class="nm-empty-state" id="nm-cust-empty-state">لا يوجد تخصيصات — اضغط «إنشاء تخصيص جديد»</div>
          </div>

          <!-- Lines Tab -->
          <div id="nm-tab-lines" class="nm-tab-pane" dir="rtl">
            <div class="nm-lines-hint">
              <span>ضغطة = لاين قوي</span>
              <span class="pin">ضغطتين سريعين = 📌 تثبيت</span>
              <span>ضغطة تانية = إيقاف</span>
            </div>

            <div class="nm-lines-toolbar">
              <button class="nm-chip-btn primary" id="nm-guidedSetup">⚡ ضبط سريع للمفاتيح</button>
              <button class="nm-chip-btn" id="nm-clearKeys">🧹 مسح كل المفاتيح</button>
              <button class="nm-chip-btn danger" id="nm-releaseAllBtn">⛔ فك كل اللاينات</button>
            </div>

            <div class="nm-card">
              <div class="nm-card-title"><span class="nm-ico">🧭</span>محرك اللاينات — قراءة فيزياء اللعبة</div>
              <div class="nm-phys-grid">
                <div class="nm-dial-wrap">
                  <canvas id="nm-angle-dial" width="132" height="132"></canvas>
                  <div class="nm-dial-center"><b id="nm-dial-deg">0°</b><small>الاتجاه الحالي</small></div>
                </div>
                <div class="nm-phys-stats">
                  <div class="nm-stat-row"><span>المعايرة</span><b id="nm-phys-ok" class="warn">في انتظار الحركة…</b></div>
                  <div class="nm-stat-row"><span>مقياس الشاشة ← الحزمة</span><b id="nm-phys-scale">—</b></div>
                  <div class="nm-stat-row"><span>موقع الكرة</span><b id="nm-phys-cell">—</b></div>
                  <div class="nm-stat-row"><span>تصحيح الزاوية</span><b id="nm-phys-corr">0.0°</b></div>
                  <div class="nm-stat-row"><span>نوع الإحداثيات</span><b id="nm-phys-src">—</b></div>
                  <div class="nm-phys-actions">
                    <button class="nm-chip-btn primary mini" id="nm-phys-cal">🎯 معايرة الآن</button>
                    <button class="nm-chip-btn mini" id="nm-phys-reset">↺ تصفير التصحيح</button>
                    <button class="nm-chip-btn mini" id="nm-phys-diag">📊 تشخيص</button>
                  </div>
                </div>
              </div>
              <div class="nm-tile-grid" style="margin-top:2px">
                <div class="nm-tile"><span>فيزياء اللعبة (مستحسن)</span>
                  <label class="nm-toggle-switch"><input type="checkbox" id="nm-phys-use"><span class="nm-slider"></span></label></div>
                <div class="nm-tile"><span>تصحيح تلقائي للزاوية</span>
                  <label class="nm-toggle-switch"><input type="checkbox" id="nm-phys-autocorr"><span class="nm-slider"></span></label></div>
                <div class="nm-tile" style="grid-column:1/-1"><span>مدى التصويب</span>
                  <select id="nm-phys-range" class="nm-mini-select" style="width:120px">
                    <option value="near">قريب</option>
                    <option value="mid">متوسط</option>
                    <option value="far">بعيد</option>
                  </select>
                </div>
              </div>
              <div class="nm-note">المحرك بيقرأ تحويل اللعبة الحقيقي (كاميرا + زووم) ويصوّب جوه حدود الخريطة — عشان الزاوية تطلع 45° بالظبط ومتبقاش أعوج عند الحواف أو بعد الانقسام.</div>
            </div>

            <details class="nm-fold" id="nm-angles-fold">
              <summary>📐 زوايا اللاينات — تعديل يدوي (متقدم)</summary>
              <div class="nm-fold-body">
                <div class="nm-angle-grid" id="nm-angle-grid"></div>
                <div class="nm-lines-toolbar" style="justify-content:flex-start">
                  <button class="nm-chip-btn mini" id="nm-angles-reset">↺ استعادة الافتراضي</button>
                  <button class="nm-chip-btn mini" id="nm-angles-cardinal">📌 تقريب لأقرب 45°</button>
                </div>
                <div class="nm-note">0° = فوق · 90° = يمين · 180° = تحت · 270° = يسار — وتُطبق على اللاين والتثبيت مع بعض.</div>
              </div>
            </details>

            <div class="nm-lines-container">
              <div class="nm-lines-column">
                <div class="nm-lines-title"><span>اللاينات الثمانية</span><span id="nm-lines-page-label">صفحة</span></div>
                ${_buildLinesRows(movDirs, "movement", getDirectionLabel)}
                <div class="nm-line-row nm-release-row">
                  <div class="nm-line-name">فك كل اللاينات</div>
                  <span class="nm-line-extra">طوارئ</span>
                  <button class="nm-btn-rec" id="nmReleaseRec">REC</button>
                  <div class="nm-key-box" id="nmReleaseKeyBox"></div>
                </div>
                <div class="nm-opts">
                  <div class="nm-opt"><span>مهلة الضغطتين (ملّي ثانية)</span><input type="number" id="nm-dblMs" class="nm-dark-input mini" min="200" max="1500" step="50"></div>
                  <div class="nm-opt"><span>فك اللاين العادي بحركة الماوس</span><label class="nm-toggle-switch"><input type="checkbox" id="nm-breakOnMove"><span class="nm-slider"></span></label></div>
                  <div class="nm-opt" id="nm-breakPxRow"><span>مسافة الفك (بكسل)</span><input type="number" id="nm-breakPx" class="nm-dark-input mini" min="50" max="2000" step="50"></div>
                  <div class="nm-opt"><span>وضع التشخيص (شريط تحت)</span><label class="nm-toggle-switch"><input type="checkbox" id="nm-diagToggle"><span class="nm-slider"></span></label></div>
                </div>
              </div>
            </div>
          </div>

          <!-- Performance Tab -->
          ${nmPerfPaneHTML()}

          <!-- Colors Tab -->
          ${nmColorsPaneHTML()}

          <!-- Recorder Tab -->
          ${nmRecPaneHTML()}

          <!-- Advanced Tools Tab -->
          ${nmAdvPaneHTML()}

          <!-- Customization Modal (inside content container) -->
          <div id="nm-customization-modal" class="nm-modal" dir="rtl">
            <div class="nm-modal-header"><h3 id="nm-modal-title">إنشاء تخصيص جديد</h3></div>
            <div class="nm-modal-body">
              <div class="nm-modal-row">
                <span class="nm-row-label">إسم التخصيص</span>
                <input type="text" id="nm-customizationName" class="nm-dark-input" placeholder="أدخل الإسم...">
              </div>
              <div class="nm-modal-row">
                <span class="nm-row-label">زر التشغيل</span>
                <div class="nm-controls-group">
                  <button class="nm-btn-rec" id="nm-shortcutRecBtn" style="width:auto;padding:0 12px">REC</button>
                  <div class="nm-key-box" id="nm-customizationShortcutBox" style="width:64px"></div>
                  <input type="hidden" id="nm-customizationShortcut" value="None">
                </div>
              </div>
              <div class="nm-modal-row">
                <span class="nm-row-label">حالة التنفيذ</span>
                <div class="nm-segment-control">
                  <div class="nm-segment-item"><input type="radio" id="nm-exec-once" name="nm-cust-exec" value="once" checked><label for="nm-exec-once">مرة واحدة</label></div>
                  <div class="nm-segment-item"><input type="radio" id="nm-exec-cont" name="nm-cust-exec" value="continuous"><label for="nm-exec-cont">مستمر</label></div>
                </div>
                <div class="nm-timer-mini-group" id="nm-continuousIntervalContainer" style="display:none">
                  <input type="number" id="nm-continuousInterval" class="nm-dark-input mini" value="50" min="10">
                  <span class="nm-ms-text">ملّي ثانية</span>
                </div>
              </div>
              <div class="nm-modal-row">
                <button class="nm-chip-btn primary" id="nm-addAction">＋ إضافة إجراء</button>
              </div>
              <div class="nm-actions-list" id="nm-actionsContainer"></div>
            </div>
            <div class="nm-modal-footer">
              <button class="nm-btn-icon nm-danger-icon" id="nm-cancelCustomization" title="إلغاء">❌</button>
              <button class="nm-chip-btn primary" id="nm-saveCustomization">إنشاء</button>
            </div>
          </div>

        </div>
      </div>

      <div class="nm-footer-rights">
        حقوق الإضافة لسيرفر Nightmare · <span style="letter-spacing:.4px">NMAG</span> · By <span class="nm-credit-name">Anas Sherif</span>
      </div>
      <div class="nm-status-container" dir="rtl">
        <span class="nm-status-text">التحكم</span>
        <div class="nm-status-dot" id="HIndicator"></div>
      </div>
    `;

        document.body.appendChild(panel);


        // Tab switching
        panel.querySelectorAll(".nm-tab-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                panel.querySelectorAll(".nm-tab-btn").forEach(b => b.classList.remove("active"));
                panel.querySelectorAll(".nm-tab-pane").forEach(p => p.classList.remove("active"));
                btn.classList.add("active");
                const tabId = btn.getAttribute("data-tab");
                if (tabId) panel.querySelector("#" + tabId).classList.add("active");
            });
        });

        panel.querySelector("#nm-closePanelBtn").onclick = () => {
            panel.classList.remove("show");
        };
        panel.querySelector("#nm-openOppositePage").onclick = () => {
            nmOpenOtherPage();
        };

        updateCustomizationsUI();
        addControlPanelListeners();
        updateHIndicatorColor();
        nmBindPageUI();
        try { nmInitV4UI(); } catch (_) { }
        try { nmStartPhysTick(); } catch (_) { }

        if (panelBackgroundImage) {
            panel.style.backgroundImage = `linear-gradient(rgba(26,26,36,0.85),rgba(15,15,19,0.95)),url(${panelBackgroundImage})`;
            panel.style.backgroundSize = "cover";
            panel.style.backgroundPosition = "center";
        }
    } catch (_) { }
}
// ── REC key binding helpers ───────────────────────────────────────────────
let _recBoxId = null, _recBtn = null;
const _keyDisplayToCode = {
    'TAB': 'Tab', 'A': 'KeyA', 'B': 'KeyB', 'C': 'KeyC', 'D': 'KeyD', 'E': 'KeyE', 'F': 'KeyF',
    'G': 'KeyG', 'H': 'KeyH', 'I': 'KeyI', 'J': 'KeyJ', 'K': 'KeyK', 'L': 'KeyL', 'M': 'KeyM',
    'N': 'KeyN', 'O': 'KeyO', 'P': 'KeyP', 'Q': 'KeyQ', 'R': 'KeyR', 'S': 'KeyS', 'T': 'KeyT',
    'U': 'KeyU', 'V': 'KeyV', 'W': 'KeyW', 'X': 'KeyX', 'Y': 'KeyY', 'Z': 'KeyZ',
    '0': 'Digit0', '1': 'Digit1', '2': 'Digit2', '3': 'Digit3', '4': 'Digit4',
    '5': 'Digit5', '6': 'Digit6', '7': 'Digit7', '8': 'Digit8', '9': 'Digit9',
    'NUM0': 'Numpad0', 'NUM1': 'Numpad1', 'NUM2': 'Numpad2', 'NUM3': 'Numpad3',
    'NUM4': 'Numpad4', 'NUM5': 'Numpad5', 'NUM6': 'Numpad6', 'NUM7': 'Numpad7',
    'NUM8': 'Numpad8', 'NUM9': 'Numpad9',
    'NUM+': 'NumpadAdd', 'NUM-': 'NumpadSubtract', 'NUM*': 'NumpadMultiply',
    'NUM/': 'NumpadDivide', 'NUM.': 'NumpadDecimal', 'NUM↵': 'NumpadEnter',
    'SPC': 'Space', 'ENT': 'Enter', 'SHF': 'ShiftLeft', 'CTL': 'ControlLeft',
    'ALT': 'AltLeft', 'LFT': 'ArrowLeft', 'UP': 'ArrowUp', 'RGT': 'ArrowRight',
    'DWN': 'ArrowDown', '`': 'Backquote'
};
const _codeToDisplay = Object.fromEntries(Object.entries(_keyDisplayToCode).map(([d, c]) => [c, d]));
function _keyEventToDisplay(ev) {
    try {
        const c = ev.code;
        if (_codeToDisplay[c]) return _codeToDisplay[c];
        if (c.startsWith('Key')) return c.slice(3);
        if (c.startsWith('Digit')) return c.slice(5);
        if (c.startsWith('Numpad')) return 'NUM' + c.slice(6);
        if (c === 'Space') return 'SPC';
        if (c === 'Enter') return 'ENT';
        if (c === 'ShiftLeft' || c === 'ShiftRight') return 'SHF';
        if (c === 'ControlLeft' || c === 'ControlRight') return 'CTL';
        if (c === 'AltLeft' || c === 'AltRight') return 'ALT';
        if (c === 'ArrowLeft') return 'LFT';
        if (c === 'ArrowRight') return 'RGT';
        if (c === 'ArrowUp') return 'UP';
        if (c === 'ArrowDown') return 'DWN';
        if (c === 'Tab') return 'TAB';
        if (c === 'Backquote') return '`';
        if (c === 'Escape') return 'ESC';
        return c.length > 5 ? c.substring(0, 4) : c;
    } catch (_) { }
}
function _displayToCode(disp) {
    try { return _keyDisplayToCode[disp.toUpperCase()] || disp; } catch (_) { return disp; }
}
function _startRec(boxId, btn) {
    try {
        _stopRec();
        _recBoxId = boxId; _recBtn = btn;
        const box = document.getElementById(boxId);
        if (box) { box.classList.add('recording'); box.textContent = '...'; }
        btn.classList.add('recording'); btn.textContent = '...';
        document.addEventListener('keydown', _recHandler, true);
    } catch (_) { }
}
function _stopRec() {
    try {
        if (_recBoxId) {
            const box = document.getElementById(_recBoxId);
            if (box) { box.classList.remove('recording'); if (box.textContent === '...') box.textContent = ''; }
        }
        if (_recBtn) { _recBtn.classList.remove('recording'); _recBtn.textContent = 'REC'; }
        _recBoxId = null; _recBtn = null;
        document.removeEventListener('keydown', _recHandler, true);
    } catch (_) { }
}
let _recOnComplete = null;
const _recHandler = nativeify(function _recHandler(ev) {
    try {
        ev.preventDefault(); ev.stopPropagation();
        let disp = _keyEventToDisplay(ev);
        let code = _displayToCode(disp);
        if (ev.code === "Escape" || ev.code === "Backspace" || ev.code === "Delete") { disp = ""; code = "None"; }
        const box = document.getElementById(_recBoxId);
        if (box) box.textContent = disp;
        const cb = _recOnComplete;
        _recOnComplete = null;
        _stopRec();
        if (cb) cb(code);
    } catch (_) { }
}, '_recHandler');
// ── multi-toggle (enable/disable all game logic) ──────────────────────────
// Default true if never set — convert stored string "true"/"false" or use default true
let multiEnabled = (function () {
    const stored = S.get('multiEnabled', null);
    if (stored === null) return true;  // first run: enabled by default
    return boolFrom(stored);
})();
function _applyMultiEnabled(val) {
    try {
        multiEnabled = val;
        S.set('multiEnabled', val.toString());
        settingsChannel.postMessage({ type: 'update_multi_enabled', data: val });
    } catch (_) { }
}
function addControlPanelListeners() {
    try {
        // ── Customizations button
        const createBtn = document.getElementById("nm-createCustomization");
        if (createBtn) createBtn.onclick = () => createNewCustomization();

        // ── Export / Import
        const exportBtn = document.getElementById("nm-exportSettingsBtn");
        const importBtn = document.getElementById("nm-importSettingsBtn");
        const importFile = document.getElementById("nm-importSettingsFile");
        if (exportBtn) exportBtn.addEventListener("click", () => exportAllSettings());
        if (importBtn && importFile) {
            importBtn.addEventListener("click", () => importFile.click());
            importFile.addEventListener("change", ev => {
                const f = ev.target.files[0];
                if (f) {
                    const r = new FileReader();
                    r.onload = e => createWarningModal(() => importSettings(e.target.result), () => { });
                    r.readAsText(f);
                }
                ev.target.value = "";
            });
        }

        // ── Timer toggle
        const timerToggle = document.getElementById("timerEnabled");
        const timerSettingsBox = document.getElementById("timerSettingsContainer");
        const timerColorMode = document.getElementById("timerColorMode");
        const timerFixedColor = document.getElementById("timerFixedColor");
        if (timerToggle) {
            const stored = S.get("timerEnabled", "false") === "true";
            timerToggle.checked = stored;
            if (timerSettingsBox) timerSettingsBox.style.display = stored ? "inline-flex" : "none";
            timerToggle.addEventListener("change", () => {
                const v = timerToggle.checked;
                S.set("timerEnabled", v.toString());
                if (timerSettingsBox) timerSettingsBox.style.display = v ? "inline-flex" : "none";
            });
        }
        if (timerColorMode) {
            const stored = S.get("timerColorMode", "random");
            timerColorMode.value = stored;
            if (timerFixedColor) timerFixedColor.style.display = stored === "fixed" ? "inline-block" : "none";
            timerColorMode.addEventListener("change", () => {
                const v = timerColorMode.value;
                S.set("timerColorMode", v);
                if (timerFixedColor) timerFixedColor.style.display = v === "fixed" ? "inline-block" : "none";
            });
        }
        if (timerFixedColor) {
            timerFixedColor.value = S.get("timerFixedColor", "#FFFFFF");
            timerFixedColor.addEventListener("input", () => S.set("timerFixedColor", timerFixedColor.value));
        }

        // ── Skip results screen toggle
        const skipToggle = document.getElementById("nm-skipResults");
        if (skipToggle) {
            skipToggle.checked = nmSkipEnabled();
            skipToggle.addEventListener("change", () => nmSetSkip(skipToggle.checked));
        }

        // ── Multi toggle (enable/disable ALL logic)
        const multiToggle = document.getElementById("multi-toggle");
        if (multiToggle) {
            multiToggle.checked = multiEnabled;
            multiToggle.addEventListener("change", () => _applyMultiEnabled(multiToggle.checked));
        }

        // ── 7 Color pickers
        function _wireColorPicker(id, action) {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener("input", () => action(el.value));
        }
        const panel = document.getElementById("controlPanel");
        const circle = document.getElementById("nm-floating-circle");
        _wireColorPicker("nm-color-menu-bg", v => {
            if (panel) { panel.style.backgroundColor = v; panel.style.backgroundImage = "none"; }
            S.set("nmColorMenuBg", v);
            settingsChannel.postMessage({ type: "update_nm_color", key: "nmColorMenuBg", val: v });
        });
        _wireColorPicker("nm-color-menu-shadow", v => {
            if (panel) {
                const [r, g, b] = [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)];
                panel.style.boxShadow = `0 15px 35px rgba(0,0,0,0.6), 0 0 20px rgba(${r},${g},${b},0.25)`;
                panel.style.border = `1px solid rgba(${r},${g},${b},0.15)`;
                panel.style.borderTop = `1px solid rgba(${r},${g},${b},0.3)`;
            }
            S.set("nmColorMenuShadow", v);
            settingsChannel.postMessage({ type: "update_nm_color", key: "nmColorMenuShadow", val: v });
        });
        _wireColorPicker("nm-color-circle-bg", v => {
            if (circle) { circle.style.backgroundColor = v; circle.style.backgroundImage = "none"; }
            S.set("nmColorCircleBg", v);
            settingsChannel.postMessage({ type: "update_nm_color", key: "nmColorCircleBg", val: v });
        });
        _wireColorPicker("nm-color-primary", v => {
            document.documentElement.style.setProperty("--primary-red", v);
            // Derive --primary-rgb, --hover-red (lighter), --primary-dark (darker) from chosen color
            const r = parseInt(v.slice(1, 3), 16), g = parseInt(v.slice(3, 5), 16), b = parseInt(v.slice(5, 7), 16);
            document.documentElement.style.setProperty("--primary-rgb", `${r},${g},${b}`);
            // Lighter hover: blend toward white by 20%
            const hr = Math.min(255, Math.round(r + (255 - r) * 0.2));
            const hg = Math.min(255, Math.round(g + (255 - g) * 0.2));
            const hb = Math.min(255, Math.round(b + (255 - b) * 0.2));
            document.documentElement.style.setProperty("--hover-red", `rgb(${hr},${hg},${hb})`);
            // Darker shade: multiply by 0.65
            const dr = Math.round(r * 0.65), dg = Math.round(g * 0.65), db = Math.round(b * 0.65);
            document.documentElement.style.setProperty("--primary-dark", `rgb(${dr},${dg},${db})`);
            S.set("nmColorPrimary", v);
            settingsChannel.postMessage({ type: "update_nm_color", key: "nmColorPrimary", val: v });
        });
        _wireColorPicker("nm-color-text-light", v => {
            document.documentElement.style.setProperty("--text-light", v);
            S.set("nmColorTextLight", v);
            settingsChannel.postMessage({ type: "update_nm_color", key: "nmColorTextLight", val: v });
        });
        _wireColorPicker("nm-color-text-dim", v => {
            document.documentElement.style.setProperty("--text-dim", v);
            S.set("nmColorTextDim", v);
            settingsChannel.postMessage({ type: "update_nm_color", key: "nmColorTextDim", val: v });
        });
        _wireColorPicker("nm-color-special-btn", v => {
            document.documentElement.style.setProperty("--special-btn-bg", v);
            S.set("nmColorSpecialBtn", v);
            settingsChannel.postMessage({ type: "update_nm_color", key: "nmColorSpecialBtn", val: v });
        });

        // ── Image uploads
        const circleImgInput = document.getElementById("nm-buttonBackgroundImage");
        if (circleImgInput) {
            circleImgInput.addEventListener("change", function () {
                const f = this.files[0]; if (!f) return;
                const r = new FileReader();
                r.onload = e => {
                    buttonBackgroundImage = e.target.result;
                    ImageStore.set("buttonBackgroundImage", buttonBackgroundImage);
                    if (circle) { circle.style.backgroundImage = `url(${buttonBackgroundImage})`; }
                    settingsChannel.postMessage({ type: "update_button_background", data: buttonBackgroundImage });
                };
                r.readAsDataURL(f);
            });
        }
        const panelImgInput = document.getElementById("nm-panelBackgroundImage");
        if (panelImgInput) {
            panelImgInput.addEventListener("change", function () {
                const f = this.files[0]; if (!f) return;
                const r = new FileReader();
                r.onload = e => {
                    panelBackgroundImage = e.target.result;
                    ImageStore.set("panelBackgroundImage", panelBackgroundImage);
                    if (panel) {
                        panel.style.backgroundImage = `linear-gradient(rgba(26,26,36,0.85),rgba(15,15,19,0.95)),url(${panelBackgroundImage})`;
                        panel.style.backgroundSize = "cover";
                        panel.style.backgroundPosition = "center";
                    }
                    settingsChannel.postMessage({ type: "update_panel_background", data: panelBackgroundImage });
                };
                r.readAsDataURL(f);
            });
        }

        // ── Lines tab: REC binding + toggle + page select for movement dirs only
        ["Right", "Left", "Up", "Down", "TopLeft", "TopRight", "BottomLeft", "BottomRight"].forEach(dir => {
            _setupLineRowUI("movement", dir);
        });

        // ── New customization modal wiring (use onclick = assignment so re-runs are idempotent)
        const _execOnce = document.getElementById("nm-exec-once");
        const _execCont = document.getElementById("nm-exec-cont");
        const _intBox = document.getElementById("nm-continuousIntervalContainer");
        if (_execOnce) _execOnce.onchange = () => { if (_intBox) _intBox.style.display = "none"; };
        if (_execCont) _execCont.onchange = () => { if (_intBox) _intBox.style.display = "flex"; };

        const shortcutRecBtn = document.getElementById("nm-shortcutRecBtn");
        if (shortcutRecBtn) {
            shortcutRecBtn.onclick = () => {
                if (_recBoxId === "nm-customizationShortcutBox") { _stopRec(); return; }
                _startRec("nm-customizationShortcutBox", shortcutRecBtn);
            };
        }
        const addActionBtn = document.getElementById("nm-addAction");
        if (addActionBtn) addActionBtn.onclick = () => _addNewActionRow();
        const saveBtn = document.getElementById("nm-saveCustomization");
        if (saveBtn) saveBtn.onclick = () => _saveNewCustomization();
        const cancelBtn = document.getElementById("nm-cancelCustomization");
        if (cancelBtn) cancelBtn.onclick = () => _closeCustomizationModal();
    } catch (_) { }
}

// ── Line row wiring (REC-based) ───────────────────────────────────────────
// Lookup table that maps varBase → getter/setter functions using the actual module-scope lets.
// This avoids eval() which cannot write outer let bindings in strict mode.
const _lineVarMap = {
    movementRight: {
        get: () => movementRightEnabled, set: v => { movementRightEnabled = v; },
        getKey: () => movementRightKey, setKey: v => { movementRightKey = v; },
        getPage: () => movementRightPage, setPage: v => { movementRightPage = v; }
    },
    movementLeft: {
        get: () => movementLeftEnabled, set: v => { movementLeftEnabled = v; },
        getKey: () => movementLeftKey, setKey: v => { movementLeftKey = v; },
        getPage: () => movementLeftPage, setPage: v => { movementLeftPage = v; }
    },
    movementUp: {
        get: () => movementUpEnabled, set: v => { movementUpEnabled = v; },
        getKey: () => movementUpKey, setKey: v => { movementUpKey = v; },
        getPage: () => movementUpPage, setPage: v => { movementUpPage = v; }
    },
    movementDown: {
        get: () => movementDownEnabled, set: v => { movementDownEnabled = v; },
        getKey: () => movementDownKey, setKey: v => { movementDownKey = v; },
        getPage: () => movementDownPage, setPage: v => { movementDownPage = v; }
    },
    movementTopLeft: {
        get: () => movementTopLeftEnabled, set: v => { movementTopLeftEnabled = v; },
        getKey: () => movementTopLeftKey, setKey: v => { movementTopLeftKey = v; },
        getPage: () => movementTopLeftPage, setPage: v => { movementTopLeftPage = v; }
    },
    movementTopRight: {
        get: () => movementTopRightEnabled, set: v => { movementTopRightEnabled = v; },
        getKey: () => movementTopRightKey, setKey: v => { movementTopRightKey = v; },
        getPage: () => movementTopRightPage, setPage: v => { movementTopRightPage = v; }
    },
    movementBottomLeft: {
        get: () => movementBottomLeftEnabled, set: v => { movementBottomLeftEnabled = v; },
        getKey: () => movementBottomLeftKey, setKey: v => { movementBottomLeftKey = v; },
        getPage: () => movementBottomLeftPage, setPage: v => { movementBottomLeftPage = v; }
    },
    movementBottomRight: {
        get: () => movementBottomRightEnabled, set: v => { movementBottomRightEnabled = v; },
        getKey: () => movementBottomRightKey, setKey: v => { movementBottomRightKey = v; },
        getPage: () => movementBottomRightPage, setPage: v => { movementBottomRightPage = v; }
    },
};

function _setupLineRowUI(prefix, dir) {
    try {
        const dirCap = dir.charAt(0).toUpperCase() + dir.slice(1);
        const varBase = prefix + dirCap;
        const entry = _lineVarMap[varBase];
        if (!entry) return;

        const enabledId = `${prefix}${dirCap}Enabled`;
        const pageId = `${prefix}${dirCap}PageSelect`;
        const boxId = `${prefix}${dirCap}KeyBox`;

        const toggle = document.getElementById(enabledId);
        const pageSel = document.getElementById(pageId);
        const keyBox = document.getElementById(boxId);
        const recBtn = keyBox ? keyBox.previousElementSibling : null;

        function setEnabled(v) {
            entry.set(v);
            S.set(varBase + "Enabled", v.toString());
            settingsChannel.postMessage({ type: "update_movement_settings", data: getAllDirections() });
        }
        function setKey(v) {
            nmSetLineKey(varBase, v || "None");
            if (toggle) toggle.checked = entry.get();
        }
        function setPage(v) {
            entry.setPage(v);
            S.set(varBase + "Page", v);
            settingsChannel.postMessage({ type: "update_movement_settings", data: getAllDirections() });
        }

        // Restore saved state to UI
        if (toggle) toggle.checked = entry.get();
        if (pageSel) pageSel.value = entry.getPage();
        if (keyBox) {
            const k = entry.getKey();
            keyBox.textContent = (k && k !== "None") ? (_codeToDisplay[k] || k) : "";
        }

        // Idempotent wiring via .onchange / .onclick
        if (toggle) toggle.onchange = () => setEnabled(toggle.checked);
        if (pageSel) pageSel.onchange = () => setPage(pageSel.value);
        if (recBtn && keyBox) {
            recBtn.onclick = () => {
                if (_recBoxId === boxId) { _stopRec(); return; }
                _recOnComplete = (code) => setKey(code);
                _startRec(boxId, recBtn);
            };
        }
    } catch (_) { }
}

// ── New customization modal ───────────────────────────────────────────────
let _editingCustomizationIndex = null;
function _openCustomizationModal(existing = null, idx = null) {
    try {
        _editingCustomizationIndex = idx;
        const modal = document.getElementById("nm-customization-modal");
        if (!modal) return;
        const titleEl = document.getElementById("nm-modal-title");
        const nameEl = document.getElementById("nm-customizationName");
        const shortEl = document.getElementById("nm-customizationShortcut");
        const boxEl = document.getElementById("nm-customizationShortcutBox");
        const onceRad = document.getElementById("nm-exec-once");
        const contRad = document.getElementById("nm-exec-cont");
        const intBox = document.getElementById("nm-continuousIntervalContainer");
        const intEl = document.getElementById("nm-continuousInterval");
        const saveBtn = document.getElementById("nm-saveCustomization");
        const actCont = document.getElementById("nm-actionsContainer");

        if (titleEl) titleEl.textContent = existing ? "تعديل التخصيص" : "إنشاء تخصيص جديد";
        if (saveBtn) saveBtn.textContent = existing ? "حفظ التعديلات" : "إنشاء";
        if (nameEl) nameEl.value = existing ? existing.name : "";
        const storedCode = existing ? existing.shortcut : "None";
        if (shortEl) shortEl.value = storedCode;
        if (boxEl) boxEl.textContent = (storedCode && storedCode !== "None") ? (_codeToDisplay[storedCode] || storedCode) : "";
        const isCont = existing && existing.executionMode === "continuous";
        if (onceRad) onceRad.checked = !isCont;
        if (contRad) contRad.checked = isCont;
        if (intBox) intBox.style.display = isCont ? "flex" : "none";
        if (intEl) intEl.value = existing ? (existing.continuousInterval || 50) : 50;
        if (actCont) actCont.innerHTML = "";
        if (existing && existing.actions) {
            existing.actions.forEach(a => _addNewActionRow(a));
        }
        _stopRec();
        modal.classList.add("show");
    } catch (_) { }
}
function _closeCustomizationModal() {
    try {
        const modal = document.getElementById("nm-customization-modal");
        if (modal) modal.classList.remove("show");
        _editingCustomizationIndex = null;
        _stopRec();
    } catch (_) { }
}
function _addNewActionRow(existing = null) {
    try {
        const container = document.getElementById("nm-actionsContainer");
        if (!container) return;
        const row = document.createElement("div");
        row.className = "nm-action-row";
        const msgVal = existing ? existing.message : "None";
        const repVal = existing ? (existing.repeat || 1) : 1;
        const pageVal = existing ? existing.page : "current";
        row.innerHTML = `
      <select class="nm-dark-select nm-action-msg" style="flex:2;">
        ${knownWsMessages.map(m => `<option value="${m.value}" ${m.value === msgVal ? "selected" : ""}>${m.label}</option>`).join("")}
      </select>
      <span>×</span>
      <input type="number" class="nm-dark-input mini nm-action-repeat" value="${repVal}" min="1">
      <span>الصفحة</span>
      <select class="nm-dark-select nm-action-page" style="flex:1.2;">
        <option value="current"  ${pageVal === "current" ? "selected" : ""}>الحالية</option>
        <option value="opposite" ${pageVal === "opposite" ? "selected" : ""}>المعاكسة</option>
        <option value="both"     ${pageVal === "both" ? "selected" : ""}>كلاهما</option>
      </select>
      <button class="nm-btn-icon nm-danger-icon">❌</button>
    `;
        row.querySelector(".nm-btn-icon").addEventListener("click", () => row.remove());
        container.appendChild(row);
        nmRefreshPageLabels();
    } catch (_) { }
}
function _saveNewCustomization() {
    try {
        const nameEl = document.getElementById("nm-customizationName");
        const shortEl = document.getElementById("nm-customizationShortcut");
        const boxEl = document.getElementById("nm-customizationShortcutBox");
        const intEl = document.getElementById("nm-continuousInterval");
        const contRad = document.getElementById("nm-exec-cont");
        const actCont = document.getElementById("nm-actionsContainer");

        const name = nameEl ? nameEl.value.trim() : "";
        // get key code: if shortEl hidden input was set by rec, use that; else decode from box display
        const disp = boxEl ? boxEl.textContent.trim() : "";
        const shortcut = disp ? (_displayToCode(disp) || "None") : "None";
        const execMode = contRad && contRad.checked ? "continuous" : "once";
        const interval = parseInt(intEl ? intEl.value : "50") || 50;

        const actions = [];
        if (actCont) {
            actCont.querySelectorAll(".nm-action-row").forEach(row => {
                const msg = row.querySelector(".nm-action-msg") ? row.querySelector(".nm-action-msg").value : "None";
                const rep = row.querySelector(".nm-action-repeat") ? parseInt(row.querySelector(".nm-action-repeat").value) || 1 : 1;
                const page = row.querySelector(".nm-action-page") ? row.querySelector(".nm-action-page").value : "current";
                if (msg && msg !== "None") actions.push({ message: msg, repeat: rep, page });
            });
        }

        if (!name || actions.length === 0) {
            alert("يرجى تعبئة الاسم وإضافة إجراء واحد على الأقل.");
            return;
        }

        nmClaimKey(shortcut, { type: 'cust', idx: _editingCustomizationIndex !== null ? _editingCustomizationIndex : -1 });
        const obj = { name, shortcut, executionMode: execMode, continuousInterval: interval, actions, enabled: true };
        if (_editingCustomizationIndex !== null) {
            customizations[_editingCustomizationIndex] = { ...customizations[_editingCustomizationIndex], ...obj };
        } else {
            customizations.push(obj);
        }
        S.set("customizations", JSON.stringify(customizations));
        settingsChannel.postMessage({ type: "update_customizations", data: customizations });
        _closeCustomizationModal();
        updateCustomizationsUI();
    } catch (_) { }
}

function fillSelectWithKeys(e, t) {
    e.innerHTML = "";
    [{
        name: "None",
        code: "None"
    }, {
        name: "Tab",
        code: "Tab"
    }, {
        name: "A",
        code: "KeyA"
    }, {
        name: "B",
        code: "KeyB"
    }, {
        name: "C",
        code: "KeyC"
    }, {
        name: "D",
        code: "KeyD"
    }, {
        name: "E",
        code: "KeyE"
    }, {
        name: "F",
        code: "KeyF"
    }, {
        name: "G",
        code: "KeyG"
    }, {
        name: "H",
        code: "KeyH"
    }, {
        name: "I",
        code: "KeyI"
    }, {
        name: "J",
        code: "KeyJ"
    }, {
        name: "K",
        code: "KeyK"
    }, {
        name: "L",
        code: "KeyL"
    }, {
        name: "M",
        code: "KeyM"
    }, {
        name: "N",
        code: "KeyN"
    }, {
        name: "O",
        code: "KeyO"
    }, {
        name: "P",
        code: "KeyP"
    }, {
        name: "Q",
        code: "KeyQ"
    }, {
        name: "R",
        code: "KeyR"
    }, {
        name: "S",
        code: "KeyS"
    }, {
        name: "T",
        code: "KeyT"
    }, {
        name: "U",
        code: "KeyU"
    }, {
        name: "V",
        code: "KeyV"
    }, {
        name: "W",
        code: "KeyW"
    }, {
        name: "X",
        code: "KeyX"
    }, {
        name: "Y",
        code: "KeyY"
    }, {
        name: "Z",
        code: "KeyZ"
    }, {
        name: "0",
        code: "Digit0"
    }, {
        name: "1",
        code: "Digit1"
    }, {
        name: "2",
        code: "Digit2"
    }, {
        name: "3",
        code: "Digit3"
    }, {
        name: "4",
        code: "Digit4"
    }, {
        name: "5",
        code: "Digit5"
    }, {
        name: "6",
        code: "Digit6"
    }, {
        name: "7",
        code: "Digit7"
    }, {
        name: "8",
        code: "Digit8"
    }, {
        name: "9",
        code: "Digit9"
    }, {
        name: "0 (يمين الكيبورد)",
        code: "Numpad0"
    }, {
        name: "1 (يمين الكيبورد)",
        code: "Numpad1"
    }, {
        name: "2 (يمين الكيبورد)",
        code: "Numpad2"
    }, {
        name: "3 (يمين الكيبورد)",
        code: "Numpad3"
    }, {
        name: "4 (يمين الكيبورد)",
        code: "Numpad4"
    }, {
        name: "5 (يمين الكيبورد)",
        code: "Numpad5"
    }, {
        name: "6 (يمين الكيبورد)",
        code: "Numpad6"
    }, {
        name: "7 (يمين الكيبورد)",
        code: "Numpad7"
    }, {
        name: "8 (يمين الكيبورد)",
        code: "Numpad8"
    }, {
        name: "9 (يمين الكيبورد)",
        code: "Numpad9"
    }, {
        name: "+ (يمين الكيبورد)",
        code: "NumpadAdd"
    }, {
        name: "− (يمين الكيبورد)",
        code: "NumpadSubtract"
    }, {
        name: "× (يمين الكيبورد)",
        code: "NumpadMultiply"
    }, {
        name: "÷ (يمين الكيبورد)",
        code: "NumpadDivide"
    }, {
        name: ". (يمين الكيبورد)",
        code: "NumpadDecimal"
    }, {
        name: "↵ (يمين الكيبورد)",
        code: "NumpadEnter"
    }, {
        name: "Space",
        code: "Space"
    }, {
        name: "Enter",
        code: "Enter"
    }, {
        name: "Shift",
        code: "ShiftLeft"
    }, {
        name: "Ctrl",
        code: "ControlLeft"
    }, {
        name: "Alt",
        code: "AltLeft"
    }, {
        name: "←",
        code: "ArrowLeft"
    }, {
        name: "↑",
        code: "ArrowUp"
    }, {
        name: "→",
        code: "ArrowRight"
    }, {
        name: "↓",
        code: "ArrowDown"
    }, {
        name: "`",
        code: "Backquote"
    }].forEach(o => {
        const n = document.createElement("option");
        n.value = o.code;
        n.textContent = o.name;
        if (o.code === t) {
            n.selected = true;
        }
        e.appendChild(n);
    });
}
function fillSelectWithPages(e, t) {
    e.innerHTML = "";
    [{
        value: "current",
        text: "الحالية"
    }, {
        value: "opposite",
        text: "المعاكسة"
    }, {
        value: "both",
        text: "كلاهما"
    }].forEach(o => {
        const n = document.createElement("option");
        n.value = o.value;
        n.textContent = o.text;
        if (o.value === t) {
            n.selected = true;
        }
        e.appendChild(n);
    });
}
function setupDirectionUI(e) {
    const t = document.getElementById(`movement${e}Enabled`);
    const o = document.getElementById(`movement${e}KeySelect`);
    const n = document.getElementById(`movement${e}PageSelect`);
    const a = getAllDirections().find(t => t.id === e);
    if (a) {
        if (t) {
            t.checked = a.enabled;
            t.addEventListener("change", () => {
                const o = t.checked;
                switch (e) {
                    case "Left":
                        movementLeftEnabled = o;
                        S.set("movementLeftEnabled", o.toString());
                        break;
                    case "Right":
                        movementRightEnabled = o;
                        S.set("movementRightEnabled", o.toString());
                        break;
                    case "Up":
                        movementUpEnabled = o;
                        S.set("movementUpEnabled", o.toString());
                        break;
                    case "Down":
                        movementDownEnabled = o;
                        S.set("movementDownEnabled", o.toString());
                        break;
                    case "TopLeft":
                        movementTopLeftEnabled = o;
                        S.set("movementTopLeftEnabled", o.toString());
                        break;
                    case "TopRight":
                        movementTopRightEnabled = o;
                        S.set("movementTopRightEnabled", o.toString());
                        break;
                    case "BottomLeft":
                        movementBottomLeftEnabled = o;
                        S.set("movementBottomLeftEnabled", o.toString());
                        break;
                    case "BottomRight":
                        movementBottomRightEnabled = o;
                        S.set("movementBottomRightEnabled", o.toString());
                }
                settingsChannel.postMessage({
                    type: "update_movement_settings",
                    data: getAllDirections()
                });
            });
        }
        if (o) {
            fillSelectWithKeys(o, a.key);
            o.addEventListener("change", () => {
                const t = o.value;
                switch (e) {
                    case "Left":
                        movementLeftKey = t;
                        S.set("movementLeftKey", t);
                        break;
                    case "Right":
                        movementRightKey = t;
                        S.set("movementRightKey", t);
                        break;
                    case "Up":
                        movementUpKey = t;
                        S.set("movementUpKey", t);
                        break;
                    case "Down":
                        movementDownKey = t;
                        S.set("movementDownKey", t);
                        break;
                    case "TopLeft":
                        movementTopLeftKey = t;
                        S.set("movementTopLeftKey", t);
                        break;
                    case "TopRight":
                        movementTopRightKey = t;
                        S.set("movementTopRightKey", t);
                        break;
                    case "BottomLeft":
                        movementBottomLeftKey = t;
                        S.set("movementBottomLeftKey", t);
                        break;
                    case "BottomRight":
                        movementBottomRightKey = t;
                        S.set("movementBottomRightKey", t);
                }
                settingsChannel.postMessage({
                    type: "update_movement_settings",
                    data: getAllDirections()
                });
            });
        }
        if (n) {
            fillSelectWithPages(n, a.page);
            n.addEventListener("change", () => {
                const t = n.value;
                switch (e) {
                    case "Left":
                        movementLeftPage = t;
                        S.set("movementLeftPage", t);
                        break;
                    case "Right":
                        movementRightPage = t;
                        S.set("movementRightPage", t);
                        break;
                    case "Up":
                        movementUpPage = t;
                        S.set("movementUpPage", t);
                        break;
                    case "Down":
                        movementDownPage = t;
                        S.set("movementDownPage", t);
                        break;
                    case "TopLeft":
                        movementTopLeftPage = t;
                        S.set("movementTopLeftPage", t);
                        break;
                    case "TopRight":
                        movementTopRightPage = t;
                        S.set("movementTopRightPage", t);
                        break;
                    case "BottomLeft":
                        movementBottomLeftPage = t;
                        S.set("movementBottomLeftPage", t);
                        break;
                    case "BottomRight":
                        movementBottomRightPage = t;
                        S.set("movementBottomRightPage", t);
                }
                settingsChannel.postMessage({
                    type: "update_movement_settings",
                    data: getAllDirections()
                });
            });
        }
    }
}
function setupNormalDirectionUI(e) {
    const t = e.charAt(0).toLowerCase() + e.slice(1);
    const o = document.getElementById(`normal${t}Enabled`);
    const n = document.getElementById(`normal${t}KeySelect`);
    const a = document.getElementById(`normal${t}PageSelect`);
    const l = getAllNormalDirections().find(t => t.id === e);
    if (l) {
        if (o) {
            o.checked = l.enabled;
            o.addEventListener("change", () => {
                const t = o.checked;
                switch (e) {
                    case "BottomLeft":
                        normalBottomLeftEnabled = t;
                        S.set("normalBottomLeftEnabled", t.toString());
                        break;
                    case "MiddleBottom":
                        normalMiddleBottomEnabled = t;
                        S.set("normalMiddleBottomEnabled", t.toString());
                        break;
                    case "BottomRight":
                        normalBottomRightEnabled = t;
                        S.set("normalBottomRightEnabled", t.toString());
                        break;
                    case "Left":
                        normalLeftEnabled = t;
                        S.set("normalLeftEnabled", t.toString());
                        break;
                    case "Center":
                        normalCenterEnabled = t;
                        S.set("normalCenterEnabled", t.toString());
                        break;
                    case "Right":
                        normalRightEnabled = t;
                        S.set("normalRightEnabled", t.toString());
                        break;
                    case "TopLeft":
                        normalTopLeftEnabled = t;
                        S.set("normalTopLeftEnabled", t.toString());
                        break;
                    case "Top":
                        normalTopEnabled = t;
                        S.set("normalTopEnabled", t.toString());
                        break;
                    case "TopRight":
                        normalTopRightEnabled = t;
                        S.set("normalTopRightEnabled", t.toString());
                        break;
                    case "Topc":
                        normalTopcEnabled = t;
                        S.set("normalTopcEnabled", t.toString());
                }
                settingsChannel.postMessage({
                    type: "update_normal_settings",
                    data: getAllNormalDirections()
                });
            });
        }
        if (n) {
            fillSelectWithKeys(n, l.key);
            n.addEventListener("change", () => {
                const t = n.value;
                switch (e) {
                    case "BottomLeft":
                        normalBottomLeftKey = t;
                        S.set("normalBottomLeftKey", t);
                        break;
                    case "MiddleBottom":
                        normalMiddleBottomKey = t;
                        S.set("normalMiddleBottomKey", t);
                        break;
                    case "BottomRight":
                        normalBottomRightKey = t;
                        S.set("normalBottomRightKey", t);
                        break;
                    case "Left":
                        normalLeftKey = t;
                        S.set("normalLeftKey", t);
                        break;
                    case "Center":
                        normalCenterKey = t;
                        S.set("normalCenterKey", t);
                        break;
                    case "Right":
                        normalRightKey = t;
                        S.set("normalRightKey", t);
                        break;
                    case "TopLeft":
                        normalTopLeftKey = t;
                        S.set("normalTopLeftKey", t);
                        break;
                    case "Top":
                        normalTopKey = t;
                        S.set("normalTopKey", t);
                        break;
                    case "TopRight":
                        normalTopRightKey = t;
                        S.set("normalTopRightKey", t);
                        break;
                    case "Topc":
                        normalTopcKey = t;
                        S.set("normalTopcKey", t);
                }
                settingsChannel.postMessage({
                    type: "update_normal_settings",
                    data: getAllNormalDirections()
                });
            });
        }
        if (a) {
            fillSelectWithPages(a, l.page);
            a.addEventListener("change", () => {
                const t = a.value;
                switch (e) {
                    case "BottomLeft":
                        normalBottomLeftPage = t;
                        S.set("normalBottomLeftPage", t);
                        break;
                    case "MiddleBottom":
                        normalMiddleBottomPage = t;
                        S.set("normalMiddleBottomPage", t);
                        break;
                    case "BottomRight":
                        normalBottomRightPage = t;
                        S.set("normalBottomRightPage", t);
                        break;
                    case "Left":
                        normalLeftPage = t;
                        S.set("normalLeftPage", t);
                        break;
                    case "Center":
                        normalCenterPage = t;
                        S.set("normalCenterPage", t);
                        break;
                    case "Right":
                        normalRightPage = t;
                        S.set("normalRightPage", t);
                        break;
                    case "TopLeft":
                        normalTopLeftPage = t;
                        S.set("normalTopLeftPage", t);
                        break;
                    case "Top":
                        normalTopPage = t;
                        S.set("normalTopPage", t);
                        break;
                    case "TopRight":
                        normalTopRightPage = t;
                        S.set("normalTopRightPage", t);
                        break;
                    case "Topc":
                        normalTopcPage = t;
                        S.set("normalTopcPage", t);
                }
                settingsChannel.postMessage({
                    type: "update_normal_settings",
                    data: getAllNormalDirections()
                });
            });
        }
    }
}
function getDirectionLabel(e) {
    return {
        Left: "أفقي يسار",
        Right: "أفقي يمين",
        Up: "عمودي فوق",
        Down: "عمودي تحت",
        TopLeft: "زاوية فوق يسار",
        TopRight: "زاوية فوق يمين",
        BottomLeft: "زاوية تحت يسار",
        BottomRight: "زاوية تحت يمين"
    }[e] || e;
}
function getNormalDirectionLabel(e) {
    return {
        bottomLeft: "زاوية تحت يسار",
        middleBottom: "عمودي تحت ",
        bottomRight: "زاوية تحت يمين",
        left: " افقي يسار",
        center: "افقي عادي",
        right: "افقي يمين",
        topLeft: "زاوية فوق يسار",
        top: "عمودي فوق",
        topRight: "زاوية فوق يمين",
        topc: "عمودي عادي"
    }[e] || e;
}
function getAllDirections() {
    return [{
        id: "Left",
        label: "أفقي يسار",
        enabled: movementLeftEnabled,
        key: movementLeftKey,
        page: movementLeftPage
    }, {
        id: "Right",
        label: "أفقي يمين",
        enabled: movementRightEnabled,
        key: movementRightKey,
        page: movementRightPage
    }, {
        id: "Up",
        label: "عمودي فوق",
        enabled: movementUpEnabled,
        key: movementUpKey,
        page: movementUpPage
    }, {
        id: "Down",
        label: "عمودي تحت",
        enabled: movementDownEnabled,
        key: movementDownKey,
        page: movementDownPage
    }, {
        id: "TopLeft",
        label: "زاوية فوق يسار",
        enabled: movementTopLeftEnabled,
        key: movementTopLeftKey,
        page: movementTopLeftPage
    }, {
        id: "TopRight",
        label: "زاوية فوق يمين",
        enabled: movementTopRightEnabled,
        key: movementTopRightKey,
        page: movementTopRightPage
    }, {
        id: "BottomLeft",
        label: "زاوية تحت يسار",
        enabled: movementBottomLeftEnabled,
        key: movementBottomLeftKey,
        page: movementBottomLeftPage
    }, {
        id: "BottomRight",
        label: "زاوية تحت يمين",
        enabled: movementBottomRightEnabled,
        key: movementBottomRightKey,
        page: movementBottomRightPage
    }];
}
function getAllNormalDirections() {
    return [{
        id: "BottomLeft",
        label: "تحت يسار",
        enabled: normalBottomLeftEnabled,
        key: normalBottomLeftKey,
        page: normalBottomLeftPage
    }, {
        id: "MiddleBottom",
        label: "وسط تحت",
        enabled: normalMiddleBottomEnabled,
        key: normalMiddleBottomKey,
        page: normalMiddleBottomPage
    }, {
        id: "BottomRight",
        label: "تحت يمين",
        enabled: normalBottomRightEnabled,
        key: normalBottomRightKey,
        page: normalBottomRightPage
    }, {
        id: "Left",
        label: "يسار",
        enabled: normalLeftEnabled,
        key: normalLeftKey,
        page: normalLeftPage
    }, {
        id: "Center",
        label: "وسط",
        enabled: normalCenterEnabled,
        key: normalCenterKey,
        page: normalCenterPage
    }, {
        id: "Right",
        label: "يمين",
        enabled: normalRightEnabled,
        key: normalRightKey,
        page: normalRightPage
    }, {
        id: "TopLeft",
        label: "فوق يسار",
        enabled: normalTopLeftEnabled,
        key: normalTopLeftKey,
        page: normalTopLeftPage
    }, {
        id: "Top",
        label: "فوق",
        enabled: normalTopEnabled,
        key: normalTopKey,
        page: normalTopPage
    }, {
        id: "TopRight",
        label: "فوق يمين",
        enabled: normalTopRightEnabled,
        key: normalTopRightKey,
        page: normalTopRightPage
    }, {
        id: "Topc",
        label: "فوق وسط",
        enabled: normalTopcEnabled,
        key: normalTopcKey,
        page: normalTopcPage
    }];
}
function createControlButton() {
    try {
        if (document.getElementById("nm-floating-circle")) return;
        const circle = document.createElement("div");
        circle.id = "nm-floating-circle";
        circle.innerHTML = '<span class="nm-glyph"><svg viewBox="0 0 32 32" width="30" height="30" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6" width="14" height="20" rx="3.5"/><rect x="15.5" y="6" width="14" height="20" rx="3.5" fill="rgba(255,255,255,.22)"/><path d="M8 16h8M13 12l4 4-4 4"/></svg></span><span class="nm-page-badge" id="nm-page-badge">1</span>';
        document.body.appendChild(circle);
        nmBindPageUI();

        // restore saved position
        const saved = S.get("controlButtonPosition", null);
        if (saved) {
            try {
                const pos = JSON.parse(saved);
                if (pos && pos.top != null && pos.left != null) {
                    circle.style.top = pos.top;
                    circle.style.left = pos.left;
                }
            } catch (_) { }
        }
        // apply stored image
        if (buttonBackgroundImage) {
            circle.style.backgroundImage = `url(${buttonBackgroundImage})`;
        }
        _setupCircleDragAndToggle(circle);
    } catch (_) { }
}
function applyButtonStyles() {
    // No-op in new UI: circle size/shape is fixed via CSS.
    // Kept so existing callers don't throw.
}
function _setupCircleDragAndToggle(circle) {
    const panel = document.getElementById("controlPanel");
    let isDragging = false;
    let startX, startY, initLeft, initTop;

    function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }
    function savePos() {
        S.set("controlButtonPosition", JSON.stringify({ top: circle.style.top, left: circle.style.left }));
    }
    function repositionPanel() {
        const cr = circle.getBoundingClientRect();
        const panelW = Math.min(780, window.innerWidth - 20);
        const panelH = Math.min(640, window.innerHeight - 20);
        const margin = 12;
        // Prefer below the circle, fall back to above if not enough space
        let top = cr.bottom + margin;
        if (top + panelH > window.innerHeight) top = Math.max(margin, cr.top - panelH - margin);
        // Align left edge with circle, shift left if it clips the right edge
        let left = cr.left;
        if (left + panelW > window.innerWidth) left = Math.max(margin, window.innerWidth - panelW - margin);
        panel.style.top = top + "px";
        panel.style.left = left + "px";
    }

    // Mouse drag
    circle.addEventListener("mousedown", nativeify((ev) => {
        try {
            if (ev.button !== 0) return;
            ev.preventDefault();
            initLeft = circle.offsetLeft; initTop = circle.offsetTop;
            startX = ev.clientX; startY = ev.clientY; isDragging = false;
        } catch (_) { }
    }, 'circleMousedown'), true);
    document.addEventListener("mousemove", nativeify((ev) => {
        try {
            if (startX === undefined) return;
            const dx = ev.clientX - startX, dy = ev.clientY - startY;
            if (!isDragging && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) isDragging = true;
            if (isDragging) {
                circle.style.left = clamp(initLeft + dx, 0, window.innerWidth - circle.offsetWidth) + "px";
                circle.style.top = clamp(initTop + dy, 0, window.innerHeight - circle.offsetHeight) + "px";
            }
        } catch (_) { }
    }, 'circleDrag'), true);
    document.addEventListener("mouseup", nativeify((ev) => {
        try {
            if (startX === undefined) return;
            const wasDragging = isDragging;
            startX = startY = undefined; isDragging = false;
            if (wasDragging) { savePos(); return; }
            if (ev.target === circle || circle.contains(ev.target)) {
                nmTogglePanel();
            }
        } catch (_) { }
    }, 'circleMouseup'), true);

    // Touch drag
    circle.addEventListener("touchstart", nativeify((ev) => {
        try {
            const t = ev.touches[0];
            initLeft = circle.offsetLeft; initTop = circle.offsetTop;
            startX = t.clientX; startY = t.clientY; isDragging = false;
        } catch (_) { }
    }, 'touchstart'), { passive: true });
    document.addEventListener("touchmove", nativeify((ev) => {
        try {
            if (startX === undefined) return;
            const t = ev.touches[0];
            const dx = t.clientX - startX, dy = t.clientY - startY;
            if (!isDragging && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) isDragging = true;
            if (isDragging) {
                circle.style.left = clamp(initLeft + dx, 0, window.innerWidth - circle.offsetWidth) + "px";
                circle.style.top = clamp(initTop + dy, 0, window.innerHeight - circle.offsetHeight) + "px";
            }
        } catch (_) { }
    }, 'touchmove'), { passive: false });
    document.addEventListener("touchend", nativeify(() => {
        try {
            if (startX === undefined) return;
            const wasDragging = isDragging;
            startX = startY = undefined; isDragging = false;
            if (wasDragging) savePos();
            else nmTogglePanel();
        } catch (_) { }
    }, 'touchend'));

    // Click-outside → close
    document.addEventListener("mousedown", nativeify((ev) => {
        try {
            if (panel.classList.contains("show") &&
                !panel.contains(ev.target) && ev.target !== circle) {
                panel.classList.remove("show");
            }
        } catch (_) { }
    }, 'clickOutside'));

    // Keep circle in viewport on resize
    window.addEventListener("resize", nativeify(() => {
        try {
            circle.style.left = clamp(circle.offsetLeft, 0, Math.max(0, window.innerWidth - circle.offsetWidth)) + "px";
            circle.style.top = clamp(circle.offsetTop, 0, Math.max(0, window.innerHeight - circle.offsetHeight)) + "px";
            savePos();
        } catch (_) { }
    }, 'circleResize'));
}
function enableDrag(e) {
    let t = 0;
    let o = 0;
    let n = 0;
    let a = 0;
    function l(e, t, o) {
        return Math.min(Math.max(e, t), o);
    }
    const i = nativeify(function dragMove(i) {
        try {
            i.preventDefault();
            const m = i.clientX - t;
            const r = i.clientY - o;
            const d = function (t, o) {
                const n = Math.max(0, window.innerWidth - e.offsetWidth);
                const a = Math.max(0, window.innerHeight - e.offsetHeight);
                return { left: l(t, 0, n), top: l(o, 0, a) };
            }(n + m, a + r);
            e.style.left = d.left + "px";
            e.style.top = d.top + "px";
        } catch (_) { }
    }, 'dragMove');
    const m = nativeify(function dragEnd() {
        try {
            document.removeEventListener("mousemove", i, true);
            document.removeEventListener("mouseup", m, true);
            S.set("controlButtonPosition", JSON.stringify({ top: e.style.top, left: e.style.left }));
        } catch (_) { }
    }, 'dragEnd');
    e.addEventListener("mousedown", nativeify(function (l) {
        try {
            l.preventDefault();
            t = l.clientX; o = l.clientY; n = e.offsetLeft; a = e.offsetTop;
            document.addEventListener("mousemove", i, true);
            document.addEventListener("mouseup", m, true);
        } catch (_) { }
    }, 'dragMousedown'), true);
    window.addEventListener("resize", nativeify(() => {
        try {
            const t = parseFloat(e.style.top) || 0;
            const o = parseFloat(e.style.left) || 0;
            const n = Math.min(Math.max(o, 0), Math.max(0, window.innerWidth - e.offsetWidth));
            const a = Math.min(Math.max(t, 0), Math.max(0, window.innerHeight - e.offsetHeight));
            e.style.left = n + "px"; e.style.top = a + "px";
            S.set("controlButtonPosition", JSON.stringify({ top: e.style.top, left: e.style.left }));
        } catch (_) { }
    }, 'dragResize'));
}
function updateCustomizationsUI() {
    try {
        const container = document.getElementById("customizationsContainer");
        const emptyState = document.getElementById("nm-cust-empty-state");
        if (!container) return;
        container.innerHTML = "";
        if (emptyState) emptyState.style.display = customizations.length ? "none" : "flex";
        customizations.forEach((c, idx) => {
            const item = document.createElement("div");
            item.className = "nm-cust-item" + (c.enabled ? "" : " disabled");
            item.setAttribute("data-index", idx);
            const dispKey = c.shortcut && c.shortcut !== "None" ? (_codeToDisplay[c.shortcut] || c.shortcut) : "";
            item.innerHTML = `
          <div class="nm-cust-info">
            <h4>${c.name}</h4>
            ${dispKey ? `<span class="nm-cust-key-badge">${dispKey}</span>` : ""}
          </div>
          <div class="nm-cust-actions">
            <button class="nm-btn-mini nm-toggle-cust">${c.enabled ? "تعطيل" : "تمكين"}</button>
            <button class="nm-btn-mini nm-edit-cust">تعديل</button>
            <button class="nm-btn-mini danger nm-delete-cust">حذف</button>
          </div>`;
            item.querySelector(".nm-toggle-cust").addEventListener("click", () => {
                customizations[idx].enabled = !customizations[idx].enabled;
                S.set("customizations", JSON.stringify(customizations));
                settingsChannel.postMessage({ type: "update_customizations", data: customizations });
                updateCustomizationsUI();
            });
            item.querySelector(".nm-edit-cust").addEventListener("click", () => {
                _openCustomizationModal(customizations[idx], idx);
            });
            item.querySelector(".nm-delete-cust").addEventListener("click", () => {
                customizations.splice(idx, 1);
                S.set("customizations", JSON.stringify(customizations));
                settingsChannel.postMessage({ type: "update_customizations", data: customizations });
                updateCustomizationsUI();
            });
            container.appendChild(item);
        });
    } catch (_) { }
}
function createNewCustomization(e = null, t = null) {
    _openCustomizationModal(e, t);
}
function getActionsFromContainer(e) {
    const t = [];
    e.querySelectorAll(".action").forEach(e => {
        const o = e.querySelector(".actionMessage").value;
        const n = parseInt(e.querySelector(".actionRepeat").value) || 1;
        const a = e.querySelector(".actionPage").value;
        if (o && o !== "None") {
            t.push({
                message: o,
                repeat: n,
                page: a
            });
        }
    });
    return t;
}
function updateMovementUI() { try { updateMovementUIElements(); } catch (_) { } }
function updateNormalUI() { try { updateNormalUIElements(); } catch (_) { } }

function addEventListeners() {
    try { window.addEventListener("keydown", handleKeyDown, true); } catch (_) { }
    try { window.addEventListener("resize", nativeify(() => { }, 'resize')); } catch (_) { }
    settingsChannel.onmessage = e => {
        const t = e.data;
        if (t.type === "update_customizations") {
            customizations = t.data;
            S.set("customizations", JSON.stringify(customizations));
            applyStoredCustomizations();
        } else if (t.type === "update_customizations") {
            customizations = t.data;
            S.set("customizations", JSON.stringify(customizations));
            applyStoredCustomizations();
        } else if (t.type === "update_nm_color") {
            // 7-color system sync across tabs
            S.set(t.key, t.val);
            const cssVarMap = {
                nmColorPrimary: "--primary-red",
                nmColorTextLight: "--text-light",
                nmColorTextDim: "--text-dim",
                nmColorSpecialBtn: "--special-btn-bg"
            };
            if (cssVarMap[t.key]) document.documentElement.style.setProperty(cssVarMap[t.key], t.val);
            const panel = document.getElementById("controlPanel");
            const circle = document.getElementById("nm-floating-circle");
            if (t.key === "nmColorMenuBg" && panel) { panel.style.backgroundColor = t.val; }
            if (t.key === "nmColorCircleBg" && circle) { circle.style.backgroundColor = t.val; }
            updateAllUIElements();
        } else if (t.type === "update_multi_enabled") {
            multiEnabled = t.data;
            S.set("multiEnabled", t.data.toString());
            const mt = document.getElementById("multi-toggle");
            if (mt) mt.checked = multiEnabled;
        } else if (t.type === "update_panel_background") {
            panelBackgroundImage = t.data;
            ImageStore.set("panelBackgroundImage", t.data);
            const panel = document.getElementById("controlPanel");
            if (panel) {
                panel.style.backgroundImage = `linear-gradient(rgba(26,26,36,0.85),rgba(15,15,19,0.95)),url(${t.data})`;
                panel.style.backgroundSize = "cover";
                panel.style.backgroundPosition = "center";
            }
        } else if (t.type === "update_button_background") {
            buttonBackgroundImage = t.data;
            ImageStore.set("buttonBackgroundImage", t.data);
            const circle = document.getElementById("nm-floating-circle");
            if (circle) circle.style.backgroundImage = `url(${t.data})`;
        } else if (t.type === "toggle_focus") {
            if (window.focusPeer) window.focusPeer();
        } else if (t.type === "update_movement_settings") {
            const e = t.data;
            if (e) {
                Object.keys(e).forEach(t => {
                    const o = e[t];
                    if (o) {
                        switch (t) {
                            case "Left":
                                movementLeftEnabled = o.enabled;
                                movementLeftKey = o.key;
                                movementLeftPage = o.page;
                                S.set("movementLeftEnabled", movementLeftEnabled.toString());
                                S.set("movementLeftKey", movementLeftKey);
                                S.set("movementLeftPage", movementLeftPage);
                                break;
                            case "Right":
                                movementRightEnabled = o.enabled;
                                movementRightKey = o.key;
                                movementRightPage = o.page;
                                S.set("movementRightEnabled", movementRightEnabled.toString());
                                S.set("movementRightKey", movementRightKey);
                                S.set("movementRightPage", movementRightPage);
                                break;
                            case "Up":
                                movementUpEnabled = o.enabled;
                                movementUpKey = o.key;
                                movementUpPage = o.page;
                                S.set("movementUpEnabled", movementUpEnabled.toString());
                                S.set("movementUpKey", movementUpKey);
                                S.set("movementUpPage", movementUpPage);
                                break;
                            case "Down":
                                movementDownEnabled = o.enabled;
                                movementDownKey = o.key;
                                movementDownPage = o.page;
                                S.set("movementDownEnabled", movementDownEnabled.toString());
                                S.set("movementDownKey", movementDownKey);
                                S.set("movementDownPage", movementDownPage);
                        }
                    }
                });
                updateMovementUIElements();
            }
        } else if (t.type === "update_normal_settings") {
            const e = t.data;
            if (e) {
                Object.keys(e).forEach(t => {
                    const o = e[t];
                    if (o) {
                        switch (t) {
                            case "BottomLeft":
                                normalBottomLeftEnabled = o.enabled;
                                normalBottomLeftKey = o.key;
                                normalBottomLeftPage = o.page;
                                S.set("normalBottomLeftEnabled", normalBottomLeftEnabled.toString());
                                S.set("normalBottomLeftKey", normalBottomLeftKey);
                                S.set("normalBottomLeftPage", normalBottomLeftPage);
                                break;
                            case "MiddleBottom":
                                normalMiddleBottomEnabled = o.enabled;
                                normalMiddleBottomKey = o.key;
                                normalMiddleBottomPage = o.page;
                                S.set("normalMiddleBottomEnabled", normalMiddleBottomEnabled.toString());
                                S.set("normalMiddleBottomKey", normalMiddleBottomKey);
                                S.set("normalMiddleBottomPage", normalMiddleBottomPage);
                                break;
                            case "BottomRight":
                                normalBottomRightEnabled = o.enabled;
                                normalBottomRightKey = o.key;
                                normalBottomRightPage = o.page;
                                S.set("normalBottomRightEnabled", normalBottomRightEnabled.toString());
                                S.set("normalBottomRightKey", normalBottomRightKey);
                                S.set("normalBottomRightPage", normalBottomRightPage);
                                break;
                            case "Left":
                                normalLeftEnabled = o.enabled;
                                normalLeftKey = o.key;
                                normalLeftPage = o.page;
                                S.set("normalLeftEnabled", normalLeftEnabled.toString());
                                S.set("normalLeftKey", normalLeftKey);
                                S.set("normalLeftPage", normalLeftPage);
                                break;
                            case "Center":
                                normalCenterEnabled = o.enabled;
                                normalCenterKey = o.key;
                                normalCenterPage = o.page;
                                S.set("normalCenterEnabled", normalCenterEnabled.toString());
                                S.set("normalCenterKey", normalCenterKey);
                                S.set("normalCenterPage", normalCenterPage);
                                break;
                            case "Right":
                                normalRightEnabled = o.enabled;
                                normalRightKey = o.key;
                                normalRightPage = o.page;
                                S.set("normalRightEnabled", normalRightEnabled.toString());
                                S.set("normalRightKey", normalRightKey);
                                S.set("normalRightPage", normalRightPage);
                                break;
                            case "TopLeft":
                                normalTopLeftEnabled = o.enabled;
                                normalTopLeftKey = o.key;
                                normalTopLeftPage = o.page;
                                S.set("normalTopLeftEnabled", normalTopLeftEnabled.toString());
                                S.set("normalTopLeftKey", normalTopLeftKey);
                                S.set("normalTopLeftPage", normalTopLeftPage);
                                break;
                            case "Top":
                                normalTopEnabled = o.enabled;
                                normalTopKey = o.key;
                                normalTopPage = o.page;
                                S.set("normalTopEnabled", normalTopEnabled.toString());
                                S.set("normalTopKey", normalTopKey);
                                S.set("normalTopPage", normalTopPage);
                                break;
                            case "TopRight":
                                normalTopRightEnabled = o.enabled;
                                normalTopRightKey = o.key;
                                normalTopRightPage = o.page;
                                S.set("normalTopRightEnabled", normalTopRightEnabled.toString());
                                S.set("normalTopRightKey", normalTopRightKey);
                                S.set("normalTopRightPage", normalTopRightPage);
                                break;
                            case "Topc":
                                normalTopcEnabled = o.enabled;
                                normalTopcKey = o.key;
                                normalTopcPage = o.page;
                                S.set("normalTopcEnabled", normalTopcEnabled.toString());
                                S.set("normalTopcKey", normalTopcKey);
                                S.set("normalTopcPage", normalTopcPage);
                        }
                    }
                });
                updateNormalUIElements();
            }
        }
    };
}
const handleKeyDown = nativeify(function handleKeyDown(e) {
    try {
        if (window.NMUPDATE && NMUPDATE.isBlocked()) return; // a mandatory update is pending: the old build must not fire commands
        if (!NMAUTH.isAuthed()) return; // defense-in-depth: no command fires without a validated login
        if (!multiEnabled) return;
        if ((!e.isTrusted && !window.__nmMacroReplay) || e.repeat) return;
        if (_recBoxId || window.__nmSetupActive) return;          // recording a key: never fire actions
        const el = e.target, tag = el && el.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el && el.isContentEditable)) return;
        const code = e.code;
        if (!code || code === "None") return;
        window.__nmStat.key = code;
        if (nmReleaseKey !== "None" && code === nmReleaseKey) { nmReleaseAll(); window.__nmStat.act = "release-all"; return; }
        const dirs = getAllDirections();
        for (let i = 0; i < dirs.length; i++) {
            const d = dirs[i];
            if (d.enabled && d.key === code) { window.__nmStat.key = code + " > " + d.id; handleMouseMovement(d.id, d.page); return; }
        }
        const nd = getAllNormalDirections();
        for (let i = 0; i < nd.length; i++) {
            const d = nd[i];
            if (d.enabled && d.key && d.key !== "None" && d.key === code) { handleNormalLineMovement(d.id, d.page); return; }
        }
        customizations.forEach((c, o) => {
            if (c.enabled && c.shortcut && c.shortcut !== "None" && code === c.shortcut) executeCustomization(c, o);
        });
    } catch (_) { }
}, 'handleKeyDown');
function getCanvasPositions() {
    try {
        const e = canvasElement || getCanvasElement();
        if (!e) { return null; }
        const t = e.getBoundingClientRect();
        const o = t.left + t.width / 2;
        const n = t.top + t.height / 2;
        const a = Math.min(t.width, t.height);
        const l = a / 2;
        return {
            canvas: e,
            rect: t,
            centerX: o,
            centerY: n,
            positions: {
                Left: [o - l, n],
                Right: [o + l, n],
                Up: [o, n - l],
                Down: [o, n + l],
                TopLeft: [o - l, n - l],
                TopRight: [o + l, n - l],
                BottomLeft: [o - l, n + l],
                BottomRight: [o + l, n + l],
                bottomLeft: [o - l, n + l],
                middleBottom: [o, n + l],
                bottomRight: [o + l, n + l],
                left: [o - l, n],
                center: [o, n],
                right: [o + l, n],
                topLeft: [o - l, n - l],
                top: [o, n - l],
                topRight: [o + l, n - l],
                topc: [o, n - a * 0.1]
            }
        };
    } catch (_) { }
}
actionChannelLocal.onmessage = nativeify(function (e) {
    try {
        const t = e.data;
        // only the page this message is addressed to reacts, and never to its own messages
        if (!t || t.to !== myPage || t.from === myPage) return;
        if (t.type === "line_press") {
            try { nmLinePress(t.dir, t.ts); } catch (_) { }
        } else if (t.type === "execute_actions") {
            try { executeReceivedActions(t.actions); } catch (_) { }
        } else if (t.type === "normal_line_move") {
            try { nmLinePress(mapNormalToMoveDir(t.position), Date.now()); } catch (_) { }
        }
    } catch (_) { }
}, 'onmessage');
// ──────────────────────────────────────────────────────────────────────
// NMAUTH — login gate. Nothing below this point (panel, hotkeys, lines,
// FPS override, color hooks, macro/clip/alerts/profiles, packet recorder)
// is ever wired up before a code is checked against the license server
// and accepted. If the server can't be reached, access fails CLOSED
// (blocked), never open — this is a deliberate choice, not a bug.
// ──────────────────────────────────────────────────────────────────────
const NM_LICENSE_SERVER_DEFAULT = "https://agar-server-production.up.railway.app"; // سيرفر التفعيل الفعلي على Railway
const NMAUTH = (function () {
    const SKEY = "nm3_serverUrl", AKEY = "nm3_auth", DKEY = "nm3_deviceId";

    function deviceId() {
        let id;
        try { id = localStorage.getItem(DKEY); } catch (_) { }
        if (!id) {
            try { id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now() + "-" + Math.random().toString(36).slice(2)); } catch (_) { id = Date.now() + "-" + Math.random().toString(36).slice(2); }
            try { localStorage.setItem(DKEY, id); } catch (_) { }
        }
        return id;
    }
    function serverUrl() {
        let v; try { v = localStorage.getItem(SKEY); } catch (_) { }
        return (v || NM_LICENSE_SERVER_DEFAULT).replace(/\/+$/, "");
    }
    function setServerUrl(u) { try { localStorage.setItem(SKEY, String(u || "").replace(/\/+$/, "")); } catch (_) { } }
    function getAuth() { try { return JSON.parse(localStorage.getItem(AKEY) || "null"); } catch (_) { return null; } }
    function setAuth(a) { try { localStorage.setItem(AKEY, JSON.stringify(a)); } catch (_) { } }
    function clearAuth() { try { localStorage.removeItem(AKEY); } catch (_) { } }

    let _state = { authed: false, permissions: {} };
    function isAuthed() { return _state.authed === true; }
    function hasPerm(k) { return _state.authed && _state.permissions && _state.permissions[k] !== false; }
    function permissions() { return Object.assign({}, _state.permissions); }

    async function login(code) {
        const res = await fetch(serverUrl() + "/api/auth/login", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: code, deviceId: deviceId() }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error((data && data.error) || "login_failed");
        setAuth({ token: data.token, exp: data.exp, permissions: data.permissions, expiresAt: data.expiresAt });
        _state = { authed: true, permissions: data.permissions || {} };
        return data;
    }
    async function validate() {
        const a = getAuth();
        if (!a || !a.token) { _state = { authed: false, permissions: {} }; return false; }
        try {
            const res = await fetch(serverUrl() + "/api/auth/validate", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token: a.token }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.valid) { clearAuth(); _state = { authed: false, permissions: {} }; return false; }
            _state = { authed: true, permissions: data.permissions || {} };
            return true;
        } catch (_) {
            // Server unreachable: fail CLOSED rather than trusting a cached token.
            _state = { authed: false, permissions: {} };
            return false;
        }
    }
    async function revalidateNow() {
        const result = await validate();
        if (!result) { try { lockdown(); } catch (_) { } }
        else { try { applyPermissionUI(); } catch (_) { } }
        return result;
    }
    function startHeartbeat() {
        try {
            setInterval(nativeify(revalidateNow, 'nmAuthHeartbeat'), 5 * 60 * 1000);
        } catch (_) { }
    }
    function lockdown() {
        try { if (typeof nmReleaseAll === "function") nmReleaseAll(); } catch (_) { }
        try { if (window.__nmCorner && window.__nmCorner.releaseAll) window.__nmCorner.releaseAll(); } catch (_) { }
        try { const p = document.getElementById("controlPanel"); if (p) p.classList.remove("show"); } catch (_) { }
        try { showOverlay(); } catch (_) { }
    }
    function applyPermissionUI() {
        try {
            const map = {
                "nm-tab-lines": ["lines", "pin"],
                "nm-tab-perf": ["fps", "alerts"],
                "nm-tab-colors": ["colors"],
                "nm-tab-rec": ["recorder"],
                "nm-tab-adv": ["macro", "clip", "alerts", "profiles"],
            };
            Object.keys(map).forEach((tabId) => {
                const visible = map[tabId].some((k) => hasPerm(k));
                const pane = document.getElementById(tabId);
                const btn = document.querySelector('.nm-tab-btn[data-tab="' + tabId + '"]');
                if (pane) pane.style.display = visible ? "" : "none";
                if (btn) btn.style.display = visible ? "" : "none";
            });
        } catch (_) { }
    }

    function injectAuthStyles() {
        if (document.getElementById("nm-auth-style")) return;
        const st = document.createElement("style");
        st.id = "nm-auth-style";
        st.textContent = `
#nm-auth-overlay{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:16px;background:radial-gradient(1200px 700px at 80% -10%,rgba(61,220,191,.15),transparent),radial-gradient(900px 520px at -10% 110%,rgba(123,140,255,.13),transparent),rgba(4,7,12,.94);backdrop-filter:blur(10px);font-family:"Segoe UI","Cairo","Tajawal",Tahoma,Arial,sans-serif}
.nm-auth-card{width:min(382px,92vw);padding:28px 26px;direction:rtl;text-align:center;background:linear-gradient(170deg,#111c2e 0%,#0a1220 60%,#070d17 100%);border:1px solid rgba(150,182,226,.2);border-radius:20px;box-shadow:0 34px 84px rgba(0,0,0,.72),inset 0 1px 0 rgba(255,255,255,.06);animation:nmAuthIn .32s cubic-bezier(.22,.8,.28,1)}
@keyframes nmAuthIn{from{opacity:0;transform:translateY(14px) scale(.97)}to{opacity:1;transform:none}}
.nm-auth-logo{width:46px;height:46px;margin:0 auto 12px;display:grid;place-items:center;border-radius:14px;background:linear-gradient(145deg,#7df0d9,#3ddcbf 45%,#1c9c86);color:#04140f;font-size:22px;font-weight:900;box-shadow:0 10px 26px rgba(61,220,191,.35),inset 0 1px 0 rgba(255,255,255,.4)}
.nm-auth-brand{font-size:17px;font-weight:900;letter-spacing:-.2px;color:#eaf2ff;margin-bottom:6px}
.nm-auth-brand span{background:linear-gradient(135deg,#7df0d9,#9db4ff);-webkit-background-clip:text;background-clip:text;color:transparent}
.nm-auth-sub{font-size:11.5px;color:#93a7c6;margin-bottom:20px;line-height:1.9}
.nm-auth-lbl{display:block;text-align:right;font-size:11.5px;font-weight:700;color:#93a7c6;margin-bottom:13px}
.nm-auth-input{width:100%;margin-top:7px;background:#0a111c;border:1px solid rgba(150,182,226,.22);color:#eaf2ff;border-radius:11px;padding:11px 13px;font-size:13.5px;box-sizing:border-box;outline:none;transition:border-color .18s,box-shadow .18s;font-family:inherit}
.nm-auth-input::placeholder{color:rgba(147,167,198,.5)}
.nm-auth-input:focus{border-color:rgba(61,220,191,.7);box-shadow:0 0 0 3px rgba(61,220,191,.18)}
.nm-auth-btn{width:100%;margin-top:4px;padding:12px;border:none;border-radius:11px;font-size:14px;font-weight:900;color:#04140f;cursor:pointer;background:linear-gradient(150deg,#7df0d9,#3ddcbf 45%,#1c9c86);box-shadow:0 10px 24px rgba(61,220,191,.28),inset 0 1px 0 rgba(255,255,255,.3);transition:filter .18s,transform .18s;font-family:inherit}
.nm-auth-btn:hover{filter:brightness(1.05);transform:translateY(-1px)}
.nm-auth-btn:active{transform:none}
.nm-auth-btn:disabled{opacity:.55;cursor:default;transform:none;filter:none}
.nm-auth-msg{min-height:16px;margin-top:13px;font-size:11.5px;font-weight:700;line-height:1.7;color:#ff8a9c}
.nm-auth-msg.ok{color:#63e6b4}
.nm-auth-foot{margin-top:16px;padding-top:14px;border-top:1px solid rgba(150,182,226,.14);font-size:10px;line-height:1.9;color:#93a7c6;opacity:.8}
`;
        document.documentElement.appendChild(st);
    }

    let _onAuthedCb = null;
    function onAuthed() {
        applyPermissionUI();
        startHeartbeat();
        if (_onAuthedCb) { const cb = _onAuthedCb; _onAuthedCb = null; try { cb(); } catch (_) { } }
    }

    function showOverlay() {
        if (!document.body) { setTimeout(showOverlay, 200); return; }
        if (document.getElementById("nm-auth-overlay")) return;
        injectAuthStyles();
        const ov = document.createElement("div");
        ov.id = "nm-auth-overlay";
        ov.innerHTML =
            '<div class="nm-auth-card">' +
            '<div class="nm-auth-logo">N</div>' +
            '<div class="nm-auth-brand">Multi Tabs <span>Controller</span></div>' +
            '<div class="nm-auth-sub">سجّل دخولك بكود التفعيل عشان تقدر تستخدم الأداة<br>مفيش اي امر هيتنفذ قبل التسجيل</div>' +
            '<label class="nm-auth-lbl">سيرفر التفعيل' +
            '<input id="nm-auth-server" class="nm-auth-input" dir="ltr" placeholder="' + NM_LICENSE_SERVER_DEFAULT + '" /></label>' +
            '<label class="nm-auth-lbl">كود الدخول' +
            '<input id="nm-auth-code" class="nm-auth-input" dir="ltr" placeholder="XXXX-XXXX-XXXX" /></label>' +
            '<button id="nm-auth-submit" class="nm-auth-btn">دخول</button>' +
            '<div id="nm-auth-msg" class="nm-auth-msg"></div>' +
            '<div class="nm-auth-foot">الأداة محمية بكود تفعيل — مفيش أي أمر بيتنفذ قبل ما السيرفر يوافق على الكود</div>' +
            '</div>';
        document.body.appendChild(ov);
        const serverInput = ov.querySelector("#nm-auth-server");
        const savedServer = serverUrl();
        serverInput.value = savedServer === NM_LICENSE_SERVER_DEFAULT ? "" : savedServer;
        const codeInput = ov.querySelector("#nm-auth-code");
        const msg = ov.querySelector("#nm-auth-msg");
        const submit = ov.querySelector("#nm-auth-submit");
        const ERR_MAP = {
            invalid_code: "الكود غير صحيح",
            revoked: "تم إلغاء هذا الكود",
            expired: "الكود منتهي الصلاحية",
            device_limit: "تجاوزت عدد الأجهزة المسموح بها لهذا الكود",
            missing_code: "اكتب الكود",
        };
        const doLogin = nativeify(async () => {
            const su = (serverInput.value || NM_LICENSE_SERVER_DEFAULT).trim();
            const code = codeInput.value.trim();
            if (!code) { msg.className = "nm-auth-msg"; msg.textContent = "اكتب الكود"; return; }
            setServerUrl(su);
            submit.disabled = true;
            msg.className = "nm-auth-msg";
            msg.textContent = "جارٍ التحقق...";
            try {
                await login(code);
                msg.className = "nm-auth-msg ok";
                msg.textContent = "تم الدخول ✓";
                try { ov.remove(); } catch (_) { }
                onAuthed();
            } catch (e) {
                const reason = String((e && e.message) || e);
                msg.className = "nm-auth-msg";
                msg.textContent = ERR_MAP[reason] || "تعذر الاتصال بسيرفر التفعيل — تأكد من رابط السيرفر";
            } finally {
                submit.disabled = false;
            }
        }, 'nmAuthSubmit');
        submit.addEventListener("click", doLogin);
        codeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
    }

    async function boot(readyCb) {
        _onAuthedCb = readyCb;
        const cached = getAuth();
        if (cached && cached.token) {
            const ok = await validate();
            if (ok) { onAuthed(); return; }
        }
        showOverlay();
    }

    return { boot, isAuthed, hasPerm, permissions, lockdown, deviceId, serverUrl, applyPermissionUI, revalidateNow };
})();

(function () {
    try {
        const e = nativeify(() => {
            try {
                NMAUTH.boot(() => {
                    try { initWithRetry(20); } catch (_) { }
                    try { NMUPDATE.start(); } catch (_) { }
                    try { nmStartPhysTick(); } catch (_) { }
                });
            } catch (_) { }
        });
        if (document.readyState === "complete" || document.readyState === "interactive") {
            try { setTimeout(e, 1000); } catch (_) { }
        } else {
            try { window.addEventListener("DOMContentLoaded", nativeify(() => { try { setTimeout(e, 1000); } catch (_) { } })); } catch (_) { }
            try { window.addEventListener("load", nativeify(() => { try { setTimeout(e, 1000); } catch (_) { } })); } catch (_) { }
        }
    } catch (_) { }
})();
// ══════════════════════════════════════════════════════════════════════════════
// NMUPDATE — server-driven update channel (v4).
//
// The admin panel can publish a new build of this userscript with one of three
// modes:
//   • off     → nothing is shown
//   • notify  → a banner inside the tool + a toast, the user updates whenever
//   • force   → a blocking screen: the tool refuses to run commands until the
//               installed version is at least `minVersion`
//
// Everything is fail-open: if the update server is unreachable the tool keeps
// working exactly as before (only the licence gate is fail-closed by design).
// ══════════════════════════════════════════════════════════════════════════════
const NMUPDATE = (function () {
    'use strict';
    const K_SEEN = 'nm3_updSeen', K_INFO = 'nm3_updInfo';
    const CHECK_EVERY = 20 * 60 * 1000;          // background poll
    const st = {
        info: null,               // {version, notes, mode, minVersion, url, size, sha256, publishedAt}
        checking: false,
        lastCheck: 0,
        applied: false,
        blocked: false,
        error: ''
    };

    function cmpVersion(a, b) {
        const pa = String(a || '0').replace(/[^0-9.].*$/, '').split('.').map(n => parseInt(n, 10) || 0);
        const pb = String(b || '0').replace(/[^0-9.].*$/, '').split('.').map(n => parseInt(n, 10) || 0);
        const n = Math.max(pa.length, pb.length);
        for (let i = 0; i < n; i++) {
            const x = pa[i] || 0, y = pb[i] || 0;
            if (x !== y) return x > y ? 1 : -1;
        }
        return 0;
    }
    function serverBase() {
        try { return NMAUTH.serverUrl(); } catch (_) { return ''; }
    }
    function downloadUrl() {
        const base = serverBase();
        const u = st.info && st.info.url;
        if (!u) return base + '/api/update/download';
        if (/^https?:\/\//i.test(u)) return u;
        return base + (u.charAt(0) === '/' ? u : '/' + u);
    }
    function seenVersion() { try { return S.get(K_SEEN, '') || ''; } catch (_) { return ''; } }
    function markSeen(v) { try { S.set(K_SEEN, String(v || '')); } catch (_) { } }

    // ── styles (self contained: this may run before the panel stylesheet) ────
    function injectStyles() {
        try {
            if (document.getElementById('nm-update-style')) return;
            if (!document.head && !document.documentElement) return;
            const s = document.createElement('style');
            s.id = 'nm-update-style';
            s.textContent = [
                '#nm-update-overlay{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:16px;background:radial-gradient(1000px 600px at 80% -10%,rgba(255,180,92,.16),transparent),radial-gradient(900px 520px at -10% 110%,rgba(61,220,191,.14),transparent),rgba(4,7,12,.93);backdrop-filter:blur(10px);font-family:"Segoe UI","Cairo",Tahoma,Arial,sans-serif}',
                '.nm-uo-card{width:min(430px,92vw);padding:26px 24px;text-align:center;direction:rtl;background:linear-gradient(170deg,#111c2e,#080e18);border:1px solid rgba(255,180,92,.34);border-radius:20px;box-shadow:0 34px 80px rgba(0,0,0,.72),inset 0 1px 0 rgba(255,255,255,.06);color:#eaf2ff}',
                '.nm-uo-badge{display:inline-flex;align-items:center;gap:7px;margin-bottom:14px;padding:5px 14px;font-size:11px;font-weight:900;color:#2a1a04;background:linear-gradient(145deg,#ffd08a,#ffb45c);border-radius:999px}',
                '.nm-uo-title{font-size:20px;font-weight:900;margin-bottom:6px}',
                '.nm-uo-sub{font-size:11.5px;line-height:1.9;color:#93a7c6;margin-bottom:16px}',
                '.nm-uo-vers{display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:14px;font-size:11px;color:#93a7c6}',
                '.nm-uo-vers b{font-size:14px;font-weight:900;color:#eaf2ff;font-variant-numeric:tabular-nums}',
                '.nm-uo-vers .arrow{color:#ffc46b;font-weight:900}',
                '.nm-uo-notes{max-height:150px;overflow:auto;margin-bottom:14px;padding:10px 12px;text-align:right;font-size:11px;line-height:1.9;color:#93a7c6;white-space:pre-wrap;background:rgba(0,0,0,.3);border:1px solid rgba(150,182,226,.16);border-radius:10px}',
                '.nm-uo-actions{display:flex;flex-direction:column;gap:8px}',
                '.nm-uo-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:42px;padding:0 16px;font-family:inherit;font-size:13px;font-weight:900;color:#04140f;background:linear-gradient(150deg,#7df0d9,#3ddcbf 45%,#1c9c86);border:1px solid rgba(255,255,255,.18);border-radius:12px;cursor:pointer;box-shadow:0 10px 24px rgba(61,220,191,.25)}',
                '.nm-uo-btn:hover{filter:brightness(1.06)}',
                '.nm-uo-btn.ghost{color:#eaf2ff;background:rgba(255,255,255,.06);border-color:rgba(150,182,226,.22);box-shadow:none;font-weight:800}',
                '.nm-uo-note{font-size:10px;line-height:1.8;color:#93a7c6;opacity:.85;margin-top:12px}',
                '#nm-update-banner{display:none;align-items:center;gap:10px;margin:10px 16px 0;padding:9px 12px;font-size:11.5px;font-weight:700;color:#2a1a04;background:linear-gradient(145deg,#ffd08a,#ffb45c);border-radius:11px;box-shadow:0 8px 20px rgba(255,180,92,.22);font-family:"Segoe UI","Cairo",Tahoma,Arial,sans-serif}',
                '#nm-update-banner.show{display:flex}',
                '#nm-update-banner .nm-ub-text{flex:1;min-width:0;line-height:1.6}',
                '#nm-update-banner button{flex:none;height:26px;padding:0 10px;font-family:inherit;font-size:10.5px;font-weight:900;color:#2a1a04;background:rgba(255,255,255,.55);border:1px solid rgba(0,0,0,.12);border-radius:8px;cursor:pointer}',
                '#nm-update-banner button:hover{background:#fff}',
                '#nm-update-banner .nm-ub-close{background:transparent;border-color:transparent;font-size:15px;line-height:1;width:24px;padding:0}',
                '.nm-update-modal{position:absolute;inset:0;z-index:45;display:none;align-items:center;justify-content:center;padding:16px;background:rgba(4,7,12,.72);backdrop-filter:blur(6px);border-radius:18px;font-family:"Segoe UI","Cairo",Tahoma,Arial,sans-serif}',
                '.nm-update-modal.show{display:flex}',
                '.nm-um-card{position:relative;width:min(460px,100%);max-height:100%;display:flex;flex-direction:column;gap:12px;padding:18px;background:linear-gradient(165deg,#101b2c,#080e18);border:1px solid rgba(150,182,226,.22);border-radius:16px;box-shadow:0 30px 70px rgba(0,0,0,.6);color:#eaf2ff;direction:rtl}',
                '.nm-um-head{display:flex;align-items:center;gap:10px}',
                '.nm-um-ico{width:36px;height:36px;flex:none;display:grid;place-items:center;font-size:17px;border-radius:11px;background:rgba(61,220,191,.14);border:1px solid rgba(61,220,191,.3)}',
                '.nm-um-head h3{margin:0;font-size:14px;font-weight:900}',
                '.nm-um-head small{display:block;font-size:10px;color:#93a7c6;font-weight:600}',
                '.nm-um-notes{max-height:170px;overflow:auto;padding:10px 12px;font-size:11.5px;line-height:1.9;color:#93a7c6;white-space:pre-wrap;background:rgba(0,0,0,.28);border:1px solid rgba(150,182,226,.16);border-radius:10px}',
                '.nm-um-foot{display:flex;gap:8px;justify-content:flex-end}',
                '.nm-um-foot .nm-uo-btn{height:34px;font-size:12px}',
                '.nm-modal-close{position:absolute;top:10px;left:10px;width:30px;height:30px;display:grid;place-items:center;font-size:16px;color:#93a7c6;background:rgba(255,255,255,.05);border:1px solid rgba(150,182,226,.18);border-radius:9px;cursor:pointer}',
                '.nm-modal-close:hover{color:#fff;background:rgba(255,255,255,.12)}'
            ].join('\n');
            (document.head || document.documentElement).appendChild(s);
        } catch (_) { }
    }

    // ── UI ───────────────────────────────────────────────────────────────────
    function info() { return st.info; }
    function isBlocked() { return st.blocked === true; }
    function notesText() {
        const n = (st.info && st.info.notes) || '';
        return String(n).slice(0, 1200);
    }
    function renderPanel() {
        try {
            const chip = document.getElementById('nm-update-chip');
            const banner = document.getElementById('nm-update-banner');
            const text = document.getElementById('nm-ub-text');
            const has = !!(st.info && st.info.available);
            if (chip) chip.hidden = !has;
            if (banner) banner.classList.toggle('show', !!(has && !st.blocked));
            if (text && has) {
                text.innerHTML = 'تحديث جديد <b>v' + String(st.info.version) + '</b>' +
                    (st.blocked ? ' — مطلوب لتشغيل الأداة' : ' متاح الآن');
            }
            const circle = document.getElementById('nm-floating-circle');
            if (circle) circle.classList.toggle('nm-has-update', has);
            const ver = document.getElementById('nm-ver-chip-num');
            if (ver) ver.textContent = NM_VERSION;
        } catch (_) { }
    }

    function overlay(force) {
        if (!document.body) { setTimeout(() => overlay(force), 250); return; }
        injectStyles();
        let ov = document.getElementById('nm-update-overlay');
        if (!ov) {
            ov = document.createElement('div');
            ov.id = 'nm-update-overlay';
            document.body.appendChild(ov);
        }
        const cur = NM_VERSION, next = (st.info && st.info.version) || '—';
        const notes = notesText();
        ov.innerHTML =
            '<div class="nm-uo-card">' +
            '<div class="nm-uo-badge">' + (force ? '⛔ تحديث إجباري' : '⬆ تحديث متاح') + '</div>' +
            '<div class="nm-uo-title">' + (force ? 'لازم تحدّث الأداة الأول' : 'فيه إصدار جديد من الأداة') + '</div>' +
            '<div class="nm-uo-sub">' + (force
                ? 'الإصدار اللي عندك اتوقف دعمه. نزّل الإصدار الجديد واستبدل السكريبت في Tampermonkey عشان الأوامر تشتغل تاني.'
                : 'نزّل الإصدار الجديد عشان تحصل على آخر إصلاحات اللاينات والزوايا.') + '</div>' +
            '<div class="nm-uo-vers"><span>عندك <b>v' + cur + '</b></span><span class="arrow">←</span><span>الجديد <b>v' + next + '</b></span></div>' +
            (notes ? '<div class="nm-uo-notes">' + escapeHtml(notes) + '</div>' : '') +
            '<div class="nm-uo-actions">' +
            '<button class="nm-uo-btn" id="nm-uo-download">⬇ تحميل التحديث</button>' +
            '<button class="nm-uo-btn ghost" id="nm-uo-recheck">🔄 تحقق مرة أخرى</button>' +
            (force ? '' : '<button class="nm-uo-btn ghost" id="nm-uo-later">لاحقًا</button>') +
            '</div>' +
            '<div class="nm-uo-note">بعد التحميل: افتح الملف في Tampermonkey → ثبّت / استبدل، وبعدها اعمل تحديث للصفحة.</div>' +
            '</div>';
        const dl = ov.querySelector('#nm-uo-download');
        if (dl) dl.onclick = () => { try { window.open(downloadUrl(), '_blank', 'noopener'); } catch (_) { } };
        const re = ov.querySelector('#nm-uo-recheck');
        if (re) re.onclick = async () => { re.disabled = true; re.textContent = '... جارٍ التحقق'; await check(true); };
        const later = ov.querySelector('#nm-uo-later');
        if (later) later.onclick = () => { try { ov.remove(); } catch (_) { } markSeen(next); };
    }
    function hideOverlay() { try { const ov = document.getElementById('nm-update-overlay'); if (ov) ov.remove(); } catch (_) { } }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function openModal() {
        try {
            if (!st.info || !st.info.available) return;
            if (st.blocked) { overlay(true); return; }
            injectStyles();
            const host = document.querySelector('#controlPanel .nm-tab-content-container') ||
                document.querySelector('.nm-tab-content-container');
            if (!host) { overlay(false); return; }
            let box = document.getElementById('nm-update-modal');
            if (!box) {
                box = document.createElement('div');
                box.id = 'nm-update-modal';
                box.className = 'nm-update-modal';
                host.appendChild(box);
            }
            box.innerHTML =
                '<div class="nm-um-card">' +
                '<button class="nm-modal-close" id="nm-um-x" title="إغلاق">×</button>' +
                '<div class="nm-um-head"><span class="nm-um-ico">⬆</span><div><h3>تحديث الأداة</h3>' +
                '<small>الإصدار الحالي v' + NM_VERSION + ' · الجديد v' + st.info.version + '</small></div></div>' +
                (notesText() ? '<div class="nm-um-notes">' + escapeHtml(notesText()) + '</div>' : '') +
                '<div class="nm-um-foot">' +
                '<button class="nm-uo-btn ghost" id="nm-um-close">إغلاق</button>' +
                '<button class="nm-uo-btn" id="nm-um-dl">⬇ تحميل</button>' +
                '</div></div>';
            box.classList.add('show');
            const close = () => box.classList.remove('show');
            const x = box.querySelector('#nm-um-x'), c2 = box.querySelector('#nm-um-close');
            if (x) x.onclick = close;
            if (c2) c2.onclick = close;
            const d = box.querySelector('#nm-um-dl');
            if (d) d.onclick = () => { try { window.open(downloadUrl(), '_blank', 'noopener'); } catch (_) { } };
        } catch (_) { }
    }

    // ── core ─────────────────────────────────────────────────────────────────
    function apply(data) {
        st.info = data || null;
        const cur = NM_VERSION;
        let available = false, force = false;
        if (data && data.version) {
            available = cmpVersion(data.version, cur) > 0;
            const minV = data.minVersion || data.version;
            force = available && (data.mode === 'force' || cmpVersion(cur, minV) < 0);
        }
        if (st.info) { st.info.available = available; st.info.force = force; }
        const wasBlocked = st.blocked;
        st.blocked = !!force;
        try { S.set(K_INFO, JSON.stringify(st.info || {})); } catch (_) { }
        renderPanel();
        if (force) {
            if (!wasBlocked) {
                try { nmReleaseAll(); } catch (_) { }
                overlay(true);
            }
        } else {
            hideOverlay();
            if (available && seenVersion() !== String(st.info.version)) {
                markSeen(st.info.version);
                try { nmToast('تحديث جديد متاح للأداة: v' + st.info.version); } catch (_) { }
            }
        }
        st.lastCheck = Date.now();
        st.applied = true;
        try { console.log('[Nightmare] فحص التحديث:', JSON.stringify(st.info)); } catch (_) { }
    }

    async function check(silent) {
        if (st.checking) return false;
        const base = serverBase();
        if (!base) return false;
        st.checking = true;
        try {
            const url = base + '/api/update/check?version=' + encodeURIComponent(NM_VERSION) +
                '&page=' + encodeURIComponent(String((typeof myPage !== 'undefined' ? myPage : 1))) +
                '&t=' + Date.now();
            const res = await fetch(url, { cache: 'no-store' });
            if (!res.ok) throw new Error('http_' + res.status);
            const data = await res.json().catch(() => ({}));
            if (!data || data.ok !== true) throw new Error('bad_payload');
            apply(data.update || null);
            st.error = '';
            return true;
        } catch (e) {
            st.error = String((e && e.message) || e);
            if (!silent) { try { nmToast('تعذر فحص التحديثات — ' + st.error); } catch (_) { } }
            return false;
        } finally {
            st.checking = false;
        }
    }

    function start() {
        try { injectStyles(); } catch (_) { }
        // show the last known state instantly (no flash of a stale banner)
        try {
            const cached = JSON.parse(S.get(K_INFO, 'null') || 'null');
            if (cached && cached.version) apply(cached);
        } catch (_) { }
        setTimeout(() => { check(true); }, 1500);
        setInterval(() => { check(true); }, CHECK_EVERY);
        try {
            document.addEventListener('visibilitychange', () => {
                try { if (!document.hidden && Date.now() - st.lastCheck > 5 * 60 * 1000) check(true); } catch (_) { }
            });
        } catch (_) { }
        try {
            // wire the always-visible entry points as soon as they exist
            const tick = setInterval(() => {
                try {
                    const chip = document.getElementById('nm-update-chip');
                    const go = document.getElementById('nm-ub-go');
                    const close = document.getElementById('nm-ub-close');
                    if (chip && !chip.__nmWired) { chip.__nmWired = true; chip.onclick = openModal; }
                    if (go && !go.__nmWired) { go.__nmWired = true; go.onclick = openModal; }
                    if (close && !close.__nmWired) {
                        close.__nmWired = true;
                        close.onclick = () => { try { markSeen((st.info && st.info.version) || ''); } catch (_) { } document.getElementById('nm-update-banner').classList.remove('show'); };
                    }
                    if (document.getElementById('nm-update-chip')) { renderPanel(); clearInterval(tick); }
                } catch (_) { }
            }, 700);
            setTimeout(() => clearInterval(tick), 20000);
        } catch (_) { }
    }

    return {
        start: start, check: check, isBlocked: isBlocked, info: info, apply: apply,
        openModal: openModal, overlay: overlay, renderPanel: renderPanel,
        downloadUrl: downloadUrl, cmpVersion: cmpVersion, st: st
    };
})();

// Direction → game-world coordinate offsets for pkt_move
// Use values well beyond any map boundary (~14142 units for standard maps)
const MOUSE_MOVE_COORDS = {
    Left: {
        x: e => -9999999,
        y: e => e / 2
    },
    Right: {
        x: e => e + 9999999,
        y: e => e / 2
    },
    Up: {
        x: e => e / 2,
        y: e => -9999999
    },
    Down: {
        x: e => e / 2,
        y: e => e + 9999999
    },
    TopLeft: {
        x: e => -9999999,
        y: e => -9999999
    },
    TopRight: {
        x: e => e + 9999999,
        y: e => -9999999
    },
    BottomLeft: {
        x: e => -9999999,
        y: e => e + 9999999
    },
    BottomRight: {
        x: e => e + 9999999,
        y: e => e + 9999999
    }
};
function handleMouseMovement(dir, page) {
    try {
        const ts = Date.now();
        if (page === "current" || page === "both") { try { nmLinePress(dir, ts); } catch (_) { } }
        if (page === "opposite" || page === "both") { nmPostToOther({ type: "line_press", dir: dir, ts: ts }); }
    } catch (_) { }
}
function handleMouseMoveLocal(dir) {
    try { nmLinePress(dir, Date.now()); } catch (_) { }
}
function mapNormalToMoveDir(e) {
    try {
        return {
            BottomLeft: "BottomLeft",
            MiddleBottom: "Down",
            BottomRight: "BottomRight",
            Left: "Left",
            Center: "Left",
            Right: "Right",
            TopLeft: "TopLeft",
            Top: "Up",
            TopRight: "TopRight",
            Topc: "Up"
        }[e] || "Down";
    } catch (_) { }
}
function handleNormalLineMovement(e, t) {
    try {
        if (t === "current" || t === "both") { try { handleNormalLineMoveLocal(e); } catch (_) { } }
        if (t === "opposite" || t === "both") {
            nmPostToOther({ type: "normal_line_move", position: e });
        }
    } catch (_) { }
}
function handleNormalLineMoveLocal(pos) {
    try {
        if (window.activeNormalLock === pos) {
            window.activeNormalLock = null;
        } else {
            window.activeNormalLock = pos;
            window.activeMovementLock = null;
        }
    } catch (_) { }
}
function dispatchMouseLike(e, t, o) {
    try {
        if (window.PointerEvent) {
            try { e.dispatchEvent(new PointerEvent(t, { ...o, pointerId: 1, pointerType: "mouse", isPrimary: true })); }
            catch (_) { try { e.dispatchEvent(new MouseEvent(t, o)); } catch (_) { } }
        } else {
            try { e.dispatchEvent(new MouseEvent(t, o)); } catch (_) { }
        }
    } catch (_) { }
}
function dispatchMoveOnly(e, t, o) {
    try {
        const n = {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: t,
            clientY: o
        };
        if (window.PointerEvent) {
            try {
                e.dispatchEvent(new PointerEvent("pointermove", {
                    ...n,
                    pointerId: 1,
                    pointerType: "mouse",
                    isPrimary: true,
                    buttons: 0
                }));
            } catch (_) { }
        }
        e.dispatchEvent(new MouseEvent("mousemove", n));
    } catch (_) { }
}
function getNormalLineCoords(e, t = 50) {
    const o = canvasElement || getCanvasElement();
    const n = (e, t, o) => Math.min(o, Math.max(t, e));
    const a = o => {
        const a = o.left + o.width / 2;
        const l = o.top + o.height / 2;
        const i = Math.min(o.width, o.height) - t * 2;
        const m = i / 2;
        const r = {
            BottomLeft: {
                x: a - m,
                y: l + m
            },
            MiddleBottom: {
                x: a,
                y: l + m
            },
            BottomRight: {
                x: a + m,
                y: l + m
            },
            Left: {
                x: a - m,
                y: l
            },
            Center: {
                x: a,
                y: l
            },
            Right: {
                x: a + m,
                y: l
            },
            TopLeft: {
                x: a - m,
                y: l - m
            },
            Top: {
                x: a,
                y: l - m
            },
            TopRight: {
                x: a + m,
                y: l - m
            },
            Topc: {
                x: a,
                y: l - i * 0.1
            }
        };
        const d = r[e] || r.Center;
        return {
            x: n(d.x, o.left + t, o.right - t),
            y: n(d.y, o.top + t, o.bottom - t)
        };
    };
    if (o && typeof o.getBoundingClientRect == "function") {
        return a(o.getBoundingClientRect());
    }
    {
        const e = document.documentElement.clientWidth;
        const t = document.documentElement.clientHeight;
        return a({
            left: 0,
            top: 0,
            width: e,
            height: t,
            right: e,
            bottom: t
        });
    }
}
function getCanvasElement() {
    try { return document.querySelector("canvas"); } catch (_) { return null; }
}
function executeCustomization(e, t) {
    try {
        if (e.executionMode === "once") {
            try { executeActions(e.actions); } catch (_) { }
        } else if (e.executionMode === "continuous") {
            if (activeCustomizations[t]) {
                try { clearInterval(intervals[t]); } catch (_) { }
                delete activeCustomizations[t];
            } else {
                activeCustomizations[t] = true;
                intervals[t] = setInterval(nativeify(() => {
                    try { executeActions(e.actions); } catch (_) { }
                }, 'custInterval'), e.continuousInterval);
            }
        }
    } catch (_) { }
}
function executeActions(e) {
    try {
        e.forEach(e => {
            try {
                for (let t = 0; t < e.repeat; t++) {
                    const o = t * 50;
                    if (e.page === "current" || e.page === "both") {
                        setTimeout(nativeify(() => { try { sendBinaryMessage(e.message); } catch (_) { } }), o);
                    }
                    if (e.page === "opposite" || e.page === "both") {
                        setTimeout(nativeify(() => {
                            nmPostToOther({ type: "execute_actions", actions: [{ message: e.message }] });
                        }), o);
                    }
                }
            } catch (_) { }
        });
    } catch (_) { }
}
let timer;
function loadAllStyle() {
    try {
        const e = document.createElement("style");
        e.type = "text/css";
        e.innerHTML = `
:root{
  color-scheme:dark;
  --bg-dark:#060a11;
  --menu-bg:#0b1220;
  --nm-surface:#0e1727;
  --nm-card:#101b2c;
  --nm-card-2:#152238;
  --nm-elev:#1b2a44;
  --nm-line:rgba(150,182,226,.12);
  --nm-line-strong:rgba(150,182,226,.22);
  --primary-red:#3ddcbf;
  --primary-rgb:61,220,191;
  --primary-dark:#1c9c86;
  --hover-red:#7df0d9;
  --text-light:#eaf2ff;
  --text-dim:#93a7c6;
  --input-bg:#0a111c;
  --border-glow:rgba(var(--primary-rgb),.45);
  --special-btn-bg:#eaf6ff;
  --special-btn-text:#0b1220;
  --nm-good:#4ade80;
  --nm-warn:#ffc46b;
  --nm-danger:#ff6f8b;
  --nm-radius:18px;
  --nm-radius-sm:12px;
  --nm-shadow:0 30px 80px rgba(2,6,14,.72),0 2px 0 rgba(255,255,255,.04) inset;
  --nm-focus:0 0 0 3px rgba(var(--primary-rgb),.22);
  --nm-ease:cubic-bezier(.22,.8,.28,1);
}

.nm-menu-container,.nm-menu-container *,#nm-floating-circle,#nm-floating-circle *,#nm-hud,#nm-hud *,.nm-toast,#nm-setup-overlay,#nm-setup-overlay *,#nm-update-banner,#nm-update-banner *,#nm-update-overlay,#nm-update-overlay *{box-sizing:border-box;font-family:"Segoe UI","Cairo","Tajawal",Tahoma,Roboto,Arial,sans-serif}
.nm-menu-container *::-webkit-scrollbar{width:8px;height:8px}
.nm-menu-container *::-webkit-scrollbar-track{background:transparent}
.nm-menu-container *::-webkit-scrollbar-thumb{background:rgba(var(--primary-rgb),.32);border:2px solid transparent;background-clip:padding-box;border-radius:99px}
.nm-menu-container *::-webkit-scrollbar-thumb:hover{background:rgba(var(--primary-rgb),.55);background-clip:padding-box}

/* ═══════════ Panel shell ═══════════ */
.nm-menu-container{
  position:fixed;
  display:none;
  flex-direction:column;
  width:min(780px,calc(100vw - 20px));
  height:min(640px,calc(100dvh - 20px));
  min-width:0;
  padding:0;
  overflow:hidden;
  isolation:isolate;
  color:var(--text-light);
  background:
    radial-gradient(120% 90% at 100% 0%,rgba(var(--primary-rgb),.13),transparent 62%),
    radial-gradient(90% 70% at 0% 100%,rgba(123,140,255,.10),transparent 66%),
    linear-gradient(160deg,#0d1626 0%,#080e19 58%,#070b13 100%);
  border:1px solid var(--nm-line-strong);
  border-radius:var(--nm-radius);
  box-shadow:var(--nm-shadow);
  z-index:2147482000;
  backdrop-filter:blur(22px) saturate(120%);
  -webkit-backdrop-filter:blur(22px) saturate(120%);
}
.nm-menu-container.show{display:flex;animation:nmPanelIn .26s var(--nm-ease)}
@keyframes nmPanelIn{from{opacity:0;transform:translateY(10px) scale(.985)}to{opacity:1;transform:none}}
.nm-menu-container::before{
  content:"";
  position:absolute;
  inset:0;
  z-index:0;
  pointer-events:none;
  background:
    linear-gradient(180deg,rgba(255,255,255,.045),transparent 140px),
    radial-gradient(600px 300px at 15% -20%,rgba(var(--primary-rgb),.10),transparent 70%);
  border-radius:inherit;
}
.nm-menu-container::after{
  content:"";
  position:absolute;
  top:0;left:0;right:0;
  height:1px;
  z-index:2;
  pointer-events:none;
  background:linear-gradient(90deg,transparent,rgba(var(--primary-rgb),.75),rgba(123,140,255,.6),transparent);
  opacity:.85;
}
.nm-menu-container>*{position:relative;z-index:1}

/* ═══════════ Header ═══════════ */
.nm-close-btn{
  position:absolute;top:14px;left:14px;
  width:34px;height:34px;
  display:flex;align-items:center;justify-content:center;
  padding:0;font-size:20px;line-height:1;
  color:var(--text-dim);
  background:rgba(255,255,255,.05);
  border:1px solid var(--nm-line);
  border-radius:11px;
  cursor:pointer;
  transition:color .18s,border-color .18s,background .18s,transform .18s var(--nm-ease);
}
.nm-close-btn:hover{color:#fff;background:rgba(255,111,139,.16);border-color:rgba(255,111,139,.42);transform:rotate(90deg)}
.nm-special-top-btn{
  position:absolute;top:14px;right:14px;z-index:6;
  height:34px;padding:0 14px;
  display:inline-flex;align-items:center;gap:7px;
  font-size:12px;font-weight:800;
  color:var(--special-btn-text);
  background:var(--special-btn-bg);
  border:none;border-radius:11px;
  cursor:pointer;
  box-shadow:0 8px 20px rgba(0,0,0,.35);
  transition:transform .18s var(--nm-ease),box-shadow .18s,filter .18s;
}
.nm-special-top-btn:hover{transform:translateY(-1px);box-shadow:0 12px 26px rgba(0,0,0,.45);filter:brightness(1.04)}
.nm-special-top-btn:active{transform:translateY(0) scale(.98)}

.nm-menu-header{
  display:flex;flex-direction:column;align-items:center;gap:8px;
  padding:14px 60px 12px;
  border-bottom:1px solid var(--nm-line);
  background:linear-gradient(180deg,rgba(255,255,255,.035),transparent);
}
.nm-menu-header .nm-brand-row{display:flex;align-items:center;gap:10px}
.nm-brand-mark{
  width:30px;height:30px;flex:none;
  display:grid;place-items:center;
  border-radius:9px;
  background:linear-gradient(145deg,rgba(var(--primary-rgb),.95),rgba(123,140,255,.85));
  color:#04140f;
  font-weight:900;font-size:15px;
  box-shadow:0 6px 16px rgba(var(--primary-rgb),.3),inset 0 1px 0 rgba(255,255,255,.35);
}
.nm-menu-header h2{
  margin:0;
  font-size:19px;
  font-weight:800;
  letter-spacing:-.2px;
  color:var(--text-light);
  text-align:center;
}
.nm-menu-header h2 span{color:var(--primary-red);text-shadow:none}
.nm-menu-sub{font-size:11px;color:var(--text-dim);letter-spacing:.2px}
.nm-header-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:center}
.nm-page-chip{
  display:inline-flex;align-items:center;gap:7px;
  padding:4px 6px 4px 12px;
  font-size:11px;font-weight:700;
  color:var(--text-dim);
  background:rgba(255,255,255,.045);
  border:1px solid var(--nm-line);
  border-radius:999px;
}
.nm-page-chip b{
  display:inline-grid;place-items:center;
  min-width:22px;height:22px;padding:0 6px;
  font-size:12px;font-weight:900;
  color:#04140f;
  background:linear-gradient(145deg,var(--primary-red),var(--primary-dark));
  border-radius:999px;
  box-shadow:0 2px 10px rgba(var(--primary-rgb),.35);
}
.nm-ver-chip{
  display:inline-flex;align-items:center;gap:6px;
  padding:4px 10px;
  font-size:10.5px;font-weight:800;letter-spacing:.3px;
  color:var(--text-dim);
  background:rgba(255,255,255,.04);
  border:1px solid var(--nm-line);
  border-radius:999px;
}
.nm-ver-chip b{color:var(--primary-red);font-weight:900}
.nm-update-chip{
  display:inline-flex;align-items:center;gap:6px;
  height:26px;padding:0 11px;
  font-size:11px;font-weight:800;
  color:#04140f;
  background:linear-gradient(145deg,var(--nm-warn),#ffd9a0);
  border:none;border-radius:999px;
  cursor:pointer;
  box-shadow:0 4px 14px rgba(255,196,107,.28);
  animation:nmUpdatePulse 2.4s ease-in-out infinite;
}
.nm-update-chip:hover{filter:brightness(1.06)}
@keyframes nmUpdatePulse{0%,100%{box-shadow:0 4px 14px rgba(255,196,107,.24)}50%{box-shadow:0 4px 22px rgba(255,196,107,.5)}}
.nm-update-chip[hidden]{display:none!important}

/* ═══════════ Body / nav ═══════════ */
.nm-menu-body{
  display:flex;
  flex:1 1 auto;
  flex-direction:row;
  gap:0;
  width:100%;
  min-height:0;
  padding:0;
}
.nm-side-nav{
  display:flex;
  flex-direction:column;
  gap:6px;
  width:72px;
  flex:none;
  padding:12px 8px;
  border-inline-end:1px solid var(--nm-line);
  background:linear-gradient(180deg,rgba(255,255,255,.02),transparent);
}
.nm-tab-btn{
  position:relative;
  width:100%;
  min-height:54px;
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;
  padding:7px 4px;
  color:var(--text-dim);
  background:transparent;
  border:1px solid transparent;
  border-radius:13px;
  cursor:pointer;
  transition:color .18s,background .18s,border-color .18s,transform .18s var(--nm-ease);
}
.nm-tab-btn svg{width:20px;height:20px;opacity:.92}
.nm-tab-btn em{font-style:normal;font-size:9.5px;font-weight:700;letter-spacing:.1px;opacity:.88}
.nm-tab-btn:hover{color:var(--text-light);background:rgba(255,255,255,.05);border-color:var(--nm-line);transform:translateY(-1px)}
.nm-tab-btn.active{
  color:var(--primary-red);
  background:linear-gradient(160deg,rgba(var(--primary-rgb),.18),rgba(var(--primary-rgb),.045));
  border-color:rgba(var(--primary-rgb),.34);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 6px 16px rgba(0,0,0,.22);
}
.nm-tab-btn.active::before{
  content:"";position:absolute;inset-inline-end:-9px;top:50%;transform:translateY(-50%);
  width:3px;height:22px;border-radius:99px;
  background:linear-gradient(180deg,var(--primary-red),rgba(var(--primary-rgb),.25));
  box-shadow:0 0 12px rgba(var(--primary-rgb),.6);
}

/* ═══════════ Content ═══════════ */
.nm-tab-content-container{
  flex:1 1 auto;
  display:flex;
  flex-direction:column;
  min-width:0;
  min-height:0;
  padding:0 0 32px;
  overflow:hidden;
  background:transparent;
  border:none;
  border-radius:0;
}
.nm-tab-pane{
  display:none;
  flex:1 1 auto;
  flex-direction:column;
  gap:12px;
  width:100%;
  min-height:0;
  padding:14px 16px 18px;
  overflow-y:auto;
  overscroll-behavior:contain;
  scrollbar-gutter:stable;
}
.nm-tab-pane.active{display:flex;animation:nmPaneIn .22s var(--nm-ease)}
@keyframes nmPaneIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}

.nm-section-title{
  display:flex;align-items:center;gap:8px;
  margin:2px 2px -2px;
  font-size:12px;font-weight:800;letter-spacing:.2px;
  color:var(--text-dim);
  text-transform:none;
}
.nm-section-title::before{
  content:"";width:6px;height:6px;border-radius:2px;
  background:linear-gradient(145deg,var(--primary-red),#7b8cff);
  box-shadow:0 0 10px rgba(var(--primary-rgb),.55);
}
.nm-section-title .nm-spacer{flex:1}

.nm-card{
  display:flex;flex-direction:column;gap:10px;
  padding:14px;
  background:linear-gradient(160deg,rgba(255,255,255,.042),rgba(255,255,255,.012)) ,var(--nm-card);
  border:1px solid var(--nm-line);
  border-radius:var(--nm-radius-sm);
  box-shadow:0 10px 26px rgba(0,0,0,.22),inset 0 1px 0 rgba(255,255,255,.045);
}
.nm-card-title{
  display:flex;align-items:center;gap:8px;
  padding-bottom:9px;margin-bottom:2px;
  font-size:13.5px;font-weight:800;
  color:var(--text-light);
  border-bottom:1px solid var(--nm-line);
}
.nm-card-title .nm-ico{
  display:grid;place-items:center;width:24px;height:24px;
  font-size:13px;border-radius:8px;
  background:rgba(var(--primary-rgb),.13);
  border:1px solid rgba(var(--primary-rgb),.22);
}
.nm-note{font-size:11px;line-height:1.85;color:var(--text-dim);opacity:.92}
.nm-live{font-size:12px;color:var(--text-dim)}
.nm-live b{color:var(--primary-red);font-weight:800}
.nm-diag-line{font-size:11px;line-height:1.8;color:var(--text-dim);word-break:break-word}
.nm-diag-line b{color:var(--text-light)}

/* ═══════════ Buttons ═══════════ */
.nm-action-buttons-row{display:flex;gap:10px}
.nm-btn-main,.nm-chip-btn{
  font-family:inherit;
  cursor:pointer;
  transition:transform .16s var(--nm-ease),box-shadow .18s,background .18s,border-color .18s,filter .18s;
}
.nm-btn-main{
  flex:1;
  height:38px;
  padding:0 14px;
  display:inline-flex;align-items:center;justify-content:center;gap:7px;
  font-size:12.5px;font-weight:800;
  color:#04140f;
  background:linear-gradient(150deg,var(--hover-red),var(--primary-red) 42%,var(--primary-dark));
  border:1px solid rgba(255,255,255,.14);
  border-radius:11px;
  box-shadow:0 8px 20px rgba(var(--primary-rgb),.22),inset 0 1px 0 rgba(255,255,255,.3);
}
.nm-btn-main:hover{filter:brightness(1.05);transform:translateY(-1px);box-shadow:0 12px 26px rgba(var(--primary-rgb),.3)}
.nm-btn-main:active{transform:translateY(0) scale(.99)}
.nm-btn-main[disabled]{opacity:.5;cursor:not-allowed;transform:none}
.nm-chip-btn{
  display:inline-flex;align-items:center;justify-content:center;gap:6px;
  min-height:32px;padding:6px 13px;
  font-size:11.5px;font-weight:800;
  color:var(--text-light);
  background:rgba(255,255,255,.055);
  border:1px solid var(--nm-line-strong);
  border-radius:10px;
}
.nm-chip-btn:hover{background:rgba(var(--primary-rgb),.16);border-color:rgba(var(--primary-rgb),.4);transform:translateY(-1px)}
.nm-chip-btn:active{transform:translateY(0)}
.nm-chip-btn.primary{
  color:#04140f;
  background:linear-gradient(150deg,var(--hover-red),var(--primary-red) 45%,var(--primary-dark));
  border-color:rgba(255,255,255,.16);
  box-shadow:0 6px 16px rgba(var(--primary-rgb),.22);
}
.nm-chip-btn.primary:hover{filter:brightness(1.05)}
.nm-chip-btn.danger{color:var(--nm-danger);background:rgba(255,111,139,.10);border-color:rgba(255,111,139,.3)}
.nm-chip-btn.danger:hover{background:rgba(255,111,139,.2)}
.nm-chip-btn.mini{min-height:26px;padding:3px 9px;font-size:10.5px;border-radius:8px}
.nm-btn-icon{
  display:inline-flex;align-items:center;justify-content:center;
  width:30px;height:30px;padding:0;
  color:var(--text-dim);
  background:rgba(255,255,255,.04);
  border:1px solid var(--nm-line);
  border-radius:9px;
  cursor:pointer;
  transition:all .18s;
}
.nm-btn-icon:hover{color:#fff;background:rgba(255,255,255,.1)}
.nm-btn-icon.nm-danger-icon:hover{color:#fff;background:rgba(255,111,139,.26);border-color:rgba(255,111,139,.45)}

/* ═══════════ Inputs / selects / switches ═══════════ */
.nm-dark-input,.nm-dark-select,.nm-mini-select{
  font-family:inherit;
  font-size:12px;
  color:var(--text-light);
  background:var(--input-bg);
  border:1px solid var(--nm-line-strong);
  border-radius:10px;
  outline:none;
  transition:border-color .18s,box-shadow .18s,background .18s;
}
.nm-dark-input,.nm-dark-select{flex:1;min-width:0;padding:8px 11px}
.nm-dark-input::placeholder{color:rgba(147,167,198,.55)}
.nm-dark-input:focus,.nm-dark-select:focus,.nm-mini-select:focus{border-color:rgba(var(--primary-rgb),.65);box-shadow:var(--nm-focus);background:#0c1524}
.nm-dark-input.mini{width:58px;flex:none;text-align:center;padding:7px 4px}
.nm-dark-select,.nm-mini-select{
  appearance:none;-webkit-appearance:none;
  cursor:pointer;
  padding-inline-end:26px;
  background-image:url("data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2393a7c6' stroke-width='2.6' stroke-linecap='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
  background-repeat:no-repeat;
  background-position:left 8px center;
  background-size:11px;
}
.nm-mini-select{width:100%;height:30px;padding:0 9px;padding-inline-end:24px;font-size:11px;font-weight:700;border-radius:9px}
.nm-dark-select option,.nm-mini-select option{background:#0d1626;color:var(--text-light)}
input[type="number"]{-moz-appearance:textfield}
input[type="number"]::-webkit-outer-spin-button,input[type="number"]::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}

.nm-toggle-switch{position:relative;display:inline-block;width:42px;height:24px;flex:none}
.nm-toggle-switch input{position:absolute;opacity:0;width:0;height:0}
.nm-slider{
  position:absolute;inset:0;
  cursor:pointer;
  background:rgba(255,255,255,.09);
  border:1px solid var(--nm-line-strong);
  border-radius:99px;
  transition:background .22s,border-color .22s,box-shadow .22s;
}
.nm-slider:before{
  content:"";position:absolute;left:3px;bottom:2px;
  width:18px;height:18px;
  background:var(--text-dim);
  border-radius:50%;
  transition:transform .22s var(--nm-ease),background .22s,box-shadow .22s;
}
.nm-toggle-switch input:checked+.nm-slider{background:linear-gradient(145deg,rgba(var(--primary-rgb),.55),rgba(var(--primary-rgb),.28));border-color:rgba(var(--primary-rgb),.7)}
.nm-toggle-switch input:checked+.nm-slider:before{transform:translateX(18px);background:var(--hover-red);box-shadow:0 0 12px rgba(var(--primary-rgb),.75)}
.nm-toggle-switch input:focus-visible+.nm-slider{box-shadow:var(--nm-focus)}

.nm-opt{
  display:flex;align-items:center;justify-content:space-between;gap:12px;
  min-height:34px;
  font-size:12px;color:var(--text-light);
}
.nm-opt>span:first-child{flex:1;color:var(--text-dim)}
.nm-tile-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));gap:9px}
.nm-tile{
  display:flex;align-items:center;justify-content:space-between;gap:10px;
  min-height:44px;padding:9px 12px;
  font-size:11.5px;font-weight:700;color:var(--text-dim);
  background:linear-gradient(160deg,rgba(255,255,255,.038),rgba(255,255,255,.012));
  border:1px solid var(--nm-line);
  border-radius:11px;
  transition:border-color .18s,background .18s;
}
.nm-tile:hover{border-color:rgba(var(--primary-rgb),.3);background:rgba(255,255,255,.05)}
.nm-tile>span:first-child{min-width:0;line-height:1.35}
.nm-tile-controls{display:flex;align-items:center;gap:7px;flex:none}
.nm-fold{
  border:1px solid var(--nm-line);
  border-radius:var(--nm-radius-sm);
  background:rgba(255,255,255,.02);
  overflow:hidden;
}
.nm-fold>summary{
  display:flex;align-items:center;gap:8px;
  padding:11px 13px;
  font-size:11.5px;font-weight:800;color:var(--text-dim);
  cursor:pointer;list-style:none;
  user-select:none;
  transition:color .18s,background .18s;
}
.nm-fold>summary::-webkit-details-marker{display:none}
.nm-fold>summary::after{content:"▾";margin-inline-start:auto;font-size:11px;opacity:.7;transition:transform .2s}
.nm-fold[open]>summary{color:var(--text-light);border-bottom:1px solid var(--nm-line);background:rgba(255,255,255,.03)}
.nm-fold[open]>summary::after{transform:rotate(180deg)}
.nm-fold>summary:hover{color:var(--text-light)}
.nm-fold-body{display:flex;flex-direction:column;gap:9px;padding:12px 13px}
.nm-opts{display:flex;flex-direction:column;gap:4px;margin-top:10px;padding-top:10px;border-top:1px solid var(--nm-line)}
.nm-ms-text{font-size:10.5px;color:var(--text-dim)}
.nm-segment-control{
  display:flex;gap:3px;padding:3px;
  background:rgba(0,0,0,.34);
  border:1px solid var(--nm-line);
  border-radius:11px;
}
.nm-segment-item{flex:1;min-width:0}
.nm-segment-item input{display:none}
.nm-segment-item label{
  display:flex;align-items:center;justify-content:center;
  padding:7px 10px;
  font-size:11.5px;color:var(--text-dim);
  border-radius:8px;
  cursor:pointer;
  transition:all .18s;
  white-space:nowrap;
}
.nm-segment-item input:checked+label{color:#04140f;font-weight:800;background:linear-gradient(150deg,var(--hover-red),var(--primary-red))}
.nm-timer-mini-group{display:flex;align-items:center;gap:8px}

/* ═══════════ Settings tab bits ═══════════ */
.nm-settings-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.nm-timer-box,.nm-colors-box{
  display:flex;flex-direction:column;gap:8px;
  padding:11px 12px;
  background:rgba(255,255,255,.028);
  border:1px solid var(--nm-line);
  border-radius:var(--nm-radius-sm);
}
.nm-timer-box{flex-direction:row;align-items:center;justify-content:space-between;gap:10px}
.nm-timer-box h3,.nm-colors-box h3{margin:0;font-size:12px;font-weight:800;color:var(--text-light)}
.nm-color-pickers-group{display:flex;gap:7px;flex-wrap:wrap}
.nm-color-wrapper{
  position:relative;width:30px;height:30px;
  border-radius:9px;overflow:hidden;
  border:1px solid var(--nm-line-strong);
  cursor:pointer;
  transition:transform .18s var(--nm-ease),border-color .18s,box-shadow .18s;
}
.nm-color-wrapper:hover{transform:translateY(-2px) scale(1.06);border-color:rgba(var(--primary-rgb),.7);box-shadow:0 6px 14px rgba(0,0,0,.35)}
.nm-color-wrapper input[type="color"]{position:absolute;top:-40%;left:-40%;width:180%;height:180%;padding:0;border:none;cursor:pointer;background:none}
.nm-upload-group{display:flex;gap:10px;width:100%;margin-top:auto}
.nm-upload-label{
  flex:1;
  display:flex;align-items:center;justify-content:center;gap:8px;
  padding:12px 10px;
  font-size:12px;font-weight:800;text-align:center;white-space:nowrap;
  color:var(--text-dim);
  background:rgba(255,255,255,.03);
  border:1px dashed var(--nm-line-strong);
  border-radius:var(--nm-radius-sm);
  cursor:pointer;
  transition:all .2s;
}
.nm-upload-label:hover{color:var(--text-light);background:rgba(var(--primary-rgb),.11);border-color:rgba(var(--primary-rgb),.55)}
.nm-upload-label input[type="file"]{display:none}
.nm-empty-state{
  width:100%;min-height:56px;
  display:flex;align-items:center;justify-content:center;
  padding:14px 10px;
  font-size:12px;color:var(--text-dim);text-align:center;opacity:.7;
  background:rgba(255,255,255,.018);
  border:1px dashed var(--nm-line);
  border-radius:var(--nm-radius-sm);
}

/* ═══════════ Lines tab ═══════════ */
.nm-lines-hint{display:flex;flex-wrap:wrap;gap:7px;justify-content:center}
.nm-lines-hint span{
  display:inline-flex;align-items:center;gap:6px;
  padding:5px 12px;
  font-size:10.5px;font-weight:800;
  color:var(--text-dim);
  background:rgba(255,255,255,.04);
  border:1px solid var(--nm-line);
  border-radius:999px;
}
.nm-lines-hint span.pin{color:#2a1a04;background:linear-gradient(145deg,var(--nm-warn),#ffd9a0);border-color:transparent}
.nm-lines-toolbar{display:flex;flex-wrap:wrap;gap:7px;justify-content:center}
.nm-lines-container{display:flex;justify-content:center;gap:12px}
.nm-lines-column{
  flex:1;
  display:flex;flex-direction:column;gap:2px;
  padding:10px 12px 12px;
  background:linear-gradient(165deg,rgba(255,255,255,.035),rgba(255,255,255,.012));
  border:1px solid var(--nm-line);
  border-radius:var(--nm-radius-sm);
}
.nm-lines-title{
  display:flex;align-items:center;justify-content:space-between;gap:8px;
  margin-bottom:8px;padding-bottom:8px;
  font-size:12.5px;font-weight:800;color:var(--text-light);
  border-bottom:1px solid var(--nm-line);
}
.nm-lines-title span{font-size:10px;font-weight:700;color:var(--text-dim)}
.nm-line-row{
  display:grid;
  grid-template-columns:minmax(0,1fr) 64px 42px 92px 44px 56px;
  align-items:center;gap:8px;
  padding:5px 6px;
  border-radius:10px;
  transition:background .16s;
}
.nm-line-row:hover{background:rgba(255,255,255,.035)}
.nm-line-row+.nm-line-row{box-shadow:inset 0 1px 0 rgba(255,255,255,.03)}
.nm-line-name{
  font-size:12px;font-weight:700;color:var(--text-light);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.nm-line-extra{font-size:10px;color:var(--text-dim);text-align:center}
.nm-line-state{
  min-width:0;padding:3px 6px;
  font-size:10px;font-weight:800;text-align:center;
  color:var(--text-dim);
  background:rgba(255,255,255,.045);
  border:1px solid transparent;
  border-radius:999px;
  transition:all .22s;
}
.nm-line-state.nm-st-off{color:var(--text-dim);background:rgba(255,255,255,.045);border-color:transparent}
.nm-line-state.nm-st-line{color:var(--primary-red);background:rgba(var(--primary-rgb),.14);border-color:rgba(var(--primary-rgb),.4)}
.nm-line-state.nm-st-pin{
  color:#2a1a04;
  background:linear-gradient(145deg,var(--nm-warn),#ffe0b0);
  border-color:transparent;
  box-shadow:0 0 14px rgba(255,196,107,.45);
  animation:nmPinPulse 1.5s ease-in-out infinite alternate;
}
@keyframes nmPinPulse{from{box-shadow:0 0 5px rgba(255,196,107,.3)}to{box-shadow:0 0 16px rgba(255,196,107,.7)}}
.nm-release-row{grid-template-columns:minmax(0,1fr) auto 44px 56px;margin-top:8px;padding-top:9px;border-top:1px dashed var(--nm-line-strong)!important}

/* ═══════════ Key recorder ═══════════ */
.nm-controls-group{display:flex;align-items:center;gap:8px}
.nm-key-box{
  width:100%;
  height:30px;
  display:flex;align-items:center;justify-content:center;
  font-size:11px;font-weight:900;letter-spacing:.4px;
  color:var(--primary-red);
  text-transform:uppercase;
  background:var(--input-bg);
  border:1px solid var(--nm-line-strong);
  border-radius:9px;
  box-shadow:inset 0 2px 5px rgba(0,0,0,.45);
  transition:border-color .22s,box-shadow .22s,color .22s;
}
.nm-key-box.recording{border-color:var(--primary-red);box-shadow:0 0 0 3px rgba(var(--primary-rgb),.16),inset 0 2px 5px rgba(0,0,0,.45);animation:nmPulseBorder 1.1s ease-in-out infinite alternate}
@keyframes nmPulseBorder{from{box-shadow:0 0 4px rgba(var(--primary-rgb),.3),inset 0 2px 5px rgba(0,0,0,.45)}to{box-shadow:0 0 16px rgba(var(--primary-rgb),.7),inset 0 2px 5px rgba(0,0,0,.45)}}
.nm-btn-rec{
  height:30px;width:100%;padding:0;
  display:inline-flex;align-items:center;justify-content:center;
  font-size:10px;font-weight:900;letter-spacing:.6px;
  color:var(--text-dim);
  background:rgba(255,255,255,.04);
  border:1px solid var(--nm-line-strong);
  border-radius:9px;
  cursor:pointer;
  transition:all .2s;
}
.nm-btn-rec:hover{color:var(--text-light);background:rgba(var(--primary-rgb),.16);border-color:rgba(var(--primary-rgb),.5)}
.nm-btn-rec.recording{color:#2a0a10;background:linear-gradient(145deg,var(--nm-danger),#ffb0bd);border-color:transparent;animation:nmPulseBg 1s ease-in-out infinite alternate}
@keyframes nmPulseBg{from{opacity:1}to{opacity:.75}}

/* ═══════════ Physics card (v4) ═══════════ */
.nm-phys-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.nm-phys-grid{display:grid;grid-template-columns:auto minmax(0,1fr);gap:14px;align-items:center}
.nm-dial-wrap{
  position:relative;width:132px;height:132px;flex:none;
  display:grid;place-items:center;
  border-radius:50%;
  background:radial-gradient(circle at 50% 42%,rgba(var(--primary-rgb),.14),transparent 66%),rgba(0,0,0,.28);
  border:1px solid var(--nm-line-strong);
  box-shadow:inset 0 0 26px rgba(0,0,0,.5);
}
#nm-angle-dial{display:block;width:132px;height:132px}
.nm-dial-center{
  position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
  display:flex;flex-direction:column;align-items:center;gap:1px;
  pointer-events:none;text-align:center;
}
.nm-dial-center b{font-size:13px;font-weight:900;color:var(--text-light);line-height:1}
.nm-dial-center small{font-size:8.5px;color:var(--text-dim);letter-spacing:.3px}
.nm-phys-stats{display:flex;flex-direction:column;gap:7px;min-width:0}
.nm-stat-row{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:11px;color:var(--text-dim)}
.nm-stat-row b{font-weight:800;color:var(--text-light);font-size:11.5px;font-variant-numeric:tabular-nums}
.nm-stat-row .ok{color:var(--nm-good)}
.nm-stat-row .warn{color:var(--nm-warn)}
.nm-stat-row .bad{color:var(--nm-danger)}
.nm-phys-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:2px}
.nm-angle-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 10px}
.nm-angle-row{display:grid;grid-template-columns:minmax(0,1fr) 70px 28px;align-items:center;gap:7px}
.nm-angle-row span{font-size:11px;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nm-angle-row input{height:28px;padding:0 6px;font-size:11px;font-weight:700;text-align:center;font-variant-numeric:tabular-nums}
.nm-angle-row button{
  width:26px;height:26px;padding:0;
  display:grid;place-items:center;
  font-size:12px;color:var(--text-dim);
  background:rgba(255,255,255,.04);border:1px solid var(--nm-line);border-radius:8px;cursor:pointer;
}
.nm-angle-row button:hover{color:var(--text-light);background:rgba(255,255,255,.1)}
.nm-angle-row input.dirty{border-color:rgba(var(--primary-rgb),.6);color:var(--primary-red)}

/* ═══════════ Customizations ═══════════ */
.nm-tab-header{display:flex;align-items:center;justify-content:space-between;gap:10px}
.nm-customizations-list{display:flex;flex-direction:column;gap:8px;flex:1;overflow-y:auto;padding:1px}
.nm-cust-item{
  display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:10px 13px;
  background:linear-gradient(160deg,rgba(255,255,255,.04),rgba(255,255,255,.012));
  border:1px solid var(--nm-line);
  border-radius:var(--nm-radius-sm);
  transition:border-color .2s,transform .2s var(--nm-ease),background .2s;
}
.nm-cust-item:hover{border-color:rgba(var(--primary-rgb),.38);transform:translateY(-1px);background:rgba(255,255,255,.05)}
.nm-cust-item.disabled{opacity:.5}
.nm-cust-info{display:flex;align-items:center;gap:9px;min-width:0}
.nm-cust-info h4{margin:0;font-size:12.5px;font-weight:800;color:var(--text-light);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nm-cust-key-badge{
  padding:2px 8px;
  font-size:9.5px;font-weight:900;letter-spacing:.4px;
  color:var(--primary-red);
  background:rgba(var(--primary-rgb),.12);
  border:1px solid rgba(var(--primary-rgb),.32);
  border-radius:7px;
}
.nm-cust-actions{display:flex;gap:6px;flex:none}
.nm-btn-mini{
  padding:5px 10px;
  font-size:10.5px;font-weight:800;
  color:var(--text-light);
  background:rgba(255,255,255,.06);
  border:1px solid var(--nm-line-strong);
  border-radius:8px;
  cursor:pointer;
  transition:all .18s;
}
.nm-btn-mini:hover{background:rgba(255,255,255,.13)}
.nm-btn-mini.danger{color:var(--nm-danger);background:rgba(255,111,139,.1);border-color:rgba(255,111,139,.3)}
.nm-btn-mini.danger:hover{background:rgba(255,111,139,.2)}

/* ═══════════ Modal ═══════════ */
.nm-modal{
  position:absolute;inset:0;z-index:40;
  display:none;flex-direction:column;
  margin:10px;
  padding:16px;
  background:linear-gradient(165deg,#0d1727,#080e18);
  border:1px solid var(--nm-line-strong);
  border-radius:var(--nm-radius-sm);
  box-shadow:0 30px 70px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.05);
  backdrop-filter:blur(14px);
}
.nm-modal.show{display:flex;animation:nmPaneIn .2s var(--nm-ease)}
.nm-modal-header h3{
  margin:0 0 12px;padding-bottom:10px;
  font-size:14px;font-weight:800;color:var(--text-light);
  border-bottom:1px solid var(--nm-line);
}
.nm-modal-body{flex:1;display:flex;flex-direction:column;gap:11px;overflow-y:auto;padding:2px}
.nm-modal-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.nm-row-label{width:84px;flex:none;font-size:11.5px;font-weight:800;color:var(--text-dim)}
.nm-actions-list{display:flex;flex-direction:column;gap:7px}
.nm-action-row{
  display:flex;align-items:center;gap:7px;
  padding:8px 9px;
  background:rgba(255,255,255,.03);
  border:1px solid var(--nm-line);
  border-radius:10px;
}
.nm-action-row span{font-size:10.5px;color:var(--text-dim);white-space:nowrap}
.nm-modal-footer{
  display:flex;justify-content:flex-end;align-items:center;gap:9px;
  margin-top:12px;padding-top:12px;
  border-top:1px solid var(--nm-line);
}

/* ═══════════ Recorder / macro lists ═══════════ */
.nm-rec-list{
  direction:ltr;text-align:left;
  max-height:190px;min-height:80px;margin:0;padding:10px 12px;
  overflow:auto;
  font-family:"Cascadia Code",Consolas,"Courier New",monospace;
  font-size:10.5px;line-height:1.75;color:#a8e6d6;
  background:rgba(0,0,0,.42);
  border:1px solid var(--nm-line);
  border-radius:10px;
  white-space:pre-wrap;word-break:break-all;
}
.nm-macro-list{display:flex;flex-direction:column;gap:6px}
.nm-macro-row{
  display:flex;align-items:center;gap:8px;
  padding:8px 10px;
  background:rgba(255,255,255,.03);
  border:1px solid var(--nm-line);
  border-radius:10px;
}
.nm-macro-name{flex:1;min-width:0;font-size:11.5px;font-weight:700;color:var(--text-light);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nm-macro-name small{font-size:9.5px;font-weight:600;color:var(--text-dim)}
.nm-macro-row .nm-key-box{width:auto;min-width:58px;height:26px;padding:0 8px;font-size:10px}
.nm-color-row{display:flex;align-items:center;gap:10px}
.nm-color-row .nm-color-name{flex:1;font-size:11.5px;color:var(--text-dim)}
.nm-color-row input[type="color"]{width:38px;height:28px;padding:0;border:1px solid var(--nm-line-strong);border-radius:8px;background:none;cursor:pointer}
.nm-swatches{display:flex;flex-wrap:wrap;gap:7px;justify-content:center}
.nm-swatch{
  width:24px;height:24px;padding:0;
  border:2px solid rgba(255,255,255,.22);
  border-radius:7px;cursor:pointer;
  transition:transform .16s var(--nm-ease),border-color .16s,box-shadow .16s;
}
.nm-swatch:hover{transform:translateY(-2px) scale(1.08);border-color:#fff;box-shadow:0 4px 12px rgba(0,0,0,.4)}

/* ═══════════ Footer ═══════════ */
.nm-footer-rights{
  position:absolute;bottom:7px;inset-inline-end:14px;
  max-width:46%;
  padding:3px 9px;
  text-align:end;
  font-size:9.5px;line-height:1.5;color:var(--text-dim);opacity:.6;
  background:rgba(7,11,19,.62);
  border-radius:8px;
  pointer-events:none;
  transition:opacity .25s;
}
.nm-footer-rights:hover{opacity:.95}
.nm-credit-line{display:inline-block;margin-top:1px}
.nm-credit-name{
  font-weight:900;letter-spacing:.2px;
  background:linear-gradient(90deg,var(--primary-red),#9db4ff,var(--hover-red),var(--primary-red));
  background-size:300% auto;
  -webkit-background-clip:text;background-clip:text;color:transparent;
  animation:nmCreditShift 6s linear infinite;
}
@keyframes nmCreditShift{to{background-position:300% center}}
.nm-status-container{position:absolute;bottom:11px;inset-inline-start:18px;display:flex;align-items:center;gap:7px;user-select:none}
.nm-status-text{font-size:10.5px;font-weight:700;color:var(--text-dim)}
.nm-status-dot{
  width:9px;height:9px;border-radius:50%;
  background:var(--nm-danger);
  box-shadow:0 0 8px rgba(255,111,139,.6);
  transition:all .35s;
}
.nm-status-dot.connected{background:var(--nm-good);box-shadow:0 0 6px rgba(74,222,128,.8),0 0 16px rgba(74,222,128,.5);animation:nmPulseGreen 1.6s ease-in-out infinite alternate}
@keyframes nmPulseGreen{from{opacity:.85;box-shadow:0 0 3px rgba(74,222,128,.6)}to{opacity:1;box-shadow:0 0 12px rgba(74,222,128,.9)}}

/* ═══════════ Floating button ═══════════ */
#nm-floating-circle{
  position:fixed;top:30px;left:30px;
  width:60px;height:60px;
  display:flex;align-items:center;justify-content:center;
  border-radius:50%;
  background-color:var(--primary-red);
  background-image:radial-gradient(circle at 32% 26%,rgba(255,255,255,.42),transparent 58%);
  background-size:cover;background-position:center;
  box-shadow:0 10px 28px rgba(0,0,0,.55),0 0 0 3px rgba(255,255,255,.07),0 0 30px rgba(var(--primary-rgb),.45);
  cursor:grab;
  z-index:2147482500;
  user-select:none;-webkit-user-select:none;
  touch-action:none;
  transition:transform .2s var(--nm-ease),box-shadow .3s;
}
#nm-floating-circle:hover{transform:scale(1.06);box-shadow:0 14px 34px rgba(0,0,0,.6),0 0 0 3px rgba(255,255,255,.12),0 0 38px rgba(var(--primary-rgb),.7)}
#nm-floating-circle:active{cursor:grabbing;transform:scale(.95)}
#nm-floating-circle::before{
  content:"";position:absolute;inset:-5px;border-radius:50%;pointer-events:none;
  background:conic-gradient(from 0deg,transparent 0 55%,rgba(var(--primary-rgb),1) 82%,#fff 100%);
  -webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 2.5px),#000 calc(100% - 2.5px));
  mask:radial-gradient(farthest-side,transparent calc(100% - 2.5px),#000 calc(100% - 2.5px));
  animation:nmSpin 3.4s linear infinite;
  opacity:.85;
}
@keyframes nmSpin{to{transform:rotate(360deg)}}
#nm-floating-circle .nm-glyph{display:flex;pointer-events:none;filter:drop-shadow(0 2px 4px rgba(0,0,0,.45))}
#nm-floating-circle[style*="url("] .nm-glyph{opacity:0}
#nm-floating-circle .nm-page-badge{
  position:absolute;right:-5px;bottom:-5px;
  min-width:23px;height:23px;padding:0 5px;
  display:grid;place-items:center;
  font-size:11.5px;font-weight:900;line-height:1;
  color:#04140f;
  background:linear-gradient(145deg,#fff,#d8fff5);
  border:2px solid var(--primary-red);
  border-radius:999px;
  box-shadow:0 3px 10px rgba(0,0,0,.55);
  pointer-events:none;
}
#nm-floating-circle.nm-has-update::after{
  content:"";position:absolute;top:-2px;right:-2px;
  width:13px;height:13px;border-radius:50%;
  background:var(--nm-warn);
  border:2px solid #0b1220;
  box-shadow:0 0 10px rgba(255,196,107,.9);
}

/* ═══════════ HUD / toast ═══════════ */
#nm-hud{
  position:fixed;top:14px;left:50%;transform:translateX(-50%);
  display:none;flex-direction:column;align-items:center;gap:6px;
  z-index:2147483000;pointer-events:none;
}
.nm-hud-tag{
  padding:6px 15px;
  font-size:12px;font-weight:800;color:var(--text-light);
  background:rgba(8,14,24,.9);
  border:1px solid rgba(255,255,255,.24);
  border-radius:999px;
  box-shadow:0 8px 22px rgba(0,0,0,.5);
  backdrop-filter:blur(8px);
  animation:clHudIn .28s var(--nm-ease);
}
.nm-hud-tag.nm-hud-pin{border-color:rgba(255,196,107,.75);box-shadow:0 0 18px rgba(255,196,107,.4),0 8px 22px rgba(0,0,0,.5)}
@keyframes clHudIn{from{opacity:0;transform:translateY(-14px)}to{opacity:1;transform:none}}
#nm-toast-stack{
  position:fixed;bottom:26px;left:50%;transform:translateX(-50%);
  z-index:2147483000;
  display:flex;flex-direction:column-reverse;gap:8px;align-items:center;
  pointer-events:none;
  max-width:min(440px,calc(100vw - 24px));
}
.nm-toast{
  display:flex;align-items:center;gap:9px;
  padding:10px 16px;
  font-size:12px;font-weight:700;color:var(--text-light);
  background:linear-gradient(145deg,rgba(16,27,44,.97),rgba(8,13,22,.97));
  border:1px solid var(--nm-line-strong);
  border-inline-start:3px solid var(--primary-red);
  border-radius:12px;
  box-shadow:0 16px 38px rgba(0,0,0,.55);
  pointer-events:auto;
  animation:nmToastIn .28s var(--nm-ease);
  transition:opacity .35s ease,transform .35s ease;
}
.nm-toast-dot{width:6px;height:6px;flex:none;border-radius:50%;background:var(--primary-red);box-shadow:0 0 9px rgba(var(--primary-rgb),.9)}
.nm-toast-msg{overflow:hidden;text-overflow:ellipsis;line-height:1.5}
.nm-toast.out{opacity:0;transform:translateY(12px) scale(.97)}
@keyframes nmToastIn{from{opacity:0;transform:translateY(14px) scale(.94)}to{opacity:1;transform:none}}

/* ═══════════ Skip results / timer ═══════════ */
.nm-skip-hide{position:fixed!important;left:-99999px!important;top:-99999px!important;opacity:0!important;pointer-events:none!important}
.timer{font-family:"Segoe UI",Arial,sans-serif;font-size:46px;font-weight:800;letter-spacing:1px;text-shadow:0 3px 12px rgba(0,0,0,.65)}

/* ═══════════ Setup overlay ═══════════ */
#nm-setup-overlay{
  position:fixed;inset:0;z-index:2147483600;
  display:flex;align-items:center;justify-content:center;
  background:radial-gradient(900px 500px at 70% -10%,rgba(var(--primary-rgb),.16),transparent),rgba(4,7,12,.82);
  backdrop-filter:blur(9px);
}
.nm-setup-card{
  width:min(380px,90vw);
  padding:26px 24px;
  text-align:center;
  background:linear-gradient(170deg,#101b2c,#080e18);
  border:1px solid var(--nm-line-strong);
  border-radius:20px;
  box-shadow:0 34px 80px rgba(0,0,0,.65),inset 0 1px 0 rgba(255,255,255,.06);
  animation:nmPopCard .25s var(--nm-ease);
  direction:rtl;
}
@keyframes nmPopCard{from{opacity:0;transform:translateY(12px) scale(.97)}to{opacity:1;transform:none}}
.nm-setup-step{
  display:inline-block;margin-bottom:14px;padding:4px 13px;
  font-size:11px;font-weight:900;letter-spacing:.6px;color:var(--primary-red);
  background:rgba(var(--primary-rgb),.13);
  border:1px solid rgba(var(--primary-rgb),.3);
  border-radius:999px;
}
.nm-setup-title{font-size:12px;color:var(--text-dim);margin-bottom:6px}
.nm-setup-name{font-size:22px;font-weight:900;color:var(--text-light);margin-bottom:16px}
.nm-setup-help{font-size:10.5px;line-height:1.9;color:var(--text-dim);opacity:.85}

/* ═══════════ Diagnostics ═══════════ */
#nm-diag{
  position:fixed;bottom:0;right:0;left:0;z-index:2147482900;
  display:none;
  padding:6px 12px;
  font-family:"Cascadia Code",Consolas,monospace;
  font-size:10.5px;direction:ltr;text-align:left;
  color:#b9e8dd;
  background:rgba(6,10,16,.92);
  border-top:1px solid rgba(var(--primary-rgb),.3);
  pointer-events:none;
}

/* ═══════════ Update banner (v4) ═══════════ */
#nm-update-banner{
  display:none;
  align-items:center;gap:10px;
  margin:0 0 2px;
  padding:9px 12px;
  font-size:11.5px;font-weight:700;color:#2a1a04;
  background:linear-gradient(145deg,#ffd08a,#ffb45c);
  border-radius:11px;
  box-shadow:0 8px 20px rgba(255,180,92,.22);
}
#nm-update-banner.show{display:flex}
#nm-update-banner .nm-ub-text{flex:1;min-width:0;line-height:1.6}
#nm-update-banner .nm-ub-text b{font-weight:900}
#nm-update-banner button{
  flex:none;height:26px;padding:0 10px;
  font-size:10.5px;font-weight:900;color:#2a1a04;
  background:rgba(255,255,255,.55);
  border:1px solid rgba(0,0,0,.12);
  border-radius:8px;cursor:pointer;
  transition:background .18s,transform .18s;
}
#nm-update-banner button:hover{background:#fff;transform:translateY(-1px)}
#nm-update-banner .nm-ub-close{background:transparent;border-color:transparent;font-size:14px;line-height:1;width:24px;padding:0}

/* ═══════════ Update modal + forced overlay (v4) ═══════════ */
.nm-update-modal{position:absolute;inset:0;z-index:45;display:none;align-items:center;justify-content:center;padding:16px;background:rgba(4,7,12,.72);backdrop-filter:blur(6px);border-radius:var(--nm-radius)}
.nm-update-modal.show{display:flex}
.nm-um-card{
  width:min(460px,100%);
  max-height:100%;
  display:flex;flex-direction:column;gap:12px;
  padding:18px;
  background:linear-gradient(165deg,#101b2c,#080e18);
  border:1px solid var(--nm-line-strong);
  border-radius:16px;
  box-shadow:0 30px 70px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.06);
  direction:rtl;
}
.nm-um-head{display:flex;align-items:center;gap:10px}
.nm-um-ico{width:36px;height:36px;flex:none;display:grid;place-items:center;font-size:17px;border-radius:11px;background:rgba(var(--primary-rgb),.14);border:1px solid rgba(var(--primary-rgb),.3)}
.nm-um-head h3{margin:0;font-size:14px;font-weight:900;color:var(--text-light)}
.nm-um-head small{display:block;font-size:10px;color:var(--text-dim);font-weight:600}
.nm-um-ver{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;font-size:11.5px;color:var(--text-dim);background:rgba(255,255,255,.03);border:1px solid var(--nm-line);border-radius:10px}
.nm-um-ver b{color:var(--text-light);font-weight:900;font-variant-numeric:tabular-nums}
.nm-um-ver .new{color:var(--nm-good)}
.nm-um-notes{max-height:180px;overflow:auto;padding:10px 12px;font-size:11.5px;line-height:1.9;color:var(--text-dim);white-space:pre-wrap;background:rgba(0,0,0,.28);border:1px solid var(--nm-line);border-radius:10px}
.nm-um-foot{display:flex;gap:8px;justify-content:flex-end}
.nm-modal-close{position:absolute;top:10px;left:10px;width:30px;height:30px;display:grid;place-items:center;font-size:16px;color:var(--text-dim);background:rgba(255,255,255,.05);border:1px solid var(--nm-line);border-radius:9px;cursor:pointer}
.nm-modal-close:hover{color:#fff;background:rgba(255,255,255,.12)}

#nm-update-overlay{
  position:fixed;inset:0;z-index:2147483647;
  display:flex;align-items:center;justify-content:center;
  padding:16px;
  background:radial-gradient(1000px 600px at 80% -10%,rgba(255,180,92,.14),transparent),radial-gradient(900px 520px at -10% 110%,rgba(var(--primary-rgb),.14),transparent),rgba(4,7,12,.92);
  backdrop-filter:blur(10px);
}
.nm-uo-card{
  width:min(420px,92vw);
  padding:26px 24px;
  text-align:center;
  direction:rtl;
  background:linear-gradient(170deg,#111c2e,#080e18);
  border:1px solid rgba(255,180,92,.32);
  border-radius:20px;
  box-shadow:0 34px 80px rgba(0,0,0,.7),inset 0 1px 0 rgba(255,255,255,.06);
  animation:nmPopCard .3s var(--nm-ease);
}
.nm-uo-badge{display:inline-flex;align-items:center;gap:7px;margin-bottom:14px;padding:5px 14px;font-size:11px;font-weight:900;color:#2a1a04;background:linear-gradient(145deg,#ffd08a,#ffb45c);border-radius:999px}
.nm-uo-title{font-size:20px;font-weight:900;color:var(--text-light);margin-bottom:6px}
.nm-uo-sub{font-size:11.5px;line-height:1.9;color:var(--text-dim);margin-bottom:16px}
.nm-uo-vers{display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:16px;font-size:11px;color:var(--text-dim)}
.nm-uo-vers b{font-size:14px;font-weight:900;color:var(--text-light);font-variant-numeric:tabular-nums}
.nm-uo-vers .arrow{color:var(--nm-warn);font-weight:900}
.nm-uo-actions{display:flex;flex-direction:column;gap:8px}
.nm-uo-actions .nm-btn-main{height:42px;font-size:13px}
.nm-uo-note{font-size:10px;line-height:1.8;color:var(--text-dim);opacity:.8;margin-top:12px}

/* ═══════════ Responsive ═══════════ */
@media (max-width:720px){
  .nm-menu-container{width:calc(100vw - 12px);height:calc(100dvh - 12px)}
  .nm-menu-body{flex-direction:column}
  .nm-side-nav{
    flex-direction:row;
    width:100%;gap:4px;
    padding:8px;
    border-inline-end:none;
    border-bottom:1px solid var(--nm-line);
    overflow-x:auto;
  }
  .nm-tab-btn{min-width:64px;min-height:46px;flex-direction:row;gap:5px;padding:6px}
  .nm-tab-btn.active::before{inset-inline-end:auto;top:auto;bottom:-8px;left:50%;transform:translateX(-50%);width:20px;height:3px}
  .nm-tab-btn em{font-size:9px}
  .nm-menu-header{padding:12px 54px 10px}
  .nm-line-row{grid-template-columns:minmax(0,1fr) 52px 40px 78px 40px 50px;gap:5px}
  .nm-phys-grid{grid-template-columns:1fr;justify-items:center}
  .nm-angle-grid{grid-template-columns:1fr;width:100%}
  .nm-settings-grid{grid-template-columns:1fr}
  .nm-footer-rights{display:none}
}
@media (prefers-reduced-motion:reduce){
  .nm-menu-container.show,.nm-tab-pane.active,.nm-toast,.nm-setup-card,.nm-uo-card,.nm-modal.show{animation:none!important}
  #nm-floating-circle::before{animation:none}
  .nm-update-chip{animation:none}
}

`;
        document.head.appendChild(e);
        let t = S.get("timerEnabled", "false") === "true";
        let o = S.get("timerColorMode", "random");
        let n = S.get("timerFixedColor", "#FFFFFF");
        timer = {
            started: false,
            element: null,
            interval: null,
            timeLeft: 60,
            start() {
                if (t) {
                    if (!this.started) {
                        this.started = true;
                        this.element = document.createElement("div");
                        this.element.style.position = "fixed";
                        this.element.style.top = "12px";
                        this.element.style.left = "50%";
                        this.element.style.transform = "translateX(-50%)";
                        this.element.style.zIndex = "999999";
                        this.element.style.pointerEvents = "none";
                        this.element.classList.add("timer");
                        document.body.appendChild(this.element);
                        this.timeLeft = 60;
                        this.updateTimerDisplay();
                        this.interval = setInterval(nativeify(() => {
                            try {
                                this.timeLeft--;
                                this.updateTimerDisplay();
                                if (this.timeLeft <= 0) {
                                    this.element.textContent = "0";
                                    clearInterval(this.interval);
                                    setTimeout(nativeify(() => { try { this.stop(); } catch (_) { } }, 'timerStop'), 1000);
                                }
                            } catch (_) { }
                        }, 'timerTick'), 1000);
                    }
                }
            },
            stop() {
                if (this.started) {
                    clearInterval(this.interval);
                    if (this.element) {
                        this.element.remove();
                        this.element = null;
                    }
                    this.started = false;
                    this.interval = null;
                    this.timeLeft = 60;
                }
            },
            updateTimerDisplay() {
                if (this.element) {
                    this.element.textContent = `${this.timeLeft}`;
                    this.element.style.color = o === "random" ? function () {
                        const e = "0123456789ABCDEF";
                        let t = "#";
                        for (let o = 0; o < 6; o++) {
                            t += e[Math.floor(Math.random() * 16)];
                        }
                        return t;
                    }() : n;
                }
            }
        };
        window.addEventListener("storage", nativeify(() => {
            try {
                t = S.get("timerEnabled", "false") === "true";
                o = S.get("timerColorMode", "random");
                n = S.get("timerFixedColor", "#FFFFFF");
                if (!t) { try { timer.stop(); } catch (_) { } }
            } catch (_) { }
        }, 'storageTimer'));
    } catch (_) { }
}
function applyStoredCustomizations() {
    try { updateAllUIElements(); } catch (_) { }
    try { updateCustomizationsUI(); } catch (_) { }
}
function observeChatMessages() {
    const e = (...e) => false;
    const t = /^started:\s*auto\s*reset\s*in\s*\d{1,3}\s*-\s*\d{1,3}\s*seconds!?$/i;
    const o = /^(auto reset canceled!|auto reset done!)$/i;
    let n = 0;
    let a = 0;
    const l = e => {
        const t = Date.now();
        if (e === "start") {
            return !(t < n) && (n = t + 4000, true);
        } else {
            return !(t < a) && (a = t + 4000, true);
        }
    };
    const i = e => (e || "").replace(/\s+/g, " ").trim();
    const m = new WeakSet();
    function r(n) {
        if (!n || n.nodeType !== 1) {
            return;
        }
        const a = n;
        if (m.has(a)) {
            return;
        }
        m.add(a);
        const r = function (e) {
            if (!e || e.nodeType !== 1) {
                return "";
            }
            const t = e.querySelector?.(".chat-message") || e;
            let o = "";
            try {
                const e = document.createTreeWalker(t, NodeFilter.SHOW_TEXT, null);
                for (let t = e.nextNode(); t; t = e.nextNode()) {
                    o += t.nodeValue + " ";
                }
            } catch {
                o = t.textContent || "";
            }
            return i(o).toLowerCase();
        }(a);
        if (!r) {
            return;
        }
        const d = t.test(r);
        const s = o.test(r);
        if ((d || s) && function (t) {
            const o = t.querySelector?.(".chat-name") || null;
            const n = t.querySelector?.(".chat-id") || null;
            if (o || n) {
                const t = i(o?.textContent || "");
                const a = i(n?.textContent || "");
                const l = t === "SERVER |📢" && /^0\|?$/.test(a);
                if (!l) {
                    e("reject (identity mismatch)", {
                        name: t,
                        id: a
                    });
                }
                return l;
            }
            return true;
        }(a)) {
            try {
                if (d && l("start")) {
                    timer.start();
                } else if (s && l("stop")) {
                    timer.stop();
                }
            } catch (e) { }
        }
    }
    new MutationObserver(e => {
        for (const t of e) {
            if (t.type === "characterData" && t.target?.parentElement) {
                r(t.target.parentElement);
            }
            if (t.addedNodes && t.addedNodes.length) {
                t.addedNodes.forEach(e => {
                    if (e.nodeType === 1) {
                        r(e);
                        e.querySelectorAll?.("div,span,p,li,section,article").forEach(r);
                    }
                });
            }
        }
    }).observe(document.documentElement, {
        childList: true,
        characterData: true,
        subtree: true
    });
}
function exportAllSettings() {
    try {
        // Ensure images are included from IDB if not yet loaded into memory
        Promise.all([
            panelBackgroundImage ? Promise.resolve(panelBackgroundImage) : ImageStore.get("panelBackgroundImage"),
            buttonBackgroundImage ? Promise.resolve(buttonBackgroundImage) : ImageStore.get("buttonBackgroundImage")
        ]).then(([panelImg, circleImg]) => {
            _doExportAllSettings(panelImg, circleImg);
        });
    } catch (_) { }
}
function _doExportAllSettings(panelImg, circleImg) {
    const e = {
        version: "1.0",
        timestamp: new Date().toISOString(),
        generalSettings: {
            oppositeHashName: oppositeHashName,
            buttonShape: buttonShape,
            buttonSize: buttonSize,
            panelBackgroundImage: panelImg || null,
            buttonBackgroundImage: circleImg || null
        },
        customizations: customizations,
        movementSettings: {
            left: {
                enabled: movementLeftEnabled,
                key: movementLeftKey,
                page: movementLeftPage
            },
            right: {
                enabled: movementRightEnabled,
                key: movementRightKey,
                page: movementRightPage
            },
            up: {
                enabled: movementUpEnabled,
                key: movementUpKey,
                page: movementUpPage
            },
            down: {
                enabled: movementDownEnabled,
                key: movementDownKey,
                page: movementDownPage
            },
            topLeft: {
                enabled: movementTopLeftEnabled,
                key: movementTopLeftKey,
                page: movementTopLeftPage
            },
            topRight: {
                enabled: movementTopRightEnabled,
                key: movementTopRightKey,
                page: movementTopRightPage
            },
            bottomLeft: {
                enabled: movementBottomLeftEnabled,
                key: movementBottomLeftKey,
                page: movementBottomLeftPage
            },
            bottomRight: {
                enabled: movementBottomRightEnabled,
                key: movementBottomRightKey,
                page: movementBottomRightPage
            }
        },
        normalSettings: {
            bottomLeft: {
                enabled: normalBottomLeftEnabled,
                key: normalBottomLeftKey,
                page: normalBottomLeftPage
            },
            middleBottom: {
                enabled: normalMiddleBottomEnabled,
                key: normalMiddleBottomKey,
                page: normalMiddleBottomPage
            },
            bottomRight: {
                enabled: normalBottomRightEnabled,
                key: normalBottomRightKey,
                page: normalBottomRightPage
            },
            left: {
                enabled: normalLeftEnabled,
                key: normalLeftKey,
                page: normalLeftPage
            },
            center: {
                enabled: normalCenterEnabled,
                key: normalCenterKey,
                page: normalCenterPage
            },
            right: {
                enabled: normalRightEnabled,
                key: normalRightKey,
                page: normalRightPage
            },
            topLeft: {
                enabled: normalTopLeftEnabled,
                key: normalTopLeftKey,
                page: normalTopLeftPage
            },
            top: {
                enabled: normalTopEnabled,
                key: normalTopKey,
                page: normalTopPage
            },
            topRight: {
                enabled: normalTopRightEnabled,
                key: normalTopRightKey,
                page: normalTopRightPage
            },
            topc: {
                enabled: normalTopcEnabled,
                key: normalTopcKey,
                page: normalTopcPage
            }
        },
        timerSettings: {
            enabled: S.get("timerEnabled", false),
            colorMode: S.get("timerColorMode", "random"),
            fixedColor: S.get("timerFixedColor", "#FFFFFF")
        },
        colorSettings: {
            nmColorMenuBg: S.get("nmColorMenuBg", "#0b1220"),
            nmColorMenuShadow: S.get("nmColorMenuShadow", "#3ddcbf"),
            nmColorCircleBg: S.get("nmColorCircleBg", "#3ddcbf"),
            nmColorPrimary: S.get("nmColorPrimary", "#3ddcbf"),
            nmColorTextLight: S.get("nmColorTextLight", "#eaf2ff"),
            nmColorTextDim: S.get("nmColorTextDim", "#93a7c6"),
            nmColorSpecialBtn: S.get("nmColorSpecialBtn", "#eaf6ff")
        },
        nm3: nmExportExtra()
    };
    const t = JSON.stringify(e, null, 2);
    const o = new Blob([t], {
        type: "application/json"
    });
    const n = URL.createObjectURL(o);
    const a = document.createElement("a");
    a.href = n;
    a.download = `settings_${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(n);
}
function createWarningModal(e, t) {
    try {
        const o = document.createElement("div");
        o.id = "importWarningModal";
        o.style.cssText = "\n      position: fixed;\n      top: 0;\n      left: 0;\n      width: 100%;\n      height: 100%;\n      background: rgba(0, 0, 0, 0.7);\n      display: flex;\n      justify-content: center;\n      align-items: center;\n      z-index: 10000;\n      font-family: Arial, sans-serif;\n    ";
        const n = document.createElement("div");
        n.style.cssText = "\n      background: linear-gradient(135deg, #fff3cd, #ffeaa7);\n      border: 2px solid #f39c12;\n      border-radius: 15px;\n      padding: 30px;\n      max-width: 500px;\n      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);\n      text-align: center;\n      color: #856404;\n    ";
        n.innerHTML = "\n      <div style=\"font-size: 48px; margin-bottom: 20px;\">⚠️</div>\n      <h2 style=\"margin: 0 0 20px 0; color: #d68910;\">تحذير مهم</h2>\n      <p style=\"margin: 15px 0; line-height: 1.6; font-size: 16px;\">\n        سيتم استبدال الإعدادات الحالية بالإعدادات المستوردة.<br>\n        <strong>ملاحظات مهمة:</strong><br>\n        • التخصيصات ستُحفظ إلا إذا وُجد تخصيص بنفس الاسم<br>\n        • الخلفيات الحالية ستُحذف وتُستبدل بالخلفيات المستوردة<br>\n        • جميع الإعدادات الأخرى ستُستبدل بالكامل\n      </p>\n      <div style=\"margin-top: 25px;\">\n        <button id=\"confirmImport\" style=\"\n          background: #e74c3c;\n          color: white;\n          border: none;\n          padding: 12px 25px;\n          margin: 0 10px;\n          border-radius: 8px;\n          cursor: pointer;\n          font-size: 16px;\n          font-weight: bold;\n        \">متابعة الاستيراد</button>\n        <button id=\"cancelImport\" style=\"\n          background: #95a5a6;\n          color: white;\n          border: none;\n          padding: 12px 25px;\n          margin: 0 10px;\n          border-radius: 8px;\n          cursor: pointer;\n          font-size: 16px;\n        \">إلغاء</button>\n      </div>\n    ";
        o.appendChild(n);
        document.body.appendChild(o);
        document.getElementById("confirmImport").addEventListener("click", () => {
            document.body.removeChild(o);
            e();
        });
        document.getElementById("cancelImport").addEventListener("click", () => {
            document.body.removeChild(o);
            t();
        });
        o.addEventListener("click", e => {
            if (e.target === o) {
                document.body.removeChild(o);
                t();
            }
        });
    } catch (_) { }
}
function importSettings(e) {
    try {
        const t = JSON.parse(e);
        if (!t.version) {
            throw new Error("ملف الإعدادات غير صالح");
        }
        try { if (t.nm3) nmImportExtra(t.nm3); } catch (_) { }
        if (t.generalSettings) {
            const e = t.generalSettings;
            if (e.oppositeHashName !== undefined) {
                oppositeHashName = e.oppositeHashName;
                S.set("oppositeHashName", oppositeHashName);
            }
            if (e.buttonShape !== undefined) {
                buttonShape = e.buttonShape;
                S.set("buttonShape", buttonShape);
            }
            if (e.buttonSize !== undefined) {
                buttonSize = e.buttonSize;
                S.set("buttonSize", buttonSize);
            }
            if (e.panelBackgroundImage !== undefined && e.panelBackgroundImage) {
                panelBackgroundImage = e.panelBackgroundImage;
                ImageStore.set("panelBackgroundImage", panelBackgroundImage);
            }
            if (e.buttonBackgroundImage !== undefined && e.buttonBackgroundImage) {
                buttonBackgroundImage = e.buttonBackgroundImage;
                ImageStore.set("buttonBackgroundImage", buttonBackgroundImage);
            }
        }
        if (t.customizations && Array.isArray(t.customizations)) {
            t.customizations.forEach(e => {
                const t = customizations.findIndex(t => t.name === e.name);
                if (t !== -1) {
                    customizations[t] = e;
                } else {
                    customizations.push(e);
                }
            });
            S.set("customizations", JSON.stringify(customizations));
        }
        if (t.movementSettings) {
            const e = t.movementSettings;
            Object.keys(e).forEach(t => {
                const o = e[t];
                switch (t) {
                    case "left":
                        movementLeftEnabled = o.enabled;
                        movementLeftKey = o.key;
                        movementLeftPage = o.page;
                        S.set("movementLeftEnabled", o.enabled.toString());
                        S.set("movementLeftKey", o.key);
                        S.set("movementLeftPage", o.page);
                        break;
                    case "right":
                        movementRightEnabled = o.enabled;
                        movementRightKey = o.key;
                        movementRightPage = o.page;
                        S.set("movementRightEnabled", o.enabled.toString());
                        S.set("movementRightKey", o.key);
                        S.set("movementRightPage", o.page);
                        break;
                    case "up":
                        movementUpEnabled = o.enabled;
                        movementUpKey = o.key;
                        movementUpPage = o.page;
                        S.set("movementUpEnabled", o.enabled.toString());
                        S.set("movementUpKey", o.key);
                        S.set("movementUpPage", o.page);
                        break;
                    case "down":
                        movementDownEnabled = o.enabled;
                        movementDownKey = o.key;
                        movementDownPage = o.page;
                        S.set("movementDownEnabled", o.enabled.toString());
                        S.set("movementDownKey", o.key);
                        S.set("movementDownPage", o.page);
                        break;
                    case "topLeft":
                        movementTopLeftEnabled = o.enabled;
                        movementTopLeftKey = o.key;
                        movementTopLeftPage = o.page;
                        S.set("movementTopLeftEnabled", o.enabled.toString());
                        S.set("movementTopLeftKey", o.key);
                        S.set("movementTopLeftPage", o.page);
                        break;
                    case "topRight":
                        movementTopRightEnabled = o.enabled;
                        movementTopRightKey = o.key;
                        movementTopRightPage = o.page;
                        S.set("movementTopRightEnabled", o.enabled.toString());
                        S.set("movementTopRightKey", o.key);
                        S.set("movementTopRightPage", o.page);
                        break;
                    case "bottomLeft":
                        movementBottomLeftEnabled = o.enabled;
                        movementBottomLeftKey = o.key;
                        movementBottomLeftPage = o.page;
                        S.set("movementBottomLeftEnabled", o.enabled.toString());
                        S.set("movementBottomLeftKey", o.key);
                        S.set("movementBottomLeftPage", o.page);
                        break;
                    case "bottomRight":
                        movementBottomRightEnabled = o.enabled;
                        movementBottomRightKey = o.key;
                        movementBottomRightPage = o.page;
                        S.set("movementBottomRightEnabled", o.enabled.toString());
                        S.set("movementBottomRightKey", o.key);
                        S.set("movementBottomRightPage", o.page);
                }
            });
        }
        if (t.normalSettings) {
            const e = t.normalSettings;
            Object.keys(e).forEach(t => {
                const o = e[t];
                switch (t) {
                    case "bottomLeft":
                        normalBottomLeftEnabled = o.enabled;
                        normalBottomLeftKey = o.key;
                        normalBottomLeftPage = o.page;
                        S.set("normalBottomLeftEnabled", o.enabled.toString());
                        S.set("normalBottomLeftKey", o.key);
                        S.set("normalBottomLeftPage", o.page);
                        break;
                    case "middleBottom":
                        normalMiddleBottomEnabled = o.enabled;
                        normalMiddleBottomKey = o.key;
                        normalMiddleBottomPage = o.page;
                        S.set("normalMiddleBottomEnabled", o.enabled.toString());
                        S.set("normalMiddleBottomKey", o.key);
                        S.set("normalMiddleBottomPage", o.page);
                        break;
                    case "bottomRight":
                        normalBottomRightEnabled = o.enabled;
                        normalBottomRightKey = o.key;
                        normalBottomRightPage = o.page;
                        S.set("normalBottomRightEnabled", o.enabled.toString());
                        S.set("normalBottomRightKey", o.key);
                        S.set("normalBottomRightPage", o.page);
                        break;
                    case "left":
                        normalLeftEnabled = o.enabled;
                        normalLeftKey = o.key;
                        normalLeftPage = o.page;
                        S.set("normalLeftEnabled", o.enabled.toString());
                        S.set("normalLeftKey", o.key);
                        S.set("normalLeftPage", o.page);
                        break;
                    case "center":
                        normalCenterEnabled = o.enabled;
                        normalCenterKey = o.key;
                        normalCenterPage = o.page;
                        S.set("normalCenterEnabled", o.enabled.toString());
                        S.set("normalCenterKey", o.key);
                        S.set("normalCenterPage", o.page);
                        break;
                    case "right":
                        normalRightEnabled = o.enabled;
                        normalRightKey = o.key;
                        normalRightPage = o.page;
                        S.set("normalRightEnabled", o.enabled.toString());
                        S.set("normalRightKey", o.key);
                        S.set("normalRightPage", o.page);
                        break;
                    case "topLeft":
                        normalTopLeftEnabled = o.enabled;
                        normalTopLeftKey = o.key;
                        normalTopLeftPage = o.page;
                        S.set("normalTopLeftEnabled", o.enabled.toString());
                        S.set("normalTopLeftKey", o.key);
                        S.set("normalTopLeftPage", o.page);
                        break;
                    case "top":
                        normalTopEnabled = o.enabled;
                        normalTopKey = o.key;
                        normalTopPage = o.page;
                        S.set("normalTopEnabled", o.enabled.toString());
                        S.set("normalTopKey", o.key);
                        S.set("normalTopPage", o.page);
                        break;
                    case "topRight":
                        normalTopRightEnabled = o.enabled;
                        normalTopRightKey = o.key;
                        normalTopRightPage = o.page;
                        S.set("normalTopRightEnabled", o.enabled.toString());
                        S.set("normalTopRightKey", o.key);
                        S.set("normalTopRightPage", o.page);
                        break;
                    case "topc":
                        normalTopcEnabled = o.enabled;
                        normalTopcKey = o.key;
                        normalTopcPage = o.page;
                        S.set("normalTopcEnabled", o.enabled.toString());
                        S.set("normalTopcKey", o.key);
                        S.set("normalTopcPage", o.page);
                }
            });
        }
        if (t.timerSettings) {
            const e = t.timerSettings;
            if (e.enabled !== undefined) {
                timerEnabled = e.enabled;
                S.set("timerEnabled", e.enabled.toString());
            }
            if (e.colorMode !== undefined) {
                timerColorMode = e.colorMode;
                S.set("timerColorMode", e.colorMode);
            }
            if (e.fixedColor !== undefined) {
                timerFixedColor = e.fixedColor;
                S.set("timerFixedColor", e.fixedColor);
            }
        }
        updateCustomizationsUI();
        updateAllUIElements();
        const o = document.getElementById("controlPanel");
        if (o && panelBackgroundImage) {
            o.style.backgroundImage = `linear-gradient(rgba(26,26,36,0.85),rgba(15,15,19,0.95)),url(${panelBackgroundImage})`;
            o.style.backgroundSize = "cover";
            o.style.backgroundPosition = "center";
        }
        const circle = document.getElementById("nm-floating-circle");
        if (circle && buttonBackgroundImage) {
            circle.style.backgroundImage = `url(${buttonBackgroundImage})`;
        }
        settingsChannel.postMessage({
            type: "settings_imported",
            data: t
        });
        alert("تم استيراد الإعدادات بنجاح! ✅");
    } catch (e) {
        alert("خطأ في استيراد الإعدادات: " + e.message);
    }
}
function updateAllUIElements() {
    try {
        // Restore 7 color pickers
        const colorMap = {
            "nm-color-menu-bg": S.get("nmColorMenuBg", "#0b1220"),
            "nm-color-menu-shadow": S.get("nmColorMenuShadow", "#3ddcbf"),
            "nm-color-circle-bg": S.get("nmColorCircleBg", "#3ddcbf"),
            "nm-color-primary": S.get("nmColorPrimary", "#3ddcbf"),
            "nm-color-text-light": S.get("nmColorTextLight", "#eaf2ff"),
            "nm-color-text-dim": S.get("nmColorTextDim", "#93a7c6"),
            "nm-color-special-btn": S.get("nmColorSpecialBtn", "#eaf6ff"),
        };
        Object.entries(colorMap).forEach(([id, val]) => {
            const el = document.getElementById(id);
            if (el) el.value = val;
        });
        // Apply stored CSS vars
        const primary = S.get("nmColorPrimary", null);
        if (primary) {
            document.documentElement.style.setProperty("--primary-red", primary);
            // Restore derived vars
            try {
                const r = parseInt(primary.slice(1, 3), 16), g = parseInt(primary.slice(3, 5), 16), b = parseInt(primary.slice(5, 7), 16);
                document.documentElement.style.setProperty("--primary-rgb", `${r},${g},${b}`);
                const hr = Math.min(255, Math.round(r + (255 - r) * 0.2)), hg = Math.min(255, Math.round(g + (255 - g) * 0.2)), hb = Math.min(255, Math.round(b + (255 - b) * 0.2));
                document.documentElement.style.setProperty("--hover-red", `rgb(${hr},${hg},${hb})`);
                const dr = Math.round(r * 0.65), dg = Math.round(g * 0.65), db = Math.round(b * 0.65);
                document.documentElement.style.setProperty("--primary-dark", `rgb(${dr},${dg},${db})`);
            } catch (_) { }
        }
        const tl = S.get("nmColorTextLight", null);
        if (tl) document.documentElement.style.setProperty("--text-light", tl);
        const td = S.get("nmColorTextDim", null);
        if (td) document.documentElement.style.setProperty("--text-dim", td);
        const sb = S.get("nmColorSpecialBtn", null);
        if (sb) document.documentElement.style.setProperty("--special-btn-bg", sb);
        // Apply panel/circle stored colors
        const panel = document.getElementById("controlPanel");
        const circle = document.getElementById("nm-floating-circle");
        const menuBg = S.get("nmColorMenuBg", null);
        if (panel && menuBg) { panel.style.backgroundColor = menuBg; }
        const circleBg = S.get("nmColorCircleBg", null);
        if (circle && circleBg) { circle.style.backgroundColor = circleBg; }
        // multi toggle
        const mt = document.getElementById("multi-toggle");
        if (mt) mt.checked = multiEnabled;
        updateMovementUIElements();
        updateNormalUIElements();
        updateTimerUIElements();
    } catch (_) { }
}
function _syncLineRow(prefix, dirCap, enabled, key, page) {
    try {
        const toggle = document.getElementById(`${prefix}${dirCap}Enabled`);
        const pageSel = document.getElementById(`${prefix}${dirCap}PageSelect`);
        const keyBox = document.getElementById(`${prefix}${dirCap}KeyBox`);
        if (toggle) toggle.checked = enabled;
        if (pageSel) pageSel.value = page;
        if (keyBox) keyBox.textContent = (key && key !== "None") ? (_codeToDisplay[key] || key) : "";
    } catch (_) { }
}
function updateMovementUIElements() {
    try {
        _syncLineRow("movement", "Right", movementRightEnabled, movementRightKey, movementRightPage);
        _syncLineRow("movement", "Left", movementLeftEnabled, movementLeftKey, movementLeftPage);
        _syncLineRow("movement", "Up", movementUpEnabled, movementUpKey, movementUpPage);
        _syncLineRow("movement", "Down", movementDownEnabled, movementDownKey, movementDownPage);
        _syncLineRow("movement", "TopLeft", movementTopLeftEnabled, movementTopLeftKey, movementTopLeftPage);
        _syncLineRow("movement", "TopRight", movementTopRightEnabled, movementTopRightKey, movementTopRightPage);
        _syncLineRow("movement", "BottomLeft", movementBottomLeftEnabled, movementBottomLeftKey, movementBottomLeftPage);
        _syncLineRow("movement", "BottomRight", movementBottomRightEnabled, movementBottomRightKey, movementBottomRightPage);
    } catch (_) { }
}
function updateNormalUIElements() {
    try {
        _syncLineRow("normal", "BottomLeft", normalBottomLeftEnabled, normalBottomLeftKey, normalBottomLeftPage);
        _syncLineRow("normal", "MiddleBottom", normalMiddleBottomEnabled, normalMiddleBottomKey, normalMiddleBottomPage);
        _syncLineRow("normal", "BottomRight", normalBottomRightEnabled, normalBottomRightKey, normalBottomRightPage);
        _syncLineRow("normal", "Left", normalLeftEnabled, normalLeftKey, normalLeftPage);
        _syncLineRow("normal", "Center", normalCenterEnabled, normalCenterKey, normalCenterPage);
        _syncLineRow("normal", "Right", normalRightEnabled, normalRightKey, normalRightPage);
        _syncLineRow("normal", "TopLeft", normalTopLeftEnabled, normalTopLeftKey, normalTopLeftPage);
        _syncLineRow("normal", "Top", normalTopEnabled, normalTopKey, normalTopPage);
        _syncLineRow("normal", "TopRight", normalTopRightEnabled, normalTopRightKey, normalTopRightPage);
        _syncLineRow("normal", "Topc", normalTopcEnabled, normalTopcKey, normalTopcPage);
    } catch (_) { }
}
function updateTimerUIElements() {
    try {
        const e = boolFrom(S.get("timerEnabled", false));
        const t = S.get("timerColorMode", "random");
        const o = S.get("timerFixedColor", "#FFFFFF");
        timerEnabled = e; timerColorMode = t; timerFixedColor = o;
        const toggleEl = document.getElementById("timerEnabled");
        const modeEl = document.getElementById("timerColorMode");
        const colorEl = document.getElementById("timerFixedColor");
        const boxEl = document.getElementById("timerSettingsContainer");
        if (toggleEl) { toggleEl.checked = e; if (boxEl) boxEl.style.display = e ? "inline-flex" : "none"; }
        if (modeEl) { modeEl.value = t; if (colorEl) colorEl.style.display = t === "fixed" ? "inline-block" : "none"; }
        if (colorEl) colorEl.value = o;
    } catch (_) { }
}
(async () => {
    try { await ensureMyTabId(); } catch (_) { }
    try { setupFocusSignalListener(); } catch (_) { }
    try { maybeClaimPairFromHash(); } catch (_) { }
})();

// ══════════════════════════════════════════════════════════════════════════════
// PIN engine (double press) - works for ALL 8 directions.
// Absolute: the game never sees the real mouse, every packet it makes is dropped,
// and our own packet is forced through at ~60/s (also in a background tab).
// ══════════════════════════════════════════════════════════════════════════════
(function initPinEngine() {
    'use strict';

    const ORDER = ["Left", "Right", "Up", "Down", "TopLeft", "TopRight", "BottomLeft", "BottomRight"];

    // A pin must push the SAME packet coordinate a single-press line already pushes
    // (MOUSE_MOVE_COORDS, ~1e7 magnitude) - not a separate, far more extreme value.
    // An old build pinned corners to coordinates near the int32 limit (~2.1 billion)
    // while plain lines used ~1e7; that huge mismatch is what made a pinned corner
    // behave erratically (overflow/clamping on the server side) while a normal line
    // on the same direction worked fine. Keeping pin and line on one shared scale
    // fixes that for all 8 directions, corners included.
    function coordsFor(k) {
        // v4: a pin and a line now aim through the exact same physics point, so a
        // pinned corner and a lined corner are the same 45° - never two scales.
        try {
            if (window.__nmPhys) {
                const p = window.__nmPhys.aim(k);
                if (p) return p;
            }
        } catch (_) { }
        const w = window.innerWidth, h = window.innerHeight;
        const c = MOUSE_MOVE_COORDS[k];
        if (!c) return null;
        const x = c.x(w), y = c.y(h);
        // sx/sy are only for the cosmetic synthetic mouse/pointer dispatch (never sent
        // to the server), clamped to stay near the real viewport so listeners that read
        // clientX/clientY for layout math don't choke on an astronomical value.
        const sx = Math.max(-100000, Math.min(w + 100000, x));
        const sy = Math.max(-100000, Math.min(h + 100000, y));
        return { x: x, y: y, sx: sx, sy: sy };
    }

    window.clActive = {};
    ORDER.forEach(k => { window.clActive[k] = false; });
    window._clBypass = false;
    window._clAllowNext = false;

    const anyActive = () => ORDER.some(k => window.clActive[k]);
    const inOurUI = (t) => { try { return !!(t && t.closest && t.closest("#controlPanel,#nm-floating-circle,#nm-setup-overlay")); } catch (_) { return false; } };

    const BLOCKED = ['mousemove', 'mouseenter', 'mouseover', 'mouseout', 'mouseleave', 'pointermove', 'pointerenter', 'pointerover'];
    const blocker = nativeify(function clMouseBlocker(ev) {
        try {
            if (window._clBypass) return;
            if (!anyActive()) return;
            if (inOurUI(ev.target)) return;
            ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
        } catch (_) { }
    }, 'clMouseBlocker');
    BLOCKED.forEach(type => {
        try { document.addEventListener(type, blocker, true); } catch (_) { }
        try { window.addEventListener(type, blocker, true); } catch (_) { }
    });

    window.__loader_on_ws_send && window.__loader_on_ws_send((ws, data) => {
        // Same reasoning as above: _clBypass never exempts a packet from this check.
        try {
            if (anyActive()) {
                let opcode = -1;
                if (data instanceof ArrayBuffer && data.byteLength >= 1) opcode = new Uint8Array(data)[0];
                else if (data && data.buffer instanceof ArrayBuffer && data.byteLength >= 1) opcode = new Uint8Array(data.buffer, data.byteOffset, 1)[0];
                if (opcode === 16) {
                    if (window._clAllowNext) { window._clAllowNext = false; return; }
                    window.__nmStat.drop++;
                    return false;
                }
            }
        } catch (_) { }
    });

    function forceSend(k) {
        try {
            if (window.NMUPDATE && NMUPDATE.isBlocked()) return;
            const c = coordsFor(k);
            if (!c) return;
            const target = document.querySelector('canvas') || document.documentElement;
            const opts = { bubbles: true, cancelable: true, composed: true, clientX: c.sx, clientY: c.sy, button: 0, buttons: 0 };
            // _clBypass here is ONLY read by the DOM mouse-event blocker above, so our own
            // cosmetic synthetic events reach the canvas instead of being swallowed by it.
            // It must stay false for ws.send() purposes - see the comment on the corner-lock
            // check in WrapWS. The real packet below goes out through ws._clRawSend, the
            // original unwrapped send, so it never touches that filter either way.
            try { if (window.__nmPhys) window.__nmPhys.markMouse(c.sx, c.sy, false); } catch (_) { }
            window._clBypass = true;
            try {
                try {
                    if (window.PointerEvent) target.dispatchEvent(new PointerEvent('pointermove', Object.assign({}, opts, { pointerId: 1, pointerType: 'mouse', isPrimary: true })));
                } catch (_) { }
                try { target.dispatchEvent(new MouseEvent('mousemove', opts)); } catch (_) { }
                const buf = pkt_move(c.x, c.y);
                if (buf) {
                    const sessions = window.__loader_sessions || [];
                    for (let i = sessions.length - 1; i >= 0; i--) {
                        const ws = sessions[i];
                        if (ws && ws.readyState === WebSocket.OPEN) {
                            const raw = ws._clRawSend || ws.send;
                            try { raw.call(ws, buf); } catch (_) { }
                        }
                    }
                }
                window.__nmStat.forced++; window.__nmStat.x = c.x; window.__nmStat.y = c.y;
            } finally { window._clBypass = false; }
        } catch (_) { window._clBypass = false; }
    }

    let tickerOn = false;
    function ensureTicker() {
        if (tickerOn) return;
        tickerOn = true;
        nmTicker(() => { try { ORDER.forEach(k => { if (window.clActive[k]) forceSend(k); }); } catch (_) { } }, 16);
    }

    function activate(k) {
        if (!(k in window.clActive)) return;
        window.activeMovementLock = null;
        window.activeNormalLock = null;
        window.nmLinePinned = false;
        ORDER.forEach(o => { window.clActive[o] = false; });   // one pinned direction at a time
        window.clActive[k] = true;
        ensureTicker();
        forceSend(k);
    }
    function deactivate(k) { window.clActive[k] = false; }
    function releaseAll() { ORDER.forEach(o => { window.clActive[o] = false; }); }
    function isActive(k) { return !!window.clActive[k]; }

    defineHidden(window, '__nmCorner', { activate, deactivate, releaseAll, isActive });
})();

// ══════════════════════════════════════════════════════════════════════════════
// Packet recorder: shows exactly what THIS page sends to the game server
// (so a feature like mute / admin can be rebuilt from the real packet).
// ══════════════════════════════════════════════════════════════════════════════
const NMREC = (function () {
    const st = { on: S.get("recOn", "false") === "true", hideMouse: S.get("recHideMouse", "true") !== "false", rows: [], t0: Date.now() };
    const hex2 = (b) => (b < 16 ? "0" : "") + b.toString(16);
    function bytesOf(data) {
        try {
            if (data instanceof ArrayBuffer) return new Uint8Array(data);
            if (data && data.buffer instanceof ArrayBuffer) return new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength);
        } catch (_) { }
        return null;
    }
    function guessText(u8) {
        try {
            const t = new TextDecoder("utf-8", { fatal: true }).decode(u8.subarray(1));
            if (/^[\x20-\x7E\u0600-\u06FF]{2,}$/.test(t)) return t;
        } catch (_) { }
        for (let off = 1; off <= 3 && off < u8.length; off++) {          // UTF-16LE, typical for agar-style packets
            let s = "", good = 0, n = 0;
            for (let i = off; i + 1 < u8.length; i += 2) {
                const c = u8[i] | (u8[i + 1] << 8);
                if (c === 0) break;
                n++; s += String.fromCharCode(c);
                if (c >= 32 && c !== 127) good++;
            }
            if (n >= 2 && good / n > 0.8) return s;
        }
        return "";
    }
    function add(data) {
        if (!st.on) return;
        let type = "bin", hex = "", text = "", op = -1, len = 0;
        const u8 = bytesOf(data);
        if (typeof data === "string") { type = "text"; text = data.slice(0, 300); len = data.length; }
        else if (u8) {
            len = u8.length; op = len ? u8[0] : -1;
            if (st.hideMouse && op === 16 && len === 13) return;
            const n = Math.min(len, 64), a = [];
            for (let i = 0; i < n; i++) a.push(hex2(u8[i]));
            hex = a.join(" ") + (len > n ? " …" : "");
            text = guessText(u8.subarray(0, Math.min(len, 400)));
        } else { type = "blob"; len = (data && data.size) || 0; }
        const last = st.rows[st.rows.length - 1];
        if (last && last.hex === hex && last.text === text && last.type === type) { last.n++; last.t = Date.now() - st.t0; return; }
        st.rows.push({ t: Date.now() - st.t0, type: type, len: len, op: op, hex: hex, text: text, n: 1 });
        if (st.rows.length > 300) st.rows.shift();
    }
    window.__loader_on_ws_send && window.__loader_on_ws_send((ws, data) => { try { add(data); } catch (_) { } });
    const line = (r) => "[" + (r.t / 1000).toFixed(2) + "s] " + r.type + " len=" + r.len + (r.op >= 0 ? " op=" + r.op : "") + (r.n > 1 ? " x" + r.n : "") +
        (r.hex ? " | " + r.hex : "") + (r.text ? " | text: " + r.text : "");
    return {
        st: st,
        set(k, v) { if (k === "on") { st.on = !!v; S.set("recOn", String(!!v)); if (v) st.t0 = Date.now(); } else if (k === "hideMouse") { st.hideMouse = !!v; S.set("recHideMouse", String(!!v)); } },
        clear() { st.rows.length = 0; st.t0 = Date.now(); },
        text(n) { const r = n ? st.rows.slice(-n) : st.rows; return r.map(line).join("\n"); }
    };
})();

// ══════════════════════════════════════════════════════════════════════════════
// Macro recorder / player — records real key presses you make (with their real
// timing) and replays them later with ONE press. Everything happens on your own
// page through the same key system already in the tool; nothing is sent to or
// about any other player.
// ══════════════════════════════════════════════════════════════════════════════
const NMMACRO = (function () {
    const KEY = "nm3_macros";
    let list = [];
    try { list = JSON.parse(S.get(KEY, "[]")) || []; } catch (_) { list = []; }
    const rec = { on: false, t0: 0, steps: [], name: "" };
    let playTimer = null, playing = false;

    function save() { try { S.set(KEY, JSON.stringify(list)); } catch (_) { } }
    function all() { return list; }

    function startRecord(name) {
        rec.on = true; rec.t0 = performance.now(); rec.steps = [];
        rec.name = (name && name.trim()) || ("ماكرو " + (list.length + 1));
    }
    function stopRecord() {
        if (!rec.on) return null;
        rec.on = false;
        if (!rec.steps.length) return null;
        const m = { name: rec.name, steps: rec.steps.slice(0, 400), key: "None" };
        list.push(m); save();
        return m;
    }
    function cancelRecord() { rec.on = false; rec.steps = []; }
    function captureKey(code) {
        if (!rec.on) return;
        if (rec.steps.length >= 400) return;
        rec.steps.push({ t: Math.round(performance.now() - rec.t0), code: code });
    }
    function removeAt(i) { if (list[i]) { list.splice(i, 1); save(); } }
    function setKeyFor(i, code) { if (list[i]) { list[i].key = code || "None"; save(); } }
    function renameAt(i, name) { if (list[i] && name && name.trim()) { list[i].name = name.trim(); save(); } }

    function play(i) {
        const m = list[i];
        if (!m || !m.steps.length || playing) return;
        playing = true;
        const fire = (idx) => {
            if (idx >= m.steps.length) { playing = false; return; }
            const step = m.steps[idx];
            try {
                window.__nmMacroReplay = true;
                window.dispatchEvent(new KeyboardEvent('keydown', { code: step.code, bubbles: true, cancelable: true }));
            } catch (_) { } finally { window.__nmMacroReplay = false; }
            const next = m.steps[idx + 1];
            const wait = next ? Math.max(0, next.t - step.t) : 0;
            playTimer = setTimeout(() => fire(idx + 1), wait);
        };
        fire(0);
    }
    function stopPlay() { if (playTimer) clearTimeout(playTimer); playTimer = null; playing = false; }
    function isPlaying() { return playing; }

    window.addEventListener("keydown", nativeify(function nmMacroHotkeys(e) {
        try {
            if (!e.isTrusted || e.repeat) return;
            if (rec.on) { captureKey(e.code); return; }
            for (let i = 0; i < list.length; i++) {
                if (list[i].key && list[i].key !== "None" && list[i].key === e.code) { play(i); break; }
            }
        } catch (_) { }
    }, 'nmMacroHotkeys'), true);

    return { all, startRecord, stopRecord, cancelRecord, removeAt, setKeyFor, renameAt, play, stopPlay, isPlaying, isRecording: () => rec.on, recName: () => rec.name, recLen: () => rec.steps.length };
})();

// ══════════════════════════════════════════════════════════════════════════════
// Size alerts — notices YOUR OWN ball's on-screen size changing fast (grew a lot
// after eating something, or shrank fast = danger) using the same canvas hook
// NMCOL already built to find "my" ball. Sound + screen flash only.
// ══════════════════════════════════════════════════════════════════════════════
const NMALERT = (function () {
    const cfg = {
        on: S.get("alOn", "false") === "true",
        growPct: Number(S.get("alGrowPct", "18")) || 18,
        shrinkPct: Number(S.get("alShrinkPct", "22")) || 22,
        sound: S.get("alSound", "true") !== "false"
    };
    let lastR = 0, cooldownUntil = 0, ac = null, events = [];
    function beep(freq, ms) {
        if (!cfg.sound) return;
        try {
            ac = ac || new (window.AudioContext || window.webkitAudioContext)();
            const o = ac.createOscillator(), g = ac.createGain();
            o.frequency.value = freq; o.type = "sine";
            g.gain.value = 0.08;
            o.connect(g); g.connect(ac.destination);
            o.start(); o.stop(ac.currentTime + ms / 1000);
        } catch (_) { }
    }
    function flash(color) {
        try {
            let el = document.getElementById("nm-flash");
            if (!el) {
                el = document.createElement("div"); el.id = "nm-flash";
                el.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;opacity:0;transition:opacity .22s";
                document.documentElement.appendChild(el);
            }
            el.style.boxShadow = "inset 0 0 0 9999px " + color;
            el.style.opacity = "1";
            setTimeout(() => { el.style.opacity = "0"; }, 220);
        } catch (_) { }
    }
    function tick() {
        if (!cfg.on || !NMCOL || !NMCOL.radius) return;
        const r = NMCOL.radius();
        const now = performance.now();
        if (r > 0 && lastR > 0 && now > cooldownUntil) {
            const pct = (r - lastR) / lastR * 100;
            if (pct >= cfg.growPct) {
                beep(880, 120); flash("rgba(50,255,120,.18)"); cooldownUntil = now + 1200;
                events.unshift({ t: Date.now(), kind: "grow", pct: Math.round(pct) });
            } else if (pct <= -cfg.shrinkPct) {
                beep(220, 180); flash("rgba(255,60,60,.22)"); cooldownUntil = now + 1200;
                events.unshift({ t: Date.now(), kind: "shrink", pct: Math.round(pct) });
            }
            if (events.length > 30) events.length = 30;
        }
        if (r > 0) lastR = r;
    }
    setInterval(() => { try { tick(); } catch (_) { } }, 300);
    const KEYS = { on: "alOn", growPct: "alGrowPct", shrinkPct: "alShrinkPct", sound: "alSound" };
    function set(k, v) {
        if (!(k in KEYS)) return;
        cfg[k] = v;
        S.set(KEYS[k], String(v));
    }
    return { cfg, set, events: () => events, testSound: () => { beep(880, 120); flash("rgba(50,255,120,.18)"); } };
})();

// ══════════════════════════════════════════════════════════════════════════════
// Profiles — save/switch between several full named setups of the tool
// (lines/keys excluded on purpose — those stay per-page; colors/perf/alerts
// included) stored locally, nothing leaves your browser.
// ══════════════════════════════════════════════════════════════════════════════
const NMPROFILES = (function () {
    const KEY = "nm3_profiles";
    let store = {};
    try { store = JSON.parse(S.get(KEY, "{}")) || {}; } catch (_) { store = {}; }
    function save() { try { S.set(KEY, JSON.stringify(store)); } catch (_) { } }
    function names() { return Object.keys(store); }
    function saveAs(name) {
        if (!name || !name.trim()) return false;
        name = name.trim();
        store[name] = typeof nmExportExtra === "function" ? nmExportExtra() : {};
        save();
        return true;
    }
    function load(name) {
        const o = store[name];
        if (!o) return false;
        try { nmImportExtra(o); } catch (_) { }
        return true;
    }
    function remove(name) { if (store[name]) { delete store[name]; save(); } }
    return { names, saveAs, load, remove };
})();

// ══════════════════════════════════════════════════════════════════════════════
// Clip recorder — records the game canvas to a local .webm file you download,
// using the browser's own MediaRecorder. Nothing leaves your machine.
// ══════════════════════════════════════════════════════════════════════════════
const NMCAP = (function () {
    let rec = null, chunks = [], recording = false, startedAt = 0;
    function findCanvas() {
        const all = Array.from(document.querySelectorAll("canvas")).filter(c => c.id !== "kiro-overlay" && c.width > 50 && c.height > 50);
        return all.sort((a, b) => (b.width * b.height) - (a.width * a.height))[0] || null;
    }
    function start() {
        if (recording) return false;
        const canvas = findCanvas();
        if (!canvas || !canvas.captureStream) return false;
        try {
            const stream = canvas.captureStream(30);
            const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) || "video/webm";
            rec = new MediaRecorder(stream, { mimeType: mime });
            chunks = [];
            rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
            rec.onstop = () => {
                try {
                    const blob = new Blob(chunks, { type: "video/webm" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url; a.download = "agar-clip-" + Date.now() + ".webm";
                    document.body.appendChild(a); a.click(); a.remove();
                    setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_) { } }, 8000);
                } catch (_) { }
            };
            rec.start(250);
            recording = true; startedAt = Date.now();
            return true;
        } catch (_) { return false; }
    }
    function stop() {
        if (!recording) return;
        try { rec.stop(); } catch (_) { }
        recording = false;
    }
    return { start, stop, isRecording: () => recording, seconds: () => recording ? Math.floor((Date.now() - startedAt) / 1000) : 0 };
})();
