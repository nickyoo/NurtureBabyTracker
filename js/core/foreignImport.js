// Foreign import: turn another tracker's export into a candidate Nurture
// backup, so the existing import path (backup.js — the trust boundary,
// AUDIT §6.5) validates and merges it exactly like a backup file.
//
// Supported inputs:
//   - Nara Baby CSV (one file per child; bracketed per-type columns,
//     epoch columns, a Time Zone column, a Profile row).
//   - Huckleberry CSV (Type / Start / End / Duration / Start Condition /
//     Start Location / End Condition / Notes; times are wall-clock with no
//     zone, so they are read in `fallbackTimeZone`).
//   - Generic CSV or JSON record lists whose headers/keys are close to the
//     usual names (type, start, end, duration, amount, note, …). A synonym
//     table maps what it can; anything unmappable is reported, never guessed
//     into a wrong entry type.
//
// The converter is PURE and deliberately conservative: it only produces
// candidate events in the v2 shape. sanitizeEvent still decides what is
// acceptable, planBabyMerge still matches the baby (by name), and merge
// still dedupes by id — ids here are deterministic (the source app's own
// activity key, or a content hash), so importing the same export twice
// changes nothing the second time.
//
// What has no Nurture equivalent (growth charts, medication, solids,
// temperature, photos) is counted in the report's `skipped` list with a
// reason, out loud — never silently dropped, never faked into another type.

const ML_PER_OZ = 29.5735;

/** @param {unknown} v @returns {number|null} */
function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const n = Number(v.trim());
  return v.trim() !== '' && Number.isFinite(n) ? n : null;
}

const normKey = k => String(k ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** FNV-1a 32-bit, hex. Deterministic ids for exports that carry none. */
function hashId(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ------------------------------------------------------------------ CSV

/**
 * Parse CSV text (RFC 4180-ish: quotes, escaped quotes, CRLF, BOM).
 * The delimiter is sniffed from the header line (comma, semicolon, tab).
 * @param {string} text
 * @returns {{ headers: string[], rows: object[] } | null} rows keyed by header
 */
export function parseCSV(text) {
  if (typeof text !== 'string') return null;
  const src = text.replace(/^\uFEFF/, '');
  const firstLine = src.split(/\r\n|\r|\n/, 1)[0] || '';
  const delim = [';', '\t', ','].map(d => [d, firstLine.split(d).length])
    .sort((a, b) => b[1] - a[1])[0][0];
  const table = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      table.push(row); row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); table.push(row); }
  const lines = table.filter(r => r.some(cell => String(cell).trim() !== ''));
  if (lines.length < 2) return null;
  const headers = lines[0].map(h => String(h).trim());
  const rows = lines.slice(1).map(cells => {
    const o = {};
    headers.forEach((h, i) => { o[h] = cells[i] ?? ''; });
    return o;
  });
  return { headers, rows };
}

// ------------------------------------------------------------------ time

/** Offset (ms) of an IANA zone at a UTC instant; 0 when the zone is unknown. */
function tzOffsetMs(tz, utcMs) {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const parts = {};
    for (const p of dtf.formatToParts(new Date(utcMs))) parts[p.type] = p.value;
    const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    return asUtc - Math.floor(utcMs / 1000) * 1000;
  } catch { return 0; }
}

function wallToUtc(y, mo, d, h, mi, s, tz) {
  const guess = Date.UTC(y, mo, d, h, mi, s);
  return guess - tzOffsetMs(tz, guess);
}

/**
 * Parse a time value: epoch (ms or s, number or string), an ISO string with
 * an offset, or a wall-clock string read in `tz`.
 * @param {unknown} v @param {string} tz @returns {number|null} epoch ms
 */
