/**
 * 视频解析：链接识别 → 调 lib/api 解析 → 组装信息文本 → 按官方机器人的被动回复预算发媒体。
 * 解析模块移植自 kakake-plugin-mkbot 的 lib/api（自包含、零 npm 依赖、纯 Node fetch）。
 *
 * 官方机器人约束（GF 开发手册 §八）：
 *  - 群聊被动回复：每条触发消息最多 5 条、5 分钟内；
 *  - 单聊：最多 4 条、60 分钟内；
 *  - 每条富媒体消息只能带一个媒体，msg_seq 必须递增。
 */

export const PLATFORMS = {
  bilibili: {
    label: '哔哩哔哩',
    api: 'blbl',
    patterns: [
      /https?:\/\/b23\.tv\/[a-zA-Z0-9]+/i,
      /https?:\/\/(?:www\.)?bilibili\.com\/video\/BV[a-zA-Z0-9]{10}/i,
    ],
  },
  douyin: {
    label: '抖音',
    api: 'dy',
    patterns: [/https?:\/\/v\.douyin\.com\/[\w-]+/i],
  },
  xiaohongshu: {
    label: '小红书',
    api: 'xhs',
    patterns: [
      /https?:\/\/xhslink\.(?:com|cn)\/[^\s\]]+/i,
      /https?:\/\/(?:www\.)?xiaohongshu\.com\/[^\s\]]+/i,
    ],
  },
  kuaishou: {
    label: '快手',
    api: 'ks',
    patterns: [/https?:\/\/v\.kuaishou\.com\/[\w-]+/i],
  },
  youtube: {
    label: 'YouTube',
    api: 'yt',
    patterns: [
      /https?:\/\/(?:www\.|m\.|music\.)?youtube\.com\/(?:shorts|embed|live)\/[\w-]+(?:\?[^\s\]]*)?/i,
      /https?:\/\/(?:www\.|m\.|music\.)?youtube\.com\/watch\?[^\s\]]+/i,
      /https?:\/\/youtu\.be\/[\w-]+(?:\?[^\s\]]*)?/i,
      /https?:\/\/(?:www\.)?youtube-nocookie\.com\/embed\/[\w-]+(?:\?[^\s\]]*)?/i,
    ],
  },
  tiktok: {
    label: 'TikTok',
    api: 'tt',
    patterns: [
      /https?:\/\/(?:www\.)?tiktok\.com\/t\/[\w-]+\/?(?:\?[^\s\]]*)?/i,
      /https?:\/\/(?:vm|vt|t)\.tiktok\.com\/[\w-]+\/?(?:\?[^\s\]]*)?/i,
      /https?:\/\/(?:www\.|m\.)?tiktok\.com\/@[^/\s\]]+\/video\/\d+(?:\?[^\s\]]*)?/i,
    ],
  },
};

/** 各站点下载用的防盗链头（自己下载媒体时用；URL 直传由平台下载，用不到） */
function refererFor(url) {
  const u = String(url || '').toLowerCase();
  if (/bilivideo|bilibili|b23\.tv|hdslb/.test(u)) return { Referer: 'https://www.bilibili.com/' };
  if (/douyin|douyinpic|douyinvod|zjcdn/.test(u)) return { Referer: 'https://www.douyin.com/' };
  if (/xhscdn|xiaohongshu/.test(u)) return { Referer: 'https://www.xiaohongshu.com/' };
  if (/yximgs|kuaishou|gifshow/.test(u)) return { Referer: 'https://www.kuaishou.com/' };
  if (/googlevideo|youtube|ytimg/.test(u)) return { Referer: 'https://www.youtube.com/' };
  if (/tiktok|tiktokcdn|byteoversea/.test(u)) return { Referer: 'https://www.tiktok.com/' };
  return {};
}

let tiktokCookie = '';
export function setTiktokCookie(cookie) { tiktokCookie = String(cookie || ''); }

export function downloadHeaders(url) {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    ...refererFor(url),
    ...(String(url || '').toLowerCase().includes('tiktok') && tiktokCookie ? { Cookie: tiktokCookie } : {}),
  };
}

/** 在文本（含卡片链接）里找第一个可解析的视频/图集链接 */
export function detectLink(scanText) {
  const text = String(scanText || '');
  for (const [key, p] of Object.entries(PLATFORMS)) {
    for (const re of p.patterns) {
      const m = text.match(re);
      if (m && m[0]) {
        // 分享文案里链接后面常跟中文标点（，。」等），必须剥掉再交给解析器
        const url = m[0].replace(/[，。、！？；：）》」』”’】]+$/, '');
        return { platform: key, url };
      }
    }
  }
  return null;
}

/** 调 lib/api/<name>.mjs 的 parse(url) */
export async function parseVideoApi(apiName, url) {
  const mod = await import(`./api/${apiName}.mjs`);
  if (typeof mod.parse !== 'function') throw new Error(`解析模块 ${apiName} 缺少 parse()`);
  return mod.parse(url);
}

function fmtNum(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n ?? '');
  if (v >= 100000000) return `${(v / 100000000).toFixed(1)}亿`;
  if (v >= 10000) return `${(v / 10000).toFixed(1)}万`;
  return String(v);
}

