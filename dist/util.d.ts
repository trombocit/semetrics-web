/** Мелкие помощники без зависимостей. Ничего не трогают при импорте — безопасно для SSR. */
export declare function uuid(): string;
/** Обёртка над localStorage/sessionStorage: в приватном режиме и при запрете — память. */
export declare class SafeStorage {
    private readonly backend;
    private memory;
    constructor(backend: () => Storage | undefined);
    private store;
    get(key: string): string | null;
    set(key: string, value: string): boolean;
    remove(key: string): void;
    keys(prefix: string): string[];
}
/**
 * Адрес → шаблон страницы по умолчанию: путь без строки запроса и `#`,
 * сегменты, похожие на id и токены, заменены на `:id`. `/t/liga-2-24-a1b2c3d4/register` →
 * `/t/:id/register`. Для адресов с секретами задайте свой `page(url)`.
 */
export declare function defaultPageTemplate(url: URL): string;
/** Хост чужого сайта, с которого пришли; свой сайт и пустой referrer — null. */
export declare function referrerHost(referrer: string, ownHost: string): string | null;
export declare function utmParams(url: URL): Record<string, string>;
/** Текст ошибки без адресов и токенов: адрес → хост, длинные строки с цифрами → `***`. */
export declare function scrubMessage(message: string, max?: number): string;
export interface DeviceInfo {
    device: "mobile" | "tablet" | "desktop";
    os: string;
    browser: string;
}
export declare function deviceInfo(ua: string, uaDataMobile?: boolean): DeviceInfo;
export declare function isBot(ua: string, webdriver: boolean | undefined): boolean;
