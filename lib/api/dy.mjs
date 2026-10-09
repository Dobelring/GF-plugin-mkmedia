import { createCipheriv, createHash, randomBytes } from "node:crypto";
const DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.0.0 Safari/537.36";
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
async function followRedirect(url, userAgent = DEFAULT_USER_AGENT) {
  const res = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: { "User-Agent": userAgent }
  });
  return res.url || url;
}
function cleanUrlTail(url) {
  return url.replace(/[^\w\-./?=&:#]+$/u, "");
}
function extractBalancedJsonFrom(html, marker) {
  const startIdx = html.indexOf(marker);
  if (startIdx < 0) return null;
  const eqIdx = html.indexOf("=", startIdx);
  if (eqIdx < 0) return null;
  const braceStart = html.indexOf("{", eqIdx);
  if (braceStart < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  let quote = "";
  for (let i = braceStart; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return html.slice(braceStart, i + 1);
      }
    }
  }
  return null;
}

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";
function output(code, msg, data = {}) {
  return { code, msg, data };
}
function stripTags(text) {
  return text.replace(/<[^>]*>/g, "");
}
function extractDouyinUrl(text) {
  const shortMatch = text.match(/https?:\/\/v\.douyin\.com\/[\w-]+/i);
  if (shortMatch) return shortMatch[0].trim();
  const longMatch = text.match(/https?:\/\/(?:www\.)?douyin\.com\/[^\s]+/i);
  if (longMatch) return longMatch[0].trim().replace(/[^\w\-./?=&:#]+$/i, "");
  const anyMatch = text.match(/https?:\/\/[^\s]*douyin\.com[^\s]*/i);
  if (anyMatch) return anyMatch[0].trim().replace(/[^\w\-./?=&:#]+$/i, "");
  return text.trim();
}
function extractId(url) {
  const patterns = [
    /\/share\/note\/(\d+)/,
    /\/share\/video\/(\d+)/,
    /\/share\/slides\/(\d+)/,
    /\/video\/(\d+)/,
    /\/note\/(\d+)/,
    /\/slides\/(\d+)/,
    /modal_id=(\d+)/,
    /[?&]item_ids=(\d+)/,
    /^(\d+)$/
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}
function isNoteUrl(url) {
  return /\/note\/|share\/note/i.test(url);
}
function isSlidesUrl(url) {
  return /\/slides\/|share\/slides/i.test(url);
}
function buildShareFetchUrls(resolvedUrl, id) {
  const urls = [];
  if (isNoteUrl(resolvedUrl) || isSlidesUrl(resolvedUrl)) {
    urls.push(`https://m.douyin.com/share/note/${id}`);
    urls.push(`https://m.douyin.com/share/video/${id}`);
    urls.push(`https://m.douyin.com/share/slides/${id}/`);
    urls.push(`https://www.iesdouyin.com/share/note/${id}/`);
    urls.push(`https://www.iesdouyin.com/share/slides/${id}/`);
    urls.push(`https://www.douyin.com/note/${id}`);
  } else {
    urls.push(`https://m.douyin.com/share/video/${id}`);
    urls.push(`https://m.douyin.com/share/note/${id}`);
  }
  urls.push(`https://m.douyin.com/share/note/${id}`);
  urls.push(`https://m.douyin.com/share/video/${id}`);
  urls.push(`https://www.iesdouyin.com/share/video/${id}/`);
  urls.push(`https://www.douyin.com/video/${id}`);
  urls.push(`https://www.douyin.com/user/self?modal_id=${id}&showTab=like`);
  return [...new Set(urls)];
}
async function getRealUrl(url) {
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: { "User-Agent": MOBILE_UA }
    });
    const location = res.headers.get("location");
    if (location) {
      const loc = location;
      if (extractId(loc)) return loc;
      return loc;
    }
  } catch {
  }
  return followRedirect(url, MOBILE_UA);
}
function isBlockedHtml(html) {
  if (html.includes("waf-js") && html.length < 1e4) return true;
  if (html.length < 800 && !html.includes("_ROUTER_DATA") && !html.includes("RENDER_DATA")) return true;
  return false;
}
async function requestPage(url, userAgent = MOBILE_UA) {
  try {
    const html = await fetchText(
      url,
      {
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          Referer: "https://www.douyin.com/",
          "Cache-Control": "no-cache",
          Pragma: "no-cache"
        }
      },
      userAgent
    );
    if (isBlockedHtml(html)) return false;
    return html;
  } catch {
    return false;
  }
}
async function fetchDetailById(resolvedUrl, id) {
  const fetchUrls = buildShareFetchUrls(resolvedUrl, id);
  for (let round = 0; round < 2; round++) {
    if (round > 0) {
      await new Promise((r) => setTimeout(r, 400 + Math.floor(Math.random() * 400)));
    }
    for (const pageUrl of fetchUrls) {
      const preferMobile = pageUrl.includes("m.douyin.com") || pageUrl.includes("iesdouyin.com");
      const uas = preferMobile ? [MOBILE_UA, USER_AGENT] : [USER_AGENT, MOBILE_UA];
      for (const ua of uas) {
        const html = await requestPage(pageUrl, ua);
        if (!html) continue;
        const detail = extractJsonFromHtml(html);
        if (detail) return detail;
      }
    }
  }
  return null;
}
const WEB_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const DETAIL_API = "https://www.douyin.com/aweme/v1/web/aweme/detail/";
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
let ttwidCache = null;
async function getTtwid() {
  if (ttwidCache && ttwidCache.expire > Date.now()) return ttwidCache.value;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch("https://ttwid.bytedance.com/ttwid/union/register/", {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": WEB_UA },
        body: JSON.stringify({
          region: "cn",
          aid: 1768,
          needFid: false,
          service: "www.douyin.com",
          migrate_info: { ticket: "", source: "node" },
          cbUrlProtocol: "https",
          union: true
        })
      });
      const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [res.headers.get("set-cookie")].filter(Boolean);
      for (const line of setCookies) {
        const matched = line.match(/(?:^|;\s*)ttwid=([^;]+)/);
        if (matched) {
          ttwidCache = { value: matched[1], expire: Date.now() + 30 * 60 * 1e3 };
          return matched[1];
        }
      }
    } catch {
    }
  }
  return "";
}
/**
 * 抖音前端把设备标识 UIFID 用 AES-256-CBC 存进 cookie：明文 `fid_ip_fpk_2_webid`，
 * 密钥是下面这串 ASCII，IV 拼在密文头部。服务端只校验格式不校验内容，本地自造即可。
 */