/**
 * 把各平台解析结果归一成统一结构：
 * { title, infoText, cover, videoUrl, images, liveItems, music, directNote }
 */
export function normalizeResult(platform, data) {
  const label = PLATFORMS[platform].label;
  if (platform === 'bilibili') {
    const d = data || {};
    const info = [
      `标题:${d['视频标题'] || ''}`,
      `简介:${String(d['视频描述'] || '无描述').slice(0, 120)}`,
      `UP主:${d['UP主信息']?.['UP主名称'] || ''}`,
      `══════════════`,
      `时长:${d['视频时长'] || ''}`,
      `大小:${d['视频大小'] || ''}`,
      `发布:${d['发布时间'] || ''}`,
      `══════════════`,
      `播放:${fmtNum(d['播放次数'])} 弹幕:${fmtNum(d['弹幕数量'])} 评论:${fmtNum(d['评论数量'])}`,
      `点赞:${fmtNum(d['点赞数量'])} 收藏:${fmtNum(d['收藏数量'])} 投币:${fmtNum(d['投币数量'])} 分享:${fmtNum(d['分享数量'])}`,
    ].join('\n');
    return { title: d['视频标题'] || '哔哩哔哩视频', infoText: info, cover: d['视频封面'] || '', videoUrl: d['视频链接'] || '' };
  }
  if (platform === 'douyin') {
    const d = data || {};
    const title = d.title || d.desc || '';
    const author = typeof d.author === 'object' ? (d.author?.name || '') : String(d.author || '');
    let info = `标题:${title}\n作者:${author}`;
    const music = d.music;
    if (music && typeof music === 'object' && (music.title || music.author)) {
      info += `\n音乐:${music.title || ''}${music.author ? ` — ${music.author}` : ''}`;
    }
    if (d.type === 'video' && d.duration != null) info += `\n时长:${Math.round(Number(d.duration) / 1000)}秒`;
    const liveItems = (d.type === 'live' || d.type === 'animated')
      ? (Array.isArray(d.live_photo) ? d.live_photo : []).map((item, i) => ({
          video: String(item?.video || '').trim(),
          image: String(item?.image || '').trim() || String((d.images || [])[i] || '').trim(),
        }))
      : [];
    return {
      title,
      infoText: info,
      cover: d.cover || '',
      videoUrl: d.type === 'video' ? (d.url || '') : '',
      images: d.type === 'image' ? (d.images || []) : [],
      liveItems,
      music,
      kind: d.type || 'video',
    };
  }
  if (platform === 'xiaohongshu') {
    const d = data || {};
    const info = `标题:${d['标题'] || ''}\n作者:${d['作者']?.['名称'] || ''}\n描述:${String(d['描述'] || '').slice(0, 120)}`;
    const kind = d['类型'];
    return {
      title: d['标题'] || '小红书笔记',
      infoText: info,
      cover: d['封面'] || '',
      videoUrl: kind === 'video' ? (d['视频链接'] || '') : '',
      images: kind === 'image' ? (d['图片'] || []) : [],
      liveItems: kind === 'live'
        ? (d['实况图'] || []).map((item) => ({ video: item?.['视频'] || '', image: item?.['图片'] || '' }))
        : [],
      kind: kind || 'video',
    };
  }
  if (platform === 'kuaishou') {
    const d = data || {};
    const publishTime = d.time ? new Date(Number(d.time)).toLocaleString('zh-CN') : '';
    let info = `标题:${d.title || ''}\n作者:${d.author || ''}`;
    if (publishTime) info += `\n发布:${publishTime}`;
    info += `\n点赞:${fmtNum(d.like)}`;
    const music = d.music;
    if (music && typeof music === 'object' && (music.name || music.artist)) {
      info += `\n音乐:${music.name || ''}${music.artist ? ` — ${music.artist}` : ''}`;
    }
    if (d.type === 'image' && d.count != null) info += `\n张数:${d.count}`;
    return {
      title: d.title || (d.type === 'image' ? '快手图集' : '快手视频'),
      infoText: info,
      cover: d.cover || '',
      videoUrl: d.type === 'video' ? (d.url || '') : '',
      images: d.type === 'image' ? (d.images || []) : [],
      music,
      kind: d.type || 'video',
    };
  }
  if (platform === 'youtube' || platform === 'tiktok') {
    const d = data || {};
    let info = `标题:${d.title || ''}\n作者:${d.author || ''}`;
    if (d.duration != null) info += `\n时长:${Math.round(Number(d.duration))}秒`;
    return {
      title: d.title || (platform === 'youtube' ? 'YouTube视频' : 'TikTok视频'),
      infoText: info,
      cover: d.cover || '',
      videoUrl: d.type === 'image' ? '' : (d.url || ''),
      images: d.type === 'image' ? (d.images || []) : [],
      music: d.music,
      kind: d.type || 'video',
    };
  }
  return { title: '解析结果', infoText: '', cover: '', videoUrl: '', images: [] };
}

/** 解析失败时的错误摘要 */
export function parseErrorText(platform, result) {
  const label = PLATFORMS[platform]?.label || platform;
  return result?.msg || result?.message || result?.error || result?.['消息'] || '未知错误';
}
