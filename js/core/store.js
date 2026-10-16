// Events API + change bus (ARCHITECTURE §3–§4).
//
// Everything that happened is an event in the `events` store. A RUNNING
// activity (live bottle, breastfeeding, pump timer, sleep) is simply an event
// with `endTime: null`, so it survives reloads with no localStorage, and at
// most one runs per type PER BABY (twins can nap at the same time; pumping is
// the parent's, so there is one running pump). Every write emits a change
// after its transaction commits; views subscribe and re-render instead of
// calling each other.
//
// Multiple babies (§3): feed/sleep/diaper/milestone events carry the babyId
// of the child they're about; pump events carry babyId: null. add()/start()
// default to the active baby, so a view that never thinks about twins still
// writes correct data.
//
// The pure half (sanitizeEvent / applyEventPatch) is shared with
// core/backup.js, so an imported file goes through exactly the same schema
// as an event the app creates itself.

import { transaction, getAll, get as dbGet, newId, STORES } from './db.js';
import { deviceId as getDeviceId, cleanText, get as getSetting, BABY_ID_RE } from './settings.js';
import { normalizeUnit, toFiniteNumber } from './units.js';
import { classifyNapOrNight } from '../domain/sleep.js';
import { switchBreastSide } from '../domain/safety.js';

/** Event types (ARCHITECTURE §3). */
export const EVENT_TYPES = Object.freeze(['feed', 'pump', 'sleep', 'diaper', 'milestone']);
/** Types that are about one child and carry a babyId. */
export const BABY_TYPES = Object.freeze(['feed', 'sleep', 'diaper', 'milestone']);
/** Parent-level types (babyId is always null). */
export const PARENT_TYPES = Object.freeze(['pump']);
/** String caps — import is a trust boundary (AUDIT §6.5). */
export const LIMITS = Object.freeze({ note: 2000, title: 200, short: 40, key: 60, photoIds: 20, amount: 10000, sideSec: 24 * 3600 });
/** Plausible timestamp range; anything outside is corrupt or hostile. */
export const MIN_TIME = Date.UTC(2000, 0, 1);
export const MAX_TIME = Date.UTC(2100, 0, 1);
/** Record ids: short, and only characters that are safe as keys/selectors. */
export const ID_RE = /^[A-Za-z0-9_.:-]{1,100}$/;
const DIAPER_KINDS = ['wet', 'dirty', 'both', 'dry'];
const STORED_TO = ['fridge', 'freezer', 'deepFreezer'];
const MILESTONE_KEY_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;

/** Thrown by start()/add()/restore() when that type already has a running
 * event for the same baby (or, for pumps, at all). */
export class RunningActivityError extends Error {
  /** @param {object} running the event that is already running */
  constructor(running) {
    super(`A ${running.type} is already running${running.babyId ? ' for this baby' : ''}`);
    this.name = 'RunningActivityError';
    this.running = running;
  }
}

/** Thrown when an id doesn't exist. */
export class NotFoundError extends Error {
  /** @param {string} id */
  constructor(id) {
    super(`No event with id ${id}`);
    this.name = 'NotFoundError';
    this.id = id;
  }
}

// ------------------------------------------------------------- pure schema

