import { onCLS, onINP, onLCP, onTTFB, type Metric } from "web-vitals";
import { EventQueue, type WireEvent } from "./queue";
import {
  SafeStorage,
  defaultPageTemplate,
  deviceInfo,
  isBot,
  referrerHost,
  scrubMessage,
  utmParams,
  uuid,
  type DeviceInfo,
} from "./util";

export const SDK_VERSION = "0.1.0";

export interface SemetricsConfig {
  /** Клиентский ключ проекта (`sm_live_…`) — он публичен, ограничения задаются в Semetrics. */
  key: string;
  /** Источник событий (`source_id`), например `turniro.ru`. Должен быть в списке ключа. */
  source: string;
  /** Версия сайта (`source_version`). */
  sourceVersion?: string;
  /** Адрес Semetrics. По умолчанию `https://semetrics.ru/events`. */
  endpoint?: string;
  /**
   * Адрес → имя шаблона страницы. `null` — страницу не отправлять. По умолчанию — путь
   * без строки запроса, сегменты-id заменены на `:id`. Если в адресах есть секреты —
   * задайте обязательно.
   */
  page?: (url: URL) => string | null;
  /** Постоянный id устройства в localStorage (`anonymous_id`). По умолчанию выключен. */
  persistentId?: boolean;
  /** Выключатель: false — SDK ничего не собирает и не шлёт. */
  enabled?: boolean;
  autoPageViews?: boolean;
  captureErrors?: boolean;
  webVitals?: boolean;
  /** Лог в консоль. */
  debug?: boolean;
  flushIntervalMs?: number;
  batchSize?: number;
}

type Props = Record<string, unknown>;

const DEFAULT_ENDPOINT = "https://semetrics.ru/events";
const MAX_ERRORS_PER_VISIT = 5;
const BEACON_MAX_BYTES = 60 * 1024;   // общий лимит браузера на keepalive-запросы — 64 КБ
const RESEND_AFTER_MS = 30_000;
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 300_000;

export class SemetricsWeb {
  private readonly local = new SafeStorage(() => window.localStorage);
  private readonly session = new SafeStorage(() => window.sessionStorage);
  private readonly cfg: Required<Omit<SemetricsConfig, "page" | "sourceVersion">> & Pick<SemetricsConfig, "page" | "sourceVersion">;
  private readonly url: string;
  private readonly device: DeviceInfo;
  private queue!: EventQueue;
  private visitId = "";
  private userId: string | null = null;
  private anonId: string | null = null;
  private currentPage: string | null = null;
  private loadPage: string | null = null;
  private lastPath: string | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private sending = false;
  private failures = 0;
  private nextAttemptAt = 0;
  private errorMessages = new Set<string>();
  private vitals: Props = {};
  private vitalsSent = false;
  private teardown: Array<() => void> = [];
  active: boolean;

