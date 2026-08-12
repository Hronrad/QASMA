import {readFile, readdir} from "node:fs/promises";
import {extname, join} from "node:path";

const root = new URL("../", import.meta.url).pathname;
const required = [
  "README.md", "index.html", "vercel.json", "scripts/build.mjs",
  "architecture/qasma-v3.2.json", "workbench/index.html",
  "workbench/dashboard.html", "workbench/candidates.html", "workbench/events.html",
  "workbench/data/runs.json", "workbench/data/demo-run.json",
  "assets/qasma-system-architecture.png", "assets/qasma-search-loop.png",
  "assets/qasma-validation-evidence.png", "assets/qasma-workbench.png",
];

for (const file of required) await readFile(join(root, file));
JSON.parse(await readFile(join(root, "architecture/qasma-v3.2.json"), "utf8"));
JSON.parse(await readFile(join(root, "workbench/data/runs.json"), "utf8"));
JSON.parse(await readFile(join(root, "workbench/data/demo-run.json"), "utf8"));
const vercel = JSON.parse(await readFile(join(root, "vercel.json"), "utf8"));
if (vercel.buildCommand !== "npm run build" || vercel.outputDirectory !== "dist") {
  throw new Error("Vercel 必须通过 npm run build 发布 dist 目录。");
}

async function walk(directory) {
  const entries = await readdir(directory, {withFileTypes: true});
  return (await Promise.all(entries.map(entry => entry.isDirectory()
    ? walk(join(directory, entry.name)) : [join(directory, entry.name)]))).flat();
}

const files = (await walk(root)).filter(file => !file.includes("/.git/"));
const forbidden = files.filter(file => extname(file) === ".py" || file.includes("/docs/"));
if (forbidden.length) throw new Error(`发现禁止公开的内容：${forbidden.join(", ")}`);
process.stdout.write(`检查通过：${files.length} 个公开文件，无 Python 或 docs 目录。\n`);
