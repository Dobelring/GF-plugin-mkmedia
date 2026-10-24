const DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.0.0 Safari/537.36";
const BILIBILI_REFERER = "https://www.bilibili.com/";
const BUVID_TTL_MS = 6 * 3600 * 1000;

async function fetchText(url, init = {}, userAgent = DEFAULT_USER_AGENT) {
  const headers = new Headers(init.headers);
  if (!headers.has("User-Agent")) {
    headers.set("User-Agent", userAgent);
  }
  const res = await fetch(url, {
    ...init,
    headers,
    redirect: init.redirect ?? "follow"
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.text();
}
async function followRedirect(url, userAgent = DEFAULT_USER_AGENT, headers = {}) {
  const res = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: { "User-Agent": userAgent, ...headers }
  });
  return res.url || url;
}

// B 站风控：api.bilibili.com 对没有 buvid3 Cookie 的请求直接回 HTTP 412（2026-10 服务器 IP 实测，
// 家宽裸 UA 仍可过）。buvid 用官方指纹接口 finger/spi 现拿、进程内缓存；接口不可用时随机造一个
// 兜底（WAF 只查 Cookie 在不在，不验真伪）。412 时换一对重试。
let buvidCache = null;
let buvidInflight = null;
function randomBuvid3() {
  const hex = "0123456789ABCDEF";
  const seg = (n) => Array.from({ length: n }, () => hex[Math.floor(Math.random() * 16)]).join("");
  return `${seg(8)}-${seg(4)}-${seg(4)}-${seg(4)}-${seg(12)}${Math.floor(Math.random() * 9e5 + 1e5)}infoc`;
}
async function fetchBuvid() {
  try {
    const raw = await fetchText("https://api.bilibili.com/x/frontend/finger/spi", {
      headers: { Referer: BILIBILI_REFERER }
    });
    const json = JSON.parse(raw);
    if (json?.code === 0 && json.data?.b_3) {
      return { b3: json.data.b_3, b4: json.data.b_4 ?? "", ts: Date.now() };
    }
    throw new Error(`spi code=${json?.code}`);
  } catch {
    return { b3: randomBuvid3(), b4: "", ts: Date.now() };
  }
}
async function getBuvid(force = false) {
  if (!force && buvidCache && Date.now() - buvidCache.ts < BUVID_TTL_MS) {
    return buvidCache;
  }
  if (!buvidInflight) {
    buvidInflight = fetchBuvid().then((v) => {
      buvidCache = v;
      return v;
    }).finally(() => {
      buvidInflight = null;
    });
  }
  return buvidInflight;
}
function buildCookieHeader(userCookie, buvid) {
  const parts = [`buvid3=${buvid.b3}`];
  if (buvid.b4) {
    parts.push(`buvid4=${buvid.b4}`);
  }
  // config.json「哔哩哔哩Cookie」：登录态可选注入（SESSDATA 等），拼在自动 buvid 后面
  const user = String(userCookie ?? "").trim().replace(/^;+|;+$/g, "");
  if (user) {
    parts.push(user);
  }
  return parts.join("; ");
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor(seconds % 3600 / 60);
  const s = seconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}
function formatPubDate(ts) {
  const d = new Date(ts * 1e3);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
async function parse(lq, ctx = {}) {
  const 原始链接 = String(lq ?? "").trim();
  if (!原始链接) {
    return { 状态码: 403, 消息: "参数lq为空", 数据: null };
  }
  const 短链接匹配 = 原始链接.match(/https?:\/\/b23\.tv\/[a-zA-Z0-9]{7}/i);
  const BV号匹配 = 原始链接.match(/BV[a-zA-Z0-9]{10}/i);
  const userCookie = ctx?.cookie;
  let buvid = await getBuvid();
  const apiGet = async (url) => {
    try {
      return await fetchText(url, {
        headers: { Referer: BILIBILI_REFERER, Cookie: buildCookieHeader(userCookie, buvid) }
      });
    } catch (e) {
      if (!/\b412\b/.test(String(e?.message))) {
        throw e;
      }
      buvid = await getBuvid(true);
      return await fetchText(url, {
        headers: { Referer: BILIBILI_REFERER, Cookie: buildCookieHeader(userCookie, buvid) }
      });
    }
  };
  let BV号 = null;
  if (短链接匹配) {
    const 跳转后链接 = await followRedirect(短链接匹配[0], DEFAULT_USER_AGENT, {
      Referer: BILIBILI_REFERER,
      Cookie: buildCookieHeader(userCookie, buvid)
    });
    const 跳转BV号匹配 = 跳转后链接.match(/BV[a-zA-Z0-9]{10}/i);
    BV号 = 跳转BV号匹配?.[0] ?? BV号匹配?.[0] ?? null;
  } else {
    BV号 = BV号匹配?.[0] ?? null;
  }
  if (!BV号) {
    return { 状态码: 403, 消息: "未找到b23.tv短链接或BV号", 数据: null };
  }
  const 视频信息 = JSON.parse(await apiGet(`https://api.bilibili.com/x/web-interface/wbi/view?bvid=${BV号}`));
  if (视频信息.code !== 0 || !视频信息.data) {
    return { 状态码: 403, 消息: "获取视频信息失败", 数据: null };
  }
  const cid = 视频信息.data.cid;
  const 播放信息 = JSON.parse(await apiGet(
    `https://api.bilibili.com/x/player/wbi/playurl?gaia_source=view-card&fnval=4048&platform=html5&bvid=${BV号}&cid=${cid}`
  ));
  if (播放信息.code !== 0 || !播放信息.data?.durl?.[0]?.url) {
    return { 状态码: 403, 消息: "获取播放地址失败", 数据: null };
  }
  const durl = 播放信息.data.durl[0];
  let 视频时长 = 0;
  let 视频大小 = 0;
  if (durl.length != null) {
    视频时长 = Math.round(durl.length / 1e3);
  }
  if (durl.size != null) {
    视频大小 = Math.round(durl.size / (1024 * 1024) * 100) / 100;
  }
  const stat = 视频信息.data.stat ?? {};
  const 数据 = {
    视频标题: 视频信息.data.title ?? "",
    视频封面: 视频信息.data.pic ?? "",
    发布时间: 视频信息.data.pubdate ? formatPubDate(视频信息.data.pubdate) : "未知",
    // B 站未填简介时返回空字符串，?? 兜不住，需按空白判断
    视频描述: String(视频信息.data.desc ?? "").trim() || "无描述",
    视频链接: (durl.url ?? "").replace(/\\/g, ""),
    视频时长: formatDuration(视频时长),
    视频大小: `${视频大小}MB`,
    播放次数: stat.view ?? 0,
    弹幕数量: stat.danmaku ?? 0,
    点赞数量: stat.like ?? 0,
    投币数量: stat.coin ?? 0,
    收藏数量: stat.favorite ?? 0,
    分享数量: stat.share ?? 0,
    评论数量: stat.reply ?? 0
  };
  if (视频信息.data.owner?.mid != null) {
    数据.UP主信息 = {
      UP主ID: 视频信息.data.owner.mid,
      UP主名称: 视频信息.data.owner.name ?? "",
      UP主头像: 视频信息.data.owner.face ?? ""
    };
  }
  return { 状态码: 200, 消息: "获取成功", 数据 };
}
const blbl = { parse };

export { blbl as default, parse };
