import { test } from "node:test";
import assert from "node:assert/strict";
import * as C from "../src/core.js";
import { holidays, easter, STATES } from "../src/holidays.js";
const H = C.HOUR,
  M = C.MINUTE,
  D = "2026-10-26";
function fresh(date = D) {
  return C.defaults(date);
}
function block(
  d,
  hours,
  { date = D, start = 8, factor = 1, pause = 0, open = false } = {},
) {
  const t = new Date(`${date}T00:00:00Z`).getTime() + start * H,
    s = {
      id: crypto.randomUUID(),
      date,
      start: t,
      end: open ? null : t + hours * H,
      factor,
      comment: "",
      createdAt: t,
      modifiedAt: t,
    };
  d.sessions.push(s);
  if (pause)
    d.breaks.push({
      id: crypto.randomUUID(),
      sessionId: s.id,
      start: t + H,
      end: t + H + pause * M,
      createdAt: t,
      modifiedAt: t,
    });
  return s;
}
for (const [title, presence, pause, raw, deduction, credit] of [
  ["genau 6 Stunden", 6, 0, 6, 0, 6],
  ["mehr als 6 Stunden", 6 + 1 / 60, 0, 6 + 1 / 60, 0.5, 5.5 + 1 / 60],
  ["genau 9 Stunden", 9, 0, 9, 0.5, 8.5],
  ["mehr als 9 Stunden", 9 + 1 / 60, 0, 9 + 1 / 60, 0.75, 8.25 + 1 / 60],
  ["vollständige Pause", 8, 30, 7.5, 0, 7.5],
  ["teilweise Pause", 8, 15, 7.75, 0.25, 7.5],
  ["lange Anwesenheit mit 30 Minuten Pause", 10, 30, 9.5, 0.25, 9.25],
  ["lange Anwesenheit mit 45 Minuten Pause", 10, 45, 9.25, 0, 9.25],
  ["echte Pause bestimmt Schwelle", 6.5, 30, 6, 0, 6],
])
  test("Pause: " + title, () => {
    const d = fresh();
    block(d, presence, { pause });
    const x = C.day(d, D);
    assert.equal(x.raw, Math.round(raw * H));
    assert.equal(x.deduction, Math.round(deduction * H));
    assert.equal(x.credited, Math.round(credit * H));
    assert.equal(C.day(d, D).credited, x.credited);
  });
