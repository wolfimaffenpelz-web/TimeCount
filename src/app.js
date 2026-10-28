import * as C from "./core.js";
import { STATES } from "./holidays.js";
import { load, update } from "./db.js";
const $ = (s) => document.querySelector(s),
  app = $("#app"),
  dialog = $("#editor"),
  body = $("#dialog-body");
const esc = (x) =>
  String(x ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const f = C.format,
  today = () => C.dateKey(),
  id = () => crypto.randomUUID();
const nice = (d) =>
  new Date(d + "T12:00:00").toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
const time = (t) =>
  t === null
    ? "läuft"
    : new Date(t).toLocaleTimeString("de-DE", {
        hour: "2-digit",
        minute: "2-digit",
      });
const localInput = (t) => {
  if (t === null) return "";
  const d = new Date(t);
  return `${C.dateKey(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}.${String(d.getMilliseconds()).padStart(3, "0")}`;
};
const stamp = (s) => {
  const n = new Date(s).getTime();
  if (!s || !Number.isFinite(n))
    throw Error("Bitte einen gültigen Zeitpunkt eingeben.");
  return n;
};
let data,
  revision,
  busy = false,
  month = today().slice(0, 7),
  reportMonth = month,
  reportWeek = C.weekStart(today()),
  selectedDate = today(),
  pendingImport,
  importRevision,
  installPrompt,
  waitingWorker,
  noticeTimer;
let trackUntil = 0;
let updateRequested = false;
let clockWarning = false,
  baseClock = Date.now(),
  baseMono = performance.now();
const channel =
  "BroadcastChannel" in window ? new BroadcastChannel("timecount") : null;
function notify(message, error = false) {
  clearTimeout(noticeTimer);
  const el = $("#notice");
  el.textContent = message;
  el.hidden = false;
  el.classList.toggle("error", error);
  if (!error) noticeTimer = setTimeout(() => (el.hidden = true), 4500);
}
function err(e) {
  notify(
    e.name === "QuotaExceededError"
      ? "Gerätespeicher voll. Änderung wurde nicht gespeichert. Bitte Speicher freigeben und ein Backup sichern."
      : e.message ||
          "Speichern fehlgeschlagen. Änderung wurde nicht übernommen.",
    true,
  );
}
const currentView = () =>
  ["today", "calendar", "reports", "settings"].includes(location.hash.slice(1))
    ? location.hash.slice(1)
    : "today";
async function refresh() {
  if (busy) return;
  try {
    const next = await load();
    if (next.revision !== revision) {
      const editing =
        dialog.open || app.querySelector('form[data-dirty="true"]');
      ({ data, revision } = next);
      if (editing)
        notify(
          "Daten wurden in einem anderen Tab geändert. Offene Formulare werden vor dem Speichern auf Konflikte geprüft.",
        );
      else render();
    }
  } catch (e) {
    err(e);
  }
}
channel?.addEventListener("message", refresh);
window.addEventListener("focus", refresh);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refresh();
});
async function save(
  change,
  { expected = revision, close = true, message = "Gespeichert." } = {},
) {
  if (busy) return false;
  if (updateRequested) {
    notify("App-Update wird vorbereitet. Bitte kurz warten.");
    return false;
  }
  busy = true;
  document
    .querySelectorAll("button[type=submit],[data-action=track]")
    .forEach((b) => (b.disabled = true));
  try {
    ({ data, revision } = await update(change, expected));
    channel?.postMessage({ revision });
    if (close) dialog.close();
    render();
    notify(message);
    return true;
  } catch (e) {
    try {
      ({ data, revision } = await load());
      render();
    } catch {}
    err(e);
    return false;
  } finally {
    busy = false;
    document
      .querySelectorAll("button[type=submit]")
      .forEach((b) => (b.disabled = false));
    syncTrackButtons();
  }
}
function syncTrackButtons() {
  const a = data && C.activeSession(data);
  document
    .querySelectorAll("[data-action=track]")
    .forEach(
      (b) =>
        (b.disabled =
          busy ||
          updateRequested ||
          performance.now() < trackUntil ||
          Boolean(a && a.date !== today())),
    );
}
function modal(html) {
  body.innerHTML = html;
  if (!dialog.open) dialog.showModal();
  body.querySelector("input,select,button")?.focus();
}
$("#close-dialog").onclick = () => dialog.close();
function metric(label, value, key) {
  return `<div class="metric"><strong ${key ? `data-live="${key}"` : ""}>${esc(value)}</strong><span>${label}</span></div>`;
}
function line(label, value) {
  return `<div class="line-item"><span>${label}</span><strong>${esc(value)}</strong></div>`;
}
function intro(label, title, sub) {
  return `<div class="intro"><div class="eyebrow">${label}</div><h1>${title}</h1><p class="subtle">${sub}</p></div>`;
}
function todayValues() {
  const now = Date.now(),
    date = today(),
    x = C.day(data, date, now),
    ws = C.weekStart(date),
    we = C.addDays(ws, 6),
    week = C.period(data, ws, we, now),
    a = C.activeSession(data),
    b = a && C.activeBreak(data, a.id);
  return {
    x,
    week,
    a,
    b,
    values: {
      actual: f(x.raw),
      credited: f(x.credited),
      pause: f(x.pause),
      deduction: f(x.deduction),
      currentPause: f(b ? Math.max(0, now - b.start) : 0),
      balance: f(C.balance(data, we, now) ?? 0, true),
      week: f(week.saldo, true),
      remaining: f(Math.max(0, week.target - week.credited)),
      bonus: f(x.bonus, true),
    },
  };
}
function todayPage() {
  const { x, week, a, b, values: v } = todayValues();
  const status = a
    ? b
      ? "Pause läuft"
      : "Arbeit läuft"
    : x.rows.length
      ? "Arbeitstag beendet"
      : "Nicht gestartet";
  const action = a ? (b ? "resume" : "stop") : "start";
  const label = a
    ? b
      ? "Pause beenden"
      : "Arbeit beenden"
    : x.rows.length
      ? "Weitere Arbeit starten"
      : "Arbeit starten";
  const old = a && a.date !== today();
  return (
    intro("Dein Arbeitsalltag", "Deine Zeit. Im Blick.", esc(nice(today()))) +
    `<div id="clock-warning">${warnings()}</div><section class="card hero" aria-label="Heutige Erfassung"><div class="row"><span class="status">${status}</span><button class="ghost" data-action="day" data-date="${today()}">Tag bearbeiten</button></div><div class="timer" data-live="actual">${v.actual}</div><div class="timer-label">Heute tatsächlich gearbeitet</div><div class="metrics">${metric("Angerechnet", v.credited, "credited")}${metric("Erfasste Pausen", v.pause, "pause")}${metric(b ? "Laufende Pause" : "Zusatzabzug", b ? v.currentPause : v.deduction, b ? "currentPause" : "deduction")}</div><div class="actions"><button class="primary" data-action="track" data-track="${action}" ${old ? "disabled" : ""}>${label}</button>${a && !b ? '<button class="secondary" data-action="track" data-track="pause">Pause starten</button>' : ""}${b ? '<button data-action="track" data-track="stop">Arbeit beenden</button>' : ""}</div><p class="note">${a ? `Beginn ${esc(a.date)} · ${time(a.start)} · Zustand ist auf diesem Gerät gespeichert.` : "Ein Klick genügt. Deine Zeiten bleiben auf diesem Gerät."}</p></section><div class="grid2"><section class="card"><div class="row"><h2>Gleitzeitkonto</h2><span class="badge">Vorläufig</span></div><div class="balance" data-live="balance">${v.balance}</div><p class="subtle">Stunden · einschließlich laufender Woche</p><p class="note">Anfangssaldo ab ${esc(data.initial.date)}. Für diese Woche ist das gesamte bereinigte Soll berücksichtigt; weitere Arbeit verbessert den Saldo.</p></section><section class="card"><div class="row"><h2>Diese Woche</h2><span class="badge">Mo – So</span></div>${line("Bereinigtes Wochenziel", f(week.target))}${line("Wochensaldo", v.week).replace("<strong>", '<strong data-live="week">')}${line("Noch bis zum Wochenziel", v.remaining).replace("<strong>", '<strong data-live="remaining">')}<progress value="${Math.min(week.credited, week.target)}" max="${week.target || 1}" aria-label="Erreichtes Wochenziel"></progress></section></div><section class="card"><div class="row"><h2>Heutige Arbeitsblöcke</h2><button class="ghost" data-action="day" data-date="${today()}">Details & Korrekturen</button></div>${x.rows.length ? x.rows.map((r) => `<div class="line-item"><span>${time(r.session.start)} – ${time(r.session.end)} ${r.session.factor !== 1 ? `<span class="badge">× ${r.session.factor}</span>` : ""}</span><strong>${f(r.raw)}</strong></div>`).join("") : '<p class="empty">Noch keine Arbeitszeit. Bereit, wenn du es bist.</p>'}<p class="note">${x.deduction ? "Der Mindestpausenabzug ist eine rechnerische Korrektur, keine tatsächlich genommene Pause." : "Echte Pausen werden gespeichert. Fehlende Mindestpausen werden separat berechnet."}</p></section>`
  );
}
function warnings() {
  if (!data) return "";
  const a = C.activeSession(data);
  let text = [];
  if (a && a.date !== today())
    text.push(
      `Die Erfassung vom ${a.date} läuft über Mitternacht. Sie bleibt vollständig diesem Tag zugeordnet. Bitte Beginn, Ende und Pausen korrigieren.`,
    );
  if ((a && Date.now() < a.start) || clockWarning)
    text.push(
      "Die Systemuhr hat sich verändert. Bitte prüfe die Gerätezeit und korrigiere betroffene Einträge.",
    );
  if (
    data.settings.timeZone !== Intl.DateTimeFormat().resolvedOptions().timeZone
  )
    text.push(
      "Die Gerätezeitzone unterscheidet sich von der bei Einrichtung gespeicherten Zeitzone. Zeitstempel bleiben unverändert; Uhrzeiten werden in der aktuellen Gerätezeitzone angezeigt.",
    );
  const x = C.day(data, today());
  if (x.raw > 10 * C.HOUR)
    text.push(
      "Heute wurden mehr als 10 Stunden tatsächlich gearbeitet. Bitte Arbeitszeit und Erholung prüfen.",
    );
  if (x.deduction)
    text.push(
      `Heute fehlen rechnerisch ${f(x.deduction)} Stunden Mindestpause. Dieser Abzug ersetzt keine echte Erholung.`,
    );
  if (data.initial.date > today())
    text.push(
      "Der Stichtag des Anfangssaldos liegt in der Zukunft. Das Gleitzeitkonto beginnt erst an diesem Tag.",
    );
  return text
    .map(
      (t) =>
        `<div class="warning">${esc(t)} ${a && a.date !== today() ? `<button data-action="day" data-date="${a.date}">Erfassung korrigieren</button>` : ""}</div>`,
    )
    .join("");
}
function calendarPage() {
  const [from, to] = C.monthRange(month + "-01"),
    offset = (C.weekday(from) + 6) % 7;
  return (
    intro(
      "Tage & Details",
      "Dein Kalender",
      "Arbeitszeit prüfen, Tage ergänzen und Einträge korrigieren.",
    ) +
    `<section class="card"><div class="toolbar"><button data-action="month" data-step="-1" aria-label="Vorheriger Monat">←</button><h2>${new Date(from + "T12:00:00").toLocaleDateString("de-DE", { month: "long", year: "numeric" })}</h2><button data-action="month" data-step="1" aria-label="Nächster Monat">→</button><label class="sr-only" for="calendar-month">Monat auswählen</label><input id="calendar-month" type="month" min="1970-01" max="2199-12" value="${month}"></div><div class="calendar">${["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((s) => `<div class="weekday">${s}</div>`).join("")}${"<div></div>".repeat(offset)}${[
      ...C.dates(from, to),
    ]
      .map((date) => {
        const x = C.day(data, date);
        return `<button class="day ${date === today() ? "today" : ""} ${[0, 6].includes(C.weekday(date)) ? "weekend" : ""}" data-action="day" data-date="${date}" aria-label="${esc(nice(date))}${x.rows.length ? ", " + f(x.credited) + " angerechnet" : ""}${x.absence ? ", " + C.TYPES[x.absence.type] : ""}${x.holiday ? ", " + esc(x.holiday) : ""}"><b>${Number(date.slice(-2))}</b>${x.rows.length ? `<span class="hours">${f(x.credited)}</span>` : ""}${x.holiday ? `<span class="mark" title="${esc(x.holiday)}">● ${esc(x.holiday)}</span>` : ""}${x.absence ? `<span class="mark">${C.TYPES[x.absence.type]}</span>` : ""}${x.rows.some((r) => r.session.factor !== 1) ? "<small>× Faktor</small>" : ""}</button>`;
      })
      .join(
        "",
      )}</div><p class="note">Zeiten zeigen angerechnete Stunden. Tippe auf einen Tag für Details und Korrekturen.</p></section>`
  );
}
function reportPage() {
  const we = C.addDays(reportWeek, 6),
    w = C.period(data, reportWeek, we),
    [from, to] = C.monthRange(reportMonth + "-01"),
    m = C.period(data, from, to),
    bal = C.balance(data, to);
  return (
    intro(
      "Wochen & Monate",
      "Was deine Zeit ergibt",
      "Nachvollziehbar aus deinen Einträgen berechnet.",
    ) +
    `<section class="card"><div class="row"><h2>Wochenübersicht</h2>${we >= today() ? '<span class="badge">Vorläufig</span>' : ""}</div><div class="toolbar"><button data-action="week" data-step="-1" aria-label="Vorherige Woche">←</button><label for="report-week">Woche ab Montag</label><input id="report-week" type="date" min="1970-01-01" max="2199-12-24" value="${reportWeek}"><button data-action="week" data-step="1" aria-label="Nächste Woche">→</button></div><p class="subtle">${reportWeek} – ${we}</p>${line("Ursprüngliches Wochensoll", f(w.original))}${line("Entlastung durch Abwesenheiten / Feiertage", f(w.reduction))}${line("Bereinigtes Wochensoll", f(w.target))}${line("Tatsächlich gearbeitet (ohne echte Pausen)", f(w.raw))}${line("Rechnerischer Zusatzabzug", f(w.deduction))}${line("Netto nach Zusatzabzug", f(w.net))}${line("Angerechnete Arbeit", f(w.credited))}${line("Wochensaldo", f(w.saldo, true))}${line("Separate Saldoanpassungen", f(w.adjustments, true))}</section><section class="card"><div class="row"><h2>Monatsübersicht</h2>${to >= today() ? '<span class="badge">Vorläufig</span>' : ""}<label class="sr-only" for="report-month">Auswertungsmonat</label><input id="report-month" type="month" min="1970-01" max="2199-12" value="${reportMonth}"></div><div class="metrics">${metric("Tatsächlich", f(m.raw))}${metric("Angerechnet", f(m.credited))}${metric("Bereinigtes Soll", f(m.target))}</div>${line("Saldo aus Arbeitszeit und Soll", f(m.saldo, true))}${line("Separate Saldoanpassungen", f(m.adjustments, true))}${line("Saldoveränderung gesamt", f(m.saldo + m.adjustments, true))}${line("Gleitzeitkonto zum Monatsende", bal === null ? "Vor Anfangsstichtag" : f(bal, true))}${line("Urlaubstage", m.vacation)}${line("Krankheitstage", m.sick)}<p class="note">Monatswerte sind taggenau zugeordnet. Der Kontostand beginnt am Anfangsstichtag; Monatswerte zeigen den ganzen Monat. Bei laufenden und zukünftigen Monaten ist das volle Monatssoll enthalten und der Wert vorläufig.</p></section><section class="card"><h2>Export für deine Unterlagen</h2><form id="csv-form"><div class="fields"><div><label for="csv-from">Von</label><input id="csv-from" name="from" type="date" value="${from}" required></div><div><label for="csv-to">Bis</label><input id="csv-to" name="to" type="date" value="${to}" required></div></div><div class="actions"><button type="submit" class="secondary">CSV herunterladen</button></div></form><p class="note">UTF-8 mit BOM · Semikolon · Zeitstempel in UTC, Zeitdauern in HH:MM.</p></section>`
  );
}
function settingsPage() {
  return (
    intro(
      "Ganz nach deinem Alltag",
      "Einstellungen",
      "Dein Arbeitsmodell und deine Daten. Alles bleibt lokal.",
    ) +
    `<section class="card"><h2>Darstellung & Feiertage</h2><form id="settings-form"><div class="fields"><div><label for="state">Bundesland</label><select id="state" name="state">${Object.entries(
      STATES,
    )
      .map(
        ([k, v]) =>
          `<option value="${k}" ${k === data.settings.state ? "selected" : ""}>${v}</option>`,
      )
      .join(
        "",
      )}</select></div><div><label for="theme">Darstellung</label><select id="theme" name="theme">${[
      ["system", "Wie das Gerät"],
      ["light", "Hell"],
      ["dark", "Dunkel"],
    ]
      .map(
        ([k, v]) =>
          `<option value="${k}" ${k === data.settings.theme ? "selected" : ""}>${v}</option>`,
      )
      .join(
        "",
      )}</select></div></div><p class="note">Lokale Sonderfälle nur aktivieren, wenn sie am Arbeitsort gelten:</p>${[
      ["assumption", "Mariä Himmelfahrt in Bayern"],
      ["augsburg", "Augsburger Friedensfest"],
      ["corpusChristi", "Fronleichnam in Gemeinden Sachsens / Thüringens"],
    ]
      .map(
        ([k, v]) =>
          `<label><input type="checkbox" name="${k}" ${data.settings.localHolidays[k] ? "checked" : ""}>${v}</label>`,
      )
      .join(
        "",
      )}<p class="note">Die Feiertagsauswahl gilt für alle Auswertungen, auch rückwirkend. Einzelne Ausnahmen lassen sich im Kalender überschreiben. Historische Regeln sind ab 1990 abgedeckt; frühere Jahre bitte manuell prüfen.</p><div class="actions"><button type="submit" class="primary">Einstellungen speichern</button></div></form></section><section class="card"><h2>Historisierte Wochenarbeitszeit</h2>${[
      ...data.schedules,
    ]
      .sort((a, b) => a.from.localeCompare(b.from))
      .map(
        (s) =>
          `<div class="list-entry"><div class="row"><span>Ab ${s.from} · <strong>${f(s.weeklyMs)} h / Woche</strong></span><div class="actions"><button data-action="schedule-edit" data-id="${esc(s.id)}">Bearbeiten</button>${data.schedules.length > 1 ? `<button class="danger" data-action="schedule-delete" data-id="${esc(s.id)}">Löschen</button>` : ""}</div></div></div>`,
      )
      .join(
        "",
      )}<p class="note">Montag bis Freitag. Tagesanteil = Wochensoll ÷ 5. Eine Regel gilt bis zur nächsten Regel; rückwirkende Änderungen berechnen nur ihren Gültigkeitszeitraum neu.</p><form id="schedule-form"><input type="hidden" name="id"><div class="fields"><div><label for="schedule-from">Gültig ab</label><input id="schedule-from" type="date" name="from" value="${today()}" required></div><div><label for="schedule-hours">Wochensoll (HH:MM)</label><input id="schedule-hours" name="hours" value="32:00" required placeholder="32:00"></div></div><div class="actions"><button type="submit" class="secondary">Neue Regel speichern</button></div></form></section><section class="card"><h2>Anfangssaldo</h2><form id="initial-form"><div class="fields"><div><label for="initial-date">Stichtag (Beginn dieses Tages)</label><input id="initial-date" name="date" type="date" value="${data.initial.date}" required></div><div><label for="initial-amount">Saldo (±HH:MM)</label><input id="initial-amount" name="amount" value="${f(data.initial.amountMs, true).replace("−", "-")}" required></div></div><p class="note">Alle Tage ab diesem Stichtag zählen zum Konto, einschließlich der laufenden Woche. Frühere Einträge bleiben gespeichert und auswertbar.</p><div class="actions"><button type="submit" class="secondary">Anfangssaldo speichern</button></div></form></section><section class="card"><h2>Manuelle Saldoanpassungen</h2>${
      [...data.adjustments]
        .sort((a, b) => b.date.localeCompare(a.date))
        .map(
          (a) =>
            `<div class="list-entry"><div>${a.date} · <strong>${f(a.amountMs, true)}</strong> · ${esc(a.comment)}</div><div class="actions"><button data-action="adjustment-edit" data-id="${esc(a.id)}">Bearbeiten</button><button class="danger" data-action="adjustment-delete" data-id="${esc(a.id)}">Löschen</button></div></div>`,
        )
        .join("") || '<p class="subtle">Noch keine Anpassungen.</p>'
    }${adjustmentForm()}</section><section class="card"><h2>Backup & Wiederherstellung</h2><p>Ein Backup enthält alle Daten einschließlich einer laufenden Erfassung. Sichere es regelmäßig außerhalb dieses Browsers.</p><div class="actions"><button data-action="backup" class="secondary">JSON-Backup herunterladen</button><button data-action="import">Backup wiederherstellen</button></div><input type="file" id="import-file" accept=".json,application/json" hidden><p class="note">Wiederherstellen ersetzt alle vorhandenen Daten nach Vorschau und Bestätigung. Browserdaten zu löschen oder die App zu deinstallieren kann lokale Daten entfernen.</p><button data-action="persist" class="ghost">Dauerhafte Speicherung anfragen</button><p id="storage-status" class="note"></p></section><section class="card"><h2>App & Offlinebetrieb</h2><p id="offline-status" class="subtle">Offline-Dateien werden geprüft …</p><div class="actions">${installPrompt ? '<button class="secondary" data-action="install">App installieren</button>' : ""}<button data-action="check-update">Auf App-Update prüfen</button>${waitingWorker ? '<button data-action="apply-update" class="secondary">Update übernehmen</button>' : ""}</div><p class="note">Android: Browsermenü → „App installieren“ oder „Zum Startbildschirm hinzufügen“. Offlinebetrieb erfordert ein erfolgreiches erstes Laden über HTTPS oder localhost. Keine Cloud, keine externen Dienste.</p><details><summary>Wie werden Zeiten berechnet?</summary><p>Die tatsächliche Arbeit ist Anwesenheit minus echte Pausen. Bei mehr als 6 bzw. 9 Stunden dieser Arbeitszeit gelten 30 bzw. 45 Minuten Mindestpause. Nur der fehlende Teil wird zusätzlich abgezogen. Die Schwelle wird danach nicht erneut geprüft, um widersprüchliches Hin- und Herspringen zu vermeiden.</p><p>Der Zusatzabzug wird zuerst auf Blöcke mit Faktor 1 verteilt; ein Rest proportional auf andere Blöcke. Danach wird die verbleibende Nettozeit je Block mit seinem Faktor bewertet. Verteilung und Rundung erfolgen in ganzzahligen Millisekunden.</p><p>Urlaub, Krankheit und Feiertage reduzieren das Soll höchstens einmal pro Tag. Freizeitausgleich reduziert es nicht. Ein Feiertag bleibt auch bei Freizeitausgleich ein Feiertag.</p></details></section>`
  );
}
function adjustmentForm(a) {
  return `<form id="adjustment-form"><input name="id" type="hidden" value="${esc(a?.id || "")}"><div class="fields"><div><label for="adjust-date">Datum</label><input id="adjust-date" name="date" type="date" value="${a?.date || today()}" required></div><div><label for="adjust-amount">Betrag (±HH:MM)</label><input id="adjust-amount" name="amount" value="${a ? f(a.amountMs, true).replace("−", "-") : "00:00"}" required></div></div><label for="adjust-comment">Begründung (optional)</label><input id="adjust-comment" name="comment" value="${esc(a?.comment)}" maxlength="10000"><div class="actions"><button type="submit" class="secondary">Anpassung speichern</button></div></form>`;
}
function render() {
  if (!data) return;
  const theme = data.settings.theme;
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  const view = currentView();
  app.innerHTML = {
    today: todayPage,
    calendar: calendarPage,
    reports: reportPage,
    settings: settingsPage,
  }[view]();
  app.setAttribute("aria-busy", "false");
  document.querySelectorAll("[data-tab]").forEach((a) => {
    a.classList.toggle("active", a.dataset.tab === view);
    if (a.dataset.tab === view) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  app
    .querySelectorAll("form")
    .forEach((form) => (form.dataset.revision = revision));
  syncTrackButtons();
  if (view === "settings") offlineStatus();
}
function pauseFields(b = {}) {
  return `<div class="pause-row"><div class="fields"><div><label>Pausenbeginn<input name="pause-start" type="datetime-local" step="0.001" value="${localInput(b.start ?? null)}" required></label></div><div><label>Pausenende (leer = läuft)<input name="pause-end" type="datetime-local" step="0.001" value="${localInput(b.end ?? null)}"></label></div></div><input name="pause-id" type="hidden" value="${esc(b.id || "")}"><button type="button" class="ghost danger" data-action="pause-remove">Pause entfernen</button></div>`;
}
function showDay(date) {
  selectedDate = date;
  const x = C.day(data, date),
    rev = revision;
  modal(
    `<h2 id="dialog-title">${esc(nice(date))}</h2><div class="metrics">${metric("Tatsächlich", f(x.raw))}${metric("Zusatzabzug", f(x.deduction))}${metric("Angerechnet", f(x.credited))}</div>${line("Erfasste Pausen", f(x.pause))}${line("Netto nach Zusatzabzug", f(x.net))}${line("Faktorbedingte Zusatzgutschrift", f(x.bonus, true))}${line("Sollanteil / bereinigt", f(x.original) + " / " + f(x.target))}${x.rows.map((r) => `<div class="list-entry"><div class="row"><strong>${time(r.session.start)} – ${time(r.session.end)}</strong><span class="badge">× ${r.session.factor}</span></div><p class="subtle">${f(r.raw)} tatsächlich · ${f(r.pause)} Pause · ${f(r.deduction)} Zusatzabzug · ${f(r.credited)} angerechnet</p>${r.session.comment ? `<p>${esc(r.session.comment)}</p>` : ""}<div class="actions"><button data-action="session-edit" data-id="${esc(r.session.id)}">Block & Pausen bearbeiten</button><button class="danger" data-action="session-delete" data-id="${esc(r.session.id)}">Block löschen</button></div></div>`).join("") || '<p class="empty">Keine Arbeitsblöcke an diesem Tag.</p>'}<div class="actions"><button class="secondary" data-action="session-new" data-date="${date}">Arbeitsblock ergänzen</button></div><h3>Abwesenheit</h3>${x.absence ? `<p>${C.TYPES[x.absence.type]} · ${esc(x.absence.comment)}</p><div class="actions"><button data-action="absence-edit" data-date="${date}">Bearbeiten</button><button class="danger" data-action="absence-delete" data-id="${esc(x.absence.id)}">Abwesenheit löschen</button></div>` : absenceForm(date, null, rev)}<h3>Feiertag</h3><p>${esc(x.holiday || "Kein Feiertag")}</p><form id="override-form" data-revision="${rev}"><input name="date" type="hidden" value="${date}"><label for="holiday-kind">Kalenderregel</label><select id="holiday-kind" name="kind"><option value="replace">Feiertag ergänzen / überschreiben</option><option value="remove" ${data.overrides.find((o) => o.date === date)?.kind === "remove" ? "selected" : ""}>Automatischen Feiertag entfernen</option><option value="auto">Automatische Berechnung wiederherstellen</option></select><label for="holiday-name">Feiertagsname</label><input id="holiday-name" name="name" value="${esc(x.holiday)}" maxlength="200"><div class="actions"><button type="submit">Feiertagsregel speichern</button></div></form>`,
  );
  body.dataset.revision = rev;
}
function absenceForm(date, a, rev = revision) {
  return `<form id="absence-form" data-revision="${rev}"><input name="id" type="hidden" value="${esc(a?.id || "")}"><div class="fields"><div><label for="absence-from">Von</label><input id="absence-from" name="from" type="date" value="${date}" required></div><div><label for="absence-to">Bis</label><input id="absence-to" name="to" type="date" value="${date}" required></div></div><label for="absence-type">Art</label><select id="absence-type" name="type">${Object.entries(
    C.TYPES,
  )
    .map(
      ([k, v]) =>
        `<option value="${k}" ${k === a?.type ? "selected" : ""}>${v}</option>`,
    )
    .join(
      "",
    )}</select><label for="absence-comment">Kommentar (optional)</label><input id="absence-comment" name="comment" value="${esc(a?.comment)}" maxlength="10000"><div class="actions"><button type="submit">Abwesenheit speichern</button></div><p class="note">Urlaub, Krankheit und Feiertage reduzieren das Soll. Freizeitausgleich baut Gleitzeit ab. Vorhandene Abwesenheiten im Zeitraum werden nicht überschrieben.</p></form>`;
}
function editSession(s, date = selectedDate) {
  const isNew = !s,
    rev = Number(body.dataset.revision ?? revision);
  s = s || {
    date,
    start: new Date(date + "T09:00:00").getTime(),
    end: new Date(date + "T17:00:00").getTime(),
    factor: 1,
    comment: "",
  };
  modal(
    `<h2 id="dialog-title">${isNew ? "Arbeitsblock ergänzen" : "Arbeitsblock bearbeiten"}</h2><form id="session-form" data-revision="${rev}"><input name="id" type="hidden" value="${esc(s.id || "")}"><input name="date" type="hidden" value="${s.date}"><div class="fields"><div><label for="session-start">Arbeitsbeginn</label><input id="session-start" name="start" type="datetime-local" step="0.001" value="${localInput(s.start)}" required></div><div><label for="session-end">Arbeitsende (leer = läuft)</label><input id="session-end" name="end" type="datetime-local" step="0.001" value="${localInput(s.end)}"></div></div><label for="session-factor">Bewertungsfaktor</label><input id="session-factor" name="factor" type="number" min="0.000001" max="1000" step="0.000001" value="${s.factor}" required><label for="session-comment">Kommentar (optional)</label><textarea id="session-comment" name="comment" maxlength="10000">${esc(s.comment)}</textarea><h3>Tatsächlich genommene Pausen</h3><div id="pause-fields">${data.breaks
      .filter((b) => b.sessionId === s.id)
      .sort((a, b) => a.start - b.start)
      .map(pauseFields)
      .join(
        "",
      )}</div><button class="ghost" type="button" data-action="pause-add">+ Pause ergänzen</button><p class="note">Beginn und Ende müssen am selben Kalendertag liegen. Eine bereits über Mitternacht laufende Erfassung wird hier bewusst korrigiert. Bei Sommerzeitwechseln bitte den resultierenden Zeitstempel im Backup prüfen; doppelte lokale Uhrzeiten sind im Editor nicht unterscheidbar.</p><div class="actions"><button class="primary" type="submit">Arbeitsblock speichern</button><button type="button" class="ghost" data-action="day" data-date="${s.date}">Zurück zum Tag</button></div></form>`,
  );
}
function confirmDelete(title, change, expected = revision) {
  modal(
    `<h2 id="dialog-title">${title}</h2><p>Dieser Eintrag wird dauerhaft gelöscht. Ein vorhandenes JSON-Backup bleibt davon unberührt.</p><div class="actions"><button id="confirm-delete" class="danger">Endgültig löschen</button><button data-action="cancel">Abbrechen</button></div>`,
  );
  $("#confirm-delete").onclick = () => save(change, { expected });
}
function download(content, name, type) {
  const url = URL.createObjectURL(new Blob([content], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
window.addEventListener("hashchange", () => {
  dialog.close();
  render();
  window.scrollTo(0, 0);
});
document.addEventListener("click", async (event) => {
  const b = event.target.closest("[data-action]");
  if (!b || busy) return;
  const { action, id: entryId, date, step } = b.dataset;
  try {
    if (action === "track") {
      if (performance.now() < trackUntil) return;
      trackUntil = performance.now() + 650;
      setTimeout(syncTrackButtons, 670);
      await save((d) => C.transition(d, b.dataset.track), {
        close: false,
        message: "Erfassung gespeichert.",
      });
    }
    if (action === "day") showDay(date);
    if (action === "month") {
      const d = new Date(month + "-01T12:00:00");
      d.setMonth(d.getMonth() + Number(step));
      const next = C.dateKey(d).slice(0, 7);
      if (next >= "1970-01" && next <= "2199-12") {
        month = next;
        render();
      }
    }
    if (action === "week") {
      const next = C.addDays(reportWeek, Number(step) * 7);
      if (C.validDate(next) && C.validDate(C.addDays(next, 6))) {
        reportWeek = next;
        render();
      }
    }
    if (action === "session-new") editSession(null, date);
    if (action === "session-edit")
      editSession(data.sessions.find((s) => s.id === entryId));
    if (action === "session-delete") {
      const rev = Number(body.dataset.revision ?? revision);
      confirmDelete(
        "Arbeitsblock mit allen Pausen löschen?",
        (d) => {
          d.sessions = d.sessions.filter((s) => s.id !== entryId);
          d.breaks = d.breaks.filter((p) => p.sessionId !== entryId);
          return d;
        },
        rev,
      );
    }
    if (action === "pause-add")
      $("#pause-fields").insertAdjacentHTML("beforeend", pauseFields());
    if (
      action === "pause-remove" &&
      confirm(
        "Diese Pause aus dem bearbeiteten Arbeitsblock entfernen? Wirksam wird die Änderung erst beim Speichern.",
      )
    )
      b.closest(".pause-row").remove();
    if (action === "absence-edit") {
      const a = C.absence(data, date);
      modal(
        `<h2 id="dialog-title">Abwesenheit bearbeiten</h2>${absenceForm(date, a, Number(body.dataset.revision ?? revision))}`,
      );
    }
    if (action === "absence-delete")
      confirmDelete(
        "Abwesenheit löschen?",
        (d) => {
          d.absences = d.absences.filter((a) => a.id !== entryId);
          return d;
        },
        Number(body.dataset.revision ?? revision),
      );
    if (action === "schedule-edit") {
      const s = data.schedules.find((s) => s.id === entryId);
      modal(
        `<h2 id="dialog-title">Wochenarbeitszeit bearbeiten</h2><p>Die Änderung wirkt rückwirkend ab dem angegebenen Datum bis zur nächsten Regel.</p><form id="schedule-form" data-revision="${revision}"><input name="id" type="hidden" value="${esc(s.id)}"><label for="edit-from">Gültig ab</label><input id="edit-from" name="from" type="date" value="${s.from}" required><label for="edit-hours">Wochensoll (HH:MM)</label><input id="edit-hours" name="hours" value="${f(s.weeklyMs)}" required><div class="actions"><button type="submit" class="primary">Regel speichern</button></div></form>`,
      );
    }
    if (action === "schedule-delete")
      confirmDelete(
        "Sollzeitregel löschen und Zeitraum neu berechnen?",
        (d) => {
          if (d.schedules.length <= 1)
            throw Error("Mindestens eine Sollzeitregel muss bleiben.");
          d.schedules = d.schedules.filter((s) => s.id !== entryId);
          return d;
        },
      );
    if (action === "adjustment-edit") {
      modal(
        `<h2 id="dialog-title">Saldoanpassung bearbeiten</h2>${adjustmentForm(data.adjustments.find((a) => a.id === entryId))}`,
      );
      $("#adjustment-form").dataset.revision = revision;
    }
    if (action === "adjustment-delete")
      confirmDelete("Saldoanpassung löschen?", (d) => {
        d.adjustments = d.adjustments.filter((a) => a.id !== entryId);
        return d;
      });
    if (action === "backup")
      download(C.backup(data), `TimeCount-${today()}.json`, "application/json");
    if (action === "import") $("#import-file").click();
    if (action === "cancel") dialog.close();
    if (action === "persist") {
      const granted = await navigator.storage?.persist?.();
      $("#storage-status").textContent = granted
        ? "Dauerhafte Speicherung wurde gewährt. Backups bleiben trotzdem wichtig."
        : "Der Browser hat dauerhafte Speicherung nicht gewährt. Bitte regelmäßig Backups sichern.";
    }
    if (action === "install" && installPrompt) {
      await installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      render();
    }
    if (action === "check-update") {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (!reg)
        throw Error(
          "Service Worker ist nicht verfügbar. HTTPS oder localhost erforderlich.",
        );
      await reg.update();
      notify(
        "Update-Prüfung abgeschlossen. Ein verfügbares Update erscheint hier.",
      );
    }
    if (action === "apply-update" && waitingWorker) {
      if (busy) return;
      const active = C.activeSession(data);
      modal(
        `<h2 id="dialog-title">App-Update übernehmen?</h2><p>Die App wird neu geladen. Alle gespeicherten Daten${active ? " und die laufende Erfassung" : ""} bleiben erhalten. Ungespeicherte Formulare in anderen Tabs gehen verloren.</p><div class="actions"><button id="confirm-update" class="primary">Jetzt aktualisieren</button><button data-action="cancel">Später</button></div>`,
      );
      $("#confirm-update").onclick = () => {
        if (!busy) waitingWorker.postMessage("ACTIVATE");
      };
    }
  } catch (e) {
    err(e);
  }
});
document.addEventListener("change", async (e) => {
  try {
    if (
      e.target.id === "calendar-month" &&
      /^\d{4}-\d{2}$/.test(e.target.value)
    ) {
      month = e.target.value;
      render();
    }
    if (
      e.target.id === "report-month" &&
      /^\d{4}-\d{2}$/.test(e.target.value)
    ) {
      reportMonth = e.target.value;
      render();
    }
    if (e.target.id === "report-week" && C.validDate(e.target.value)) {
      reportWeek = C.weekStart(e.target.value);
      render();
    }
    if (e.target.id === "import-file") {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 30 * 1024 * 1024)
        throw Error("Backup ist zu groß (maximal 30 MB).");
      pendingImport = C.parseBackup(await file.text());
      importRevision = revision;
      modal(
        `<h2 id="dialog-title">Backup wiederherstellen?</h2><div class="warning">Alle vorhandenen Daten werden vollständig ersetzt. Bitte sichere vorher dein aktuelles Backup.</div>${line("Arbeitsblöcke", pendingImport.sessions.length)}${line("Pausen", pendingImport.breaks.length)}${line("Abwesenheiten", pendingImport.absences.length)}${line("Sollzeitregeln", pendingImport.schedules.length)}${line("Feiertagsregeln", pendingImport.overrides.length)}${line("Saldoanpassungen", pendingImport.adjustments.length)}${line("Anfangsstichtag", pendingImport.initial.date)}<p class="note">${C.activeSession(pendingImport) ? "Das Backup enthält eine laufende Erfassung. Sie wird mit ihrem ursprünglichen Zeitstempel fortgesetzt." : ""}</p><div class="actions"><button id="confirm-import" class="danger">Alle Daten ersetzen</button><button data-action="cancel">Abbrechen</button></div>`,
      );
      $("#confirm-import").onclick = async () => {
        if (
          await save(() => structuredClone(pendingImport), {
            expected: importRevision,
            message: "Backup vollständig wiederhergestellt.",
          })
        )
          pendingImport = null;
      };
    }
  } catch (e2) {
    err(e2);
  }
});
document.addEventListener("input", (e) => {
  const form = e.target.closest("form");
  if (form) form.dataset.dirty = "true";
});
document.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target,
    v = Object.fromEntries(new FormData(form)),
    expected =
      form.dataset.revision !== undefined
        ? Number(form.dataset.revision)
        : revision;
  try {
    if (form.getAttribute("id") === "csv-form") {
      download(
        C.csv(data, v.from, v.to),
        `TimeCount-${v.from}-${v.to}.csv`,
        "text/csv;charset=utf-8",
      );
      return;
    }
    if (form.getAttribute("id") === "session-form") {
      const start = stamp(v.start),
        end = v.end ? stamp(v.end) : null,
        date = C.dateKey(new Date(start));
      if (end !== null && C.dateKey(new Date(end)) !== date)
        throw Error(
          "Beginn und Ende müssen am selben Tag liegen. Bitte den über Mitternacht laufenden Block ausdrücklich korrigieren.",
        );
      if (
        start > Date.now() + 60000 ||
        (end !== null && end > Date.now() + 60000)
      )
        throw Error("Arbeitszeiten dürfen nicht in der Zukunft liegen.");
      const now = Date.now(),
        sessionId = v.id || id();
      const pauses = [...form.querySelectorAll(".pause-row")].map((row) => ({
        id: row.querySelector("[name=pause-id]").value || id(),
        sessionId,
        start: stamp(row.querySelector("[name=pause-start]").value),
        end: row.querySelector("[name=pause-end]").value
          ? stamp(row.querySelector("[name=pause-end]").value)
          : null,
        createdAt: now,
        modifiedAt: now,
      }));
      await save(
        (d) => {
          const old = d.sessions.find((s) => s.id === sessionId);
          const s = {
            id: sessionId,
            date,
            start,
            end,
            factor: Number(v.factor),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            comment: v.comment,
            createdAt: old?.createdAt ?? now,
            modifiedAt: now,
          };
          d.sessions = d.sessions.filter((s) => s.id !== sessionId);
          d.sessions.push(s);
          pauses.forEach(
            (p) =>
              (p.createdAt =
                d.breaks.find((b) => b.id === p.id)?.createdAt ?? now),
          );
          d.breaks = d.breaks.filter((b) => b.sessionId !== sessionId);
          d.breaks.push(...pauses);
          return d;
        },
        { expected },
      );
    }
    if (form.getAttribute("id") === "absence-form") {
      if (!C.validDate(v.from) || !C.validDate(v.to) || v.to < v.from)
        throw Error("Bitte einen gültigen Abwesenheitszeitraum auswählen.");
      await save(
        (d) => {
          d.absences = d.absences.filter((a) => a.id !== v.id);
          for (const date of C.dates(v.from, v.to)) {
            if (d.absences.some((a) => a.date === date))
              throw Error(
                `Am ${date} besteht bereits eine Abwesenheit. Es wurde nichts geändert.`,
              );
            d.absences.push({
              id: id(),
              date,
              type: v.type,
              comment: v.comment,
            });
          }
          return d;
        },
        { expected },
      );
    }
    if (form.getAttribute("id") === "override-form")
      await save(
        (d) => {
          d.overrides = d.overrides.filter((o) => o.date !== v.date);
          if (v.kind !== "auto")
            d.overrides.push({
              id: id(),
              date: v.date,
              kind: v.kind,
              name: v.name.trim(),
            });
          return d;
        },
        { expected },
      );
    if (form.getAttribute("id") === "schedule-form") {
      const weeklyMs = C.parseDuration(v.hours);
      await save(
        (d) => {
          d.schedules = d.schedules.filter((s) => s.id !== v.id);
          d.schedules.push({
            id: v.id || id(),
            from: v.from,
            weeklyMs,
            days: [1, 2, 3, 4, 5],
            modifiedAt: Date.now(),
          });
          return d;
        },
        { expected },
      );
    }
    if (form.getAttribute("id") === "initial-form") {
      const amountMs = C.parseDuration(v.amount);
      await save(
        (d) => {
          d.initial = { id: "initial", date: v.date, amountMs };
          return d;
        },
        { expected },
      );
    }
    if (form.getAttribute("id") === "adjustment-form") {
      const amountMs = C.parseDuration(v.amount);
      await save(
        (d) => {
          d.adjustments = d.adjustments.filter((a) => a.id !== v.id);
          d.adjustments.push({
            id: v.id || id(),
            date: v.date,
            amountMs,
            comment: v.comment,
          });
          return d;
        },
        { expected },
      );
    }
    if (form.getAttribute("id") === "settings-form")
      await save(
        (d) => {
          d.settings = {
            ...d.settings,
            state: v.state,
            theme: v.theme,
            localHolidays: {
              assumption: v.assumption === "on",
              augsburg: v.augsburg === "on",
              corpusChristi: v.corpusChristi === "on",
            },
          };
          return d;
        },
        { expected },
      );
  } catch (error) {
    err(error);
  }
});
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
  if (data && currentView() === "settings") render();
});
async function offlineStatus() {
  const el = $("#offline-status");
  if (!el) return;
  try {
    const cache = await caches.open("timecount-v1");
    const files = await cache.keys();
    el.textContent =
      files.length >= 10
        ? "Offline-Dateien sind auf diesem Gerät gespeichert."
        : "Offline-Dateien sind noch nicht vollständig gespeichert. Bitte beim ersten Laden online bleiben.";
  } catch {
    el.textContent =
      "Offline-Speicherung nicht verfügbar. Bitte Browserberechtigungen prüfen.";
  }
}
navigator.serviceWorker?.addEventListener("message", (event) => {
  if (event.data === "PREPARE_UPDATE" && event.ports[0]) {
    updateRequested = true;
    syncTrackButtons();
    const ready = () => {
      if (busy) {
        setTimeout(ready, 25);
        return;
      }
      event.ports[0].postMessage("READY");
      event.ports[0].close();
    };
    ready();
  }
  if (event.data === "UPDATE_CANCELLED") {
    updateRequested = false;
    syncTrackButtons();
    notify(
      "Update konnte noch nicht übernommen werden. Bitte andere App-Tabs schließen und erneut versuchen.",
      true,
    );
  }
});
async function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register("./sw.js", {
      type: "module",
    });
    function waiting() {
      if (reg.waiting) {
        waitingWorker = reg.waiting;
        notify(
          "Ein App-Update ist verfügbar. Du kannst es in den Einstellungen übernehmen.",
        );
        if (data && currentView() === "settings" && !dialog.open) render();
      }
    }
    waiting();
    reg.addEventListener("updatefound", () =>
      reg.installing?.addEventListener("statechange", waiting),
    );
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!reloading) {
        reloading = true;
        location.reload();
      }
    });
    await navigator.serviceWorker.ready;
    offlineStatus();
  } catch (e) {
    notify("Offline-Vorbereitung fehlgeschlagen: " + e.message, true);
  }
}
setInterval(() => {
  if (!data || document.hidden) return;
  const drift = Date.now() - baseClock - (performance.now() - baseMono);
  if (Math.abs(drift) > 120000 && !clockWarning) {
    clockWarning = true;
    if (currentView() === "today") $("#clock-warning").innerHTML = warnings();
  }
  if (currentView() === "today") {
    const v = todayValues().values;
    document
      .querySelectorAll("[data-live]")
      .forEach((el) => (el.textContent = v[el.dataset.live]));
    const currentDate = $("[data-action=day]")?.dataset.date;
    if (currentDate !== today()) render();
  }
}, 1000);
try {
  ({ data, revision } = await load());
  render();
  registerSW();
} catch (e) {
  app.innerHTML =
    '<div class="warning"><h1>Speicherung nicht verfügbar</h1><p>TimeCount benötigt IndexedDB. Bitte privaten Modus, freien Speicher und Browserberechtigungen prüfen und die Seite erneut laden. Es werden keine Aktionen nur scheinbar gespeichert.</p><button data-action="reload">Erneut versuchen</button></div>';
  document.addEventListener("click", (e) => {
    if (e.target.dataset.action === "reload") location.reload();
  });
  err(e);
}
