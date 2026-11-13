import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SemetricsWeb } from "../src/client";
import type { WireEvent } from "../src/queue";

const KEY = "sm_live_web_test";

type Sent = { url: string; body: { key: string; events: WireEvent[] }; via: "fetch" | "beacon" };
let sent: Sent[] = [];
let fetchStatus = 200;
let clients: SemetricsWeb[] = [];

function make(cfg: Partial<ConstructorParameters<typeof SemetricsWeb>[0]> = {}) {
  const c = new SemetricsWeb({ key: KEY, source: "turniro.ru", flushIntervalMs: 3_600_000, webVitals: false, ...cfg });
  clients.push(c);
  return c;
}

const events = () => sent.flatMap(s => s.body.events);
const names = () => events().map(e => e.event_name);

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  sent = [];
  fetchStatus = 200;
  window.history.replaceState(null, "", "/t/liga-a1b2c3d4?utm_source=vk&k=SECRET");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)), via: "fetch" });
    return new Response("{}", { status: fetchStatus });
  }));
  Object.defineProperty(navigator, "sendBeacon", {
    configurable: true,
    value: vi.fn(() => true),
  });
});

afterEach(() => {
  clients.forEach(c => c.destroy());
  clients = [];
  vi.unstubAllGlobals();
});

describe("просмотры страниц и источники", () => {
  it("первая страница визита: landing, referrer_host, utm; адрес без секретов", async () => {
    const c = make();
    await c.flush(true);
    const [pv] = events();
    expect(pv.event_name).toBe("page_viewed");
    expect(pv.properties).toMatchObject({ page: "/t/:id", landing: true, referrer_host: "vk.com", utm_source: "vk" });
    expect(JSON.stringify(pv)).not.toContain("SECRET");
    expect(pv.platform).toBe("web");
    expect(pv.source_id).toBe("turniro.ru");
    expect(sent[0].url).toBe("https://semetrics.ru/events/ingest/web");
    expect(sent[0].body.key).toBe(KEY);
  });

  it("переходы SPA: новый путь — событие, тот же путь с другим query — нет", async () => {
    const c = make();
    window.history.pushState(null, "", "/organizer");
    window.history.replaceState(null, "", "/organizer?tab=2");
    window.history.pushState(null, "", "/t/x12345678/register");
    await c.flush(true);
    const pages = events().filter(e => e.event_name === "page_viewed");
    expect(pages.map(e => e.properties.page)).toEqual(["/t/:id", "/organizer", "/t/:id/register"]);
    expect(pages.slice(1).every(e => e.properties.landing === false && !("utm_source" in e.properties))).toBe(true);
  });

  it("хук page: null — не слать страницу и не подставлять page в события", async () => {
    const c = make({ page: url => (url.pathname.startsWith("/s/") ? null : "tournament") });
    window.history.pushState(null, "", "/s/SECRET99");
    c.track("share_clicked");
    await c.flush(true);
    expect(names()).toEqual(["page_viewed", "share_clicked"]);
    expect(events()[0].properties.page).toBe("tournament");
    expect(events()[1].properties.page).toBeUndefined();
  });
});

describe("визит и пользователь", () => {
  it("session_id — визит вкладки; identify и reset", async () => {
    const c = make({ autoPageViews: false });
    c.track("a");
    c.identify("acc-1");
    c.track("b");
    c.reset();
    c.track("c");
    await c.flush(true);
    const [a, b, cc] = events();
    expect(a.user_id).toBeNull();
    expect(b.user_id).toBe("acc-1");
    expect(a.session_id).toBe(b.session_id);
    expect(cc.user_id).toBeNull();
    expect(cc.session_id).not.toBe(a.session_id);
    expect(a.anonymous_id).toBeNull();
    expect(document.cookie).toBe("");
  });

  it("persistentId — постоянный anonymous_id в window.localStorage", () => {
    const first = make({ persistentId: true, autoPageViews: false });
    const id = window.localStorage.getItem("sm_aid");
    expect(id).toBeTruthy();
    first.destroy();
    window.sessionStorage.clear();
    make({ persistentId: true, autoPageViews: false });
    expect(window.localStorage.getItem("sm_aid")).toBe(id);
  });

  it("свойства устройства в каждом событии, свои свойства важнее", async () => {
    const c = make({ autoPageViews: false });
    c.track("x", { device: "custom" });
    await c.flush(true);
    expect(events()[0].properties).toMatchObject({ device: "custom", os: expect.any(String), browser: expect.any(String) });
  });
});

