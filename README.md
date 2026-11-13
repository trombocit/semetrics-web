# Semetrics Web SDK

Браузерный SDK для [Semetrics](https://semetrics.ru): сам собирает просмотры страниц (в том числе переходы SPA), источники переходов, ошибки JavaScript и Web Vitals. Очередь хранится в `localStorage`, события уходят пачками, при уходе со страницы — через `sendBeacon`. Cookie не ставит.

## Установка

```bash
npm install github:trombocit/semetrics-web#v0.1.0
```

Без сборщика — один файл, глобальный `Semetrics`:

```html
<script src="/vendor/semetrics.min.js"></script>
<script>Semetrics.init({ key: "sm_live_…", source: "example.ru" });</script>
```

## Подключение (Next.js и любой сайт)

```ts
import * as semetrics from "semetrics-web";

semetrics.init({
  key: "sm_live_…",              // клиентский ключ проекта
  source: "turniro.ru",          // source_id — должен быть в списке ключа
  sourceVersion: "1.4.0",
  page: url => templateOf(url),  // адрес → имя шаблона; null — не слать
});

semetrics.track("share_clicked", { kind: "link" });
semetrics.identify(accountId);   // после входа
semetrics.reset();               // после выхода
```

`init` вызывайте один раз в клиентском коде (в Next.js — в клиентском компоненте корневого layout). При импорте SDK ничего не трогает, на сервере все вызовы пустые.

Ключ в браузере виден всем — это нормально. Ограничьте его в Semetrics: тип «клиентский», источники и домены сайта («Настроить» у ключа).

## Что собирается само

| Событие | Когда | Свойства |
|---|---|---|
| `page_viewed` | загрузка и переходы SPA (`pushState`, `replaceState`, `popstate`) | `page`, `landing`; на первой странице визита — `referrer_host`, `utm_*` |
| `client_error` | `error`, `unhandledrejection`; до 5 за визит | `kind`, `message` (адреса → хост, токены → `***`, до 200 символов), `online` |
| `web_vitals` | уход со страницы | `lcp_ms`, `inp_ms`, `cls`, `ttfb_ms`, `page` |

В каждом событии: `device` (`mobile` / `tablet` / `desktop`), `os`, `browser`, `page`. Полный User-Agent и адрес страницы не отправляются.

## Приватность

- **Адрес страницы.** По умолчанию — путь без строки запроса и `#`, сегменты, похожие на id и токены, заменены на `:id`. Если в адресах секреты (ключи управления, коды, приглашения), задайте `page(url)`.
- **Визит** (`session_id`) — UUID в `sessionStorage` вкладки, живёт, пока открыта вкладка.
- **Постоянный id устройства** (`anonymous_id`) — только с `persistentId: true`, хранится в `localStorage`; укажите это в политике сайта.
- Из ботов и автоматизации (`navigator.webdriver`, роботы, headless) не шлёт. `optOut()` — отказ пользователя.

## Настройки

| Параметр | По умолчанию | |
|---|---|---|
| `endpoint` | `https://semetrics.ru/events` | адрес Semetrics |
| `page` | путь с `:id` | адрес → шаблон страницы или `null` |
| `persistentId` | `false` | постоянный `anonymous_id` |
| `enabled` | `true` | выключатель |
| `autoPageViews`, `captureErrors`, `webVitals` | `true` | автособытия |
| `flushIntervalMs`, `batchSize` | `10000`, `20` | отправка |
| `debug` | `false` | лог в консоль |

## Доставка

Событие удаляется из очереди после ответа сервера. При ошибке сети, 429 и 5xx — повтор с паузой до 5 минут. При уходе со страницы — `sendBeacon` (общий лимит браузера около 64 КБ); не влезшее и неподтверждённое дошлёт следующая загрузка. Повторы отсекает сервер по `event_id`.