test("einfacher Tag und getrennte Faktorzeit", () => {
  const d = fresh();
  block(d, 2, { factor: 1.5 });
  const x = C.day(d, D);
  assert.equal(x.raw, 2 * H);
  assert.equal(x.credited, 3 * H);
  assert.equal(x.bonus, H);
});
test("mehrere Blöcke / unterbrochener Tag ohne Abzug der Unterbrechung als Pause", () => {
  const d = fresh();
  block(d, 3);
  block(d, 3, { start: 13 });
  assert.equal(C.day(d, D).raw, 6 * H);
  assert.equal(C.day(d, D).pause, 0);
});
test("reguläre Minuten werden zuerst gekürzt", () => {
  const d = fresh();
  block(d, 2, { factor: 2 });
  block(d, 5, { start: 11 });
  const x = C.day(d, D);
  assert.equal(x.rows[0].deduction, 0);
  assert.equal(x.rows[1].deduction, 0.5 * H);
  assert.equal(x.credited, 8.5 * H);
});
test("Rest proportional, wenn reguläre Minuten nicht ausreichen", () => {
  const d = fresh();
  block(d, 0.1);
  block(d, 3, { start: 9, factor: 1.5 });
  block(d, 4, { start: 13, factor: 2 });
  const x = C.day(d, D);
  assert.equal(x.rows[0].deduction, 0.1 * H);
  assert.equal(x.rows[1].deduction, Math.round((0.4 * H * 3) / 7));
  assert.equal(
    x.rows.reduce((s, r) => s + r.deduction, 0),
    0.5 * H,
  );
  assert.equal(
    x.rows.reduce((s, r) => s + r.net, 0),
    x.net,
  );
});
test("proportionale Verteilung hat keine verlorenen Millisekunden", () => {
  assert.deepEqual(C.allocate(10, [1, 1, 1]), [4, 3, 3]);
  assert.deepEqual(C.allocate(3, [0, 0]), [0, 0]);
});
test("laufende Erfassung, Pause, Neustart und Fortsetzung", () => {
  const t = new Date().setHours(8, 0, 0, 0),
    d = fresh(C.dateKey(new Date(t)));
  C.transition(d, "start", t);
  C.transition(d, "pause", t + 2 * H);
  const restored = C.parseBackup(C.backup(d));
  assert.equal(C.day(restored, d.initial.date, t + 2.5 * H).raw, 2 * H);
  C.transition(restored, "resume", t + 2.5 * H);
  C.transition(restored, "stop", t + 4 * H);
  assert.equal(C.day(restored, d.initial.date).raw, 3.5 * H);
  assert.equal(C.activeSession(restored), undefined);
});
test("Stop während Pause schließt beide Intervalle", () => {
  const t = new Date().setHours(8, 0, 0, 0),
    d = fresh();
  C.transition(d, "start", t);
  C.transition(d, "pause", t + H);
  C.transition(d, "stop", t + 2 * H);
  assert.equal(d.breaks[0].end, t + 2 * H);
  assert.equal(d.sessions[0].end, t + 2 * H);
});
test("Doppelstart und Uhr-Rücksprung werden abgewiesen", () => {
  const t = Date.now(),
    d = fresh();
  C.transition(d, "start", t);
  assert.throws(() => C.transition(d, "start", t + 1), /bereits/);
  assert.throws(() => C.transition(d, "stop", t - 1), /Uhrzeit/);
});
test("Mitternacht wird nicht still abgeschnitten", () => {
  const t = new Date().setHours(23, 0, 0, 0),
    d = fresh();
  C.transition(d, "start", t);
  assert.equal(C.day(d, C.dateKey(new Date(t)), t + 2 * H).raw, 2 * H);
  assert.throws(() => C.transition(d, "stop", t + 2 * H), /korrigieren/);
});
test("vergangenen Tag korrigieren berechnet Saldo neu", () => {
  const d = fresh();
  const s = block(d, 5);
  const old = C.day(d, D).saldo;
  s.end += H;
  assert.equal(C.day(d, D).saldo - old, H);
});
test("positive und negative Woche, vorläufige Restwoche", () => {
  const d = fresh();
  for (let i = 0; i < 5; i++) block(d, 7, { date: C.addDays(D, i) });
  const p = C.period(d, D, C.addDays(D, 6));
  assert.equal(p.target, 32 * H);
  assert.equal(p.credited, 32.5 * H);
  assert.equal(p.saldo, 0.5 * H);
  const empty = fresh();
  block(empty, 5);
  const q = C.period(empty, D, C.addDays(D, 6));
  assert.equal(q.saldo, -27 * H);
});
test("Anfangssaldo und separate Anpassung einschließlich negativ", () => {
  const d = fresh();
  d.initial.amountMs = -2 * H;
  d.adjustments.push({
    id: "adjust",
    date: D,
    amountMs: 3 * H,
    comment: "Korrektur",
  });
  assert.equal(C.balance(d, D), H - 6.4 * H);
  assert.equal(C.balance(d, "2026-10-25"), null);
});
test("Sollzeitwechsel mitten in der Woche", () => {
  const d = fresh();
  d.schedules.push({
    id: "new",
    from: "2026-10-28",
    weeklyMs: 40 * H,
    days: [1, 2, 3, 4, 5],
    modifiedAt: Date.now(),
  });
  assert.equal(C.period(d, D, "2026-11-01").original, 2 * 6.4 * H + 3 * 8 * H);
  assert.equal(C.target(d, "2026-10-23"), 6.4 * H);
  d.schedules[1].from = "2026-10-27";
  assert.equal(C.target(d, D), 6.4 * H);
  assert.equal(C.target(d, "2026-10-27"), 8 * H);
});
for (const type of ["vacation", "sick", "holiday", "timeoff"])
  test("Abwesenheit: " + type, () => {
    const d = fresh();
    d.absences.push({ id: "a", date: D, type });
    const x = C.day(d, D);
    assert.equal(x.target, type === "timeoff" ? 6.4 * H : 0);
    assert.equal(x.credited, 0);
  });
