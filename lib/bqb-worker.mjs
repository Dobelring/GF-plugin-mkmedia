/**
 * sharp 渲染 worker：把表情合成放进独立线程，sharp 原生库出错也不会拖死宿主进程。
 * 协议：
 *   入 { id, kind, payload, assetsDir, dataPath }
 *   出 { id, ok, buffer?, mime?, ext? } / { id, ok: false, error }
 */

import { parentPort, workerData } from 'node:worker_threads';
import { getSharp } from './sharp-loader.mjs';
import { renderBqb } from './bqb-core.mjs';

const dataPath = workerData?.dataPath || '';
let sharpPromise = getSharp(dataPath, null, { autoInstall: false });

parentPort.on('message', async (job) => {
  const { id, kind, payload, assetsDir } = job || {};
  if (!id) return;
  try {
    const sharp = await sharpPromise;
    if (typeof sharp !== 'function') throw new Error('sharp 未安装');
    const result = await renderBqb({ kind, env: { sharp, assetsDir }, ...payload });
    parentPort.postMessage({
      id,
      ok: true,
      buffer: result.buffer,
      mime: result.mime,
      ext: result.ext,
    });
  } catch (e) {
    parentPort.postMessage({ id, ok: false, error: e?.message || String(e) });
  }
});
