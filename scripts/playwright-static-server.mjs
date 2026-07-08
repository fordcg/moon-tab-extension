// @ts-check
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

const root = path.resolve(process.cwd(), "dist");
const host = process.env.PLAYWRIGHT_STATIC_HOST || "127.0.0.1";
const port = Number(process.env.PLAYWRIGHT_STATIC_PORT || 4173);

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
]);

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url || "/", `http://${host}:${port}`);
  const filePath = resolveFilePath(requestUrl.pathname);
  if (!filePath) {
    response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  const file = await stat(filePath).catch(() => undefined);
  if (!file?.isFile()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "content-length": file.size,
    "content-type": contentTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream",
  });
  createReadStream(filePath).pipe(response);
});

server.listen(port, host, () => {
  console.log(`Playwright static server listening on http://${host}:${port}`);
});

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

function resolveFilePath(pathname) {
  const decodedPath = decodeURIComponent(pathname);
  const normalizedPath = decodedPath === "/" ? "/index.html" : decodedPath;
  const filePath = path.resolve(root, `.${normalizedPath}`);
  return filePath === root || filePath.startsWith(`${root}${path.sep}`) ? filePath : undefined;
}

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
