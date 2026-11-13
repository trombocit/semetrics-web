/** Мелкие помощники без зависимостей. Ничего не трогают при импорте — безопасно для SSR. */

export function uuid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Обёртка над localStorage/sessionStorage: в приватном режиме и при запрете — память. */
export class SafeStorage {
  private memory = new Map<string, string>();
  constructor(private readonly backend: () => Storage | undefined) {}

  private store(): Storage | undefined {
    try {
      const s = this.backend();
      if (!s) return undefined;
      const probe = "__sm_probe__";
      s.setItem(probe, "1");
      s.removeItem(probe);
      return s;
    } catch {
      return undefined;
    }
  }

  get(key: string): string | null {
    try {
      const s = this.store();
      return s ? s.getItem(key) : this.memory.get(key) ?? null;
    } catch {
      return this.memory.get(key) ?? null;
    }
  }

  set(key: string, value: string): boolean {
    try {
      const s = this.store();
      if (s) {
        s.setItem(key, value);
        return true;
      }
    } catch {
      // квота исчерпана — ниже запасной путь в память
    }
    this.memory.set(key, value);
    return false;
  }

  remove(key: string): void {
    try {
      this.store()?.removeItem(key);
    } catch {
      // ignore
    }
    this.memory.delete(key);
  }

  keys(prefix: string): string[] {
    const out = new Set<string>();
    try {
      const s = this.store();
      if (s) for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (k && k.startsWith(prefix)) out.add(k);
      }
    } catch {
      // ignore
    }
    for (const k of this.memory.keys()) if (k.startsWith(prefix)) out.add(k);
    return [...out];
  }
}

const ID_SEGMENT = [
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, // UUID
  /^\d+$/,                                                            // число
  /^(?=.*\d)[A-Za-z0-9_-]{8,}$/,                                      // 8+ символов с цифрами: коды, токены
];

/**
 * Адрес → шаблон страницы по умолчанию: путь без строки запроса и `#`,
 * сегменты, похожие на id и токены, заменены на `:id`. `/t/liga-2-24-a1b2c3d4/register` →
 * `/t/:id/register`. Для адресов с секретами задайте свой `page(url)`.
 */
export function defaultPageTemplate(url: URL): string {
  const parts = url.pathname.split("/").map(seg => {
    let decoded = seg;
    try {
      decoded = decodeURIComponent(seg);
    } catch {
      // оставить как есть
    }
    return ID_SEGMENT.some(re => re.test(decoded)) ? ":id" : seg;
  });
  const path = parts.join("/");
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path || "/";
}

/** Хост чужого сайта, с которого пришли; свой сайт и пустой referrer — null. */
export function referrerHost(referrer: string, ownHost: string): string | null {
  if (!referrer) return null;
  try {
    const host = new URL(referrer).hostname.toLowerCase();
    return host && host !== ownHost.toLowerCase() ? host : null;
  } catch {
    return null;
  }
}

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];

export function utmParams(url: URL): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of UTM_KEYS) {
    const v = url.searchParams.get(k);
    if (v) out[k] = v.slice(0, 64);
  }
  return out;
}

/** Текст ошибки без адресов и токенов: адрес → хост, длинные строки с цифрами → `***`. */
export function scrubMessage(message: string, max = 200): string {
  return message
    .replace(/https?:\/\/([^/\s?#]+)[^\s]*/g, "$1")
    .replace(/(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{8,}/g, "***")
    .slice(0, max);
}

export interface DeviceInfo {
  device: "mobile" | "tablet" | "desktop";
  os: string;
  browser: string;
}

export function deviceInfo(ua: string, uaDataMobile?: boolean): DeviceInfo {
  const tablet = /iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua);
  const mobile = uaDataMobile ?? /Mobi|iPhone|iPod|Android.*Mobile/i.test(ua);
  const device = tablet ? "tablet" : mobile ? "mobile" : "desktop";
  const os =
    /Android/i.test(ua) ? "android" :
    /iPhone|iPad|iPod/i.test(ua) ? "ios" :
    /Windows/i.test(ua) ? "windows" :
    /Mac OS X|Macintosh/i.test(ua) ? "macos" :
    /CrOS/i.test(ua) ? "chromeos" :
    /Linux/i.test(ua) ? "linux" : "other";
  const browser =
    /YaBrowser/i.test(ua) ? "yandex" :
    /Edg\//i.test(ua) ? "edge" :
    /OPR\/|Opera/i.test(ua) ? "opera" :
    /SamsungBrowser/i.test(ua) ? "samsung" :
    /Firefox|FxiOS/i.test(ua) ? "firefox" :
    /Chrome|CriOS/i.test(ua) ? "chrome" :
    /Safari/i.test(ua) ? "safari" : "other";
  return { device, os, browser };
}

const BOT_UA = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|facebookexternalhit|vkshare|whatsapp|telegram|preview/i;

export function isBot(ua: string, webdriver: boolean | undefined): boolean {
  return !!webdriver || BOT_UA.test(ua);
}
