export declare const SDK_VERSION = "0.1.0";
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
export declare class SemetricsWeb {
    private readonly local;
    private readonly session;
    private readonly cfg;
    private readonly url;
    private readonly device;
    private queue;
    private visitId;
    private userId;
    private anonId;
    private currentPage;
    private loadPage;
    private lastPath;
    private timer;
    private sending;
    private failures;
    private nextAttemptAt;
    private errorMessages;
    private vitals;
    private vitalsSent;
    private teardown;
    active: boolean;
    constructor(config: SemetricsConfig);
    private log;
    private startVisit;
    private on;
    track(name: string, properties?: Props): void;
    identify(userId: string | null): void;
    /** Выход из аккаунта: забыть пользователя и начать новый визит. */
    reset(): void;
    pageView(): void;
    private onLocationChange;
    private onError;
    private onRejection;
    private captureError;
    private onVital;
    private sendVitals;
    private onHidden;
    private listen;
    private body;
    /** Пачка, которая влезает в лимит запроса. */
    private take;
    /** Отправить накопленное. `force` — без паузы после ошибок. */
    flush(force?: boolean): Promise<void>;
    /** Уход со страницы: отправить, что влезает, через sendBeacon. Удаляется после подтверждения. */
    beacon(): void;
    /** Отказ от статистики: запоминается на устройстве, SDK сразу перестаёт слать. */
    optOut(): void;
    /** Снять отказ. Сбор возобновится со следующей загрузки страницы. */
    optIn(): void;
    /** Снять обработчики и таймер, вернуть history как было. */
    destroy(): void;
}
export {};
