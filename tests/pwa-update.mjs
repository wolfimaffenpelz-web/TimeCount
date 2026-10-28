import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
// Serve two complete releases from memory without editing the checkout.
export async function testUpdate(browser) {
  const root = path.resolve(new URL("..", import.meta.url).pathname);
  let release = "v1";
  const types = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".webmanifest": "application/manifest+json",
    ".png": "image/png",
  };
  const server = createServer(async (req, res) => {
    try {
      const name = new URL(req.url, "http://localhost").pathname;
      const file = path.resolve(
        root,
        "." + (name === "/" ? "/index.html" : name),
      );
      if (!file.startsWith(root + path.sep)) throw Error();
      let content = await readFile(file);
      if (file.endsWith(".js"))
        content = Buffer.from(
          content.toString().replaceAll("timecount-v1", "timecount-" + release),
        );
      res.writeHead(200, {
        "Content-Type": types[path.extname(file)] || "text/plain",
        "Cache-Control": "no-store",
      });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const context = await browser.newContext({ timezoneId: "Europe/Berlin" });
  try {
    const page = await context.newPage(),
      origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(origin);
    await page.waitForFunction(
      () =>
        navigator.serviceWorker.controller && document.querySelector(".status"),
    );
    await page
      .getByRole("button", { name: "Arbeit starten", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Pause starten", exact: true })
      .click();
    await page.getByText("Pause läuft", { exact: true }).waitFor();
    const before = await page.evaluate(async () => {
      const { load } = await import("/src/db.js");
      return JSON.stringify(await load());
    });
    const other = await context.newPage();
    await other.goto(origin);
    await other.getByText("Pause läuft", { exact: true }).waitFor();
    release = "v2";
    await page
      .getByRole("link", { name: "Einstellungen", exact: true })
      .click();
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.getRegistration()).update();
    });
    await page
      .getByRole("button", { name: "Update übernehmen", exact: true })
      .waitFor();
    // A waiting release must not replace the current release's cached files.
    assert.equal(
      await page.evaluate(() =>
        navigator.serviceWorker.getRegistration().then((r) => r.waiting?.state),
      ),
      "installed",
    );
    await page
      .getByRole("button", { name: "Update übernehmen", exact: true })
      .click();
    const reloaded = page.waitForNavigation({ waitUntil: "networkidle" });
    await page
      .getByRole("button", { name: "Jetzt aktualisieren", exact: true })
      .click();
    await reloaded;
    await page.waitForFunction(async () => {
      const keys = await caches.keys();
      return keys.includes("timecount-v2") && !keys.includes("timecount-v1");
    });
    await page.waitForLoadState("networkidle");
    const after = await page.evaluate(async () => {
      const { load } = await import("/src/db.js");
      return JSON.stringify(await load());
    });
    assert.equal(after, before);
    await context.setOffline(true);
    await page.goto(origin + "/#today");
    await page.getByText("Pause läuft", { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(async () => {
        const { load } = await import("/src/db.js");
        return JSON.stringify(await load());
      }),
      before,
    );
  } finally {
    await context.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
