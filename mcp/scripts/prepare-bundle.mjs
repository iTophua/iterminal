#!/usr/bin/env node
/**
 * 准备打进 Tauri app bundle 的 MCP server 产物（src-tauri/mcp-bundle/）：
 *   dist/            —— tsc 构建输出（调用方保证已构建，或在本脚本里构建）
 *   node_modules/    —— 仅生产依赖（@modelcontextprotocol/sdk；不带 typescript 等 dev 依赖）
 *   package.json     —— 只含 type:module + dependencies，供 node 解析 ESM
 *
 * node_modules 有简单缓存：sdk 主版本没变且目录存在时跳过 npm install，本地反复 build 不用等网络。
 */
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const mcpDir = dirname(dirname(fileURLToPath(import.meta.url)));
const srcPkg = JSON.parse(readFileSync(join(mcpDir, "package.json"), "utf-8"));
const outDir = join(mcpDir, "..", "src-tauri", "mcp-bundle");
const cacheDir = outDir + ".nm-cache";

// 1. dist：不存在则现场构建（正常流程 beforeBuild 已构建过）。
//    干净环境（如 build-pro.sh 直接构建）mcp 依赖也可能缺失，一并兜底安装。
if (!existsSync(join(mcpDir, "dist", "index.js"))) {
  if (!existsSync(join(mcpDir, "node_modules"))) {
    execSync("npm install --no-audit --no-fund", { cwd: mcpDir, stdio: "inherit" });
  }
  execSync("npm run build", { cwd: mcpDir, stdio: "inherit" });
}

// 2. 缓存判断：已装 sdk 主版本与 package.json 要求一致 → 整个 node_modules 复用
const sdkWanted = srcPkg.dependencies["@modelcontextprotocol/sdk"];
const installedVersionPath = join(outDir, "node_modules", "@modelcontextprotocol", "sdk", "package.json");
let cacheHit = false;
if (existsSync(installedVersionPath)) {
  try {
    const installed = JSON.parse(readFileSync(installedVersionPath, "utf-8")).version;
    cacheHit = installed.split(".")[0] === sdkWanted.replace(/^\^/, "").split(".")[0];
  } catch {
    cacheHit = false;
  }
}
if (cacheHit) {
  mkdirSync(cacheDir, { recursive: true });
  renameSync(join(outDir, "node_modules"), join(cacheDir, "node_modules"));
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
cpSync(join(mcpDir, "dist"), join(outDir, "dist"), { recursive: true });

// 3. 精简 package.json（只保留运行必需字段）
const bundlePkg = {
  name: "iterminal-mcp-bundle",
  private: true,
  type: "module",
  dependencies: srcPkg.dependencies, // 仅 @modelcontextprotocol/sdk
};
writeFileSync(join(outDir, "package.json"), JSON.stringify(bundlePkg, null, 2));

if (cacheHit) {
  renameSync(join(cacheDir, "node_modules"), join(outDir, "node_modules"));
  rmSync(cacheDir, { recursive: true, force: true });
  console.log("[prepare-bundle] node_modules 缓存命中，跳过 install");
} else {
  execSync("npm install --omit=dev --ignore-scripts --no-audit --no-fund", { cwd: outDir, stdio: "inherit" });
}

console.log("[prepare-bundle] 完成 ->", outDir);