export function parseTime(v, tz) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : (/^\d+(\.\d+)?$/.test(String(v).trim()) ? Number(v) : null);
  if (n !== null && Number.isFinite(n)) {
    if (n >= 1e11) return Math.round(n);          // epoch ms
    if (n >= 1e8) return Math.round(n * 1000);    // epoch s
    return null;
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/.test(s) && /(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : null;
  }
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) return wallToUtc(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0), tz);
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return wallToUtc(+m[1], +m[2] - 1, +m[3], 0, 0, 0, tz);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ ]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (m) {
    let h = +m[4];
    if (/pm/i.test(m[7] || '') && h < 12) h += 12;
    if (/am/i.test(m[7] || '') && h === 12) h = 0;
    return wallToUtc(+m[3], +m[1] - 1, +m[2], h, +m[5], +(m[6] || 0), tz);
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

/** "140ml", "4.5 oz", "2.5" → { amount, unit|null }. */
export function parseAmount(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? { amount: v, unit: null } : null;
  const m = String(v).trim().match(/^([\d]*\.?[\d]+)\s*(ml|mL|oz|floz|fl\s?oz)?$/i);
  if (!m) return null;
  const unit = m[2] ? (/ml/i.test(m[2]) ? 'mL' : 'oz') : null;
  return { amount: Number(m[1]), unit };
}

const unitOf = u => (/^(ml|millilit)/i.test(String(u || '').trim()) ? 'mL' : 'oz');

/** Sum two parsed amounts into the first one's unit. */
function sumAmounts(a, b) {
  if (!a) return b;
  if (!b) return a;
  const toUnit = (x, unit) => (x.unit === unit || !x.unit ? x.amount
    : unit === 'mL' ? x.amount * ML_PER_OZ : x.amount / ML_PER_OZ);
  const unit = a.unit || b.unit || 'oz';
  return { amount: Math.round((toUnit(a, unit) + toUnit(b, unit)) * 100) / 100, unit };
}

/** "11:24" → seconds, read as H:MM (sleep lengths); "1:02:03" → H:MM:SS. */
function parseColonDuration(v) {
  const m = String(v ?? '').trim().match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  return (+m[1]) * 3600 + (+m[2]) * 60 + (+(m[3] || 0));
}

// ------------------------------------------------------------------ shared

const DIAPER_KIND = [
  [/both|dirty.*wet|wet.*dirty/, 'both'],
  [/dirty|poo|stool|bm\b/, 'dirty'],
  [/wet|pee|urine/, 'wet'],
  [/dry/, 'dry'],
];
function diaperKind(text) {
  const s = String(text ?? '').toLowerCase();
  for (const [re, kind] of DIAPER_KIND) if (re.test(s)) return kind;
  return null;
}

function baseEvent(id, start, end, note) {
  return {
    id, startTime: start, endTime: end ?? start,
    note: typeof note === 'string' ? note.trim() : '',
    createdAt: start, updatedAt: start,
  };
}

function newReport(source) {
  return {
    source, rows: 0,
    converted: { feed: 0, pump: 0, sleep: 0, diaper: 0 },
    skipped: [], warnings: [],
  };
}
function skip(report, rowNo, reason) {
  report.skipped.push({ row: rowNo, reason });
}
function warnOnce(report, msg) {
  if (!report.warnings.includes(msg)) report.warnings.push(msg);
}

// ------------------------------------------------------------------ Nara
// One CSV per child. Columns: Type, Profile Name, Start Date/time,
// Start Date/time (Epoch), Note, Time Zone, then one bracketed group per
// activity ("[Pump] Total Volume", "[Diaper] Type", …), plus _activityKey.

function readNara(rows, fallbackTz, report) {
  const events = [];
  let baby = { name: '', birthDate: null };
  const groupsOf = row => {
    const groups = {};
    for (const k of Object.keys(row)) {
      const m = k.match(/^\[(.+)\]\s*(.+)$/);
      if (m) (groups[m[1].toLowerCase()] ||= {})[m[2]] = row[k];
    }
    return groups;
  };
  const field = (group, ...names) => {
    if (!group) return '';
    for (const n of names) {
      const hit = Object.keys(group).find(k => k.toLowerCase() === n.toLowerCase());
      if (hit && group[hit] !== '') return group[hit];
    }
    return '';
  };
  const fieldRe = (group, re) => {
    if (!group) return '';
    const hit = Object.keys(group).find(k => re.test(k) && group[k] !== '');
    return hit ? group[hit] : '';
  };

  rows.forEach((row, i) => {
    report.rows++;
    const rowNo = i + 2; // + header, 1-based like a spreadsheet
    const type = String(row['Type'] ?? '').trim();
    const tz = String(row['Time Zone'] ?? '').trim() || fallbackTz;
    const note = row['Note'] ?? '';
    if (type.toLowerCase() === 'profile') {
      const g = groupsOf(row);
      baby = {
        name: String(row['Profile Name'] ?? '').trim(),
        birthDate: field(g['profile'], 'Birth Date') || null,
      };
      return;
    }
    if (row['Profile Name'] && !baby.name) baby.name = String(row['Profile Name']).trim();
    const start = parseTime(row['Start Date/time (Epoch)'], tz) ?? parseTime(row['Start Date/time'], tz);
    if (start === null) { skip(report, rowNo, `${type || 'A row'} had no readable start time`); return; }
    const id = row['_activityKey'] ? `nara_${row['_activityKey']}` : `imp_${hashId(JSON.stringify(row))}`;
    const g = groupsOf(row);
    const t = type.toLowerCase();

    if (t === 'pump') {
      const grp = g['pump'];
      const total = parseAmount(field(grp, 'Total Volume'));
      const left = parseAmount(field(grp, 'Left Volume'));
      const right = parseAmount(field(grp, 'Right Volume'));
      const withUnits = [total, left, right].map((a, j) => a && {
        amount: a.amount,
        unit: a.unit || unitOf(field(grp, ['Total Volume Unit', 'Left Volume Unit', 'Right Volume Unit'][j])),
      });
      const amount = withUnits[0] || sumAmounts(withUnits[1], withUnits[2]);
      const end = parseTime(field(grp, 'End Date/time (Epoch)'), tz) ?? parseTime(field(grp, 'End Date/time'), tz);
      events.push({ ...baseEvent(id, start, end, note), type: 'pump', babyId: null,
        data: { amount: amount ? amount.amount : null, unit: amount ? amount.unit : 'oz', storedTo: null } });
      report.converted.pump++;
    } else if (t === 'bottle feed' || t === 'bottle') {
      const grp = g['bottle feed'] || g['bottle'];
      const milkRaw = field(grp, 'Type');
      const milk = /formula/i.test(milkRaw) ? 'formula' : 'breastmilk';
      const amt = parseAmount(field(grp, 'Breast Milk Volume')) || parseAmount(field(grp, 'Formula Volume')) || parseAmount(field(grp, 'Volume'));
      const unitRaw = field(grp, 'Breast Milk Volume Unit') || field(grp, 'Formula Volume Unit') || field(grp, 'Volume Unit');
      const fname = field(grp, 'Formula Name').trim();
      const finalNote = fname ? (String(note).trim() ? `${String(note).trim()} · ${fname}` : fname) : note;
      events.push({ ...baseEvent(id, start, start, finalNote), type: 'feed', babyId: '__BABY__',
        data: { method: 'bottle', milk, amount: amt ? amt.amount : null, unit: amt?.unit || unitOf(unitRaw) } });
      report.converted.feed++;
    } else if (t === 'breastfeeding' || t === 'breastfeed' || t === 'nursing' || t === 'breast feed') {
      const grp = Object.values(g).length ? (g['breastfeeding'] || g['nursing'] || g['breast feed'] || g['breastfeeding / nursing']) : null;
      const lSec = num(fieldRe(grp, /left.*duration/i)) ?? num(fieldRe(grp, /duration.*left/i));
      const rSec = num(fieldRe(grp, /right.*duration/i)) ?? num(fieldRe(grp, /duration.*right/i));
      const totalSec = num(fieldRe(grp, /^duration/i));
      let left = lSec || 0, right = rSec || 0;
      if (!left && !right && totalSec) {
        left = totalSec;
        warnOnce(report, 'Some nursing sessions only had a total time; it was kept on one side.');
      }
      const end = start + (left + right) * 1000;
      events.push({ ...baseEvent(id, start, end, note), type: 'feed', babyId: '__BABY__',
        data: { method: 'breast', left, right, lastSide: right > left ? 'right' : 'left', activeSide: null, activeSince: null } });
      report.converted.feed++;
    } else if (t === 'diaper') {
      const grp = g['diaper'];
      const kind = diaperKind(field(grp, 'Type')) || diaperKind(field(grp, 'Detail'));
      if (!kind) { skip(report, rowNo, 'A diaper entry didn’t say wet, dirty or both'); return; }
      const data = { kind };
      const color = field(grp, 'Dirty Color').trim();
      const texture = field(grp, 'Dirty Texture').trim();
      if (color) data.color = color;
      if (texture) data.consistency = texture;
      events.push({ ...baseEvent(id, start, start, note), type: 'diaper', babyId: '__BABY__', data });
      report.converted.diaper++;
    } else if (t === 'sleep') {
      const grp = g['sleep'];
      let end = parseTime(field(grp, 'End Date/time (Epoch)'), tz) ?? parseTime(field(grp, 'End Date/time'), tz);
      const dur = num(field(grp, 'Duration (Seconds)'));
      if (end === null && dur) end = start + dur * 1000;
      events.push({ ...baseEvent(id, start, end, note), type: 'sleep', babyId: '__BABY__', data: {} });
      report.converted.sleep++;
    } else if (t === 'growth') {
      skip(report, rowNo, 'Growth measurements have no Nurture entry type');
    } else if (type) {
      skip(report, rowNo, `“${type}” entries have no Nurture equivalent`);
    } else {
      skip(report, rowNo, 'A row had no activity type');
    }
  });
  if (rows.some(r => r['Created By Caregiver'])) {
    warnOnce(report, 'Caregiver names from the export aren’t kept — Nurture doesn’t record who logged an entry.');
  }
  return { events, baby };
}

// ------------------------------------------------------------------ Huckleberry
// Columns: Type, Start, End, Duration, Start Condition, Start Location,
// End Condition, Notes. The same columns change meaning per Type (robinbaby
// + Huckleberry help, checked Nov 2026): bottle amounts and milk ride in the
// condition columns, nursing sides are tokens like "00:07R", diaper colour
// can ride in Duration. Times carry no zone.

function readHuckleberry(rows, fallbackTz, report) {
  const events = [];
  const baby = { name: '', birthDate: null };
  rows.forEach((row, i) => {
    report.rows++;
    const rowNo = i + 2;
    const type = String(row['Type'] ?? '').trim();
    const start = parseTime(row['Start'], fallbackTz);
    if (start === null) { skip(report, rowNo, `${type || 'A row'} had no readable start time`); return; }
    const end = parseTime(row['End'], fallbackTz);
    const note = row['Notes'] ?? '';
    const sc = String(row['Start Condition'] ?? '');
    const sl = String(row['Start Location'] ?? '');
    const ec = String(row['End Condition'] ?? '');
    const id = `imp_${hashId([type, start, end ?? '', sc, sl, ec, note].join('|'))}`;
    const t = type.toLowerCase();

    if (t === 'sleep') {
      let e = end;
      if (e === null) { const d = parseColonDuration(row['Duration']); if (d) e = start + d * 1000; }
      events.push({ ...baseEvent(id, start, e, note), type: 'sleep', babyId: '__BABY__', data: {} });
      report.converted.sleep++;
    } else if (t.startsWith('feed')) {
      if (/breast/i.test(sl) || /breast/i.test(t)) {
        let left = 0, right = 0;
        for (const m of `${sc} ${ec}`.matchAll(/(\d{1,2}):(\d{2})\s*([LR])\b/gi)) {
          const sec = (+m[1]) * 3600 + (+m[2]) * 60; // tokens are H:MM ("00:07R" = 7 minutes right)
          if (m[3].toUpperCase() === 'L') left += sec; else right += sec;
        }
        events.push({ ...baseEvent(id, start, end ?? start + (left + right) * 1000, note), type: 'feed', babyId: '__BABY__',
          data: { method: 'breast', left, right, lastSide: right > left ? 'right' : 'left', activeSide: null, activeSince: null } });
        report.converted.feed++;
      } else {
        const milk = /formula/i.test(sc) ? 'formula' : 'breastmilk';
        const amt = parseAmount(ec) || parseAmount(sc);
        events.push({ ...baseEvent(id, start, start, note), type: 'feed', babyId: '__BABY__',
          data: { method: 'bottle', milk, amount: amt ? amt.amount : null, unit: amt?.unit || 'oz' } });
        report.converted.feed++;
      }
    } else if (t.startsWith('diaper')) {
      const kind = diaperKind(ec) || diaperKind(sc);
      if (!kind) { skip(report, rowNo, 'A diaper entry didn’t say wet, dirty or both'); return; }
      const data = { kind };
      const color = String(row['Duration'] ?? '').trim();
      if (color && !/^[\d:]+$/.test(color)) data.color = color;
      events.push({ ...baseEvent(id, start, start, note), type: 'diaper', babyId: '__BABY__', data });
      report.converted.diaper++;
    } else if (t.startsWith('pump')) {
      const amount = sumAmounts(parseAmount(sc), parseAmount(ec));
      events.push({ ...baseEvent(id, start, end, note), type: 'pump', babyId: null,
        data: { amount: amount ? amount.amount : null, unit: amount ? amount.unit : 'oz', storedTo: null } });
      report.converted.pump++;
    } else if (t === 'growth') {
      skip(report, rowNo, 'Growth measurements have no Nurture entry type');
    } else if (type) {
      skip(report, rowNo, `“${type}” entries have no Nurture equivalent`);
    } else {
      skip(report, rowNo, 'A row had no activity type');
    }
  });
  warnOnce(report, `Huckleberry times carry no time zone; they were read as ${fallbackTz}.`);
  return { events, baby };
}

// ------------------------------------------------------------------ generic
// Any other flat record list (CSV or JSON): headers/keys are matched against
// a synonym table, the type value is matched against the usual words. Rows
// that don't resolve are reported, not guessed.

const SYNONYMS = {
  type: ['type', 'activity', 'activitytype', 'category', 'event', 'eventtype', 'kind', 'logtype', 'entrytype'],
  start: ['start', 'starttime', 'startdate', 'startdatetime', 'datetime', 'date', 'time', 'timestamp', 'startdate/time'],
  startEpoch: ['startdate/time(epoch)', 'startepoch', 'starttimeepoch', 'epoch', 'epochms', 'timestampms'],
  end: ['end', 'endtime', 'enddate', 'enddatetime', 'enddate/time'],
  endEpoch: ['enddate/time(epoch)', 'endepoch', 'endtimeepoch'],
  durationSec: ['duration(seconds)', 'durationseconds', 'durationsec', 'durationsecs', 'duration'],
  note: ['note', 'notes', 'comment', 'comments', 'description'],
  amount: ['amount', 'volume', 'quantity', 'totalvolume', 'amountml', 'amountoz', 'volume(ml)', 'volume(oz)'],
  unit: ['unit', 'volumeunit', 'amountunit', 'units'],
  detail: ['detail', 'details', 'contents', 'diapertype', 'diaperdetail'],
  milk: ['milk', 'milktype', 'feedtype', 'feedingtype'],
  babyName: ['baby', 'babyname', 'child', 'childname', 'profilename', 'name'],
  leftSec: ['leftduration(seconds)', 'leftduration', 'leftseconds', 'left'],
  rightSec: ['rightduration(seconds)', 'rightduration', 'rightseconds', 'right'],
  tz: ['timezone', 'tz', 'time zone'],
};

function pick(row, keys) {
  const byNorm = {};
  for (const k of Object.keys(row)) byNorm[normKey(k)] = row[k];
  for (const want of keys) {
    const v = byNorm[normKey(want)];
    if (v !== undefined && v !== '') return v;
  }
  return '';
}

function readGeneric(rows, fallbackTz, report) {
  const events = [];
  const baby = { name: '', birthDate: null };
  rows.forEach((row, i) => {
    report.rows++;
    const rowNo = i + 2;
    const tz = String(pick(row, SYNONYMS.tz) || '').trim() || fallbackTz;
    const typeRaw = String(pick(row, SYNONYMS.type) || '').trim();
    const t = typeRaw.toLowerCase();
    const name = String(pick(row, SYNONYMS.babyName) || '').trim();
    if (name && !baby.name && !/^\d+$/.test(name)) baby.name = name;
    const start = parseTime(pick(row, SYNONYMS.startEpoch), tz) ?? parseTime(pick(row, SYNONYMS.start), tz);
    if (start === null) { skip(report, rowNo, `${typeRaw || 'A row'} had no readable start time`); return; }
    let end = parseTime(pick(row, SYNONYMS.endEpoch), tz) ?? parseTime(pick(row, SYNONYMS.end), tz);
    const durSec = num(pick(row, SYNONYMS.durationSec));
    if (end === null && durSec) end = start + durSec * 1000;
    const note = pick(row, SYNONYMS.note);
    const id = `imp_${hashId(JSON.stringify(row))}`;
    const amtParsed = parseAmount(pick(row, SYNONYMS.amount));
    const amount = amtParsed ? { amount: amtParsed.amount, unit: amtParsed.unit || unitOf(pick(row, SYNONYMS.unit)) } : null;

    if (/pump/.test(t)) {
      events.push({ ...baseEvent(id, start, end, note), type: 'pump', babyId: null,
        data: { amount: amount ? amount.amount : null, unit: amount ? amount.unit : 'oz', storedTo: null } });
      report.converted.pump++;
    } else if (/bottle/.test(t) || (/feed|formula/.test(t) && amount)) {
      const milkText = `${pick(row, SYNONYMS.milk)} ${typeRaw}`;
      events.push({ ...baseEvent(id, start, start, note), type: 'feed', babyId: '__BABY__',
        data: { method: 'bottle', milk: /formula/i.test(milkText) ? 'formula' : 'breastmilk', amount: amount ? amount.amount : null, unit: amount ? amount.unit : 'oz' } });
      report.converted.feed++;
    } else if (/breast|nurs/.test(t)) {
      const toSec = (v, keyName) => {
        const n = num(v);
        if (n === null) return 0;
        return /sec/.test(keyName) || n > 3600 ? Math.round(n) : Math.round(n * 60);
      };
      const left = toSec(pick(row, SYNONYMS.leftSec), SYNONYMS.leftSec.join(' '));
      const right = toSec(pick(row, SYNONYMS.rightSec), SYNONYMS.rightSec.join(' '));
      events.push({ ...baseEvent(id, start, end ?? start + (left + right) * 1000, note), type: 'feed', babyId: '__BABY__',
        data: { method: 'breast', left, right, lastSide: right > left ? 'right' : 'left', activeSide: null, activeSince: null } });
      report.converted.feed++;
    } else if (/sleep|nap|night/.test(t)) {
      events.push({ ...baseEvent(id, start, end, note), type: 'sleep', babyId: '__BABY__', data: {} });
      report.converted.sleep++;
    } else if (/diaper|nappy|wet|dirty/.test(t) || diaperKind(pick(row, SYNONYMS.detail))) {
      const kind = diaperKind(typeRaw) || diaperKind(pick(row, SYNONYMS.detail));
      if (!kind) { skip(report, rowNo, 'A diaper entry didn’t say wet, dirty or both'); return; }
      events.push({ ...baseEvent(id, start, start, note), type: 'diaper', babyId: '__BABY__', data: { kind } });
      report.converted.diaper++;
    } else if (/growth|weight|height|length/.test(t)) {
      skip(report, rowNo, 'Growth measurements have no Nurture entry type');
    } else if (typeRaw) {
      skip(report, rowNo, `“${typeRaw}” entries weren’t recognised`);
    } else {
      skip(report, rowNo, 'A row had no activity type');
    }
  });
  return { events, baby };
}

// ------------------------------------------------------------------ entry

/** Does this text already look like a Nurture backup (v2 or v1)? */
export function isNurtureBackupText(text) {
  try {
    const obj = JSON.parse(text);
    if (!obj || typeof obj !== 'object') return false;
    if (obj.app === 'nurture' && typeof obj.schema === 'number') return true;
    if (obj.version === 1 && ['sessions', 'inventory', 'settings'].some(k => Array.isArray(obj[k]))) return true;
    return false;
  } catch { return false; }
}

function detectCsvSource(headers) {
  const has = h => headers.includes(h);
  if (has('_activityKey') || headers.some(h => /^\[.+\]/.test(h)) || has('Start Date/time (Epoch)')) return 'nara';
  const hb = ['Type', 'Start', 'End', 'Duration', 'Start Condition', 'Start Location', 'End Condition', 'Notes'];
  if (hb.every(has)) return 'huckleberry';
  return 'generic';
}

function slug(s) {
  const out = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return out || 'imported';
}

/**
 * Convert a foreign export (CSV text, or JSON text holding a record list)
 * into a candidate Nurture backup plus a plain-language report.
 * @param {string} text
 * @param {{ now?: number, fallbackTimeZone?: string }} [opts]
 * @returns {{ ok: true, source: string, backup: object, report: object } | { ok: false, error: string }}
 */
export function convertForeignText(text, { now = Date.now(), fallbackTimeZone } = {}) {
  const fallbackTz = fallbackTimeZone
    || (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC')
    || 'UTC';
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'That file is empty.' };

  let source, parsed;
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let obj;
    try { obj = JSON.parse(trimmed); } catch { return { ok: false, error: 'That file couldn’t be read as JSON or CSV.' }; }
    const list = Array.isArray(obj) ? obj
      : Object.values(obj).find(v => Array.isArray(v) && v.length && typeof v[0] === 'object');
    if (!list) return { ok: false, error: 'No list of entries was found in that file.' };
    source = 'generic';
    const report = newReport(source);
    parsed = readGeneric(list, fallbackTz, report);
    parsed.report = report;
  } else {
    const csv = parseCSV(text);
    if (!csv) return { ok: false, error: 'That file doesn’t look like a Nurture backup or a tracker export.' };
    source = detectCsvSource(csv.headers);
    const report = newReport(source);
    parsed = source === 'nara' ? readNara(csv.rows, fallbackTz, report)
      : source === 'huckleberry' ? readHuckleberry(csv.rows, fallbackTz, report)
      : readGeneric(csv.rows, fallbackTz, report);
    parsed.report = report;
  }

  const { events, baby, report } = parsed;
  if (!events.length) {
    return { ok: false, error: 'No entries Nurture can use were found in that file.', report };
  }
  const babyId = `baby_${slug(baby.name)}`;
  for (const e of events) if (e.babyId === '__BABY__') e.babyId = babyId;
  events.sort((a, b) => a.startTime - b.startTime);
  const backup = {
    app: 'nurture', schema: 2,
    exportedAt: new Date(now).toISOString(),
    events, inventory: [],
    settings: {
      babies: [{
        id: babyId, name: baby.name || '',
        birthDate: baby.birthDate || null, photoId: null,
        createdAt: events[0] ? events[0].startTime : now,
      }],
      activeBabyId: babyId,
    },
  };
  return { ok: true, source, backup, report };
}

/** One-line summary of a conversion report, for the import preview. Pure. */
export function describeConversion(report) {
  const c = report.converted;
  const parts = [];
  if (c.feed) parts.push(`${c.feed} feed${c.feed === 1 ? '' : 's'}`);
  if (c.pump) parts.push(`${c.pump} pump${c.pump === 1 ? '' : 's'}`);
  if (c.sleep) parts.push(`${c.sleep} sleep${c.sleep === 1 ? '' : 's'}`);
  if (c.diaper) parts.push(`${c.diaper} diaper${c.diaper === 1 ? '' : 's'}`);
  return parts.join(', ');
}

export const foreignImport = Object.freeze({ parseCSV, parseTime, parseAmount, isNurtureBackupText, convertForeignText, describeConversion });
