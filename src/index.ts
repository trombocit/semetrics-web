/**
 * Semetrics Web SDK. Один экземпляр на страницу:
 *
 *   import * as semetrics from "semetrics-web";
 *   semetrics.init({ key: "sm_live_…", source: "turniro.ru", page: url => … });
 *   semetrics.track("share_clicked", { kind: "link" });
 *
 * Безопасен для SSR: при импорте ничего не трогает, на сервере вызовы — пустые.
 * Вызовы до init() копятся (до 100) и отправляются после init().
 */
import { SemetricsWeb, SDK_VERSION, type SemetricsConfig } from "./client";
import { defaultPageTemplate } from "./util";

export type { SemetricsConfig };
export { SDK_VERSION, defaultPageTemplate };

let client: SemetricsWeb | null = null;
const pending: Array<(c: SemetricsWeb) => void> = [];

function call(fn: (c: SemetricsWeb) => void): void {
  if (typeof window === "undefined") return;
  if (client) fn(client);
  else if (pending.length < 100) pending.push(fn);
}

export function init(config: SemetricsConfig): void {
  if (typeof window === "undefined" || client) return;
  client = new SemetricsWeb(config);
  for (const fn of pending.splice(0)) fn(client);
}

export function track(name: string, properties?: Record<string, unknown>): void {
  call(c => c.track(name, properties));
}

/** После входа: id аккаунта во всех следующих событиях визита. null — снять. */
export function identify(userId: string | null): void {
  call(c => c.identify(userId));
}

/** После выхода из аккаунта: забыть пользователя и начать новый визит. */
export function reset(): void {
  call(c => c.reset());
}

/** Отправить события сейчас, не дожидаясь таймера. */
export function flush(): Promise<void> {
  return client ? client.flush(true) : Promise.resolve();
}

/** Ручной просмотр страницы — если autoPageViews выключен. */
export function pageView(): void {
  call(c => c.pageView());
}

export function optOut(): void {
  call(c => c.optOut());
}

export function optIn(): void {
  call(c => c.optIn());
}

/** Для тестов: забыть экземпляр. */
export function _reset(): void {
  client?.destroy();
  client = null;
  pending.splice(0);
}
