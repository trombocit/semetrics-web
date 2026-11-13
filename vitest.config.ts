import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    environmentOptions: {
      jsdom: { url: "https://turniro.ru/t/liga-a1b2c3d4?utm_source=vk&k=SECRET", referrer: "https://vk.com/feed" },
    },
    // Node 22+ кладёт в globalThis свой localStorage и перекрывает jsdom — выключаем
    pool: "forks",
    poolOptions: { forks: { execArgv: ["--no-experimental-webstorage"] } },
  },
});
