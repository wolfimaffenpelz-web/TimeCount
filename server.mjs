import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.dirname(fileURLToPath(import.meta.url));
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      const name = decodeURIComponent(url.pathname);
      const file = path.resolve(
        root,
        "." + (name === "/" ? "/index.html" : name),
      );
      if (
        !file.startsWith(root + path.sep) ||
        name.split("/").some((x) => x.startsWith(".")) ||
        (![
          "/index.html",
          "/styles.css",
          "/sw.js",
          "/manifest.webmanifest",
        ].includes(name) &&
          name !== "/" &&
          !name.startsWith("/src/") &&
          !name.startsWith("/icons/"))
      ) {
        res.writeHead(404);
        return res.end();
      }
      const body = await readFile(file);
      res.writeHead(200, {
        "Content-Type": mime[path.extname(file)] || "application/octet-stream",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("Nicht gefunden");
    }
  })
  .listen(Number(process.env.PORT) || 4173, "0.0.0.0", () =>
    console.log("TimeCount läuft auf Port " + (process.env.PORT || 4173)),
  );
