/**
 * QQ 官方机器人发送层。
 *
 * 官方发富媒体是两步：先调上传接口拿 file_info，再发 msg_type=7 携带 media.file_info。
 * 上传有两种方式：
 *  1) URL 直传：请求体带 url（http 开头），由平台下载转存 —— 对方 CDN 不带防盗链时最简单；
 *  2) 分片上传：upload_prepare → 逐片 PUT 到预签名 URL → upload_part_finish →
 *     带 upload_id 调上传接口合并。适合本地生成的图片/视频（base64 官方不支持）。
 *
 * 群聊 /v2/groups/{openid}/... 与单聊 /v2/users/{openid}/... 两套接口不互通。
 */

import crypto from 'node:crypto';

/** md5_10m = 文件前 10002432 字节的 MD5（官方秒传校验值） */
const MD5_10M_SIZE = 10002432;

const seqMap = new Map(); // event.id -> { seq, at }
let seqSweepTimer = null;

/** 每 10 分钟清一次 5 分钟没活动的 seq 计数，防内存膨胀 */
export function startSeqSweeper(logger) {
  if (seqSweepTimer) return;
  seqSweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of seqMap) {
      if (now - v.at > 10 * 60 * 1000) seqMap.delete(k);
    }
  }, 10 * 60 * 1000);
  if (seqSweepTimer.unref) seqSweepTimer.unref();
  logger?.debug?.('[gf-send] seq sweeper started');
}

export function stopSeqSweeper() {
  if (seqSweepTimer) {
    clearInterval(seqSweepTimer);
    seqSweepTimer = null;
  }
}

function nextSeq(event) {
  const key = String(event?.id || Math.random());
  const rec = seqMap.get(key) || { seq: 0, at: 0 };
  rec.seq += 1;
  rec.at = Date.now();
  seqMap.set(key, rec);
  return rec.seq;
}

export function replyTarget(event) {
  if (event?.group_openid) {
    return {
      isGroup: true,
      target: String(event.group_openid),
      uploadPath: `/v2/groups/${event.group_openid}/files`,
      sendPath: `/v2/groups/${event.group_openid}/messages`,
      preparePath: `/v2/groups/${event.group_openid}/upload_prepare`,
      finishPath: `/v2/groups/${event.group_openid}/upload_part_finish`,
    };
  }
  const openid = getUserOpenidSafe(event);
  if (openid) {
    return {
      isGroup: false,
      target: openid,
      uploadPath: `/v2/users/${openid}/files`,
      sendPath: `/v2/users/${openid}/messages`,
      preparePath: `/v2/users/${openid}/upload_prepare`,
      finishPath: `/v2/users/${openid}/upload_part_finish`,
    };
  }
  return null;
}

function getUserOpenidSafe(event) {
  const a = (event && event.author) || {};
  return String(a.user_openid || a.member_openid || a.union_openid || '');
}

/** 发一条文本（msg_type=0） */
export async function sendText(ctx, event, text) {
  const t = replyTarget(event);
  if (!t) throw new Error('既不是群聊也不是单聊事件，无法回复');
  return ctx.actions.call(t.sendPath, {
    content: String(text ?? ''),
    msg_type: 0,
    msg_id: event.id,
    msg_seq: nextSeq(event),
  });
}

/** 发 Markdown 文本（msg_type=2），可与 keyboard 搭配 */
export async function sendMarkdown(ctx, event, content) {
  const t = replyTarget(event);
  if (!t) throw new Error('既不是群聊也不是单聊事件，无法回复');
  return ctx.actions.call(t.sendPath, {
    msg_type: 2,
    markdown: { content: String(content ?? '') },
    msg_id: event.id,
    msg_seq: nextSeq(event),
  });
}

function isLikelySimulated(resp) {
  // 控制台「模拟消息」对 /files、/upload_prepare 等返回空对象；真实接口要么有字段要么抛错
  return !resp || typeof resp !== 'object' || Object.keys(resp).length === 0;
}

function requireFileInfo(resp, what) {
  const fi = resp && resp.file_info;
  if (!fi) {
    if (isLikelySimulated(resp)) throw new Error(`${what}：模拟环境不支持富媒体上传（真实连接可用）`);
    throw new Error(`${what}：接口未返回 file_info`);
  }
  return fi;
}

async function uploadAndSend(ctx, event, uploadResp, seq) {
  const t = replyTarget(event);
  const fileInfo = requireFileInfo(uploadResp, '富媒体上传');
  const body = {
    msg_type: 7,
    media: { file_info: fileInfo },
    msg_id: event.id,
    msg_seq: seq || nextSeq(event),
  };
  return ctx.actions.call(t.sendPath, body);
}

/**
 * URL 直传发送富媒体（file_type：1=图片 2=视频 3=语音 4=文件）。
 * 平台服务端会自己去下载这个 URL —— 需要 URL 公网可访问且无防盗链。
 */
