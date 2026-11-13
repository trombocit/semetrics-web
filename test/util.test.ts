import { describe, expect, it } from "vitest";
import { defaultPageTemplate, deviceInfo, isBot, referrerHost, scrubMessage, utmParams, uuid } from "../src/util";

describe("defaultPageTemplate", () => {
  it("убирает строку запроса, хеш и id-сегменты", () => {
    const t = (u: string) => defaultPageTemplate(new URL(u));
    expect(t("https://turniro.ru/")).toBe("/");
    expect(t("https://turniro.ru/t/liga-2-24-a1b2c3d4/register?k=SECRET#x")).toBe("/t/:id/register");
    expect(t("https://turniro.ru/s/AB12CD34")).toBe("/s/:id");
    expect(t("https://turniro.ru/p/12345/")).toBe("/p/:id");
    expect(t("https://turniro.ru/i/6f1c2a3b-1111-4222-8333-444455556666")).toBe("/i/:id");
    expect(t("https://turniro.ru/organizer/help")).toBe("/organizer/help");
  });
});

describe("источник перехода", () => {
  it("referrer — только хост чужого сайта", () => {
    expect(referrerHost("https://vk.com/wall-1_2?x=1", "turniro.ru")).toBe("vk.com");
    expect(referrerHost("https://turniro.ru/t/x", "turniro.ru")).toBeNull();
    expect(referrerHost("", "turniro.ru")).toBeNull();
    expect(referrerHost("не адрес", "turniro.ru")).toBeNull();
  });

  it("utm — до 64 символов, лишние параметры не берём", () => {
    const u = new URL("https://turniro.ru/?utm_source=vk&utm_campaign=" + "x".repeat(100) + "&k=SECRET");
    expect(utmParams(u)).toEqual({ utm_source: "vk", utm_campaign: "x".repeat(64) });
  });
});

describe("scrubMessage", () => {
  it("адреса — до хоста, токены — звёздочки, длина ограничена", () => {
    expect(scrubMessage("Failed to fetch https://turniro.ru/i/abc12345XYZ?k=1"))
      .toBe("Failed to fetch turniro.ru");
    expect(scrubMessage("bad token a1b2c3d4e5 for code 12345678")).toBe("bad token *** for code ***");
    expect(scrubMessage("x".repeat(500)).length).toBe(200);
  });
});

describe("устройство и боты", () => {
  it("определяет тип, ОС и браузер грубо", () => {
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";
    expect(deviceInfo(iphone)).toEqual({ device: "mobile", os: "ios", browser: "safari" });
    const yandex = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 YaBrowser/24.1 Safari/537.36";
    expect(deviceInfo(yandex)).toEqual({ device: "desktop", os: "windows", browser: "yandex" });
    const tab = "Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 Chrome/120.0 Safari/537.36";
    expect(deviceInfo(tab).device).toBe("tablet");
  });

  it("боты и автоматизация", () => {
    expect(isBot("Mozilla/5.0 (compatible; YandexBot/3.0)", false)).toBe(true);
    expect(isBot("Mozilla/5.0 HeadlessChrome/120", false)).toBe(true);
    expect(isBot("Mozilla/5.0 Chrome/120", true)).toBe(true);
    expect(isBot("Mozilla/5.0 Chrome/120", false)).toBe(false);
  });

  it("uuid", () => {
    expect(uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