const own = (o, k) => (o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isTime = n => n !== null && n >= MIN_TIME && n <= MAX_TIME;

function amountOrNull(v) {
  const n = toFiniteNumber(v);
  return n !== null && n >= 0 && n <= LIMITS.amount ? n : null;
}

function seconds(v) {
  const n = toFiniteNumber(v);
  return n !== null && n >= 0 ? Math.min(Math.round(n), LIMITS.sideSec) : 0;
}

/**
 * Validate + normalise per-type `data`. Builds a NEW object from known keys
 * only, so unknown keys (including __proto__/constructor) never survive.
 * @param {string} type
 * @param {unknown} data
 * @param {{ startTime?: number }} [ctx] used to default sleep.kind
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
export function sanitizeEventData(type, data, { startTime } = {}) {
  const d = isPlainObject(data) ? data : {};
  switch (type) {
    case 'feed': {
      if (own(d, 'method') === 'breast') {
        const side = v => (v === 'left' || v === 'right' ? v : null);
        const out = {
          method: 'breast',
          left: seconds(own(d, 'left')),
          right: seconds(own(d, 'right')),
          lastSide: side(own(d, 'lastSide')) || 'left',
          activeSide: side(own(d, 'activeSide')),
        };
        const since = toFiniteNumber(own(d, 'activeSince'));
        out.activeSince = out.activeSide && isTime(since) ? since : null;
        return { ok: true, value: out };
      }
      const out = {
        method: 'bottle',
        milk: own(d, 'milk') === 'formula' ? 'formula' : 'breastmilk',
        amount: amountOrNull(own(d, 'amount')),
        unit: normalizeUnit(own(d, 'unit')),
      };
      const prepared = amountOrNull(own(d, 'prepared'));
      if (prepared !== null) out.prepared = prepared;
      const src = own(d, 'sourceInventoryId');
      if (typeof src === 'string' && ID_RE.test(src)) out.sourceInventoryId = src;
      return { ok: true, value: out };
    }
    case 'pump': {
      const storedTo = own(d, 'storedTo');
      const out = {
        amount: amountOrNull(own(d, 'amount')),
        unit: normalizeUnit(own(d, 'unit')),
        storedTo: STORED_TO.includes(storedTo) ? storedTo : null,
      };
      const inv = own(d, 'inventoryId');
      if (typeof inv === 'string' && ID_RE.test(inv)) out.inventoryId = inv;
      return { ok: true, value: out };
    }
    case 'sleep': {
      const kind = own(d, 'kind');
      if (kind === 'nap' || kind === 'night') return { ok: true, value: { kind } };
      return { ok: true, value: { kind: Number.isFinite(startTime) ? classifyNapOrNight(startTime) : 'nap' } };
    }
    case 'diaper': {
      const kind = own(d, 'kind');
      if (!DIAPER_KINDS.includes(kind)) return { ok: false, error: 'diaper.kind must be wet, dirty, both or dry' };
      const out = { kind };
      const color = cleanText(own(d, 'color'), LIMITS.short);
      const consistency = cleanText(own(d, 'consistency'), LIMITS.short);
      if (color) out.color = color;
      if (consistency) out.consistency = consistency;
      return { ok: true, value: out };
    }
    case 'milestone': {
      const key = own(d, 'key');
      const ids = own(d, 'photoIds');
      return {
        ok: true,
        value: {
          key: typeof key === 'string' && MILESTONE_KEY_RE.test(key) ? key : null,
          title: cleanText(own(d, 'title'), LIMITS.title),
          photoIds: Array.isArray(ids)
            ? [...new Set(ids.filter(id => typeof id === 'string' && ID_RE.test(id)))].slice(0, LIMITS.photoIds)
            : [],
        },
      };
    }
    default:
      return { ok: false, error: `unknown event type: ${String(type).slice(0, 40)}` };
  }
}

/**
 * Validate + normalise a whole event record. Pure. Output contains only the
 * §3 keys. `strict` (app writes) rejects endTime < startTime and a missing
 * babyId; lenient (imports, undo) clamps the time and falls back to
 * `defaultBabyId` for a baby-level event without one. (With no default
 * either, babyId stays null: the event then shows for every baby rather than
 * being dropped — import must never lose data.) `allowNullBaby` lets a
 * strict write keep such an event's null babyId, so it stays editable. Pump
 * events always get babyId: null.
 * @param {unknown} raw
 * @param {{ now?: number, deviceId?: string, strict?: boolean, defaultBabyId?: string, allowNullBaby?: boolean }} [opts]
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
export function sanitizeEvent(raw, { now = Date.now(), deviceId, strict = false, defaultBabyId, allowNullBaby = false } = {}) {
  if (!isPlainObject(raw)) return { ok: false, error: 'event must be an object' };
  const type = own(raw, 'type');
  if (!EVENT_TYPES.includes(type)) return { ok: false, error: `unknown event type: ${String(type).slice(0, 40)}` };
  const id = own(raw, 'id');
  if (typeof id !== 'string' || !ID_RE.test(id)) return { ok: false, error: 'bad event id' };

  const startTime = toFiniteNumber(own(raw, 'startTime'));
  if (!isTime(startTime)) return { ok: false, error: 'bad startTime' };

  let endTime = own(raw, 'endTime');
  if (endTime === undefined) endTime = startTime; // an instant (diaper, past log)
  else if (endTime !== null) {
    endTime = toFiniteNumber(endTime);
    if (!isTime(endTime)) return { ok: false, error: 'bad endTime' };
    if (endTime < startTime) {
      if (strict) return { ok: false, error: 'endTime is before startTime' };
      endTime = startTime;
    }
  }

  const data = sanitizeEventData(type, own(raw, 'data'), { startTime });
  if (!data.ok) return data;

  let babyId = null;
  if (BABY_TYPES.includes(type)) {
    const b = own(raw, 'babyId');
    if (typeof b === 'string' && BABY_ID_RE.test(b)) babyId = b;
    else if (strict && !(allowNullBaby && (b === null || b === undefined))) return { ok: false, error: `a ${type} needs a babyId` };
    else if (typeof defaultBabyId === 'string' && BABY_ID_RE.test(defaultBabyId)) babyId = defaultBabyId;
  }

  const createdAt = toFiniteNumber(own(raw, 'createdAt'));
  const updatedAt = toFiniteNumber(own(raw, 'updatedAt'));
  const event = {
    id,
    type,
    startTime,
    endTime,
    note: cleanText(own(raw, 'note'), LIMITS.note),
    data: data.value,
    createdAt: isTime(createdAt) ? createdAt : now,
    updatedAt: 0,
    babyId,
    deviceId: undefined,
  };
  event.updatedAt = isTime(updatedAt) ? updatedAt : event.createdAt;
  const dev = own(raw, 'deviceId');
  if (typeof dev === 'string' && /^dev_[A-Za-z0-9_-]{6,80}$/.test(dev)) event.deviceId = dev;
  else if (deviceId) event.deviceId = deviceId;
  else delete event.deviceId;
  const from = own(raw, 'migratedFrom');
  if (typeof from === 'string' && ID_RE.test(from)) event.migratedFrom = from;
  return { ok: true, value: event };
}

/**
 * Apply an edit: shallow-merge top-level fields (startTime, endTime, note,
 * babyId — "this was actually the other twin"), merge `data` one level deep,
 * bump updatedAt. id/type/createdAt/deviceId are immutable (changing type
 * would orphan the data); a pump's babyId stays null. Pure; throws on invalid.
 * @param {object} event
 * @param {object} patch
 * @param {number} [now]
 * @returns {object}
 */
export function applyEventPatch(event, patch, now = Date.now()) {
  const p = isPlainObject(patch) ? patch : {};
  if (own(p, 'type') !== undefined && own(p, 'type') !== event.type) throw new TypeError('An event\'s type cannot change');
  const merged = { ...event };
  for (const k of ['startTime', 'endTime', 'note', 'babyId']) if (own(p, k) !== undefined) merged[k] = own(p, k);
  if (isPlainObject(own(p, 'data'))) merged.data = { ...event.data, ...own(p, 'data') };
  // Strictly increasing, so merge-by-updatedAt always sees an edit as newer
  // even when two edits land in the same millisecond.
  merged.updatedAt = Math.max(now, (event.updatedAt || 0) + 1);
  // An event that already had no baby (a lenient import/undo) stays editable
  // as long as the edit doesn't explicitly set babyId to something invalid.
  const keepsNullBaby = (event.babyId ?? null) === null && own(p, 'babyId') === undefined;
  const res = sanitizeEvent(merged, { now, strict: true, allowNullBaby: keepsNullBaby });
  if (!res.ok) throw new RangeError(res.error);
  return res.value;
}

/**
 * Newest first: startTime desc, then createdAt desc, then id (stable).
 * @param {object} a
 * @param {object} b
 * @returns {number}
 */
export function compareNewestFirst(a, b) {
  return (b.startTime - a.startTime) || ((b.createdAt || 0) - (a.createdAt || 0)) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

/**
 * Does `event` belong in a view of `babyId`? undefined → every event; a baby
 * id → that baby's events plus parent-level ones (pumps, babyId null); null →
 * parent-level only. Pure.
 * @param {object} event
 * @param {string|null|undefined} babyId
 * @returns {boolean}
 */
export function matchesBaby(event, babyId) {
  if (babyId === undefined) return true;
  const b = event && event.babyId !== undefined ? event.babyId : null;
  return babyId === null ? b === null : (b === babyId || b === null);
}

// Same (type, baby) slot → at most one running event in it.
const sameSlot = (a, b) => a.type === b.type && (a.babyId ?? null) === (b.babyId ?? null);

// -------------------------------------------------------------- change bus

const listeners = new Set();

/**
 * Emit a change to every subscriber (core-internal; backup/migrate use it to
 * announce bulk changes as { op: 'bulk' }).
 * @param {{op: string, event?: object, prev?: object}} change
 */
export function notifyEvents(change) {
  for (const fn of [...listeners]) {
    try { fn(change); } catch (err) { console.error('events listener failed', err); }
  }
}

/**
 * Subscribe to changes: fn({ op: 'add'|'update'|'remove'|'bulk', event, prev }).
 * 'bulk' (import/migration/erase) carries no event — re-query everything.
 * @param {(change: {op: string, event?: object, prev?: object}) => void} fn
 * @returns {() => void} unsubscribe
 */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ------------------------------------------------------------------- reads

/**
 * One event by id, or null.
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function get(id) {
  return (await dbGet(STORES.events, id)) || null;
}

/**
 * Query events, newest first.
 *  - type / types: filter by type(s)
 *  - from / to: startTime in [from, to) — or, with overlap: true, any event
 *    whose [startTime, endTime ?? now] touches the window (night sleeps that
 *    began yesterday)
 *  - running: true → only running, false → only finished
 *  - babyId: that baby's events + parent-level (pump) events; null → only
 *    parent-level (see matchesBaby)
 *  - limit: max results
 * @param {{type?: string, types?: string[], from?: number, to?: number, running?: boolean, overlap?: boolean, babyId?: string|null, limit?: number}} [q]
 * @returns {Promise<object[]>}
 */
export async function query({ type, types, from, to, running, overlap = false, babyId, limit } = {}) {
  const lo = Number.isFinite(from) && !overlap ? from : -Infinity;
  const hi = Number.isFinite(to) ? to : Infinity;
  let rows;
  if (typeof type === 'string') {
    rows = await getAll(STORES.events, { index: 'type_startTime', query: IDBKeyRange.bound([type, lo], [type, hi], false, true) });
  } else if (lo !== -Infinity || hi !== Infinity) {
    rows = await getAll(STORES.events, { index: 'startTime', query: IDBKeyRange.bound(lo, hi, false, true) });
  } else {
    rows = await getAll(STORES.events);
  }
  const typeSet = Array.isArray(types) ? new Set(types) : null;
  const out = rows.filter(e => {
    if (typeSet && !typeSet.has(e.type)) return false;
    if (running === true && e.endTime !== null) return false;
    if (running === false && e.endTime === null) return false;
    if (!matchesBaby(e, babyId)) return false;
    if (overlap && Number.isFinite(from)) {
      const end = e.endTime === null ? Infinity : e.endTime;
      if (!(e.startTime >= from || end > from)) return false;
    }
    return true;
  }).sort(compareNewestFirst);
  return Number.isFinite(limit) ? out.slice(0, Math.max(0, limit)) : out;
}

/**
 * Most recent FINISHED event of a type (by startTime), optionally matching a
 * synchronous predicate and/or a baby (see matchesBaby). Walks the index
 * backwards, so it's cheap.
 * @param {string} type
 * @param {(e: object) => boolean} [predicate]
 * @param {{ babyId?: string|null }} [opts]
 * @returns {Promise<object|null>}
 */
export function last(type, predicate, { babyId } = {}) {
  return transaction(STORES.events, 'readonly', (s, ctx) => {
    const range = IDBKeyRange.bound([type, -Infinity], [type, Infinity]);
    const req = s.events.index('type_startTime').openCursor(range, 'prev');
    ctx.done(null);
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return;
      const e = cur.value;
      let match = e.endTime !== null && matchesBaby(e, babyId);
      if (match && predicate) {
        try { match = !!predicate(e); } catch (err) { ctx.fail(err); return; }
      }
      if (match) { ctx.done(e); return; }
      cur.continue();
    };
  });
}

/**
 * Running events (endTime === null), oldest first — so live pills keep their
 * order when another activity starts. Optionally for one baby (+ the
 * parent's running pump).
 * @param {string} [type]
 * @param {{ babyId?: string|null }} [opts]
 * @returns {Promise<object[]>}
 */
export async function running(type, { babyId } = {}) {
  const rows = typeof type === 'string'
    ? await getAll(STORES.events, { index: 'type', query: type })
    : await getAll(STORES.events);
  return rows.filter(e => e.endTime === null && matchesBaby(e, babyId))
    .sort((a, b) => (a.startTime - b.startTime) || (a.createdAt - b.createdAt));
}

// ------------------------------------------------------------------ writes

// Insert/put inside one transaction that ALSO checks the one-running-per-
// type-per-baby rule, so two quick taps (or two tabs) can't both start a timer.
function writeWithRunningGuard(event, { overwrite }) {
  return transaction(STORES.events, 'readwrite', (s, ctx) => {
    const write = () => {
      const req = overwrite ? s.events.put(event) : s.events.add(event);
      req.onsuccess = () => ctx.done(event);
    };
    if (event.endTime !== null) { write(); return; }
    const q = s.events.index('type').getAll(event.type);
    q.onsuccess = () => {
      const other = q.result.find(e => e.endTime === null && e.id !== event.id && sameSlot(e, event));
      if (other) ctx.fail(new RunningActivityError(other));
      else write();
    };
  });
}

// App writes may only point at a baby that exists (a stale id from an old
// sheet would otherwise create events no view can ever show).
function assertKnownBaby(event) {
  if (event.babyId === null) return;
  const known = getSetting('babies').some(b => b.id === event.babyId);
  if (!known) throw new RangeError('Unknown babyId');
}

/**
 * Create an event. id/createdAt/updatedAt/deviceId are filled in; babyId
 * defaults to the active baby for feed/sleep/diaper/milestone and is always
 * null for pump. endTime defaults to startTime (an instant); pass endTime:
 * null to create a running event (prefer start()). Throws RangeError on
 * invalid input (incl. an unknown babyId) and RunningActivityError if that
 * type is already running for that baby.
 * @param {{type: string, startTime?: number, endTime?: number|null, note?: string, data?: object, babyId?: string}} input
 * @returns {Promise<object>} the stored event
 */
export async function add(input) {
  const now = Date.now();
  const deviceId = await getDeviceId(); // also loads settings (babies)
  const raw = isPlainObject(input) ? input : {};
  const res = sanitizeEvent({
    type: own(raw, 'type'),
    startTime: own(raw, 'startTime') ?? now,
    endTime: own(raw, 'endTime'),
    note: own(raw, 'note'),
    data: own(raw, 'data'),
    babyId: own(raw, 'babyId') ?? getSetting('activeBabyId'),
    id: newId('evt'),
    createdAt: now,
    updatedAt: now,
  }, { now, deviceId, strict: true });
  if (res.ok) assertKnownBaby(res.value);
  if (!res.ok) throw new RangeError(res.error);
  const event = await writeWithRunningGuard(res.value, { overwrite: false });
  notifyEvents({ op: 'add', event });
  return event;
}

/**
 * Edit an event: top-level fields shallow-merge, `data` merges one level.
 * @param {string} id
 * @param {object} patch
 * @returns {Promise<object>} the updated event
 */
export async function update(id, patch) {
  const now = Date.now();
  await getDeviceId(); // settings loaded, so a babyId change can be checked
  const { prev, next } = await transaction(STORES.events, 'readwrite', (s, ctx) => {
    const g = s.events.get(id);
    g.onsuccess = () => {
      const prevEvent = g.result;
      if (!prevEvent) { ctx.fail(new NotFoundError(id)); return; }
      let nextEvent;
      try {
        nextEvent = applyEventPatch(prevEvent, patch, now);
        if (nextEvent.babyId !== prevEvent.babyId) assertKnownBaby(nextEvent);
      } catch (err) { ctx.fail(err); return; }
      const finish = () => { s.events.put(nextEvent); ctx.done({ prev: prevEvent, next: nextEvent }); };
      const movedSlot = nextEvent.babyId !== prevEvent.babyId;
      if (nextEvent.endTime !== null || (prevEvent.endTime === null && !movedSlot)) { finish(); return; }
      // Re-opening a finished event, or moving a running one to another
      // baby: same one-running rule as start().
      const q = s.events.index('type').getAll(nextEvent.type);
      q.onsuccess = () => {
        const other = q.result.find(e => e.endTime === null && e.id !== id && sameSlot(e, nextEvent));
        if (other) ctx.fail(new RunningActivityError(other)); else finish();
      };
    };
  });
  notifyEvents({ op: 'update', event: next, prev });
  return next;
}

/**
 * Delete an event. Resolves with the removed event (keep it for Undo →
 * restore()), or null if it didn't exist.
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function remove(id) {
  const removed = await transaction(STORES.events, 'readwrite', (s, ctx) => {
    const g = s.events.get(id);
    g.onsuccess = () => {
      if (!g.result) { ctx.done(null); return; }
      s.events.delete(id);
      ctx.done(g.result);
    };
  });
  if (removed) notifyEvents({ op: 'remove', event: removed });
  return removed;
}

/**
 * Undo a remove(): put the event back exactly as it was (same id,
 * timestamps). Emits { op: 'add', restored: true }.
 * @param {object} event
 * @returns {Promise<object>}
 */
export async function restore(event) {
  const res = sanitizeEvent(event, { now: Date.now() });
  if (!res.ok) throw new RangeError(res.error);
  const restored = await writeWithRunningGuard(res.value, { overwrite: true });
  notifyEvents({ op: 'add', event: restored, restored: true });
  return restored;
}

/**
 * Start a running activity of `type` (for `babyId`, default the active baby;
 * pumps are the parent's). Throws RunningActivityError (with `.running`) if
 * one of that type is already running for that baby — the UI can offer to
 * open it instead.
 * @param {string} type
 * @param {object} [data]
 * @param {{ startTime?: number, note?: string, babyId?: string }} [opts]
 * @returns {Promise<object>}
 */
export function start(type, data = {}, { startTime, note, babyId } = {}) {
  return add({ type, data, note, babyId, startTime: startTime ?? Date.now(), endTime: null });
}

/**
 * Finish a running activity: endTime = patch.endTime ?? now (never before
 * startTime), then merge the rest of the patch (e.g. the final amount). A
 * running breastfeed banks its active side first. Stopping an already
 * finished event is a no-op that returns it (double-tap safe).
 * @param {string} id
 * @param {object} [patch]
 * @returns {Promise<object>}
 */
export async function stop(id, patch = {}) {
  const now = Date.now();
  const result = await transaction(STORES.events, 'readwrite', (s, ctx) => {
    const g = s.events.get(id);
    g.onsuccess = () => {
      const prev = g.result;
      if (!prev) { ctx.fail(new NotFoundError(id)); return; }
      if (prev.endTime !== null) { ctx.done({ prev, next: prev, noop: true }); return; }
      const p = isPlainObject(patch) ? patch : {};
      const requested = toFiniteNumber(own(p, 'endTime'));
      const endTime = Math.max(prev.startTime, requested ?? now);
      let data = own(p, 'data');
      if (prev.type === 'feed' && prev.data && prev.data.method === 'breast' && prev.data.activeSide) {
        data = { ...switchBreastSide(prev.data, null, endTime), ...(isPlainObject(data) ? data : {}) };
      }
      let next;
      try {
        next = applyEventPatch(prev, { ...p, endTime, ...(data ? { data } : {}) }, now);
      } catch (err) { ctx.fail(err); return; }
      s.events.put(next);
      ctx.done({ prev, next, noop: false });
    };
  });
  if (!result.noop) notifyEvents({ op: 'update', event: result.next, prev: result.prev });
  return result.next;
}

/** The events API as one object, for ctx injection (ARCHITECTURE §4). */
export const events = Object.freeze({ add, update, remove, restore, get, query, last, running, start, stop, subscribe, matchesBaby, TYPES: EVENT_TYPES });