test("Urlaubszeitraum summiert taggenau, Wochenende entlastet nicht", () => {
  const d = fresh();
  for (const date of C.dates(D, "2026-11-01"))
    d.absences.push({ id: date, date, type: "vacation" });
  assert.equal(C.period(d, D, "2026-11-01").target, 0);
  assert.equal(C.day(d, "2026-10-31").reduction, 0);
});
test("Feiertag und Abwesenheit entlasten nicht doppelt; Feiertagsarbeit zählt extra", () => {
  const d = fresh("2026-12-25");
  d.absences.push({ id: "a", date: "2026-12-25", type: "vacation" });
  block(d, 2, { date: "2026-12-25", factor: 2 });
  const x = C.day(d, "2026-12-25");
  assert.equal(x.reduction, 6.4 * H);
  assert.equal(x.target, 0);
  assert.equal(x.saldo, 4 * H);
  assert.equal(C.day(d, "2026-12-26").reduction, 0);
});
test("Feiertagsüberschreibungen entfernen und ergänzen offline", () => {
  const d = fresh();
  d.overrides.push({ id: "x", date: "2026-12-25", name: "", kind: "remove" });
  assert.equal(C.day(d, "2026-12-25").target, 6.4 * H);
  d.overrides.push({
    id: "y",
    date: D,
    name: "Lokaler Feiertag",
    kind: "replace",
  });
  assert.equal(C.day(d, D).target, 0);
});
test("Monatsgrenzen teilen Wochen ohne doppelte Werte", () => {
  const d = fresh("2026-09-28");
  block(d, 5, { date: "2026-09-30" });
  block(d, 6, { date: "2026-10-01" });
  const w = C.period(d, "2026-09-28", "2026-10-04"),
    a = C.period(d, "2026-09-28", "2026-09-30"),
    b = C.period(d, "2026-10-01", "2026-10-04");
  assert.equal(w.saldo, a.saldo + b.saldo);
  assert.equal(w.credited, 11 * H);
  assert.equal(C.balance(d, "2026-10-04"), w.saldo);
});
test("JSON-Roundtrip enthält alle Entitäten und identische Berechnung", () => {
  const d = fresh();
  block(d, 8, { pause: 30 });
  const restored = C.parseBackup(C.backup(d));
  for (const k of Object.keys(d)) assert.deepEqual(restored[k], d[k]);
  assert.deepEqual(C.day(restored, D), C.day(d, D));
});
test("beschädigte Backups, unbekannte Version und falsche Struktur", () => {
  assert.throws(() => C.parseBackup("{"), /JSON/);
  assert.throws(() => C.parseBackup('{"schemaVersion":99}'), /Schema/);
  const d = fresh();
  d.sessions = {};
  assert.throws(() => C.validate(d), /Datensammlung/);
});
test("Intervalle und Pausen plausibilisieren", () => {
  const d = fresh(),
    s = block(d, 2);
  block(d, 2, { start: 9 });
  assert.throws(() => C.validate(d), /überschneiden/);
  d.sessions.pop();
  d.breaks.push({
    id: "p",
    sessionId: s.id,
    start: s.start - H,
    end: s.start,
    createdAt: s.start,
    modifiedAt: s.start,
  });
  assert.throws(() => C.validate(d), /Pausen/);
  d.breaks = [];
  s.end = s.start;
  assert.throws(() => C.validate(d), /Arbeitsblock/);
});
test("doppelte Abwesenheiten, Regeln und aktive Blöcke sind ungültig", () => {
  const d = fresh();
  d.absences = [
    { id: "a", date: D, type: "sick" },
    { id: "b", date: D, type: "vacation" },
  ];
  assert.throws(() => C.validate(d), /Doppelte/);
  d.absences = [];
  block(d, 1, { open: true });
  block(d, 1, { start: 10, open: true });
  assert.throws(() => C.validate(d), /überschneiden|aktive/);
});
test("CSV: BOM, Semikolon, Zeitzuordnung und sicherer Text", () => {
  const d = fresh();
  block(d, 2);
  d.overrides.push({ id: "o", date: D, kind: "replace", name: "=SUMME(A1)" });
  const csv = C.csv(d, D, D);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes(";"));
  assert.ok(csv.includes("'=SUMME"));
  assert.equal(csv.split("\r\n").length, 2);
});
test("Formate und Kalenderarithmetik sind vorzeichen- und DST-stabil", () => {
  assert.equal(C.parseDuration("-02:15"), -135 * M);
  assert.equal(C.format(-135 * M), "−02:15");
  assert.throws(() => C.parseDuration("12:99"));
  assert.equal(C.weekStart("2026-11-01"), D);
  assert.deepEqual(C.monthRange("2024-02-15"), ["2024-02-01", "2024-02-29"]);
  assert.equal(C.addDays("2026-03-29", 1), "2026-03-30");
  assert.equal(C.validDate("2026-02-30"), false);
});
test("alle 16 Länder und bewegliche Feiertage", () => {
  assert.equal(Object.keys(STATES).length, 16);
  assert.equal(easter(2026).toISOString().slice(0, 10), "2026-04-05");
  for (const state of Object.keys(STATES)) {
    const h = holidays(2026, state);
    assert.equal(h.get("2026-04-03"), "Karfreitag");
    assert.equal(h.get("2026-05-14"), "Christi Himmelfahrt");
    assert.equal(h.get("2026-05-25"), "Pfingstmontag");
    assert.ok(h.has("2026-12-25"));
  }
});
test("historische Gültigkeit und lokale Feiertage", () => {
  assert.equal(holidays(2016, "NI").has("2016-10-31"), false);
  assert.equal(holidays(2017, "HE").has("2017-10-31"), true);
  assert.equal(holidays(2018, "NI").has("2018-10-31"), true);
  assert.equal(holidays(2018, "BE").has("2018-03-08"), false);
  assert.equal(holidays(2019, "BE").has("2019-03-08"), true);
  assert.equal(holidays(2022, "MV").has("2022-03-08"), false);
  assert.equal(holidays(2023, "MV").has("2023-03-08"), true);
  assert.equal(holidays(1994, "NI").has("1994-11-16"), true);
  assert.equal(holidays(1995, "NI").has("1995-11-22"), false);
  assert.equal(holidays(2026, "BY").has("2026-08-15"), false);
  assert.equal(
    holidays(2026, "BY", { assumption: true }).has("2026-08-15"),
    true,
  );
  assert.equal(holidays(2026, "SN").get("2026-11-18"), "Buß- und Bettag");
  assert.equal(holidays(2025, "BE").has("2025-05-08"), true);
  assert.equal(holidays(2026, "TH").has("2026-09-20"), true);
  assert.equal(holidays(2040, "NI").has("2040-05-10"), true);
});
test("Tageszuordnung beim Import muss zum Zeitstempel passen", () => {
  const d = fresh();
  const s = block(d, 2);
  s.date = "2026-10-25";
  assert.throws(() => C.validate(d), /Datum/);
});
test("beendeter Block über Mitternacht ist ungültig, aktiver bleibt erhalten", () => {
  const d = fresh();
  const s = block(d, 3, { start: 23 });
  assert.throws(() => C.validate(d), /Mitternacht/);
  s.end = null;
  assert.doesNotThrow(() => C.validate(d));
});
test("Zeitzonenwechsel verändert aufgezeichneten Kalendertag nicht", () => {
  const d = fresh();
  const t = Date.parse("2026-10-26T23:10:00Z");
  d.sessions.push({
    id: "s",
    date: "2026-10-27",
    start: t,
    end: t + M,
    factor: 1,
    timeZone: "Europe/Berlin",
    createdAt: t,
    modifiedAt: t,
  });
  d.settings.timeZone = "America/New_York";
  assert.doesNotThrow(() => C.validate(d));
  assert.equal(C.day(d, "2026-10-27").raw, M);
});
test("Sommerzeit-Rückstellung verwendet tatsächliche Zeitstempel", () => {
  const d = fresh("2026-10-25"),
    t = Date.parse("2026-10-25T00:30:00Z");
  d.sessions.push({
    id: "s",
    date: "2026-10-25",
    start: t,
    end: t + H,
    factor: 1,
    timeZone: "Europe/Berlin",
    createdAt: t,
    modifiedAt: t,
  });
  C.validate(d);
  assert.equal(C.day(d, "2026-10-25").raw, H);
});
test("Pausen dürfen sich weder überschneiden noch nach Blockende liegen", () => {
  const d = fresh();
  const s = block(d, 4, { pause: 30 });
  const p = d.breaks[0];
  d.breaks.push({ ...p, id: "p2", start: p.start + M });
  assert.throws(() => C.validate(d), /Pausen/);
  d.breaks.pop();
  p.end = s.end + 1;
  assert.throws(() => C.validate(d), /Pausen/);
});
test("Faktorwertung rundet nur einmal auf Millisekunden", () => {
  const d = fresh();
  const s = block(d, 1 / 3600000, { factor: 1.5 });
  assert.equal(C.day(d, D).credited, 2);
  s.factor = 0;
  assert.throws(() => C.validate(d), /Faktor/);
});
test("Urlaubs- und Krankheitstage zählen nur reguläre Nichtfeiertage", () => {
  const d = fresh();
  d.absences.push(
    { id: "a", date: "2026-12-25", type: "vacation" },
    { id: "b", date: "2026-12-26", type: "sick" },
    { id: "c", date: "2026-12-28", type: "vacation" },
  );
  const p = C.period(d, "2026-12-25", "2026-12-28");
  assert.equal(p.vacation, 1);
  assert.equal(p.sick, 0);
});
test("regionale Änderung und Overrides verwenden keine veralteten Feiertagswerte", () => {
  const d = fresh();
  assert.equal(C.holiday(d, "2026-03-08"), null);
  d.settings.state = "BE";
  assert.equal(C.holiday(d, "2026-03-08"), "Internationaler Frauentag");
  d.overrides.push({ id: "o", date: "2026-03-08", kind: "remove", name: "" });
  assert.equal(C.holiday(d, "2026-03-08"), null);
});
