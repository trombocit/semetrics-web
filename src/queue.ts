import { SafeStorage } from "./util";

export interface WireEvent {
  event_id: string;
  event_name: string;
  client_ts: string;
  user_id: string | null;
  anonymous_id: string | null;
  session_id: string | null;
  source_id: string;
  source_version: string;
  platform: "web";
  sdk_version: string;
  properties: Record<string, unknown>;
}

interface Entry {
  e: WireEvent;
  s?: number; // когда отправлено через sendBeacon/fetch без подтверждения (мс)
}

const PREFIX = "sm_q_";
const HB_PREFIX = "sm_hb_";
const ORPHAN_AFTER_MS = 2 * 60 * 1000;

/**
 * Очередь событий вкладки в localStorage (`sm_q_<визит>`). Событие удаляется только
 * после ответа сервера. Отправленное через sendBeacon остаётся в очереди помеченным:
 * если страница жива — через `resendAfterMs` уйдёт снова за подтверждением, если
 * закрыта — его дошлёт следующая загрузка. Повторы отсекает сервер по event_id.
 * При переполнении отбрасываются новые события, как в остальных SDK.
 */
export class EventQueue {
  private entries: Entry[] = [];
  private readonly key: string;
  private readonly hbKey: string;

  constructor(private readonly storage: SafeStorage, visitId: string, private readonly max = 1000) {
    this.key = PREFIX + visitId;
    this.hbKey = HB_PREFIX + visitId;
    this.entries = this.read(this.key);
  }

  private read(key: string): Entry[] {
    try {
      const raw = this.storage.get(key);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter(x => x && x.e && x.e.event_id) : [];
    } catch {
      return [];
    }
  }

  private save(): void {
    if (this.entries.length) this.storage.set(this.key, JSON.stringify(this.entries));
    else this.storage.remove(this.key);
  }

  get size(): number {
    return this.entries.length;
  }

  push(e: WireEvent): boolean {
    if (this.entries.length >= this.max) return false;
    this.entries.push({ e });
    this.save();
    return true;
  }

  /** События к отправке: не отправленные или отправленные давно без подтверждения. */
  pending(now: number, resendAfterMs: number): WireEvent[] {
    return this.entries.filter(x => !x.s || now - x.s > resendAfterMs).map(x => x.e);
  }

  markSent(ids: string[], now: number): void {
    const set = new Set(ids);
    for (const x of this.entries) if (set.has(x.e.event_id)) x.s = now;
    this.save();
  }

  remove(ids: string[]): void {
    const set = new Set(ids);
    this.entries = this.entries.filter(x => !set.has(x.e.event_id));
    this.save();
  }

  /** Перенести всё в другую очередь (смена визита после reset) и удалить свою. */
  moveTo(other: EventQueue): void {
    for (const x of this.entries) if (!other.push(x.e)) break;
    this.entries = [];
    this.save();
    this.storage.remove(this.hbKey);
  }

  heartbeat(now: number): void {
    this.storage.set(this.hbKey, String(now));
  }

  /** Забрать очереди закрытых вкладок: их пульс старше ORPHAN_AFTER_MS. */
  adoptOrphans(now: number): number {
    let adopted = 0;
    for (const k of this.storage.keys(PREFIX)) {
      if (k === this.key) continue;
      const visit = k.slice(PREFIX.length);
      const hb = Number(this.storage.get(HB_PREFIX + visit) || 0);
      if (now - hb < ORPHAN_AFTER_MS) continue;
      const orphan = this.read(k);
      const known = new Set(this.entries.map(x => x.e.event_id));
      for (const x of orphan) {
        if (this.entries.length >= this.max) break;
        if (!known.has(x.e.event_id)) {
          this.entries.push({ e: x.e });
          adopted++;
        }
      }
      this.storage.remove(k);
      this.storage.remove(HB_PREFIX + visit);
    }
    if (adopted) this.save();
    return adopted;
  }
}
