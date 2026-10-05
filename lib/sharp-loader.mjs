/**
 * sharp 加载器（表情制作依赖）。
 *
 * 解析顺序：
 *  1. 裸 import('sharp') —— 能命中插件目录 / 宿主 node_modules 里的 sharp；
 *  2. 显式探测数据根目录 data/runtime-deps/node_modules/sharp（跨账号共享、重装插件不丢）；
 *  3. 都没有则自动 npm install 到 runtime-deps（默认源失败换 npmmirror），装完再试。
 *
 * 自动安装对 Linux 服务器部署友好：换机器 / 换系统后首次使用会自动装对应平台的原生包。
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const SHARP_VERSION = '^0.34.3';
const INSTALL_TIMEOUT_MS = 600_000;

let cachedSharp = null;
let installPromise = null;

export function runtimeDepsDir(dataPath) {
  // dataPath = <宿主>/data/<账号>/<插件ID> → 数据根 <宿主>/data
  return path.resolve(String(dataPath || '.'), '..', '..', 'runtime-deps');
}

function sharpEntryCandidates(dataPath) {
  const dirs = [runtimeDepsDir(dataPath)];
  const list = [];
  for (const dir of dirs) {
    for (const rel of ['lib/index.js', 'lib/sharp.js']) {
      list.push(path.join(dir, 'node_modules', 'sharp', ...rel.split('/')));
    }
  }
  return list;
}

async function tryImportFile(file) {
  try {
    if (!fs.existsSync(file)) return null;
    const mod = await import(pathToFileURL(file).href);
    return mod.default || mod;
  } catch {
    return null;
  }
}

async function probeDirect() {
  try {
    const mod = await import('sharp');
    const sharp = mod.default || mod;
    if (typeof sharp === 'function') return sharp;
  } catch { /* not installed */ }
  return null;
}

async function loadSharpRaw(dataPath) {
  if (cachedSharp) return cachedSharp;
  const direct = await probeDirect();
  if (direct) {
    cachedSharp = direct;
    return direct;
  }
  for (const file of sharpEntryCandidates(dataPath)) {
    const sharp = await tryImportFile(file);
    if (sharp) {
      cachedSharp = sharp;
      return sharp;
    }
  }
  return null;
}

function runNpm(args, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    let child;
    try {
      child = spawn(cmd, args, { cwd, shell: process.platform === 'win32', windowsHide: true });
    } catch (e) {
      resolve({ ok: false, error: e?.message });
      return;
    }
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      resolve({ ok: false, error: `npm install 超时（${timeoutMs}ms）` });
    }, timeoutMs);
    child.stdout?.on('data', (d) => { stdout += String(d); });
    child.stderr?.on('data', (d) => { stderr += String(d); });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, error: e?.message || 'npm 启动失败' });
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, error: code === 0 ? '' : `npm exit ${code}: ${(stderr || stdout).slice(-400)}` });
    });
  });
}

/** 自动安装 sharp 到数据根 runtime-deps（并发只装一次） */
export async function ensureSharpInstalled(dataPath, logger) {
  const dir = runtimeDepsDir(dataPath);
  if (installPromise) return installPromise;
  installPromise = (async () => {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const pkgFile = path.join(dir, 'package.json');
      if (!fs.existsSync(pkgFile)) {
        fs.writeFileSync(pkgFile, JSON.stringify({ name: 'kakake-runtime-deps', private: true, dependencies: { sharp: SHARP_VERSION } }, null, 2), 'utf-8');
      }
      logger?.info?.('[bqb] 未找到 sharp，开始自动安装（首次约 1-2 分钟）…');
      let r = await runNpm(['install', '--no-audit', '--no-fund', `sharp@${SHARP_VERSION}`], dir, INSTALL_TIMEOUT_MS);
      if (!r.ok) {
        logger?.warn?.(`[bqb] 默认源安装失败，改用 npmmirror 重试: ${r.error}`);
        r = await runNpm(['install', '--no-audit', '--no-fund', `--registry=https://registry.npmmirror.com`, `sharp@${SHARP_VERSION}`], dir, INSTALL_TIMEOUT_MS);
      }
      if (!r.ok) {
        logger?.error?.(`[bqb] sharp 自动安装失败: ${r.error}。请手动进入 ${dir} 执行 npm install sharp`);
        return false;
      }
      logger?.info?.('[bqb] sharp 安装完成');
      return true;
    } finally {
      installPromise = null;
    }
  })();
  return installPromise;
}

/**
 * 取 sharp；没有时触发自动安装并返回 null（调用方提示用户稍后再试）。
 * autoInstall=true 时允许触发安装。
 */
export async function getSharp(dataPath, logger, { autoInstall = true } = {}) {
  let sharp = await loadSharpRaw(dataPath);
  if (sharp) return sharp;
  if (!autoInstall) return null;
  const installed = await ensureSharpInstalled(dataPath, logger);
  if (!installed) return null;
  return loadSharpRaw(dataPath);
}

/** 只探测是否可用，不触发安装 */
export async function probeSharp(dataPath) {
  return loadSharpRaw(dataPath);
}
