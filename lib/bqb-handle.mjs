/**
 * 表情制作指令分发（官方机器人版）。
 *
 * 与 OneBot 版的关键差异：
 *  - 官方机器人拿不到 QQ 号，也没有 QQ 头像接口 —— 头像一律改为「消息里的图片」：
 *    当条消息带图 / 引用（message_type=103）一条带图消息；
 *  - 附件 URL 有时效，取到引用后要立刻下载；
 *  - 输出 GIF/PNG buffer 没有公网 URL，走分片上传发送。
 */

import { pickAttachments, quotedContent } from './gf-util.mjs';
import { sendText, sendMediaBuffer } from './gf-send.mjs';
import { runBqb } from './bqb-job.mjs';

export const BQB_TRIGGERS = new Map([
  ['爬', 'crawl'],
  ['顶', 'play'],
  ['啃', 'bite'],
  ['摸头', 'petpet'],
  ['吃', 'eat'],
  ['吸', 'suck'],
  ['啾', 'jiujiu'],
  ['挠头', 'scratch_head'],
  ['贴贴', 'rub'],
  ['二次元入口', 'acg_entrance'],
  ['上瘾', 'addiction'],
  ['别碰', 'dont_touch'],
  ['灰飞烟灭', 'fade_away'],
  ['捣', 'pound'],
  ['pound', 'pound'],
  ['卖掉了', 'sold_out'],
  ['sold_out', 'sold_out'],
  ['嘲讽', 'taunt'],
  ['taunt', 'taunt'],
  ['想什么', 'think_what'],
  ['think_what', 'think_what'],
  ['我想上的', 'what_i_want_to_do'],
  ['what_i_want_to_do', 'what_i_want_to_do'],
  ['你不懂啦', 'you_dont_get'],
  ['you_dont_get', 'you_dont_get'],
]);

export const BQB_MENU = [
  '表情制作菜单（发指令时带上一张图片，或引用一条带图的消息）',
  '· GIF：摸头 / 顶 / 啃 / 吃 / 吸 / 啾 / 挠头 / 贴贴 / 捣 / 灰飞烟灭',
  '· 图片：爬 / 二次元入口 / 上瘾 / 别碰 / 卖掉了 / 嘲讽 / 想什么 / 我想上的 / 你不懂啦',
  '· 证书：戒导 或 戒导2026-01-01',
  '· 贴贴需两张图：一条消息发两张图+贴贴，或带一张图引用一张图',
  '· 例：[图片] 摸头　｜　引用带图消息：嘲讽',
].join('\n');

const USAGE_SINGLE = '请带上一张图片使用：一条消息里先发图再发指令（如 [图片]摸头），或引用一条带图的消息发送指令。官方机器人暂不支持自动取头像。';
const USAGE_RUB = '贴贴需要两张图片：一条消息发两张图+「贴贴」，或带一张图并引用另一条带图的消息。';

export function resolveBqbCommand(text) {
  const t = String(text || '');
  const abst = t.match(/^戒导(\d{4}-\d{1,2}-\d{1,2})?$/);
  if (abst) return { kind: 'abstinence', date: abst[1] };
  const kind = BQB_TRIGGERS.get(t);
  if (kind) return { kind };
  return null;
}

async function fetchImageBuffer(url) {
  const u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u)) return null;
  try {
    const res = await fetch(u, {
      signal: AbortSignal.timeout(15_000),
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    if (!ab || ab.byteLength < 32) return null;
    return Buffer.from(ab);
  } catch {
    return null;
  }
}

/** 当前消息 + 引用消息里的全部图片 buffer（按出现顺序） */
export async function collectImageBuffers(event) {
  const out = [];
  for (const a of pickAttachments(event).images) {
    if (out.length >= 2) break;
    const buf = await fetchImageBuffer(a.url);
    if (buf) out.push(buf);
  }
  if (out.length < 2) {
    const quoted = quotedContent(event);
    for (const a of quoted.images) {
      if (out.length >= 2) break;
      const buf = await fetchImageBuffer(a.url);
      if (buf) out.push(buf);
    }
  }
  return out;
}

/**
 * 处理表情指令。返回：
 *   false  —— 不是表情指令（继续别的处理）
 *   true   —— 已处理（成功或已回复提示）
 */
export async function handleBqbCommand(ctx, event, rawText) {
  const text = String(rawText || '').replace(/\s+/g, '');
  const resolved = resolveBqbCommand(text);
  if (!resolved) return false;
  const { kind, date } = resolved;

  const buffers = await collectImageBuffers(event);

  try {
    let payload;
    if (kind === 'rub') {
      if (buffers.length < 2) {
        await sendText(ctx, event, USAGE_RUB);
        return true;
      }
      payload = { selfAvatar: buffers[0], targetAvatar: buffers[1] };
    } else {
      if (!buffers.length) {
        await sendText(ctx, event, USAGE_SINGLE);
        return true;
      }
      payload = { avatar: buffers[0] };
      if (kind === 'abstinence') {
        payload.displayName = String(event?.author?.username || '').trim() || '戒导人';
        payload.date = date || '';
      }
      if (kind === 'acg_entrance') payload.text = '';
    }

    const result = await runBqb(kind, payload);
    await sendMediaBuffer(ctx, event, result.buffer, {
      fileType: 1,
      fileName: `bqb_${kind}.${result.ext || 'png'}`,
    });
    ctx.logger?.info?.(`[bqb] 已生成 ${kind}（${(result.buffer.length / 1024).toFixed(0)}KB）`);
  } catch (e) {
    if (/模拟环境/.test(String(e?.message))) {
      await sendText(ctx, event, '收到！当前是模拟事件，模拟器不支持发送富媒体；连接真实机器人后会正常回复表情图。');
    } else if (e?.noSharp || /sharp 未安装/.test(String(e?.message))) {
      await sendText(ctx, event, '表情功能需要 sharp 组件，正在后台自动安装，请过几分钟再试一次～');
    } else if (/素材目录不存在|模板不存在|素材不存在/.test(String(e?.message))) {
      ctx.logger?.error?.(`[bqb] 素材缺失: ${e?.message}`);
      await sendText(ctx, event, '表情素材缺失，请检查插件目录 assets/bqb/ 是否完整。');
    } else {
      ctx.logger?.error?.(`[bqb] 渲染失败 ${kind}: ${e?.message}`);
      await sendText(ctx, event, '表情制作失败了，请稍后再试～');
    }
  }
  return true;
}
