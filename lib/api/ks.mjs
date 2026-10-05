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

const USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1 Edg/122.0.0.0";
function extractKuaishouUrl(text) {
  const shortMatch = text.match(/https?:\/\/v\.kuaishou\.com\/[\w-]+/i);
  if (shortMatch) return shortMatch[0].trim();
  const anyMatch = text.match(/https?:\/\/[^\s]*kuaishou\.com[^\s]*/i);
  if (anyMatch) return anyMatch[0].trim().replace(/[^\w\-./?=&:#]+$/i, "");
  return text.trim();
}
async function getRedirectedUrl(url) {
  try {
    return await followRedirect(url, USER_AGENT);
  } catch {
    return null;
  }
}
async function curlRequest(url) {
  try {
    return await fetchText(
      url,
      {
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.9",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
          "Upgrade-Insecure-Requests": "1"
        }
      },
      USER_AGENT
    );
  } catch {
    return false;
  }
}
function extractContentIdAndType(url) {
  const patterns = {
    "short-video": /short-video\/([^?]+)/,
    "long-video": /long-video\/([^?]+)/,
    photo: /photo\/([^?]+)/
  };
  for (const [type, pattern] of Object.entries(patterns)) {
    const match = url.match(pattern);
    if (match) return [type, match[1]];
  }
  return ["", ""];
}
function filterMediaData(data) {
  const filtered = {};
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith("tusjoh")) continue;
    const item = value;
    if (item.fid !== void 0 || item.photo !== void 0) {
      filtered[key] = value;
    }
  }
  return filtered;
}
function buildMusicInfo(photo) {
  const musicSource = photo.music ?? photo.soundTrack ?? {};
  return {
    name: musicSource.name ?? "",
    artist: musicSource.artist ?? "",
    cover: musicSource.imageUrls?.[0]?.url ?? musicSource.avatarUrls?.[0]?.url ?? "",
    url: musicSource.audioUrls?.[0]?.url ?? ""
  };
}
function parseInitState(pageContent) {
  let jsonString = extractBalancedJsonFrom(pageContent, "window.INIT_STATE");
  if (!jsonString) return null;
  jsonString = jsonString.replace(/;\s*$/, "");
  let data;
  try {
    data = JSON.parse(jsonString);
  } catch {
    let cleaned = jsonString.replace(/\\"/g, '"').replace(
      /"\{"err_msg":"launchApplication:fail"\}"/g,
      '"err_msg","launchApplication:fail"'
    ).replace(
      /"\{"err_msg":"system:access_denied"\}"/g,
      '"err_msg","system:access_denied"'
    );
    try {
      data = JSON.parse(cleaned);
    } catch (e) {
      return { code: 500, msg: `JSON解析错误: ${e instanceof Error ? e.message : "unknown"}` };
    }
  }
  const filteredData = filterMediaData(data);
  if (!Object.keys(filteredData).length) return null;
  const firstItem = Object.values(filteredData)[0];
  const photo = firstItem.photo ?? {};
  const musicInfo = buildMusicInfo(photo);
  const atlas = photo.ext_params;
  const imageList = atlas?.atlas?.list ?? [];
  if (imageList.length) {
    return {
      code: 200,
      msg: "success",
      data: {
        type: "image",
        title: photo.caption ?? "",
        author: photo.userName ?? "",
        avatar: photo.headUrl ?? "",
        count: imageList.length,
        like: Number(photo.likeCount) || 0,
        time: Number(photo.timestamp) || 0,
        music: "http://txmov2.a.kwimgs.com" + (atlas?.atlas?.music ?? ""),
        images: imageList.map((path) => `http://tx2.a.yximgs.com/${path}`),
        cover: imageList[0] ? `http://tx2.a.yximgs.com/${imageList[0]}` : "",
        url: imageList[0] ? `http://tx2.a.yximgs.com/${imageList[0]}` : "",
        api: 1
      }
    };
  }
  if (photo.photoType === "SINGLE_PICTURE" || photo.singlePicture === true) {
    const coverUrls = photo.coverUrls;
    const imageUrl = coverUrls?.[0]?.url ?? "";
    if (imageUrl) {
      return {
        code: 200,
        msg: "解析成功",
        data: {
          type: "image",
          author: photo.userName ?? "",
          avatar: photo.headUrl ?? "",
          like: Number(photo.likeCount) || 0,
          time: Number(photo.timestamp) || 0,
          title: photo.caption ?? "",
          cover: imageUrl,
          url: imageUrl,
          images: [imageUrl],
          music: musicInfo
        }
      };
    }
  }
  if (photo.mainMvUrls || photo.photoType === "VIDEO") {
    const mainMvUrls = photo.mainMvUrls;
    let videoUrl = mainMvUrls?.[0]?.url ?? "";
    const manifest = photo.manifest;
    if (!videoUrl) {
      videoUrl = manifest?.adaptationSet?.[0]?.representation?.[0]?.url ?? "";
    }
    if (videoUrl) {
      const coverUrls = photo.coverUrls;
      return {
        code: 200,
        msg: "解析成功",
        data: {
          type: "video",
          author: photo.userName ?? "",
          avatar: photo.headUrl ?? "",
          like: Number(photo.likeCount) || 0,
          time: Number(photo.timestamp) || 0,
          title: photo.caption ?? "",
          cover: coverUrls?.[0]?.url ?? "",
          url: videoUrl,
          music: musicInfo
        }
      };
    }
  }
  return null;
}
function parseApolloState(pageContent, contentId, contentType) {
  let raw = extractBalancedJsonFrom(pageContent, "window.__APOLLO_STATE__");
  if (!raw) return null;
  let cleanedData = raw.replace(/function\s*\([^)]*\)\s*{[^}]*}/g, ":").replace(/,\s*(?=}|])/g, "").replace(/;\(:?\(\)\);/g, "");
  let apolloState;
  try {
    apolloState = JSON.parse(cleanedData);
  } catch {
    return null;
  }
  const videoInfo = apolloState.defaultClient;
  if (!videoInfo) return null;
  const key = `VisionVideoDetailPhoto:${contentId}`;
  const videoData = videoInfo[key];
  if (!videoData) return null;
  let authorData = null;
  for (const k of Object.keys(videoInfo)) {
    if (k.startsWith("VisionVideoDetailAuthor:")) {
      authorData = videoInfo[k];
      break;
    }
  }
  let videoUrl = "";
  if (contentType === "long-video") {
    const manifestH265 = videoData.manifestH265;
    videoUrl = manifestH265?.json?.adaptationSet?.[0]?.representation?.[0]?.backupUrl?.[0] ?? "";
  } else {
    videoUrl = videoData.photoUrl ?? "";
  }
  if (!videoUrl) return null;
  return {
    code: 200,
    msg: "解析成功",
    data: {
      type: contentType === "photo" ? "image" : "video",
      author: authorData?.name ?? "",
      avatar: authorData?.headerUrl ?? "",
      title: videoData.caption ?? "",
      cover: videoData.coverUrl ?? "",
      url: videoUrl,
      like: 0,
      time: 0
    }
  };
}
async function parse(urlInput) {
  const url = cleanUrlTail(extractKuaishouUrl(urlInput));
  if (!url) return { code: 201, msg: "url为空" };
  try {
    const redirectUrl = await getRedirectedUrl(url);
    if (!redirectUrl) return { code: 400, msg: "无法获取有效链接" };
    const pageContent = await curlRequest(redirectUrl);
    if (pageContent === false) return { code: 500, msg: "页面内容获取失败" };
    const [contentType, contentId] = extractContentIdAndType(redirectUrl);
    if (!contentId) return { code: 400, msg: "无法识别的链接类型" };
    const result = parseInitState(pageContent) ?? parseApolloState(pageContent, contentId, contentType);
    return result ?? { code: 404, msg: "未找到有效媒体信息" };
  } catch (e) {
    return { code: 500, msg: e instanceof Error ? e.message : "解析失败" };
  }
}
const ks = { parse };

export { ks as default, parse };