const UIFID_KEY = "d5fe484db73f50ab7688217db62ce1d2";
const SIGN_SALT = "A96D855A08C0A9707F8BEF0D9A527E4E";
let uifidCache = "";
function generateUifid() {
  if (uifidCache) return uifidCache;
  const fid = randomBytes(8).toString("hex");
  const ip = `${1 + Math.floor(Math.random() * 220)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${1 + Math.floor(Math.random() * 253)}`;
  const fpk = Buffer.concat([Buffer.from("Salted__"), randomBytes(56)]).toString("base64");
  const webid = String(Math.floor(7e18 + Math.random() * 2e18));
  const plain = `${fid}_${ip}_${fpk}_2_${webid}`;
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", Buffer.from(UIFID_KEY, "utf8"), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  uifidCache = Buffer.concat([iv, encrypted]).toString("hex");
  return uifidCache;
}
function buildDetailParams(id) {
  const params = [
    ["device_platform", "webapp"],
    ["aid", "6383"],
    ["channel", "channel_pc_web"],
    ["aweme_id", id],
    ["pc_client_type", "1"],
    ["version_code", "190500"],
    ["version_name", "19.5.0"],
    ["cookie_enabled", "true"],
    ["screen_width", "1920"],
    ["screen_height", "1080"],
    ["browser_language", "zh-CN"],
    ["browser_platform", "Win32"],
    ["browser_name", "Chrome"],
    ["browser_version", "126.0.0.0"],
    ["browser_online", "true"],
    ["engine_name", "Blink"],
    ["engine_version", "126.0.0.0"],
    ["os_name", "Windows"],
    ["os_version", "10"],
    ["cpu_core_num", "12"],
    ["device_memory", "8"],
    ["platform", "PC"],
    ["downlink", "10"],
    ["effective_type", "4g"],
    ["round_trip_time", "50"]
  ];
  return params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
}
/** secsdk 加签：MD5(uifid_秒级时间戳_盐_查询串)，缺了会被 Argus 以 Sign Invalid 拒掉 */
function signDetailQuery(query, uifid, timestamp) {
  return createHash("md5").update(`${uifid}_${timestamp}_${SIGN_SALT}_${query}`, "utf8").digest("hex");
}
async function fetchDetailByApi(id) {
  const ttwid = await getTtwid();
  let filterMsg = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(400 + Math.floor(Math.random() * 500));
    const uifid = generateUifid();
    const timestamp = Math.floor(Date.now() / 1000);
    const query = `${buildDetailParams(id)}&uifid=${uifid}&timestamp=${timestamp}`;
    const url = `${DETAIL_API}?${query}&x-secsdk-web-signature=${signDetailQuery(query, uifid, timestamp)}`;
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": WEB_UA,
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "zh-CN,zh;q=0.9",
          Referer: `https://www.douyin.com/video/${id}`,
          ...ttwid ? { Cookie: `ttwid=${ttwid}` } : {}
        }
      });
      if (!res.ok) continue;
      const text = await res.text();
      if (!text.trim()) continue;
      const json = JSON.parse(text);
      const detail = json.aweme_detail ?? json.aweme_details?.[0];
      if (detail && (detail.video || detail.images)) return { detail };
      const msg = json.filter_detail?.detail_msg || json.filter_detail?.notice || "";
      if (msg) {
        filterMsg = msg;
        break;
      }
    } catch {
    }
  }
  if (!filterMsg) {
    // 整轮拿不到内容：换一套身份重试下一次调用，避免某个 uifid/ttwid 被风控标记后进程内一直卡死
    uifidCache = "";
    ttwidCache = null;
  }
  return filterMsg ? { filterMsg } : {};
}
function looksLikeDetail(node) {
  const hasMedia = node.video && typeof node.video === "object" || Array.isArray(node.images) && node.images.length > 0;
  if (!hasMedia) return false;
  return typeof node.desc === "string" || typeof node.aweme_id === "string" || typeof node.awemeId === "string" || node.author !== void 0 || node.authorInfo !== void 0;
}
function findDetailNode(node, depth = 0) {
  if (!node || typeof node !== "object" || depth > 8) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findDetailNode(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const obj = node;
  if (looksLikeDetail(obj)) return obj;
  for (const key of Object.keys(obj)) {
    const found = findDetailNode(obj[key], depth + 1);
    if (found) return found;
  }
  return null;
}
function extractJsonFromHtml(html) {
  const renderStart = '<script id="RENDER_DATA" type="application/json">';
  const posStart = html.indexOf(renderStart);
  if (posStart >= 0) {
    const jsonStr = html.slice(posStart + renderStart.length);
    const posEnd = jsonStr.indexOf("<\/script>");
    if (posEnd >= 0) {
      try {
        const decoded = decodeURIComponent(jsonStr.slice(0, posEnd));
        const data = JSON.parse(decoded);
        if (data.app?.videoDetail) return data.app.videoDetail;
      } catch {
      }
    }
  }
  const routerJson = extractBalancedJsonFrom(html, "window._ROUTER_DATA");
  if (routerJson) {
    try {
      const json = JSON.parse(routerJson);
      const loaderData = json.loaderData;
      if (loaderData) {
        for (const key of Object.keys(loaderData)) {
          const page = loaderData[key];
          if (page?.videoInfoRes?.item_list?.[0]) {
            return page.videoInfoRes.item_list[0];
          }
        }
        const found = findDetailNode(loaderData);
        if (found) return found;
      }
    } catch {
    }
  }
  return null;
}
function pickBestPlayUrl(candidates) {
  if (!candidates.length) return null;
  let v26Link = null;
  for (const candidate of candidates) {
    if (candidate.includes("v3-web")) return candidate;
    if (candidate.includes("v26-web")) v26Link = candidate;
  }
  if (v26Link) return v26Link.replace(/:\/\/([^/]+)/, "://v26-luna.douyinvod.com");
  return candidates[0];
}
function isAnimatedImageUrl(url) {
  const u = String(url || "").toLowerCase();
  if (!u) return false;
  if (u.includes(".gif")) return true;
  if (u.includes("awebp") || u.includes("animated")) return true;
  if (u.includes("lqen") || u.includes("livephoto") || u.includes("live_photo")) return true;
  return false;
}
function collectImageUrls(img) {
  const out = [];
  const lists = [img.url_list, img.urlList, img.download_url_list, img.downloadUrlList];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const s = String(item || "").trim();
      if (s && !out.includes(s)) out.push(s);
    }
  }
  return out;
}
function pickImageUrl(img) {
  const all = collectImageUrls(img);
  if (!all.length) return "";
  const animated = all.find((u) => isAnimatedImageUrl(u));
  return animated || all[0];
}
function isWatermarkedUrl(url) {
  const u = String(url || "");
  if (!u) return false;
  if (/playwm/i.test(u)) return true;
  if (/[?&]watermark=(1|true)(?=[&#]|$)/i.test(u)) return true;
  return false;
}
function stripWatermark(url) {
  let u = String(url || "");
  if (!u) return "";
  u = u.replace(/playwm/gi, "play");
  u = u.replace(/([?&]watermark=)(?:1|true)(?=[&#]|$)/gi, (_m, prefix) => `${prefix}0`);
  return u;
}
function cdnRank(url) {
  if (url.includes("v3-web")) return 0;
  if (url.includes("v26-web")) return 1;
  return 2;
}
function buildPlayApiUrl(videoInfo) {
  const fromPlayAddr = videoInfo.play_addr?.uri;
  const fromCamel = videoInfo.playAddr?.uri;
  const uri = [fromPlayAddr, fromCamel, videoInfo.uri].find((v) => typeof v === "string" && v);
  if (!uri) return null;
  return `https://aweme.snssdk.com/aweme/v1/play/?video_id=${encodeURIComponent(String(uri))}&ratio=1080p&line=0`;
}
function extractLiveVideoUrl(videoInfo) {
  if (!videoInfo || typeof videoInfo !== "object") return null;
  const candidates = [];
  const push = (value, weight) => {
    const s = typeof value === "string" ? value.trim() : "";
    if (s) candidates.push({ url: s, weight });
  };
  const pushList = (list, weight) => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      if (typeof item === "string") push(item, weight);
      else if (item && typeof item === "object") push(item.src, weight);
    }
  };
  const playAddr = videoInfo.playAddr;
  if (Array.isArray(playAddr)) {
    for (const addr of playAddr) push(addr?.src, 0);
  } else if (playAddr && typeof playAddr === "object") {
    pushList(playAddr.url_list, 0);
  }
  pushList(videoInfo.play_addr?.url_list, 0);
  for (const key of ["play_addr_h264", "play_addr_265", "play_addr_lowbr"]) {
    pushList(videoInfo[key]?.url_list, 1);
  }
  const bitRates = videoInfo.bit_rate || videoInfo.bitRateList || videoInfo.bit_rate_list;
  if (Array.isArray(bitRates)) {
    for (const rate of bitRates) {
      pushList(rate.play_addr?.url_list, 2);
      const pa2 = rate.playAddr;
      if (Array.isArray(pa2)) for (const a of pa2) push(a?.src, 2);
    }
  }
  push(videoInfo.playApi, 3);
  push(videoInfo.play_api, 3);
  if (videoInfo.download_addr && typeof videoInfo.download_addr === "object") {
    pushList(videoInfo.download_addr.url_list, 9);
  }
  let media = candidates.filter((c) => !/ies-music|\/obj\/ies-music\//i.test(c.url));
  if (!media.length) media = candidates;
  if (!media.length) return null;
  const score = (c) => (isWatermarkedUrl(c.url) ? 1e3 : 0) + c.weight * 10 + cdnRank(c.url);
  media.sort((a, b) => score(a) - score(b));
  const best = media[0];
  let url = stripWatermark(best.url);
  if (url.includes("v26-web")) url = url.replace(/:\/\/([^/]+)/, "://v26-luna.douyinvod.com");
  if (isWatermarkedUrl(url) || best.weight >= 9) {
    const clean = buildPlayApiUrl(videoInfo);
    if (clean) return clean;
  }
  return url;
}
function extractImageLiveVideo(img) {
  const nested = img.video || img.live_photo || img.livePhoto || img.clip || {};
  let url = extractLiveVideoUrl(nested);
  if (!url && typeof img.video === "string") url = img.video;
  if (!url && typeof img.live_video_url === "string") url = img.live_video_url;
  return url ? stripWatermark(url) : null;
}
function extractHighestQualityVideo(detail) {
  let url = null;
  const backup = [];
  const video = detail.video;
  const bitRateList = video?.bitRateList ?? video?.bit_rate ?? video?.bit_rate_list;
  if (Array.isArray(bitRateList) && bitRateList.length) {
    const sorted = [...bitRateList].sort(
      (a, b) => (Number(b.bitRate ?? b.bit_rate) || 0) - (Number(a.bitRate ?? a.bit_rate) || 0)
    );
    for (const rateItem of sorted) {
      const candidates = [];
      const playAddr = rateItem.playAddr;
      if (Array.isArray(playAddr)) {
        for (const pa of playAddr) {
          if (pa.src) candidates.push(pa.src);
        }
      } else {
        const playAddrSnake = rateItem.play_addr;
        if (playAddrSnake?.url_list) candidates.push(...playAddrSnake.url_list);
      }
      if (!candidates.length) continue;
      const cleanOnes = candidates.filter((c) => !isWatermarkedUrl(c));
      const pool = cleanOnes.length ? cleanOnes : candidates;
      const currentBest = pickBestPlayUrl(pool);
      if (!url && currentBest) url = currentBest;
      for (let candidate of pool) {
        if (candidate.includes("v26-web")) {
          candidate = candidate.replace(/:\/\/([^/]+)/, "://v26-luna.douyinvod.com");
        }
        candidate = stripWatermark(candidate);
        if (candidate !== url && !backup.includes(candidate)) backup.push(candidate);
      }
      if (url && backup.length) break;
    }
  }
  if (!url && video) {
    const uri = video.uri;
    const playApi = video.playApi ?? video.play_addr?.url_list?.[0];
    if (playApi) {
      url = stripWatermark(playApi);
    } else if (uri) {
      url = `https://aweme.snssdk.com/aweme/v1/play/?video_id=${encodeURIComponent(uri)}&ratio=720p&line=0`;
    }
    const urlList = video.play_addr?.url_list ?? [];
    for (let i = 1; i < urlList.length; i++) {
      backup.push(stripWatermark(urlList[i]));
    }
  }
  if (url) url = stripWatermark(url);
  if (url && isWatermarkedUrl(url) && video) {
    const clean = buildPlayApiUrl(video);
    if (clean) url = clean;
  }
  return { url, backup };
}
function extractCover(detail) {
  const video = detail.video;
  let cover = "";
  const originCover = video?.originCover;
  const originCoverSnake = video?.origin_cover;
  if (originCover?.urlList?.[0]) cover = originCover.urlList[0];
  else if (originCoverSnake?.url_list?.[0]) cover = originCoverSnake.url_list[0];
  else if (typeof video?.originCover === "string") cover = video.originCover;
  else if (Array.isArray(video?.originCoverUrlList) && video.originCoverUrlList[0]) {
    cover = String(video.originCoverUrlList[0]);
  }
  if (!cover && video) {
    const coverObj = video.cover;
    if (typeof coverObj === "string") cover = coverObj;
    else cover = coverObj?.urlList?.[0] ?? coverObj?.url_list?.[0] ?? "";
  }
  const detailCover = detail.cover;
  if (!cover && detailCover?.url_list?.[0]) cover = detailCover.url_list[0];
  if (!cover && video) {
    const dynamicCover = video.dynamicCover;
    const dynamicCoverSnake = video.dynamic_cover;
    cover = dynamicCover?.urlList?.[0] ?? dynamicCoverSnake?.url_list?.[0] ?? "";
  }
  return cover;
}
function formatData(detail) {
  const authorInfo = detail.authorInfo;
  const author = detail.author;
  const music = detail.music;
  const video = detail.video;
  const result = {
    type: "unknown",
    title: detail.desc ?? "",
    desc: detail.desc ?? "",
    author: {
      name: authorInfo?.nickname ?? author?.nickname ?? "",
      id: String(authorInfo?.uid ?? author?.uid ?? ""),
      avatar: authorInfo?.avatarUri ?? (author?.avatar_thumb?.url_list?.[0] ?? "")
    },
    cover: extractCover(detail),
    url: null,
    duration: video?.duration ?? null,
    video_backup: null,
    images: [],
    live_photo: [],
    music: {
      title: music?.musicName ?? music?.title ?? "",
      author: music?.ownerNickname ?? music?.author ?? "",
      url: music?.playUrl?.uri ?? music?.play_url?.uri ?? "",
      cover: music?.coverThumb?.urlList?.[0] ?? music?.cover_thumb?.url_list?.[0] ?? ""
    }
  };
  const images = detail.images;
  if (Array.isArray(images) && images.length) {
    result.type = "image";
    let animatedCount = 0;
    for (const img of images) {
      const imgUrl = pickImageUrl(img);
      if (imgUrl) {
        result.images.push(imgUrl);
        if (isAnimatedImageUrl(imgUrl)) animatedCount++;
      }
      const liveVideoUrl = extractImageLiveVideo(img);
      if (liveVideoUrl) {
        result.live_photo.push({ image: imgUrl || liveVideoUrl, video: liveVideoUrl });
      }
    }
    const descHint = /动图|实况|live\s*photo/i.test(result.desc || result.title || "");
    if (result.live_photo.length) {
      result.type = "live";
    } else if (animatedCount > 0 || descHint) {
      result.type = "animated";
      result.live_photo = result.images.map((image) => ({ image, video: "" }));
    }
    if (!result.cover && result.images.length) result.cover = result.images[0];
    if (!result.cover && result.live_photo.length) result.cover = result.live_photo[0].image;
  } else {
    result.type = "video";
    const videoInfo = extractHighestQualityVideo(detail);
    result.url = videoInfo.url;
    result.video_backup = videoInfo.backup.length ? videoInfo.backup : null;
    result.video_id = video?.uri ?? "";
  }
  return output(200, "解析成功", result);
}
async function parse(urlInput) {
  let url = cleanUrlTail(stripTags(extractDouyinUrl(urlInput)));
  if (!url) return output(400, "请输入抖音链接");
  try {
    let host = "";
    try {
      host = new URL(url).hostname;
    } catch {
      return output(400, "链接格式错误");
    }
    if (host === "v.douyin.com" || !url.includes("douyin.com") || !extractId(url)) {
      url = await getRealUrl(url);
    }
    const id = extractId(url);
    if (!id) {
      return output(400, `链接格式错误，无法提取ID。处理后的链接: ${url}`);
    }
    const api = await fetchDetailByApi(id);
    const detail = api.detail ?? await fetchDetailById(url, id);
    if (!detail) {
      if (api.filterMsg) return output(404, `解析失败：${api.filterMsg}`);
      return output(404, "解析失败，未找到有效内容（抖音接口风控拦截或分享页结构已变更，请稍后重试）");
    }
    return formatData(detail);
  } catch (e) {
    return output(500, e instanceof Error ? e.message : "解析失败");
  }
}
const dy = { parse };

export { dy as default, parse };
