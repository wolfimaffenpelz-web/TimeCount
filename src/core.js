import { holidays, STATES } from "./holidays.js";
export const HOUR = 3600000,
  MINUTE = 60000,
  VERSION = 1;
export const TYPES = {
  vacation: "Urlaub",
  sick: "Krankheit",
  holiday: "Feiertag",
  timeoff: "Freizeitausgleich",
};
export const dateKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const validDate = (s) =>
  typeof s === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  Number.isFinite(Date.parse(s)) &&
  new Date(s + "T12:00:00Z").toISOString().slice(0, 10) === s &&
  s >= "1970-01-01" &&
  s <= "2199-12-31";
export function addDays(s, n) {
  const d = new Date(s + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function weekday(s) {
  return new Date(s + "T12:00:00Z").getUTCDay();
}
export function weekStart(s) {
  return addDays(s, -((weekday(s) + 6) % 7));
}
export function monthRange(s) {
  const a = s.slice(0, 7) + "-01";
  const d = new Date(a + "T12:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + 1);
  return [a, addDays(d.toISOString().slice(0, 10), -1)];
}
export function* dates(a, b) {
  for (let d = a; d <= b; d = addDays(d, 1)) yield d;
}
export function format(ms, signed = false) {
  const n = Math.floor(Math.abs(ms) / MINUTE);
  return `${ms < 0 ? "−" : signed && ms > 0 ? "+" : ""}${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}
export function parseDuration(value) {
  const m = /^([+-]?)(\d{1,6}):([0-5]\d)$/.exec(value.trim().replace("−", "-"));
  if (!m)
    throw Error("Zeit bitte als HH:MM eingeben, bei Bedarf mit Minuszeichen.");
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * MINUTE;
}
export function zonedDate(timestamp, zone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const value = (k) => parts.find((p) => p.type === k).value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}
export function defaults(today = dateKey()) {
  return {
    schemaVersion: VERSION,
    settings: {
      id: "settings",
      state: "NI",
      localHolidays: {},
      theme: "system",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    schedules: [
      {
        id: crypto.randomUUID(),
        from: "1970-01-01",
        weeklyMs: 32 * HOUR,
        days: [1, 2, 3, 4, 5],
        modifiedAt: Date.now(),
      },
    ],
    sessions: [],
    breaks: [],
    absences: [],
    overrides: [],
    adjustments: [],
    initial: { id: "initial", date: today, amountMs: 0 },
  };
}
export const activeSession = (d) => d.sessions.find((s) => s.end === null);
export const activeBreak = (d, id) =>
  d.breaks.find((b) => b.sessionId === id && b.end === null);
const holidayCache = new Map();
export function holiday(d, date) {
  const o = d.overrides.find((o) => o.date === date);
  if (o) return o.kind === "remove" ? null : o.name;
  const key = JSON.stringify([
    date.slice(0, 4),
    d.settings.state,
    d.settings.localHolidays,
  ]);
  if (!holidayCache.has(key)) {
    if (holidayCache.size > 1024) holidayCache.clear();
    holidayCache.set(
      key,
      holidays(
        Number(date.slice(0, 4)),
        d.settings.state,
        d.settings.localHolidays,
      ),
    );
  }
  return holidayCache.get(key).get(date) || null;
}
export function schedule(d, date) {
  return d.schedules
    .filter((s) => s.from <= date)
    .sort((a, b) => b.from.localeCompare(a.from))[0];
}
export function target(d, date) {
  const s = schedule(d, date);
  return s && s.days.includes(weekday(date)) ? s.weeklyMs / s.days.length : 0;
}
export function absence(d, date) {
  return d.absences.find((a) => a.date === date);
}
// Allocate exact integer milliseconds using largest remainders; deterministic ties follow input order.
export function allocate(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum || !total) return weights.map(() => 0);
  const denom = BigInt(sum);
  const parts = weights.map((w, i) => {
    const p = BigInt(total) * BigInt(w);
    return { i, value: Number(p / denom), remainder: p % denom };
  });
  let left = total - parts.reduce((a, p) => a + p.value, 0);
  for (const p of [...parts].sort((a, b) =>
    a.remainder === b.remainder
      ? a.i - b.i
      : a.remainder > b.remainder
        ? -1
        : 1,
  )) {
    if (left-- > 0) p.value++;
  }
  return parts.map((p) => p.value);
}
function prepare(d) {
  const sessions = new Map(),
    breaks = new Map();
  for (const s of d.sessions) {
    if (!sessions.has(s.date)) sessions.set(s.date, []);
    sessions.get(s.date).push(s);
  }
  for (const b of d.breaks) {
    if (!breaks.has(b.sessionId)) breaks.set(b.sessionId, []);
    breaks.get(b.sessionId).push(b);
  }
  return { sessions, breaks };
}
export function day(d, date, now = Date.now(), prepared) {
  const rows = (
    prepared
      ? prepared.sessions.get(date) || []
      : d.sessions.filter((s) => s.date === date)
  )
    .sort((a, b) => a.start - b.start)
    .map((s) => {
      const end = s.end ?? Math.max(s.start, now);
      const pause = (
        prepared
          ? prepared.breaks.get(s.id) || []
          : d.breaks.filter((b) => b.sessionId === s.id)
      ).reduce(
        (n, b) => n + Math.max(0, Math.min(b.end ?? now, end) - b.start),
        0,
      );
      return {
        session: s,
        presence: end - s.start,
        pause,
        raw: end - s.start - pause,
        deduction: 0,
        net: 0,
        credited: 0,
      };
    });
  const raw = rows.reduce((n, r) => n + r.raw, 0),
    pause = rows.reduce((n, r) => n + r.pause, 0);
  // Threshold is actual work BEFORE the fictional deduction. Never iterate the threshold.
  const required =
    raw > 9 * HOUR ? 45 * MINUTE : raw > 6 * HOUR ? 30 * MINUTE : 0;
  const deduction = Math.min(raw, Math.max(0, required - pause));
  const regular = rows.map((r) => (r.session.factor === 1 ? r.raw : 0)),
    regTotal = regular.reduce((a, b) => a + b, 0);
  const first = allocate(Math.min(deduction, regTotal), regular);
  const rest = allocate(
    deduction - Math.min(deduction, regTotal),
    rows.map((r) => (r.session.factor === 1 ? 0 : r.raw)),
  );
  rows.forEach((r, i) => {
    r.deduction = first[i] + rest[i];
    r.net = r.raw - r.deduction;
    r.credited = Number(
      (BigInt(r.net) * BigInt(Math.round(r.session.factor * 1000000)) +
        500000n) /
        1000000n,
    );
  });
  const original = target(d, date),
    a = absence(d, date),
    h = holiday(d, date),
    reduction = h || (a && a.type !== "timeoff") ? original : 0;
  const credited = rows.reduce((n, r) => n + r.credited, 0),
    net = raw - deduction;
  return {
    date,
    rows,
    raw,
    pause,
    required,
    deduction,
    net,
    credited,
    bonus: credited - net,
    original,
    reduction,
    target: original - reduction,
    saldo: credited - original + reduction,
    absence: a,
    holiday: h,
  };
}
export function period(d, from, to, now = Date.now()) {
  const prepared = prepare(d);
  const result = {
    from,
    to,
    original: 0,
    reduction: 0,
    target: 0,
    raw: 0,
    net: 0,
    pause: 0,
    deduction: 0,
    credited: 0,
    saldo: 0,
    adjustments: 0,
    vacation: 0,
    sick: 0,
  };
  for (const date of dates(from, to)) {
    const x = day(d, date, now, prepared);
    for (const key of [
      "original",
      "reduction",
      "target",
      "raw",
      "net",
      "pause",
      "deduction",
      "credited",
      "saldo",
    ])
      result[key] += x[key];
    if (x.original && !x.holiday) {
      if (x.absence?.type === "vacation") result.vacation++;
      if (x.absence?.type === "sick") result.sick++;
    }
  }
  result.adjustments = d.adjustments
    .filter((a) => a.date >= from && a.date <= to)
    .reduce((s, a) => s + a.amountMs, 0);
  return result;
}
export function balance(d, through, now = Date.now()) {
  if (through < d.initial.date) return null;
  const p = period(d, d.initial.date, through, now);
  return d.initial.amountMs + p.saldo + p.adjustments;
}
export function transition(d, action, now = Date.now()) {
  const current = activeSession(d);
  if (
    current &&
    (dateKey(new Date(now)) !== current.date ||
      now < current.start ||
      d.breaks.some((b) => b.sessionId === current.id && now < b.start))
  )
    throw Error(
      "Datum oder Uhrzeit passt nicht zur laufenden Erfassung. Bitte den Tag im Kalender korrigieren.",
    );
  if (action === "start") {
    if (current) throw Error("Es läuft bereits eine Erfassung.");
    d.sessions.push({
      id: crypto.randomUUID(),
      date: dateKey(new Date(now)),
      start: now,
      end: null,
      factor: 1,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      comment: "",
      createdAt: now,
      modifiedAt: now,
    });
  } else {
    if (!current) throw Error("Keine laufende Erfassung.");
    const b = activeBreak(d, current.id);
    if (action === "pause") {
      if (b) throw Error("Die Pause läuft bereits.");
      d.breaks.push({
        id: crypto.randomUUID(),
        sessionId: current.id,
        start: now,
        end: null,
        createdAt: now,
        modifiedAt: now,
      });
    } else if (action === "resume") {
      if (!b) throw Error("Keine laufende Pause.");
      b.end = now;
      b.modifiedAt = now;
    } else if (action === "stop") {
      if (b) {
        b.end = now;
        b.modifiedAt = now;
      }
      current.end = now;
    } else throw Error("Unbekannte Aktion.");
    current.modifiedAt = now;
  }
  return validate(d);
}
export function validate(d) {
  const fail = (m) => {
      throw Error(m);
    },
    obj = (x) => x && typeof x === "object" && !Array.isArray(x),
    int = (n) => Number.isSafeInteger(n),
    ts = (n) => int(n) && n >= 0 && n <= 7258118400000;
  if (!obj(d) || d.schemaVersion !== VERSION)
    fail("Inkompatible Schema-Version. Unterstützt wird Version 1.");
  if (
    !obj(d.settings) ||
    !STATES[d.settings.state] ||
    !["system", "light", "dark"].includes(d.settings.theme) ||
    typeof d.settings.timeZone !== "string" ||
    !obj(d.settings.localHolidays)
  )
    fail("Ungültige Einstellungen.");
  try {
    zonedDate(0, d.settings.timeZone);
  } catch {
    fail("Ungültige Zeitzone.");
  }
  for (const k of ["corpusChristi", "assumption", "augsburg"])
    if (
      d.settings.localHolidays[k] !== undefined &&
      typeof d.settings.localHolidays[k] !== "boolean"
    )
      fail("Ungültige lokale Feiertagsoption.");
  for (const name of [
    "schedules",
    "sessions",
    "breaks",
    "absences",
    "overrides",
    "adjustments",
  ]) {
    if (!Array.isArray(d[name]) || d[name].length > 100000)
      fail("Ungültige Datensammlung: " + name);
    const ids = new Set();
    for (const x of d[name]) {
      if (!obj(x) || typeof x.id !== "string" || !x.id || ids.has(x.id))
        fail("Fehlende oder doppelte ID in " + name);
      ids.add(x.id);
    }
  }
  const text = (x) =>
    x === undefined || (typeof x === "string" && x.length <= 10000);
  const unique = (arr, key) =>
    new Set(arr.map((x) => x[key])).size === arr.length;
  if (!d.schedules.length || !unique(d.schedules, "from"))
    fail("Sollzeitregeln fehlen oder haben doppelte Stichtage.");
  for (const s of d.schedules) {
    if (
      !validDate(s.from) ||
      !int(s.weeklyMs) ||
      s.weeklyMs < 0 ||
      s.weeklyMs > 168 * HOUR ||
      s.weeklyMs % MINUTE !== 0 ||
      JSON.stringify(s.days) !== "[1,2,3,4,5]" ||
      !ts(s.modifiedAt)
    )
      fail("Ungültige Sollzeitregel (Montag bis Freitag, 0–168 Stunden).");
  }
  if (
    !obj(d.initial) ||
    !validDate(d.initial.date) ||
    !int(d.initial.amountMs) ||
    Math.abs(d.initial.amountMs) > 1000000 * HOUR
  )
    fail("Ungültiger Anfangssaldo.");
  const sessions = [...d.sessions].sort((a, b) => a.start - b.start);
  let end = -1,
    active = 0;
  for (const s of sessions) {
    if (
      !validDate(s.date) ||
      !ts(s.start) ||
      (s.end !== null && (!ts(s.end) || s.end <= s.start)) ||
      !Number.isFinite(s.factor) ||
      s.factor <= 0 ||
      s.factor > 1000 ||
      Math.abs(s.factor * 1e6 - Math.round(s.factor * 1e6)) > 1e-6 ||
      !text(s.comment) ||
      !ts(s.createdAt) ||
      !ts(s.modifiedAt)
    )
      fail(
        "Ungültiger Arbeitsblock oder Faktor (maximal sechs Nachkommastellen).",
      );
    if (s.start < end) fail("Arbeitsblöcke überschneiden sich.");
    end = s.end ?? Infinity;
    if (s.end === null) active++;
    try {
      const zone = s.timeZone ?? d.settings.timeZone;
      if (zonedDate(s.start, zone) !== s.date)
        fail("Das Datum eines Arbeitsblocks passt nicht zu seinem Beginn.");
      if (s.end !== null && zonedDate(s.end, zone) !== s.date)
        fail(
          "Beendete Arbeitsblöcke über Mitternacht bitte in getrennte Tage aufteilen.",
        );
    } catch (e) {
      fail(e.message || "Ungültige Zeitzone im Arbeitsblock.");
    }
  }
  if (active > 1) fail("Mehr als eine aktive Erfassung.");
  for (const s of sessions) {
    const bs = d.breaks
      .filter((b) => b.sessionId === s.id)
      .sort((a, b) => a.start - b.start);
    let last = s.start;
    for (const b of bs) {
      if (
        !ts(b.start) ||
        b.start < last ||
        b.start < s.start ||
        (s.end !== null && (b.end === null || b.start >= s.end)) ||
        (b.end !== null &&
          (!ts(b.end) || b.end <= b.start || b.end > (s.end ?? Infinity))) ||
        !ts(b.createdAt) ||
        !ts(b.modifiedAt)
      )
        fail(
          "Pausen überschneiden sich oder liegen außerhalb des Arbeitsblocks.",
        );
      last = b.end ?? Infinity;
    }
  }
  if (d.breaks.some((b) => !sessions.some((s) => s.id === b.sessionId)))
    fail("Pause ohne Arbeitsblock.");
  if (!unique(d.absences, "date") || !unique(d.overrides, "date"))
    fail("Doppelte Abwesenheit oder Feiertagsüberschreibung.");
  for (const a of d.absences)
    if (!validDate(a.date) || !TYPES[a.type] || !text(a.comment))
      fail("Ungültige Abwesenheit.");
  for (const o of d.overrides)
    if (
      !validDate(o.date) ||
      !["remove", "replace"].includes(o.kind) ||
      typeof o.name !== "string" ||
      (o.kind === "replace" && !o.name.trim()) ||
      o.name.length > 200
    )
      fail("Ungültige Feiertagsüberschreibung.");
  for (const a of d.adjustments)
    if (
      !validDate(a.date) ||
      !int(a.amountMs) ||
      Math.abs(a.amountMs) > 1000000 * HOUR ||
      !text(a.comment)
    )
      fail("Ungültige Saldoanpassung.");
  if (
    d.adjustments.reduce(
      (sum, a) => sum + Math.abs(a.amountMs),
      Math.abs(d.initial.amountMs),
    ) >
    1000000 * HOUR
  )
    fail("Die Summe der Saldoanpassungen ist zu groß.");
  return d;
}
export function backup(d) {
  validate(d);
  return JSON.stringify(
    { ...d, exportedAt: new Date().toISOString() },
    null,
    2,
  );
}
export function parseBackup(text) {
  if (text.length > 30 * 1024 * 1024)
    throw Error("Backup ist zu groß (maximal 30 MB).");
  let d;
  try {
    d = JSON.parse(text);
  } catch {
    throw Error("Die Datei enthält kein gültiges JSON.");
  }
  return validate(d);
}
const csvCell = (x) =>
  '"' +
  String(x ?? "")
    .replaceAll('"', '""')
    .replace(/^[=+@\t\r]/, "'$&") +
  '"';
export function csv(d, from, to, now = Date.now()) {
  if (!validDate(from) || !validDate(to) || from > to)
    throw Error("Ungültiger Exportzeitraum.");
  const rows = [
    [
      "Datum",
      "Beginn",
      "Ende",
      "Pause",
      "Zusatzabzug",
      "Tatsächliche Arbeit",
      "Netto nach Abzug",
      "Faktor",
      "Angerechnet",
      "Soll",
      "Abwesenheit / Feiertag",
      "Saldo",
      "Saldoanpassung",
    ],
  ];
  for (const date of dates(from, to)) {
    const x = day(d, date, now),
      label = [TYPES[x.absence?.type], x.holiday].filter(Boolean).join(" / ");
    const adj = d.adjustments
      .filter((a) => a.date === date)
      .reduce((s, a) => s + a.amountMs, 0);
    const blocks = x.rows.length ? x.rows : [null];
    blocks.forEach((r, i) => {
      const time = (n) => (n === null ? "läuft" : new Date(n).toISOString());
      rows.push([
        date,
        r ? time(r.session.start) : "",
        r ? time(r.session.end) : "",
        format(r?.pause ?? 0),
        format(r?.deduction ?? 0),
        format(r?.raw ?? 0),
        format(r?.net ?? 0),
        r?.session.factor ?? "",
        format(r?.credited ?? 0),
        i === 0 ? format(x.target) : "",
        i === 0 ? label : "",
        i === 0 ? format(x.saldo, true) : "",
        i === 0 ? format(adj, true) : "",
      ]);
    });
  }
  return "\uFEFF" + rows.map((r) => r.map(csvCell).join(";")).join("\r\n");
}
