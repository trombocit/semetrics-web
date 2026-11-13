// src/client.ts
import { onCLS, onINP, onLCP, onTTFB } from "web-vitals";

// src/queue.ts
var PREFIX = "sm_q_";
var HB_PREFIX = "sm_hb_";
var ORPHAN_AFTER_MS = 2 * 60 * 1e3;
var EventQueue = class {
  constructor(storage, visitId, max = 1e3) {
    this.storage = storage;
    this.max = max;
    this.entries = [];
    this.key = PREFIX + visitId;
    this.hbKey = HB_PREFIX + visitId;
    this.entries = this.read(this.key);
  }
  read(key) {
    try {
      const raw = this.storage.get(key);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((x) => x && x.e && x.e.event_id) : [];
    } catch {
      return [];
    }
  }
  save() {
    if (this.entries.length) this.storage.set(this.key, JSON.stringify(this.entries));
    else this.storage.remove(this.key);
  }
  get size() {
    return this.entries.length;
  }
  push(e) {
    if (this.entries.length >= this.max) return false;
    this.entries.push({ e });
    this.save();
    return true;
  }
  /** События к отправке: не отправленные или отправленные давно без подтверждения. */
  pending(now, resendAfterMs) {
    return this.entries.filter((x) => !x.s || now - x.s > resendAfterMs).map((x) => x.e);
  }
  markSent(ids, now) {
    const set = new Set(ids);
    for (const x of this.entries) if (set.has(x.e.event_id)) x.s = now;
    this.save();
  }
  remove(ids) {
    const set = new Set(ids);
    this.entries = this.entries.filter((x) => !set.has(x.e.event_id));
    this.save();
  }
  /** Перенести всё в другую очередь (смена визита после reset) и удалить свою. */
  moveTo(other) {
    for (const x of this.entries) if (!other.push(x.e)) break;
    this.entries = [];
    this.save();
    this.storage.remove(this.hbKey);
  }
  heartbeat(now) {
    this.storage.set(this.hbKey, String(now));
  }
  /** Забрать очереди закрытых вкладок: их пульс старше ORPHAN_AFTER_MS. */
  adoptOrphans(now) {
    let adopted = 0;
    for (const k of this.storage.keys(PREFIX)) {
      if (k === this.key) continue;
      const visit = k.slice(PREFIX.length);
      const hb = Number(this.storage.get(HB_PREFIX + visit) || 0);
      if (now - hb < ORPHAN_AFTER_MS) continue;
      const orphan = this.read(k);
      const known = new Set(this.entries.map((x) => x.e.event_id));
      for (const x of orphan) {
        if (this.entries.length >= this.max) break;
        if (!known.has(x.e.event_id)) {
          this.entries.push({ e: x.e });
          adopted++;
        }
      }
      this.storage.remove(k);
      this.storage.remove(HB_PREFIX + visit);
    }
    if (adopted) this.save();
    return adopted;
  }
};

// src/util.ts
function uuid() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = b[6] & 15 | 64;
  b[8] = b[8] & 63 | 128;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
