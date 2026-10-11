/**
 * 视频解析的完整处理流：解析 → 信息文本 → 媒体发送（带被动回复预算控制）。
 *
 * 群聊每条触发消息最多 5 条被动回复、单聊 4 条，所以媒体发送量要预算：
 * 文本 1 条 + 视频或图片若干条；图片超量的部分不再发送。
 */

import { replyTarget, sendText, sendMediaByUrl, sendMediaBuffer, downloadToBuffer } from './gf-send.mjs';
import {
  PLATFORMS,
  parseVideoApi,
  normalizeResult,
  parseErrorText,
  downloadHeaders,
  setTiktokCookie,
} from './video-parse.mjs';

function safeName(name, fallback = 'media') {
  return (
    String(name || fallback)
      .replace(/[\\/:*?"<>|\r\n]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || fallback
  );
}

function maxReplies(event) {
  return replyTarget(event)?.isGroup ? 5 : 4;
}

async function trySendMedia(ctx, event, url, fileType, fileName, used, budget, { proxyFetch = null, skipUrlDirect = false } = {}) {
  if (used.count >= budget) return 'skip';
  // 平台代下载（URL 直传）对被墙 CDN 无效，YouTube/TikTok 直接走自下载分片上传
  if (!skipUrlDirect) {
    try {
      await sendMediaByUrl(ctx, event, url, fileType, fileName);
      used.count += 1;
      return 'url';
    } catch (e1) {
      if (used.count >= budget) return 'skip';
      try {
        const buf = await downloadToBuffer(url, {
          headers: downloadHeaders(url),
          maxBytes: fileType === 2 ? 60 * 1024 * 1024 : 20 * 1024 * 1024,
          timeoutMs: 90_000,
        });
        await sendMediaBuffer(ctx, event, buf, { fileType, fileName });
        used.count += 1;
        return 'buffer';
      } catch (e2) {
        ctx.logger?.warn?.(
          `[视频解析] 媒体发送失败 平台=${fileType === 2 ? 'video' : 'image'} URL直传: ${e1?.message} | 分片上传: ${e2?.message}`
        );
        return 'fail';
      }
    }
  }
  try {
    const buf = await downloadToBuffer(url, {
      headers: downloadHeaders(url),
      maxBytes: fileType === 2 ? 60 * 1024 * 1024 : 20 * 1024 * 1024,
      timeoutMs: 120_000,
      fetchImpl: proxyFetch || fetch,
    });
    await sendMediaBuffer(ctx, event, buf, { fileType, fileName });
    used.count += 1;
    return 'buffer';
  } catch (e2) {
    ctx.logger?.warn?.(`[视频解析] 媒体发送失败（代理下载） 平台=${fileType === 2 ? 'video' : 'image'}: ${e2?.message}`);
    return 'fail';
  }
}

/**
 * 主入口：解析并发送。返回 { parsed: boolean, error?: string }。
 */
export async function handleVideoLink(ctx, event, platform, url, cfg = {}) {
  const p = PLATFORMS[platform];
  if (!p) return { parsed: false, error: 'unknown platform' };
  // 被墙平台（YouTube/TikTok）走代理：解析 + 媒体下载都用；国内平台直连
  const needProxy = platform === 'youtube' || platform === 'tiktok';
  let proxyFetch = null;
  if (needProxy && cfg?.proxyUrl) {
    const { getProxiedFetch } = await import('./proxy-fetch.mjs');
    proxyFetch = await getProxiedFetch(cfg.dataPath, cfg.proxyUrl, ctx.logger);
  }
  const t0 = Date.now();
  let result;
  try {
    result = await parseVideoApi(p.api, url, { proxyFetch, cookies: cfg?.cookies });
  } catch (e) {
    ctx.logger?.error?.(`[视频解析] ${p.label} 解析异常: ${e?.message} | 链接=${url}`);
    await sendText(ctx, event, `${p.label}解析失败：${e?.message || '未知错误'}`).catch(() => {});
    return { parsed: false, error: e?.message };
  }

  const ok =
    platform === 'bilibili'
      ? Number(result?.['状态码']) === 200
      : platform === 'xiaohongshu'
        ? result?.success === true
        : Number(result?.code) === 200 && result?.data;
  if (!ok) {
    const errText = parseErrorText(platform, result);
    ctx.logger?.error?.(`[视频解析] ${p.label} 解析失败: ${errText} | 链接=${url}`);
    await sendText(ctx, event, `${p.label}解析失败：${errText}`).catch(() => {});
    return { parsed: false, error: errText };
  }

  const data = platform === 'bilibili' ? result['数据'] : platform === 'xiaohongshu' ? result.data : result.data;
  const norm = normalizeResult(platform, data);
  if (platform === 'tiktok' && data?.cookie) setTiktokCookie(data.cookie);
  ctx.logger?.info?.(`[视频解析] ${p.label} 解析成功 (${((Date.now() - t0) / 1000).toFixed(1)}s) ${norm.title}`);

  const budget = maxReplies(event);
  const used = { count: 0 };
  const mediaCap = Math.max(1, Math.min(10, Number(cfg?.maxMedia) || 4));
  const sendOpts = { proxyFetch, skipUrlDirect: needProxy };

  // 1) 信息文本
  try {
    await sendText(ctx, event, `${p.label} · 解析\n─────────────\n${norm.infoText}`);
    used.count += 1;
  } catch (e) {
    ctx.logger?.error?.(`[视频解析] 信息文本发送失败: ${e?.message}`);
    return { parsed: true };
  }

  const videoFail = { sent: false };
  // 2) 视频
  if (norm.videoUrl && used.count < budget) {
    const r = await trySendMedia(ctx, event, norm.videoUrl, 2, `${safeName(norm.title)}.mp4`, used, budget, sendOpts);
    videoFail.sent = r === 'url' || r === 'buffer';
  }

  // 3) 实况图（优先视频轨）与图集
  let items = [];
  if (Array.isArray(norm.liveItems) && norm.liveItems.length) {
    items = norm.liveItems.map((it) => (it.video ? { url: it.video, type: 2 } : { url: it.image, type: 1 })).filter((it) => it.url);
  } else if (Array.isArray(norm.images) && norm.images.length) {
    items = norm.images.map((u) => ({ url: u, type: 1 }));
  }
  if (items.length && used.count < budget) {
    let sent = 0;
    let failed = 0;
    const cap = Math.min(mediaCap, budget - used.count);
    for (const item of items.slice(0, cap)) {
      if (used.count >= budget) break;
      const r = await trySendMedia(ctx, event, item.url, item.type, safeName(norm.title, 'image'), used, budget, sendOpts);
      if (r === 'url' || r === 'buffer') sent += 1;
      else if (r === 'fail') failed += 1;
    }
    if (sent === 0 && failed > 0 && used.count < budget) {
      const links = items.slice(0, 2).map((it) => it.url).join('\n');
      try {
        await sendText(ctx, event, `媒体直链（链接有时效，请尽快保存）:\n${links}`);
        used.count += 1;
      } catch { /* ignore */ }
    }
    const rest = items.length - sent;
    if (rest > 0 && used.count < budget) {
      try {
        await sendText(ctx, event, `共 ${items.length} 个媒体，受回复条数限制已发送 ${sent} 个，其余请通过原链接查看`);
        used.count += 1;
      } catch { /* ignore */ }
    }
  }

  // 4) 视频没发出去时补封面，让群里至少有预览
  if (!videoFail.sent && norm.cover && used.count < budget) {
    await trySendMedia(ctx, event, norm.cover, 1, 'cover', used, budget, sendOpts);
  }

  if (platform === 'tiktok') setTiktokCookie('');

  return { parsed: true };
}