export async function sendMediaByUrl(ctx, event, url, fileType = 1, fileName = '') {
  const t = replyTarget(event);
  if (!t) throw new Error('既不是群聊也不是单聊事件，无法回复');
  const body = {
    file_type: fileType,
    url: String(url || ''),
    srv_send_msg: false,
  };
  if (fileName) body.file_name = fileName;
  const resp = await ctx.actions.call(t.uploadPath, body);
  return uploadAndSend(ctx, event, resp);
}

function md5Buf(buf) {
  return crypto.createHash('md5').update(buf).digest('hex');
}

/**
 * 分片上传发送本地 buffer。
 * 官方不支持 base64 直传，本地媒体必须走：upload_prepare → PUT 预签名 URL →
 * upload_part_finish → /files(带 upload_id) 合并拿 file_info。
 */
export async function sendMediaBuffer(ctx, event, buffer, { fileType = 1, fileName = 'image.png' } = {}) {
  const t = replyTarget(event);
  if (!t) throw new Error('既不是群聊也不是单聊事件，无法回复');
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (!buf.length) throw new Error('分片上传失败：内容为空');

  const head = buf.subarray(0, Math.min(buf.length, MD5_10M_SIZE));
  const prepareBody = {
    file_type: fileType,
    file_size: String(buf.length),
    file_name: fileName,
    md5: md5Buf(buf),
    sha1: crypto.createHash('sha1').update(buf).digest('hex'),
    md5_10m: md5Buf(head),
  };

  const prepared = await ctx.actions.call(t.preparePath, prepareBody);
  if (prepared && prepared.file_info) {
    // 命中秒传：prepare 直接给 file_info
    return uploadAndSend(ctx, event, prepared);
  }
  const uploadId = prepared && prepared.upload_id;
  if (!uploadId) {
    if (isLikelySimulated(prepared)) throw new Error('分片上传失败：模拟环境不支持富媒体上传（真实连接可用）');
    throw new Error('分片上传失败：预上传未返回 upload_id');
  }

  const blockSize = Math.max(1, Number(prepared?.block_size) || 5 * 1024 * 1024);

  // 以服务器返回的 parts 清单为准：分片序号（实测可能不是 0 起）与每片大小都用服务端给的，
  // 按顺序消费字节区间；清单为空时才按 block_size 自己切（index 从 0）。
  const serverParts = Array.isArray(prepared?.parts) && prepared.parts.length ? prepared.parts : null;
  const jobs = [];
  if (serverParts) {
    let offset = 0;
    for (const sp of serverParts) {
      const size = Math.max(1, Number(sp?.block_size) || blockSize);
      const slice = buf.subarray(offset, Math.min(offset + size, buf.length));
      if (!slice.length) break;
      jobs.push({ index: Number(sp?.index ?? jobs.length), slice, presigned: String(sp?.presigned_url || '') });
      offset += size;
    }
  } else {
    for (let offset = 0; offset < buf.length; offset += blockSize) {
      jobs.push({ index: jobs.length, slice: buf.subarray(offset, Math.min(offset + blockSize, buf.length)), presigned: '' });
    }
  }

  // 逐片 PUT 到平台给的预签名地址（直连，不走 ctx.actions.call）
  for (const job of jobs) {
    if (job.presigned) {
      const resp = await fetch(job.presigned, {
        method: 'PUT',
        body: job.slice,
        signal: AbortSignal.timeout(120_000),
      });
      if (!resp.ok) throw new Error(`分片上传失败：PUT ${job.index} HTTP ${resp.status}`);
      try { await resp.body?.cancel?.(); } catch { /* ignore */ }
    }
    await ctx.actions.call(t.finishPath, {
      upload_id: uploadId,
      part_index: job.index,
      block_size: String(job.slice.length),
      md5: md5Buf(job.slice),
    });
  }

  const merged = await ctx.actions.call(t.uploadPath, {
    file_type: fileType,
    upload_id: uploadId,
    srv_send_msg: false,
  });
  return uploadAndSend(ctx, event, merged);
}

/**
 * URL 直传失败时的兜底：把 URL 内容下载到内存（带防盗链 Referer 由调用方传入 headers），
 * 再走分片上传。
 */
export async function downloadToBuffer(url, { headers = {}, timeoutMs = 60_000, maxBytes = 60 * 1024 * 1024 } = {}) {
  const resp = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!resp.ok) throw new Error(`下载失败 HTTP ${resp.status}`);
  const len = Number(resp.headers.get('content-length') || 0);
  if (len && len > maxBytes) throw new Error(`文件过大（${(len / 1048576).toFixed(1)}MB 超过 ${(maxBytes / 1048576).toFixed(0)}MB 限制）`);
  const ab = await resp.arrayBuffer();
  if (ab.byteLength > maxBytes) throw new Error(`文件过大（${(ab.byteLength / 1048576).toFixed(1)}MB）`);
  return Buffer.from(ab);
}