var SafeStorage = class {
  constructor(backend) {
    this.backend = backend;
    this.memory = /* @__PURE__ */ new Map();
  }
  store() {
    try {
      const s = this.backend();
      if (!s) return void 0;
      const probe = "__sm_probe__";
      s.setItem(probe, "1");
      s.removeItem(probe);
      return s;
    } catch {
      return void 0;
    }
  }
  get(key) {
    var _a, _b;
    try {
      const s = this.store();
      return s ? s.getItem(key) : (_a = this.memory.get(key)) != null ? _a : null;
    } catch {
      return (_b = this.memory.get(key)) != null ? _b : null;
    }
  }
  set(key, value) {
    try {
      const s = this.store();
      if (s) {
        s.setItem(key, value);
        return true;
      }
    } catch {
    }
    this.memory.set(key, value);
    return false;
  }
  remove(key) {
    var _a;
    try {
      (_a = this.store()) == null ? void 0 : _a.removeItem(key);
    } catch {
    }
    this.memory.delete(key);
  }
  keys(prefix) {
    const out = /* @__PURE__ */ new Set();
    try {
      const s = this.store();
      if (s) for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (k && k.startsWith(prefix)) out.add(k);
      }
    } catch {
    }
    for (const k of this.memory.keys()) if (k.startsWith(prefix)) out.add(k);
    return [...out];
  }
};
var ID_SEGMENT = [
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  // UUID
  /^\d+$/,
  // число
  /^(?=.*\d)[A-Za-z0-9_-]{8,}$/
  // 8+ символов с цифрами: коды, токены
];
function defaultPageTemplate(url) {
  const parts = url.pathname.split("/").map((seg) => {
    let decoded = seg;
    try {
      decoded = decodeURIComponent(seg);
    } catch {
    }
    return ID_SEGMENT.some((re) => re.test(decoded)) ? ":id" : seg;
  });
  const path = parts.join("/");
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path || "/";
}
function referrerHost(referrer, ownHost) {
  if (!referrer) return null;
  try {
    const host = new URL(referrer).hostname.toLowerCase();
    return host && host !== ownHost.toLowerCase() ? host : null;
  } catch {
    return null;
  }
}
var UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
function utmParams(url) {
  const out = {};
  for (const k of UTM_KEYS) {
    const v = url.searchParams.get(k);
    if (v) out[k] = v.slice(0, 64);
  }
  return out;
}
function scrubMessage(message, max = 200) {
  return message.replace(/https?:\/\/([^/\s?#]+)[^\s]*/g, "$1").replace(/(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{8,}/g, "***").slice(0, max);
}
function deviceInfo(ua, uaDataMobile) {
  const tablet = /iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua);
  const mobile = uaDataMobile != null ? uaDataMobile : /Mobi|iPhone|iPod|Android.*Mobile/i.test(ua);
  const device = tablet ? "tablet" : mobile ? "mobile" : "desktop";
  const os = /Android/i.test(ua) ? "android" : /iPhone|iPad|iPod/i.test(ua) ? "ios" : /Windows/i.test(ua) ? "windows" : /Mac OS X|Macintosh/i.test(ua) ? "macos" : /CrOS/i.test(ua) ? "chromeos" : /Linux/i.test(ua) ? "linux" : "other";
  const browser = /YaBrowser/i.test(ua) ? "yandex" : /Edg\//i.test(ua) ? "edge" : /OPR\/|Opera/i.test(ua) ? "opera" : /SamsungBrowser/i.test(ua) ? "samsung" : /Firefox|FxiOS/i.test(ua) ? "firefox" : /Chrome|CriOS/i.test(ua) ? "chrome" : /Safari/i.test(ua) ? "safari" : "other";
  return { device, os, browser };
}
var BOT_UA = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|facebookexternalhit|vkshare|whatsapp|telegram|preview/i;
function isBot(ua, webdriver) {
  return !!webdriver || BOT_UA.test(ua);
}

// src/client.ts
var SDK_VERSION = "0.1.0";
var DEFAULT_ENDPOINT = "https://semetrics.ru/events";
var MAX_ERRORS_PER_VISIT = 5;
var BEACON_MAX_BYTES = 60 * 1024;
var RESEND_AFTER_MS = 3e4;
var BACKOFF_BASE_MS = 5e3;
var BACKOFF_MAX_MS = 3e5;
var SemetricsWeb = class {
  constructor(config) {
    this.local = new SafeStorage(() => window.localStorage);
    this.session = new SafeStorage(() => window.sessionStorage);
    this.visitId = "";
    this.userId = null;
    this.anonId = null;
    this.currentPage = null;
    this.loadPage = null;
    this.lastPath = null;
    this.sending = false;
    this.failures = 0;
    this.nextAttemptAt = 0;
    this.errorMessages = /* @__PURE__ */ new Set();
    this.vitals = {};
    this.vitalsSent = false;
    this.teardown = [];
    this.onLocationChange = () => {
      if (window.location.pathname !== this.lastPath) this.pageView();
    };
    this.onError = (ev) => {
      this.captureError("error", ev.message || String(ev.error || ""));
    };
    this.onRejection = (ev) => {
      const r = ev.reason;
      this.captureError("rejection", r && r.message || String(ev.reason));
    };
    this.onVital = (m) => {
      const name = m.name.toLowerCase();
      this.vitals[name === "cls" ? "cls" : `${name}_ms`] = name === "cls" ? Math.round(m.value * 1e3) / 1e3 : Math.round(m.value);
    };
    this.onHidden = () => {
      if (document.visibilityState !== "hidden") return;
      if (this.cfg.webVitals) this.sendVitals();
      this.beacon();
    };
    var _a;
    this.cfg = {
      endpoint: DEFAULT_ENDPOINT,
      persistentId: false,
      enabled: true,
      autoPageViews: true,
      captureErrors: true,
      webVitals: true,
      debug: false,
      flushIntervalMs: 1e4,
      batchSize: 20,
      ...config
    };
    this.url = this.cfg.endpoint.replace(/\/+$/, "") + "/ingest/web";
    const nav = navigator;
    this.device = deviceInfo(nav.userAgent || "", (_a = nav.userAgentData) == null ? void 0 : _a.mobile);
    const optedOut = this.local.get("sm_optout") === "1";
    this.active = this.cfg.enabled && !optedOut && !isBot(nav.userAgent || "", nav.webdriver) && !!config.key;
    if (!this.active) {
      this.log("SDK \u0432\u044B\u043A\u043B\u044E\u0447\u0435\u043D", { enabled: this.cfg.enabled, optedOut });
      return;
    }
    this.startVisit(this.session.get("sm_visit"));
    this.userId = this.session.get("sm_uid");
    if (this.cfg.persistentId) {
      this.anonId = this.local.get("sm_aid") || uuid();
      this.local.set("sm_aid", this.anonId);
    }
    this.queue.adoptOrphans(Date.now());
    this.listen();
  }
  log(...args) {
    if (this.cfg.debug) console.log("[semetrics]", ...args);
  }
  startVisit(existing) {
    const previous = this.queue;
    this.visitId = existing || uuid();
    this.session.set("sm_visit", this.visitId);
    this.queue = new EventQueue(this.local, this.visitId);
    this.queue.heartbeat(Date.now());
    previous == null ? void 0 : previous.moveTo(this.queue);
  }
  on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this.teardown.push(() => target.removeEventListener(type, fn, opts));
  }
  // ── публичный API ────────────────────────────────────────────
  track(name, properties = {}) {
    if (!this.active || !name) return;
    const props = { ...this.device, ...properties };
    if (this.currentPage !== null && props.page === void 0) props.page = this.currentPage;
    const event = {
      event_id: uuid(),
      event_name: name,
      client_ts: (/* @__PURE__ */ new Date()).toISOString(),
      user_id: this.userId,
      anonymous_id: this.anonId,
      session_id: this.visitId,
      source_id: this.cfg.source,
      source_version: this.cfg.sourceVersion || "",
      platform: "web",
      sdk_version: SDK_VERSION,
      properties: props
    };
    if (!this.queue.push(event)) this.log("\u043E\u0447\u0435\u0440\u0435\u0434\u044C \u043F\u0435\u0440\u0435\u043F\u043E\u043B\u043D\u0435\u043D\u0430, \u0441\u043E\u0431\u044B\u0442\u0438\u0435 \u043E\u0442\u0431\u0440\u043E\u0448\u0435\u043D\u043E", name);
    else this.log("track", name, props);
    if (this.queue.size >= this.cfg.batchSize) void this.flush();
  }
  identify(userId) {
    if (!this.active) return;
    this.userId = userId ? String(userId) : null;
    if (this.userId) this.session.set("sm_uid", this.userId);
    else this.session.remove("sm_uid");
  }
  /** Выход из аккаунта: забыть пользователя и начать новый визит. */
  reset() {
    if (!this.active) return;
    this.userId = null;
    this.session.remove("sm_uid");
    this.session.remove("sm_landed");
    this.startVisit(null);
  }
  // ── автособытия ──────────────────────────────────────────────
  pageView() {
    if (!this.active) return;
    const url = new URL(window.location.href);
    this.lastPath = url.pathname;
    const template = this.cfg.page ? this.cfg.page(url) : defaultPageTemplate(url);
    this.currentPage = template;
    if (this.loadPage === null) this.loadPage = template;
    if (template === null) return;
    const landing = this.session.get("sm_landed") !== "1";
    const props = { page: template, landing };
    if (landing) {
      this.session.set("sm_landed", "1");
      const ref = referrerHost(document.referrer, url.hostname);
      if (ref) props.referrer_host = ref;
      Object.assign(props, utmParams(url));
    }
    this.track("page_viewed", props);
  }
  captureError(kind, raw) {
    const message = scrubMessage(raw || "unknown");
    const count = Number(this.session.get("sm_err_n") || 0);
    if (count >= MAX_ERRORS_PER_VISIT || this.errorMessages.has(message)) return;
    this.errorMessages.add(message);
    this.session.set("sm_err_n", String(count + 1));
    this.track("client_error", { kind, message, online: navigator.onLine });
  }
  sendVitals() {
    if (this.vitalsSent || !Object.keys(this.vitals).length || this.loadPage === null) return;
    this.vitalsSent = true;
    this.track("web_vitals", { ...this.vitals, page: this.loadPage });
  }
  listen() {
    const w = window;
    if (this.cfg.webVitals) {
      onLCP(this.onVital);
      onINP(this.onVital);
      onCLS(this.onVital);
      onTTFB(this.onVital);
    }
    if (this.cfg.captureErrors) {
      this.on(w, "error", this.onError);
      this.on(w, "unhandledrejection", this.onRejection);
    }
    if (this.cfg.autoPageViews) {
      for (const method of ["pushState", "replaceState"]) {
        const original = history[method];
        const patched = function(...args) {
          const result = original.apply(this, args);
          w.dispatchEvent(new Event("semetrics:locationchange"));
          return result;
        };
        history[method] = patched;
        this.teardown.push(() => {
          if (history[method] === patched) history[method] = original;
        });
      }
      this.on(w, "popstate", this.onLocationChange);
      this.on(w, "semetrics:locationchange", this.onLocationChange);
      const doc = document;
      if (doc.prerendering) this.on(document, "prerenderingchange", () => this.pageView(), { once: true });
      else this.pageView();
    }
    this.on(document, "visibilitychange", this.onHidden);
    this.on(w, "pagehide", () => {
      if (this.cfg.webVitals) this.sendVitals();
      this.beacon();
    });
    this.timer = setInterval(() => {
      this.queue.heartbeat(Date.now());
      void this.flush();
    }, this.cfg.flushIntervalMs);
  }
  // ── доставка ─────────────────────────────────────────────────
  body(events) {
    return JSON.stringify({ key: this.cfg.key, events });
  }
  /** Пачка, которая влезает в лимит запроса. */
  take(max) {
    const out = [];
    let size = this.body([]).length;
    for (const e of this.queue.pending(Date.now(), RESEND_AFTER_MS)) {
      const len = JSON.stringify(e).length + 1;
      if (out.length >= max || size + len > BEACON_MAX_BYTES) break;
      out.push(e);
      size += len;
    }
    return out;
  }
  /** Отправить накопленное. `force` — без паузы после ошибок. */
  async flush(force = false) {
    if (!this.active || this.sending) return;
    if (!force && Date.now() < this.nextAttemptAt) return;
    this.sending = true;
    try {
      for (let round = 0; round < 10; round++) {
        const batch = this.take(50);
        if (!batch.length) return;
        const ids = batch.map((e) => e.event_id);
        let status = 0;
        try {
          const resp = await fetch(this.url, {
            method: "POST",
            body: this.body(batch),
            headers: { "Content-Type": "text/plain;charset=UTF-8" },
            credentials: "omit",
            keepalive: true
          });
          status = resp.status;
        } catch {
          status = 0;
        }
        if (status >= 200 && status < 300) {
          this.queue.remove(ids);
          this.failures = 0;
          this.nextAttemptAt = 0;
          continue;
        }
        if (status === 0 || status === 408 || status === 429 || status >= 500) {
          this.failures++;
          const delay = Math.min(BACKOFF_BASE_MS * 2 ** (this.failures - 1), BACKOFF_MAX_MS);
          this.nextAttemptAt = Date.now() + delay * (0.8 + Math.random() * 0.4);
          this.log("\u0441\u0435\u0440\u0432\u0435\u0440 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D, \u043F\u043E\u0432\u0442\u043E\u0440 \u043F\u043E\u0437\u0436\u0435", status);
          return;
        }
        this.log("\u0441\u0435\u0440\u0432\u0435\u0440 \u043E\u0442\u043A\u043B\u043E\u043D\u0438\u043B \u043F\u0430\u0447\u043A\u0443, \u0441\u043E\u0431\u044B\u0442\u0438\u044F \u0443\u0434\u0430\u043B\u0435\u043D\u044B", status);
        this.queue.remove(ids);
      }
    } finally {
      this.sending = false;
    }
  }
  /** Уход со страницы: отправить, что влезает, через sendBeacon. Удаляется после подтверждения. */
  beacon() {
    if (!this.active || typeof navigator.sendBeacon !== "function") return;
    let budget = BEACON_MAX_BYTES;
    while (budget > 1024) {
      const batch = this.take(50);
      if (!batch.length) return;
      const body = this.body(batch);
      if (body.length > budget) return;
      const ok = navigator.sendBeacon(this.url, new Blob([body], { type: "text/plain;charset=UTF-8" }));
      if (!ok) return;
      this.queue.markSent(batch.map((e) => e.event_id), Date.now());
      budget -= body.length;
    }
  }
  /** Отказ от статистики: запоминается на устройстве, SDK сразу перестаёт слать. */
  optOut() {
    this.local.set("sm_optout", "1");
    this.active = false;
  }
  /** Снять отказ. Сбор возобновится со следующей загрузки страницы. */
  optIn() {
    this.local.remove("sm_optout");
  }
  /** Снять обработчики и таймер, вернуть history как было. */
  destroy() {
    if (this.timer) clearInterval(this.timer);
    for (const fn of this.teardown.splice(0).reverse()) fn();
    this.active = false;
  }
};

// src/index.ts
var client = null;
var pending = [];
function call(fn) {
  if (typeof window === "undefined") return;
  if (client) fn(client);
  else if (pending.length < 100) pending.push(fn);
}
function init(config) {
  if (typeof window === "undefined" || client) return;
  client = new SemetricsWeb(config);
  for (const fn of pending.splice(0)) fn(client);
}
function track(name, properties) {
  call((c) => c.track(name, properties));
}
function identify(userId) {
  call((c) => c.identify(userId));
}
function reset() {
  call((c) => c.reset());
}
function flush() {
  return client ? client.flush(true) : Promise.resolve();
}
function pageView() {
  call((c) => c.pageView());
}
function optOut() {
  call((c) => c.optOut());
}
function optIn() {
  call((c) => c.optIn());
}
function _reset() {
  client == null ? void 0 : client.destroy();
  client = null;
  pending.splice(0);
}
export {
  SDK_VERSION,
  _reset,
  defaultPageTemplate,
  flush,
  identify,
  init,
  optIn,
  optOut,
  pageView,
  reset,
  track
};