describe("ошибки JavaScript", () => {
  it("чистит текст, склеивает одинаковые, не больше 5 за визит", async () => {
    const c = make({ autoPageViews: false });
    window.dispatchEvent(new ErrorEvent("error", { message: "Failed https://turniro.ru/i/tok12345678 x" }));
    window.dispatchEvent(new ErrorEvent("error", { message: "Failed https://turniro.ru/i/tok12345678 x" }));
    for (let i = 0; i < 10; i++) window.dispatchEvent(new ErrorEvent("error", { message: `err ${"ab".repeat(i + 1)}` }));
    await c.flush(true);
    const errs = events().filter(e => e.event_name === "client_error");
    expect(errs).toHaveLength(5);
    expect(errs[0].properties).toMatchObject({ kind: "error", message: "Failed turniro.ru x" });
  });
});

describe("доставка", () => {
  it("успех — очередь пустая; 503 — события остаются и ждут паузу", async () => {
    const c = make({ autoPageViews: false });
    c.track("a");
    fetchStatus = 503;
    await c.flush(true);
    expect(sent).toHaveLength(1);
    await c.flush();                 // пауза после ошибки — не шлём
    expect(sent).toHaveLength(1);
    fetchStatus = 200;
    await c.flush(true);
    expect(sent).toHaveLength(2);
    expect(window.localStorage.getItem(Object.keys(window.localStorage).find(k => k.startsWith("sm_q_"))!)).toBeNull();
  });

  it("403 — запрос не примут никогда: события не держим", async () => {
    const c = make({ autoPageViews: false });
    c.track("a");
    fetchStatus = 403;
    await c.flush(true);
    fetchStatus = 200;
    await c.flush(true);
    expect(sent).toHaveLength(1);
  });

  it("уход со страницы — sendBeacon text/plain; событие остаётся до подтверждения", async () => {
    const c = make({ autoPageViews: false });
    c.track("bye");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    const calls = (navigator.sendBeacon as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    const [url, blob] = calls[0] as [string, Blob];
    expect(url).toBe("https://semetrics.ru/events/ingest/web");
    expect(blob.type).toBe("text/plain;charset=utf-8");
    const text = await new Promise<string>(resolve => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.readAsText(blob);
    });
    expect(JSON.parse(text).events.map((e: WireEvent) => e.event_name)).toEqual(["bye"]);
    await c.flush(true);
    expect(sent).toHaveLength(0);    // недавно ушло через beacon — повторно не шлём сразу
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    const key = Object.keys(window.localStorage).find(k => k.startsWith("sm_q_"))!;
    expect(JSON.parse(window.localStorage.getItem(key)!)).toHaveLength(1);
  });

  it("очередь закрытой вкладки дошлёт следующая загрузка", async () => {
    const lost = { e: { event_id: "11111111-1111-4111-8111-111111111111", event_name: "orphan" } };
    window.localStorage.setItem("sm_q_old-visit", JSON.stringify([lost]));
    window.localStorage.setItem("sm_hb_old-visit", String(Date.now() - 10 * 60 * 1000));
    const c = make({ autoPageViews: false });
    await c.flush(true);
    expect(names()).toEqual(["orphan"]);
    expect(window.localStorage.getItem("sm_q_old-visit")).toBeNull();
  });
});

describe("когда SDK молчит", () => {
  it("бот, enabled: false, отказ пользователя", async () => {
    Object.defineProperty(navigator, "webdriver", { configurable: true, value: true });
    const bot = make();
    bot.track("x");
    Object.defineProperty(navigator, "webdriver", { configurable: true, value: false });
    const off = make({ enabled: false });
    off.track("x");
    const user = make({ autoPageViews: false });
    user.optOut();
    user.track("x");
    await Promise.all([bot.flush(true), off.flush(true), user.flush(true)]);
    expect(sent).toHaveLength(0);
    expect(bot.active || off.active || user.active).toBe(false);
  });
});
