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
/**
 * Очередь событий вкладки в localStorage (`sm_q_<визит>`). Событие удаляется только
 * после ответа сервера. Отправленное через sendBeacon остаётся в очереди помеченным:
 * если страница жива — через `resendAfterMs` уйдёт снова за подтверждением, если
 * закрыта — его дошлёт следующая загрузка. Повторы отсекает сервер по event_id.
 * При переполнении отбрасываются новые события, как в остальных SDK.
 */
export declare class EventQueue {
    private readonly storage;
    private readonly max;
    private entries;
    private readonly key;
    private readonly hbKey;
    constructor(storage: SafeStorage, visitId: string, max?: number);
    private read;
    private save;
    get size(): number;
    push(e: WireEvent): boolean;
    /** События к отправке: не отправленные или отправленные давно без подтверждения. */
    pending(now: number, resendAfterMs: number): WireEvent[];
    markSent(ids: string[], now: number): void;
    remove(ids: string[]): void;
    /** Перенести всё в другую очередь (смена визита после reset) и удалить свою. */
    moveTo(other: EventQueue): void;
    heartbeat(now: number): void;
    /** Забрать очереди закрытых вкладок: их пульс старше ORPHAN_AFTER_MS. */
    adoptOrphans(now: number): number;
}
