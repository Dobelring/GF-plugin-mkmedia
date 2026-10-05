/**
 * MK媒体·官方（GF-plugin-mkmedia）
 * QQ 官方机器人插件：视频解析（B站/抖音/小红书/快手/YouTube/TikTok）+ 表情制作。
 *
 * 解析与素材移植自 kakake-plugin-mkbot（三个句号），发送层按官方机器人
 * REST API（/v2/groups|/v2/users + 富媒体两步上传）重新实现。
 *
 * 事件结构见宿主「工具-插件开发-GF-官方机器人」手册：
 *  - 字段平铺，按 event.t 过滤；群消息有 GROUP_AT_MESSAGE_CREATE / GROUP_MESSAGE_CREATE 两个事件名；
 *  - plugin_onmessage 会收到所有事件，第一件事就是过滤。
 */

import fs from 'node:fs';
import path from 'node:path';
import { startSeqSweeper, stopSeqSweeper, sendText } from './lib/gf-send.mjs';
import { isChatMessage, messageText, dedupKey, cardUrls } from './lib/gf-util.mjs';
import { detectLink } from './lib/video-parse.mjs';
import { handleVideoLink } from './lib/video-handle.mjs';
import { initBqbJob, disposeBqbJob } from './lib/bqb-job.mjs';
import { handleBqbCommand } from './lib/bqb-handle.mjs';
import { loadConfig, handleAdminAndMenu, featureEnabled } from './lib/config.mjs';
import { probeSharp } from './lib/sharp-loader.mjs';

const PLUGIN_NAME = 'GF-plugin-mkmedia';

/** 消息去重表：官方会重复推送同一消息 */
const seen = new Map();
let sweepTimer = null;

function sweepSeen() {
  const now = Date.now();
  for (const [k, at] of seen) {
    if (now - at > 6 * 60 * 1000) seen.delete(k);
  }
}

let runtime = { ctx: null, cfg: null };

export async function plugin_init(ctx) {
  runtime.ctx = ctx;
  runtime.cfg = loadConfig(ctx);
  startSeqSweeper(ctx.logger);
  initBqbJob({
    dataPath: ctx.dataPath,
    pluginPath: ctx.pluginPath,
    logger: ctx.logger,
  });

  if (!sweepTimer) {
    sweepTimer = setInterval(sweepSeen, 5 * 60 * 1000);
    if (sweepTimer.unref) sweepTimer.unref();
  }

  // 后台探测 sharp（不阻塞加载）：装没装只影响表情制作
  probeSharp(ctx.dataPath)
    .then((s) => {
      if (!s) ctx.logger?.info?.('[mkmedia] sharp 未安装，首次使用表情制作时会自动安装（约1-2分钟）');
    })
    .catch(() => { /* ignore */ });

  // 版本戳：帮助确认运行的是不是最新代码（多文件 ESM 插件改码后需重启宿主才完全生效）
  let buildTag = '';
  try {
    const entryStat = fs.statSync(new URL(import.meta.url));
    const manifest = JSON.parse(fs.readFileSync(path.join(ctx.pluginPath, 'plugin.json'), 'utf-8'));
    buildTag = ` v${manifest.version || '?'} build=${new Date(entryStat.mtimeMs).toISOString().slice(0, 16)}`;
  } catch { /* ignore */ }
  ctx.logger?.info?.(
    `[mkmedia] 已加载${buildTag}。视频解析=${runtime.cfg['视频解析'] ? '开' : '关'} 表情制作=${runtime.cfg['表情制作'] ? '开' : '关'} 数据目录=${ctx.dataPath}`
  );
}

export async function plugin_onmessage(ctx, event) {
  try {
    if (!event || !isChatMessage(event)) return;

    // 去重（官方会重复推送，msg_idx 最可靠）
    const dk = dedupKey(event);
    if (!dk) return;
    if (seen.has(dk)) return;
    seen.set(dk, Date.now());
    if (seen.size > 2000) sweepSeen();

    const cfg = runtime.cfg || loadConfig(ctx);
    const text = messageText(event);

    // 1) 菜单 / 配置指令（先于其它匹配，避免被表情指令吞掉）
    const admin = await handleAdminAndMenu(ctx, event, text, cfg);
    if (admin?.handled) {
      if (admin.reply) {
        await sendText(ctx, event, admin.reply).catch((e) =>
          ctx.logger?.warn?.(`[mkmedia] 菜单回复失败: ${e?.message}`)
        );
      }
      return;
    }

    // 2) 表情制作（全等匹配指令词）
    if (featureEnabled(cfg, event, '表情制作')) {
      const handled = await handleBqbCommand(ctx, event, text);
      if (handled) return;
    }

    // 3) 视频解析：正文 + 卡片链接里找平台链接（无需指令，发链接即解析）
    if (featureEnabled(cfg, event, '视频解析')) {
      const scanText = [text, ...cardUrls(event)].filter(Boolean).join('\n');
      const hit = detectLink(scanText);
      if (hit) {
        const cap = Math.max(1, Math.min(10, Number(cfg['图集最多发送']) || 4));
        await handleVideoLink(ctx, event, hit.platform, hit.url, {
          maxMedia: cap,
          proxyUrl: cfg['代理'],
          dataPath: ctx.dataPath,
        });
        return;
      }
    }
  } catch (e) {
    ctx.logger?.error?.(`[mkmedia] 处理消息出错: ${e?.stack || e?.message || e}`);
  }
}

export async function plugin_onevent(ctx, event) {
  try {
    if (event?.t === 'GROUP_ADD_ROBOT') {
      ctx.logger?.info?.(`[mkmedia] 被拉进群 ${event.group_openid}。群成员发「媒体菜单」查看用法`);
    }
  } catch { /* ignore */ }
}

export async function plugin_cleanup(ctx) {
  disposeBqbJob();
  stopSeqSweeper();
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
  seen.clear();
  runtime = { ctx: null, cfg: null };
  ctx?.logger?.info?.('[mkmedia] 已卸载');
}

// CJS 兼容兜底：宿主对 ESM 插件直接取命名导出，这里不需要额外处理
export default { plugin_init, plugin_onmessage, plugin_onevent, plugin_cleanup };
