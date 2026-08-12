import {createReadStream, statSync} from "node:fs";
import {createServer} from "node:http";
import {extname, join, normalize} from "node:path";

const root = new URL("../", import.meta.url).pathname;
const port = Number(process.env.PORT || 4173);
const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

createServer((request, response) => {
  const requested = request.url === "/" ? "/index.html" : request.url.split("?")[0];
  const relative = normalize(decodeURIComponent(requested)).replace(/^(\.\.(\/|\\|$))+/, "");
  const path = join(root, relative);
  if (!path.startsWith(root)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  try {
    if (!statSync(path).isFile()) throw new Error("Not a file");
    response.writeHead(200, {"Content-Type": types[extname(path)] || "application/octet-stream"});
    createReadStream(path).pipe(response);
  } catch {
    response.writeHead(404, {"Content-Type": "text/plain; charset=utf-8"}).end("Not found");
  }
}).listen(port, "127.0.0.1", () => {
  process.stdout.write(`QASMA public workbench: http://127.0.0.1:${port}/\n`);
});
