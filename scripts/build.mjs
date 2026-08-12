import {cp, mkdir, rm, stat} from "node:fs/promises";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, "dist");
const publicEntries = ["index.html", "assets", "architecture", "workbench"];

await rm(output, {recursive: true, force: true});
await mkdir(output, {recursive: true});

for (const entry of publicEntries) {
  await cp(join(root, entry), join(output, entry), {recursive: true});
}

for (const required of [
  "index.html",
  "workbench/index.html",
  "workbench/common.js",
  "workbench/data/runs.json",
  "architecture/qasma-v3.2.json",
]) {
  const info = await stat(join(output, required));
  if (!info.isFile()) throw new Error(`构建输出缺少 ${required}`);
}

process.stdout.write(`Vercel 静态输出已生成：${output}\n`);
