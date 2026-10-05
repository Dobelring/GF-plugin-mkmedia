/**
 * 可选代理 fetch —— 仅供 YouTube / TikTok 解析与媒体下载使用。
 *
 * 大陆服务器直连 youtube.com / tiktok.com 不通；Node 内置 fetch 既不读
 * HTTP_PROXY 环境变量（NODE_USE_ENV_PROXY 要 Node 24+），也没有公开的
 * dispatcher 注入途径，所以用 npm 的 undici（ProxyAgent + fetch），
 * 与 sharp 一起自动装在数据根 data/runtime-deps/。
 *
 * 国内平台（B站/抖音/小红书/快手）不走代理，保持直连。
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

let cached = null; // { key: proxyUrl, fetch: fn }

function runtimeDepsDir(dataPath) {
  // dataPath = <宿主>/data/<账号>/<插件ID> → 数据根 <宿主>/data
  return path.resolve(String(dataPath || '.'), '..', '..', 'runtime-deps');
}

async function tryLoadUndici(dataPath) {
  // 1) 裸 import：能命中插件目录/宿主 node_modules 解析链
  try {
    const mod = await import('undici');
    const u = mod.default ?? mod;
    if (typeof u?.fetch === 'function' && u?.ProxyAgent) return u;
  } catch { /* 未安装 */ }
  // 2) 数据根 runtime-deps
  for (const rel of ['lib/index.js', 'index.js']) {
    const file = path.join(runtimeDepsDir(dataPath), 'node_modules', 'undici', ...rel.split('/'));
    try {
      if (!fs.existsSync(file)) continue;
      const mod = await import(pathToFileURL(file).href);
      const u = mod.default ?? mod;
      if (typeof u?.fetch === 'function' && u?.ProxyAgent) return u;
    } catch { /* 试下一个 */ }
  }
  return null;
}

/**
 * 取「走代理的 fetch」函数；代理未配置或 undici 不可用时返回 null（调用方回退直连）。
 * 同一代理地址只建一次连接池。
 */
export async function getProxiedFetch(dataPath, proxyUrl, logger) {
  const proxy = String(proxyUrl || '').trim();
  if (!/^https?:\/\//i.test(proxy)) return null;
  if (cached && cached.key === proxy) return cached.fetch;

  let undici = await tryLoadUndici(dataPath);
  if (!undici) {
    // 与 sharp 共用 runtime-deps 自动安装器（其中包含 undici）
    const { ensureSharpInstalled } = await import('./sharp-loader.mjs');
    const ok = await ensureSharpInstalled(dataPath, logger);
    if (ok) undici = await tryLoadUndici(dataPath);
  }
  if (!undici) {
    logger?.warn?.('[代理] undici 组件不可用，YouTube/TikTok 将直连尝试（大陆服务器大概率失败）');
    return null;
  }
  const agent = new undici.ProxyAgent(proxy);
  const proxied = (url, opts = {}) => undici.fetch(url, { ...opts, dispatcher: agent });
  cached = { key: proxy, fetch: proxied };
  logger?.info?.(`[代理] YouTube/TikTok 解析将经由 ${proxy}`);
  return proxied;
}
