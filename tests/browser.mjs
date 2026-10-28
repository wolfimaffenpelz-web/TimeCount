import { chromium } from "playwright";
import { testUpdate } from "./pwa-update.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
const port = 4180,
  origin = `http://127.0.0.1:${port}`,
  root = new URL("..", import.meta.url).pathname;
const server = spawn(process.execPath, ["server.mjs"], {
  cwd: root,
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let browser;
const errors = [];
let passed = 0;
async function check(name, fn) {
  await fn();
  passed++;
  console.log("✓ " + name);
}
try {
  await new Promise((resolve, reject) => {
    server.stdout.once("data", resolve);
    server.once("error", reject);
    server.once("exit", (code) => reject(Error("Server beendet: " + code)));
  });
  const executablePath =
    process.env.CHROMIUM_PATH ||
    (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
  browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    acceptDownloads: true,
  });
  const page = await context.newPage();
  context.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  await page.waitForFunction(
    () =>
      document.querySelector(".status") && navigator.serviceWorker.controller,
  );
  await page.waitForLoadState("networkidle");
  await check("Mobile Startseite, kein horizontaler Überlauf", async () => {
    assert.equal(
      await page.locator(".status").textContent(),
      "Nicht gestartet",
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
  });
  await check("Start und persistente Erfassung nach Reload", async () => {
    await page
      .getByRole("button", { name: "Arbeit starten", exact: true })
      .click();
    await page.getByText("Arbeit läuft", { exact: true }).waitFor();
    const start = await page.evaluate(async () => {
      const { load } = await import("/src/db.js");
      return (await load()).data.sessions[0].start;
    });
    await page.reload();
    await page.getByText("Arbeit läuft", { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(async () => {
        const { load } = await import("/src/db.js");
        return (await load()).data.sessions[0].start;
      }),
      start,
    );
  });
  await check(
    "Pause bleibt bei Neustart und kann mit Arbeit beendet werden",
    async () => {
      await page
        .getByRole("button", { name: "Pause starten", exact: true })
        .click();
      await page.getByText("Pause läuft", { exact: true }).waitFor();
      await page.reload();
      await page.getByText("Pause läuft", { exact: true }).waitFor();
      await page
        .getByRole("button", { name: "Arbeit beenden", exact: true })
        .click();
      await page.getByText("Arbeitstag beendet", { exact: true }).waitFor();
      const state = await page.evaluate(async () => {
        const { load } = await import("/src/db.js");
        return (await load()).data;
      });
      assert.ok(state.sessions[0].end > state.sessions[0].start);
      assert.equal(state.breaks[0].end, state.sessions[0].end);
    },
  );
  await check("Weiterer Block und Pause fortsetzen", async () => {
    await page
      .getByRole("button", { name: "Weitere Arbeit starten", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Pause starten", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Pause beenden", exact: true })
      .click();
    await page.getByText("Arbeit läuft", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Arbeit beenden", exact: true })
      .click();
    await page.getByText("Arbeitstag beendet", { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(async () => {
        const { load } = await import("/src/db.js");
        return (await load()).data.sessions.length;
      }),
      2,
    );
  });
  await check("Kalender und Tageskorrektur mit Faktor", async () => {
    await page.getByRole("link", { name: "Kalender", exact: true }).click();
    const date = await page.evaluate(() => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    });
    await page.locator("#calendar-month").fill(date.slice(0, 7));
    await page.locator(`[data-action=day][data-date="${date}"]`).click();
    await page
      .getByRole("button", { name: "Arbeitsblock ergänzen", exact: true })
      .click();
    await page.locator("#session-start").fill(date + "T08:00");
    await page.locator("#session-end").fill(date + "T10:00");
    await page.locator("#session-factor").fill("1.5");
    await page
      .getByRole("button", { name: "Arbeitsblock speichern", exact: true })
      .click();
    await page.waitForFunction(() => !document.querySelector("dialog").open);
    const day = await page.evaluate(async (date) => {
      const { load } = await import("/src/db.js");
      const { day } = await import("/src/core.js");
      return day((await load()).data, date);
    }, date);
    assert.equal(day.raw, 7200000);
    assert.equal(day.credited, 10800000);
  });
  await check(
    "Abwesenheit, Feiertagsüberschreibung und Löschen mit Bestätigung",
    async () => {
      const first = page.locator(".day").first();
      await first.click();
      await page.locator("#absence-type").selectOption("sick");
      await page
        .getByRole("button", { name: "Abwesenheit speichern", exact: true })
        .click();
      await page.waitForFunction(() => !document.querySelector("dialog").open);
      await first.click();
      await page.locator("#holiday-name").fill("Lokaler Testfeiertag");
      await page
        .getByRole("button", { name: "Feiertagsregel speichern", exact: true })
        .click();
      await page.waitForFunction(() => !document.querySelector("dialog").open);
      await first.click();
      await page
        .getByRole("button", { name: "Abwesenheit löschen", exact: true })
        .click();
      assert.equal(
        await page
          .locator("dialog")
          .getByText("Dieser Eintrag wird dauerhaft gelöscht.", {
            exact: false,
          })
          .count(),
        1,
      );
      await page
        .getByRole("button", { name: "Abbrechen", exact: true })
        .click();
      assert.equal(
        await page.evaluate(async () => {
          const { load } = await import("/src/db.js");
          return (await load()).data.absences.length;
        }),
        1,
      );
    },
  );
  await check(
    "Historische Sollzeit und getrennte Saldoanpassung über Formulare",
    async () => {
      await page
        .getByRole("link", { name: "Einstellungen", exact: true })
        .click();
      await page.locator("#schedule-from").fill("2027-01-01");
      await page.locator("#schedule-hours").fill("40:00");
      await page
        .getByRole("button", { name: "Neue Regel speichern", exact: true })
        .click();
      await page.getByText("Ab 2027-01-01", { exact: false }).waitFor();
      await page.locator("#adjust-amount").fill("-02:15");
      await page.locator("#adjust-comment").fill("Testkorrektur");
      await page
        .getByRole("button", { name: "Anpassung speichern", exact: true })
        .click();
      await page.getByText("Testkorrektur", { exact: false }).waitFor();
      const d = await page.evaluate(async () => {
        const { load } = await import("/src/db.js");
        return (await load()).data;
      });
      assert.equal(d.schedules.length, 2);
      assert.equal(d.adjustments[0].amountMs, -8100000);
    },
  );
  let backupText;
  await check(
    "Vollständiges JSON-Backup und Import-Vorschau / Abbruch",
    async () => {
      const event = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "JSON-Backup herunterladen", exact: true })
        .click();
      const download = await event;
      backupText = await readFile(await download.path(), "utf8");
      const parsed = JSON.parse(backupText);
      assert.equal(parsed.schemaVersion, 1);
      assert.equal(parsed.sessions.length, 3);
      await page.locator("#import-file").setInputFiles({
        name: "backup.json",
        mimeType: "application/json",
        buffer: Buffer.from(backupText),
      });
      await page
        .getByRole("button", { name: "Alle Daten ersetzen", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "Abbrechen", exact: true })
        .click();
      assert.equal(
        await page.evaluate(async () => {
          const { load } = await import("/src/db.js");
          return (await load()).data.sessions.length;
        }),
        3,
      );
    },
  );
  await check("Beschädigtes Backup verändert keine Daten", async () => {
    await page.locator("#import-file").setInputFiles({
      name: "bad.json",
      mimeType: "application/json",
      buffer: Buffer.from("{bad"),
    });
    await page
      .getByRole("status")
      .filter({ hasText: "kein gültiges JSON" })
      .waitFor();
    assert.equal(
      await page.evaluate(async () => {
        const { load } = await import("/src/db.js");
        return (await load()).data.sessions.length;
      }),
      3,
    );
  });
  await check(
    "Import ersetzt Daten transaktional und vollständig",
    async () => {
      const saved = JSON.parse(backupText);
      saved.adjustments = [];
      await page.locator("#import-file").setInputFiles({
        name: "restore.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(saved)),
      });
      await page
        .getByRole("button", { name: "Alle Daten ersetzen", exact: true })
        .click();
      await page.waitForFunction(() => !document.querySelector("dialog").open);
      const d = await page.evaluate(async () => {
        const { load } = await import("/src/db.js");
        return (await load()).data;
      });
      assert.equal(d.adjustments.length, 0);
      assert.deepEqual(d.sessions, saved.sessions);
    },
  );
  await check("Wochen- und Monatsauswertung und CSV-Download", async () => {
    await page.getByRole("link", { name: "Auswertung", exact: true }).click();
    await page
      .getByRole("heading", { name: "Wochenübersicht", exact: true })
      .waitFor();
    await page
      .getByRole("heading", { name: "Monatsübersicht", exact: true })
      .waitFor();
    const event = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "CSV herunterladen", exact: true })
      .click();
    const file = await event;
    const csv = await readFile(await file.path(), "utf8");
    assert.ok(csv.startsWith("\uFEFF"));
    assert.ok(csv.includes("Angerechnet"));
    assert.ok(csv.includes(";"));
  });
  await check(
    "IndexedDB: abgebrochene und unplausible Änderungen werden vollständig zurückgerollt",
    async () => {
      const result = await page.evaluate(async () => {
        const { load, update } = await import("/src/db.js");
        const before = await load();
        let rejected = 0;
        try {
          await update((d) => {
            d.sessions = [];
            throw Error("Abgebrochener Import");
          });
        } catch {
          rejected++;
        }
        try {
          await update((d) => {
            d.sessions.push({ ...d.sessions[0], id: "overlap" });
            return d;
          });
        } catch {
          rejected++;
        }
        const after = await load();
        return {
          rejected,
          before: JSON.stringify(before),
          after: JSON.stringify(after),
        };
      });
      assert.equal(result.rejected, 2);
      assert.equal(result.before, result.after);
    },
  );
  await check(
    "Simulierter voller Speicher meldet Fehler und speichert keine scheinbar erfolgreiche Aktion",
    async () => {
      await page.getByRole("link", { name: "Heute", exact: true }).click();
      const before = await page.evaluate(async () => {
        const { load } = await import("/src/db.js");
        window.originalPut = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args) {
          if (this.name === "sessions")
            throw new DOMException("Test: Speicher voll", "QuotaExceededError");
          return window.originalPut.apply(this, args);
        };
        return JSON.stringify(await load());
      });
      await page
        .getByRole("button", { name: "Weitere Arbeit starten", exact: true })
        .click();
      await page
        .getByRole("status")
        .filter({ hasText: "Gerätespeicher voll" })
        .waitFor();
      await page.evaluate(() => {
        IDBObjectStore.prototype.put = window.originalPut;
        delete window.originalPut;
      });
      const after = await page.evaluate(async () => {
        const { load } = await import("/src/db.js");
        return JSON.stringify(await load());
      });
      assert.equal(before, after);
      await page.getByText("Arbeitstag beendet", { exact: true }).waitFor();
    },
  );
  const other = await context.newPage();
  await other.goto(origin);
  await other.waitForFunction(() => document.querySelector(".status"));
  await check(
    "Zwei Tabs: konkurrierende Änderungen mit gleicher Version ergeben genau einen Commit",
    async () => {
      const rev = await page.evaluate(async () => {
        const { load } = await import("/src/db.js");
        return (await load()).revision;
      });
      const change = (rev) =>
        import("/src/db.js").then(({ update }) =>
          update((d) => {
            d.settings.theme = "dark";
            return d;
          }, rev).then(
            () => true,
            () => false,
          ),
        );
      const results = await Promise.all([
        page.evaluate(change, rev),
        other.evaluate(change, rev),
      ]);
      assert.equal(results.filter(Boolean).length, 1);
    },
  );
  await check(
    "Veraltetes Tagesformular überschreibt keine Änderung eines anderen Tabs",
    async () => {
      await page
        .getByRole("button", { name: "Tag bearbeiten", exact: true })
        .click();
      await page.locator("[data-action=session-edit]").first().click();
      await page
        .locator("#session-comment")
        .fill("Darf nicht gespeichert werden");
      await other.evaluate(async () => {
        const { update } = await import("/src/db.js");
        await update((d) => {
          d.settings.theme = "light";
          return d;
        });
      });
      await page
        .getByRole("button", { name: "Arbeitsblock speichern", exact: true })
        .click();
      await page
        .getByRole("status")
        .filter({ hasText: "anderen Tab geändert" })
        .waitFor();
      assert.equal(
        await page.evaluate(async () => {
          const { load } = await import("/src/db.js");
          return (await load()).data.sessions.some(
            (s) => s.comment === "Darf nicht gespeichert werden",
          );
        }),
        false,
      );
      await page
        .getByRole("button", { name: "Schließen", exact: true })
        .click();
    },
  );
  await check(
    "Zwei Tabs: genau eine aktive Erfassung auch bei parallelem Start",
    async () => {
      const start = () =>
        Promise.all([import("/src/db.js"), import("/src/core.js")]).then(
          ([{ update }, { transition }]) =>
            update((d) => transition(d, "start")).then(
              () => true,
              () => false,
            ),
        );
      const results = await Promise.all([
        page.evaluate(start),
        other.evaluate(start),
      ]);
      assert.equal(results.filter(Boolean).length, 1);
      const count = await page.evaluate(async () => {
        const { load } = await import("/src/db.js");
        return (await load()).data.sessions.filter((s) => s.end === null)
          .length;
      });
      assert.equal(count, 1);
    },
  );
  await other.close();
  await page.goto(origin);
  await page.getByText("Arbeit läuft", { exact: true }).waitFor();
  await check(
    "Offline-Neustart mit Service Worker und erhaltener Erfassung",
    async () => {
      await context.setOffline(true);
      await page.reload();
      await page.getByText("Arbeit läuft", { exact: true }).waitFor();
      await page
        .getByRole("button", { name: "Pause starten", exact: true })
        .click();
      await page.getByText("Pause läuft", { exact: true }).waitFor();
      await page.reload();
      await page.getByText("Pause läuft", { exact: true }).waitFor();
      await page
        .getByRole("button", { name: "Pause beenden", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Arbeit beenden", exact: true })
        .click();
      await page.getByText("Arbeitstag beendet", { exact: true }).waitFor();
      await context.setOffline(false);
    },
  );
  await check(
    "Responsive Ansicht, Dunkelmodus und lokale PWA-Assets",
    async () => {
      await page
        .getByRole("link", { name: "Einstellungen", exact: true })
        .click();
      await page.locator("#theme").selectOption("light");
      await page
        .getByRole("button", { name: "Einstellungen speichern", exact: true })
        .click();
      await page.getByRole("link", { name: "Heute", exact: true }).click();
      await mkdir(new URL("../.test-results", import.meta.url), {
        recursive: true,
      });
      await page.screenshot({
        path: new URL("../.test-results/mobile.png", import.meta.url).pathname,
        fullPage: true,
      });
      await page.setViewportSize({ width: 1280, height: 900 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await page.screenshot({
        path: new URL("../.test-results/desktop.png", import.meta.url).pathname,
        fullPage: true,
      });
      const assets = await page.evaluate(async () => {
        const c = await caches.open("timecount-v1");
        return (await c.keys()).length;
      });
      assert.equal(assets, 11);
    },
  );
  await check(
    "App-Update wartet auf Übernahme und bewahrt laufende Pause und Offlinebetrieb",
    () => testUpdate(browser),
  );
  assert.deepEqual(errors, [], "Keine unbehandelten Browserfehler");
  console.log(
    `\n${passed} Browserprüfungen bestanden; keine unbehandelten JavaScript-Fehler.`,
  );
} catch (e) {
  for (const c of browser?.contexts() || [])
    for (const p of c.pages())
      console.error(
        "Browserstatus:",
        await p.locator("#notice").textContent(),
        await p.locator("dialog").textContent(),
        await p.locator("dialog input").evaluateAll((xs) =>
          xs.map((x) => ({
            name: x.name,
            value: x.value,
            valid: x.validity.valid,
            message: x.validationMessage,
            disabled: x.disabled,
          })),
        ),
      );
  throw e;
} finally {
  await browser?.close();
  server.kill();
}
