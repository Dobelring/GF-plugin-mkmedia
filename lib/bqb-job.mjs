/**
 * bqb 渲染调度（主线程侧）：优先丢给 sharp worker 线程，worker 不可用时回退进程内渲染。
 */

import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { getSharp } from './sharp-loader.mjs';
import { renderBqb } from './bqb-core.mjs';

const WORKER_FILE = fileURLToPath(new URL('./bqb-worker.mjs', import.meta.url));

let state = null; // { dataPath, assetsDir, logger, worker, workerBroken, pending: Map }

export function initBqbJob({ dataPath, pluginPath, logger }) {
  state = {
    dataPath: String(dataPath || ''),
    assetsDir: path.join(String(pluginPath || ''), 'assets', 'bqb'),
    logger,
    worker: null,
    workerBroken: false,
    pending: new Map(),
    jobId: 0,
  };
  return state;
}

export function bqbAssetsDir() {
  return state?.assetsDir || '';
}

function ensureWorker() {
  if (!state || state.workerBroken) return null;
  if (state.worker) return state.worker;
  try {
    const worker = new Worker(WORKER_FILE, { workerData: { dataPath: state.dataPath } });
    worker.unref?.();
    worker.on('message', (msg) => {
      const rec = state.pending.get(msg?.id);
      if (!rec) return;
      state.pending.delete(msg.id);
      if (msg.ok) rec.resolve({ buffer: Buffer.from(msg.buffer), mime: msg.mime, ext: msg.ext });
      else rec.reject(new Error(msg.error || 'worker 渲染失败'));
    });
    worker.on('error', (err) => {
      state.logger?.warn?.(`[bqb] worker 异常，回退进程内渲染: ${err?.message}`);
      for (const [, rec] of state.pending) rec.reject(Object.assign(new Error('worker crashed'), { workerCrash: true }));
      state.pending.clear();
      state.workerBroken = true;
      state.worker = null;
    });
    worker.on('exit', () => {
      if (state) state.worker = null;
    });
    state.worker = worker;
    return worker;
  } catch (e) {
    state.logger?.warn?.(`[bqb] worker 启动失败，回退进程内渲染: ${e?.message}`);
    state.workerBroken = true;
    return null;
  }
}

function postJob(kind, payload, timeoutMs = 120_000) {
  const worker = ensureWorker();
  if (!worker) return Promise.reject(Object.assign(new Error('no worker'), { noWorker: true }));
  return new Promise((resolve, reject) => {
    const id = `job_${Date.now()}_${++state.jobId}`;
    const timer = setTimeout(() => {
      state.pending.delete(id);
      reject(new Error('worker 渲染超时'));
    }, timeoutMs);
    state.pending.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    worker.postMessage({ id, kind, payload, assetsDir: state.assetsDir });
  });
}

/**
 * 渲染一张表情。先走 worker；worker 不存在/崩溃时回退进程内。
 * payload: { avatar?, selfAvatar?, targetAvatar?, displayName?, date?, text?, circle? }
 */
export async function runBqb(kind, payload) {
  if (!state) throw new Error('bqb 未初始化');
  try {
    return await postJob(kind, payload);
  } catch (e) {
    if (!e?.noWorker && !e?.workerCrash && !/no worker|worker crashed/.test(String(e?.message))) {
      // 渲染本身的错误（模板缺失等）直接抛，没必要进程内再试一遍
      if (!/sharp 未安装/.test(String(e?.message))) throw e;
    }
    const sharp = await getSharp(state.dataPath, state.logger);
    if (!sharp) {
      const err = new Error('sharp 未安装，且自动安装未完成');
      err.noSharp = true;
      throw err;
    }
    state.logger?.debug?.('[bqb] 进程内渲染回退');
    return renderBqb({ kind, env: { sharp, assetsDir: state.assetsDir }, ...payload });
  }
}

export function disposeBqbJob() {
  if (state?.worker) {
    try { state.worker.terminate(); } catch { /* ignore */ }
  }
  if (state) {
    for (const [, rec] of state.pending) rec.reject(new Error('插件已卸载'));
    state.pending?.clear();
  }
  state = null;
}