  constructor(config: SemetricsConfig) {
    this.cfg = {
      endpoint: DEFAULT_ENDPOINT,
      persistentId: false,
      enabled: true,
      autoPageViews: true,
      captureErrors: true,
      webVitals: true,
      debug: false,
      flushIntervalMs: 10_000,
      batchSize: 20,
      ...config,
    };
    this.url = this.cfg.endpoint.replace(/\/+$/, "") + "/ingest/web";
    const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
    this.device = deviceInfo(nav.userAgent || "", nav.userAgentData?.mobile);
    const optedOut = this.local.get("sm_optout") === "1";
    this.active = this.cfg.enabled && !optedOut && !isBot(nav.userAgent || "", nav.webdriver) && !!config.key;
    if (!this.active) {
      this.log("SDK выключен", { enabled: this.cfg.enabled, optedOut });
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

  private log(...args: unknown[]): void {
    if (this.cfg.debug) console.log("[semetrics]", ...args);
  }

  private startVisit(existing: string | null): void {
    const previous = this.queue as EventQueue | undefined;
    this.visitId = existing || uuid();
    this.session.set("sm_visit", this.visitId);
    this.queue = new EventQueue(this.local, this.visitId);
    this.queue.heartbeat(Date.now());
    previous?.moveTo(this.queue); // неотправленное старого визита не теряем
  }

  private on(target: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions): void {
    target.addEventListener(type, fn, opts);
    this.teardown.push(() => target.removeEventListener(type, fn, opts));
  }

  // ── публичный API ────────────────────────────────────────────

  track(name: string, properties: Props = {}): void {
    if (!this.active || !name) return;
    const props: Props = { ...this.device, ...properties };
    if (this.currentPage !== null && props.page === undefined) props.page = this.currentPage;
    const event: WireEvent = {
      event_id: uuid(),
      event_name: name,
      client_ts: new Date().toISOString(),
      user_id: this.userId,
      anonymous_id: this.anonId,
      session_id: this.visitId,
      source_id: this.cfg.source,
      source_version: this.cfg.sourceVersion || "",
      platform: "web",
      sdk_version: SDK_VERSION,
      properties: props,
    };
    if (!this.queue.push(event)) this.log("очередь переполнена, событие отброшено", name);
    else this.log("track", name, props);
    if (this.queue.size >= this.cfg.batchSize) void this.flush();
  }

  identify(userId: string | null): void {
    if (!this.active) return;
    this.userId = userId ? String(userId) : null;
    if (this.userId) this.session.set("sm_uid", this.userId);
    else this.session.remove("sm_uid");
  }

  /** Выход из аккаунта: забыть пользователя и начать новый визит. */
  reset(): void {
    if (!this.active) return;
    this.userId = null;
    this.session.remove("sm_uid");
    this.session.remove("sm_landed");
    this.startVisit(null);
  }

  // ── автособытия ──────────────────────────────────────────────

  pageView(): void {
    if (!this.active) return;
    const url = new URL(window.location.href);
    this.lastPath = url.pathname;
    const template = this.cfg.page ? this.cfg.page(url) : defaultPageTemplate(url);
    this.currentPage = template;
    if (this.loadPage === null) this.loadPage = template;
    if (template === null) return;
    const landing = this.session.get("sm_landed") !== "1";
    const props: Props = { page: template, landing };
    if (landing) {
      this.session.set("sm_landed", "1");
      const ref = referrerHost(document.referrer, url.hostname);
      if (ref) props.referrer_host = ref;
      Object.assign(props, utmParams(url));
    }
    this.track("page_viewed", props);
  }

  private onLocationChange = (): void => {
    if (window.location.pathname !== this.lastPath) this.pageView();
  };

  private onError = (ev: ErrorEvent): void => {
    this.captureError("error", ev.message || String(ev.error || ""));
  };

  private onRejection = (ev: PromiseRejectionEvent): void => {
    const r = ev.reason as { message?: string } | undefined;
    this.captureError("rejection", (r && r.message) || String(ev.reason));
  };

  private captureError(kind: string, raw: string): void {
    const message = scrubMessage(raw || "unknown");
    const count = Number(this.session.get("sm_err_n") || 0);
    if (count >= MAX_ERRORS_PER_VISIT || this.errorMessages.has(message)) return;
    this.errorMessages.add(message);
    this.session.set("sm_err_n", String(count + 1));
    this.track("client_error", { kind, message, online: navigator.onLine });
  }

  private onVital = (m: Metric): void => {
    const name = m.name.toLowerCase();
    this.vitals[name === "cls" ? "cls" : `${name}_ms`] = name === "cls" ? Math.round(m.value * 1000) / 1000 : Math.round(m.value);
  };

  private sendVitals(): void {
    if (this.vitalsSent || !Object.keys(this.vitals).length || this.loadPage === null) return;
    this.vitalsSent = true;
    this.track("web_vitals", { ...this.vitals, page: this.loadPage });
  }

  private onHidden = (): void => {
    if (document.visibilityState !== "hidden") return;
    if (this.cfg.webVitals) this.sendVitals();
    this.beacon();
  };

  private listen(): void {
    const w = window;
    if (this.cfg.webVitals) {
      // Колбэки web-vitals срабатывают на visibilitychange раньше нашего обработчика
      onLCP(this.onVital);
      onINP(this.onVital);
      onCLS(this.onVital);
      onTTFB(this.onVital);
    }
    if (this.cfg.captureErrors) {
      this.on(w, "error", this.onError as EventListener);
      this.on(w, "unhandledrejection", this.onRejection as EventListener);
    }
    if (this.cfg.autoPageViews) {
      for (const method of ["pushState", "replaceState"] as const) {
        const original = history[method];
        const patched = function (this: History, ...args: Parameters<History["pushState"]>) {
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
      const doc = document as Document & { prerendering?: boolean };
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

  private body(events: WireEvent[]): string {
    return JSON.stringify({ key: this.cfg.key, events });
  }

  /** Пачка, которая влезает в лимит запроса. */
  private take(max: number): WireEvent[] {
    const out: WireEvent[] = [];
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
  async flush(force = false): Promise<void> {
    if (!this.active || this.sending) return;
    if (!force && Date.now() < this.nextAttemptAt) return;
    this.sending = true;
    try {
      for (let round = 0; round < 10; round++) {
        const batch = this.take(50);
        if (!batch.length) return;
        const ids = batch.map(e => e.event_id);
        let status = 0;
        try {
          const resp = await fetch(this.url, {
            method: "POST",
            body: this.body(batch),
            headers: { "Content-Type": "text/plain;charset=UTF-8" },
            credentials: "omit",
            keepalive: true,
          });
          status = resp.status;
        } catch {
          status = 0; // сеть, блокировщик, CORS
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
          this.log("сервер недоступен, повтор позже", status);
          return;
        }
        // 4xx — запрос не примут никогда (ключ, домен, формат): не держим очередь
        this.log("сервер отклонил пачку, события удалены", status);
        this.queue.remove(ids);
      }
    } finally {
      this.sending = false;
    }
  }

  /** Уход со страницы: отправить, что влезает, через sendBeacon. Удаляется после подтверждения. */
  beacon(): void {
    if (!this.active || typeof navigator.sendBeacon !== "function") return;
    let budget = BEACON_MAX_BYTES;
    while (budget > 1024) {
      const batch = this.take(50);
      if (!batch.length) return;
      const body = this.body(batch);
      if (body.length > budget) return;
      const ok = navigator.sendBeacon(this.url, new Blob([body], { type: "text/plain;charset=UTF-8" }));
      if (!ok) return;
      this.queue.markSent(batch.map(e => e.event_id), Date.now());
      budget -= body.length;
    }
  }

  /** Отказ от статистики: запоминается на устройстве, SDK сразу перестаёт слать. */
  optOut(): void {
    this.local.set("sm_optout", "1");
    this.active = false;
  }

  /** Снять отказ. Сбор возобновится со следующей загрузки страницы. */
  optIn(): void {
    this.local.remove("sm_optout");
  }

  /** Снять обработчики и таймер, вернуть history как было. */
  destroy(): void {
    if (this.timer) clearInterval(this.timer);
    for (const fn of this.teardown.splice(0).reverse()) fn();
    this.active = false;
  }
}
