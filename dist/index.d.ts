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
import { SDK_VERSION, type SemetricsConfig } from "./client";
import { defaultPageTemplate } from "./util";
export type { SemetricsConfig };
export { SDK_VERSION, defaultPageTemplate };
export declare function init(config: SemetricsConfig): void;
export declare function track(name: string, properties?: Record<string, unknown>): void;
/** После входа: id аккаунта во всех следующих событиях визита. null — снять. */
export declare function identify(userId: string | null): void;
/** После выхода из аккаунта: забыть пользователя и начать новый визит. */
export declare function reset(): void;
/** Отправить события сейчас, не дожидаясь таймера. */
export declare function flush(): Promise<void>;
/** Ручной просмотр страницы — если autoPageViews выключен. */
export declare function pageView(): void;
export declare function optOut(): void;
export declare function optIn(): void;
/** Для тестов: забыть экземпляр. */
export declare function _reset(): void;
