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

const SM3_IV = [
  1937774191,
  1226093241,
  388252375,
  3666478592,
  2842636476,
  372324522,
  3817729613,
  2969243214
];
function rotl(x, n) {
  const s = n & 31;
  return (x << s | x >>> 32 - s) >>> 0;
}
function p0(x) {
  return (x ^ rotl(x, 9) ^ rotl(x, 17)) >>> 0;
}
function p1(x) {
  return (x ^ rotl(x, 15) ^ rotl(x, 23)) >>> 0;
}
function sm3(input) {
  const bitLen = input.length * 8;
  const padLen = (56 - (input.length + 1) % 64 + 64) % 64;
  const buf = new Uint8Array(input.length + 1 + padLen + 8);
  buf.set(input, 0);
  buf[input.length] = 128;
  const dv = new DataView(buf.buffer);
  dv.setUint32(buf.length - 8, Math.floor(bitLen / 4294967296), false);
  dv.setUint32(buf.length - 4, bitLen >>> 0, false);
  const v = SM3_IV.slice();
  const w = new Uint32Array(68);
  for (let off = 0; off < buf.length; off += 64) {
    for (let j = 0; j < 16; j++) w[j] = dv.getUint32(off + j * 4, false);
    for (let j = 16; j < 68; j++) {
      const x = (w[j - 16] ^ w[j - 9] ^ rotl(w[j - 3], 15)) >>> 0;
      w[j] = (p1(x) ^ rotl(w[j - 13], 7) ^ w[j - 6]) >>> 0;
    }
    let a = v[0], b = v[1], c = v[2], d = v[3];
    let e = v[4], f = v[5], g = v[6], h = v[7];
    for (let j = 0; j < 64; j++) {
      const t = j < 16 ? 2043430169 : 2055708042;
      const a12 = rotl(a, 12);
      const ss1 = rotl((a12 + e >>> 0) + rotl(t, j) >>> 0, 7);
      const ss2 = (ss1 ^ a12) >>> 0;
      const ff = j < 16 ? (a ^ b ^ c) >>> 0 : (a & b | a & c | b & c) >>> 0;
      const gg = j < 16 ? (e ^ f ^ g) >>> 0 : (e & f | ~e & g) >>> 0;
      const tt1 = (ff + d >>> 0) + ss2 + ((w[j] ^ w[j + 4]) >>> 0) >>> 0 >>> 0;
      const tt2 = (gg + h >>> 0) + ss1 + w[j] >>> 0 >>> 0;
      d = c;
      c = rotl(b, 9);
      b = a;
      a = tt1;
      h = g;
      g = rotl(f, 19);
      f = e;
      e = p0(tt2);
    }
    v[0] = (v[0] ^ a) >>> 0;
    v[1] = (v[1] ^ b) >>> 0;
    v[2] = (v[2] ^ c) >>> 0;
    v[3] = (v[3] ^ d) >>> 0;
    v[4] = (v[4] ^ e) >>> 0;
    v[5] = (v[5] ^ f) >>> 0;
    v[6] = (v[6] ^ g) >>> 0;
    v[7] = (v[7] ^ h) >>> 0;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) odv.setUint32(i * 4, v[i] >>> 0, false);
  return out;
}
function charCodes(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
  return out;
}
function fromCharCodes(list) {
  let s = "";
  for (const n of list) s += String.fromCharCode(n);
  return s;
}
function utf8Bytes(s) {
  return new TextEncoder().encode(s);
}
function jsShiftRight(val, n) {
  return Math.floor(val % 4294967296) >>> n;
}
const SALT = "cus";
const CHARSET = [
  "Dkdpgh2ZmsQB80/MfvV36XI1R45-WUAlEixNLwoqYTOPuzKFjJnry79HbGcaStCe",
  "ckdp1h4ZKsUB80/Mfvw36XIgR25+WQAlEi7NLboqYTOPuzmFjJnryx9HVGDaStCe"
];
const BIG_ARRAY_SEED = [
  121,
  243,
  55,
  234,
  103,
  36,
  47,
  228,
  30,
  231,
  106,
  6,
  115,
  95,
  78,
  101,
  250,
  207,
  198,
  50,
  139,
  227,
  220,
  105,
  97,
  143,
  34,
  28,
  194,
  215,
  18,
  100,
  159,
  160,
  43,
  8,
  169,
  217,
  180,
  120,
  247,
  45,
  90,
  11,
  27,
  197,
  46,
  3,
  84,
  72,
  5,
  68,
  62,
  56,
  221,
  75,
  144,
  79,
  73,
  161,
  178,
  81,
  64,
  187,
  134,
  117,
  186,
  118,
  16,
  241,
  130,
  71,
  89,
  147,
  122,
  129,
  65,
  40,
  88,
  150,
  110,
  219,
  199,
  255,
  181,
  254,
  48,
  4,
  195,
  248,
  208,
  32,
  116,
  167,
  69,
  201,
  17,
  124,
  125,
  104,
  96,
  83,
  80,
  127,
  236,
  108,
  154,
  126,
  204,
  15,
  20,
  135,
  112,
  158,
  13,
  1,
  188,
  164,
  210,
  237,
  222,
  98,
  212,
  77,
  253,
  42,
  170,
  202,
  26,
  22,
  29,
  182,
  251,
  10,
  173,
  152,
  58,
  138,
  54,
  141,
  185,
  33,
  157,
  31,
  252,
  132,
  233,
  235,
  102,
  196,
  191,
  223,
  240,
  148,
  39,
  123,
  92,
  82,
  128,
  109,
  57,
  24,
  38,
  113,
  209,
  245,
  2,
  119,
  153,
  229,
  189,
  214,
  230,
  174,
  232,
  63,
  52,
  205,
  86,
  140,
  66,
  175,
  111,
  171,
  246,
  133,
  238,
  193,
  99,
  60,
  74,
  91,
  225,
  51,
  76,
  37,
  145,
  211,
  166,
  151,
  213,
  206,
  0,
  200,
  244,
  176,
  218,
  44,
  184,
  172,
  49,
  216,
  93,
  168,
  53,
  21,
  183,
  41,
  67,
  85,
  224,
  155,
  226,
  242,
  87,
  177,
  146,
  70,
  190,
  12,
  162,
  19,
  137,
  114,
  25,
  165,
  163,
  192,
  23,
  59,
  9,
  94,
  179,
  107,
  35,
  7,
  142,
  131,
  239,
  203,
  149,
  136,
  61,
  249,
  14,
  156
];
function sm3ToArray(input) {
  const bytes = typeof input === "string" ? utf8Bytes(input) : new Uint8Array(input);
  return Array.from(sm3(bytes));
}
function paramsToArray(param, addSalt = true) {
  const processed = typeof param === "string" && addSalt ? param + SALT : param;
  return sm3ToArray(processed);
}
function transformBytes(bytesList) {
  const bigArray = BIG_ARRAY_SEED.slice();
  const size = bigArray.length;
  const bytesStr = fromCharCodes(bytesList);
  const result = [];
  let indexB = bigArray[1];
  let initialValue = 0;
  let valueE = 0;
  for (let index = 0; index < bytesStr.length; index++) {
    let sumInitial;
    if (index === 0) {
      initialValue = bigArray[indexB];
      sumInitial = indexB + initialValue;
      bigArray[1] = initialValue;
      bigArray[indexB] = indexB;
    } else {
      sumInitial = initialValue + valueE;
    }
    sumInitial %= size;
    result.push(bytesStr.charCodeAt(index) ^ bigArray[sumInitial]);
    valueE = bigArray[(index + 2) % size];
    sumInitial = (indexB + valueE) % size;
    initialValue = bigArray[sumInitial];
    bigArray[sumInitial] = bigArray[(index + 2) % size];
    bigArray[(index + 2) % size] = initialValue;
    indexB = sumInitial;
  }
  return fromCharCodes(result);
}
function base64Encode(input, alphabetIndex = 0) {
  const table = CHARSET[alphabetIndex];
  let binary = "";
  for (let i = 0; i < input.length; i++) {
    binary += (input.charCodeAt(i) & 255).toString(2).padStart(8, "0");
  }
  const padding = (6 - binary.length % 6) % 6;
  binary += "0".repeat(padding);
  let out = "";
  for (let i = 0; i < binary.length; i += 6) {
    out += table[parseInt(binary.slice(i, i + 6), 2)];
  }
  return out + "=".repeat(Math.floor(padding / 2));
}
function abogusEncode(input, alphabetIndex) {
  const table = CHARSET[alphabetIndex];
  const masks = [
    [18, 16515072],
    [12, 258048],
    [6, 4032],
    [0, 63]
  ];
  let out = "";
  for (let i = 0; i < input.length; i += 3) {
    let n;
    if (i + 2 < input.length) {
      n = input.charCodeAt(i) << 16 | input.charCodeAt(i + 1) << 8 | input.charCodeAt(i + 2);
    } else if (i + 1 < input.length) {
      n = input.charCodeAt(i) << 16 | input.charCodeAt(i + 1) << 8;
    } else {
      n = input.charCodeAt(i) << 16;
    }
    for (const [shift, mask] of masks) {
      if (shift === 6 && i + 1 >= input.length) break;
      if (shift === 0 && i + 2 >= input.length) break;
      out += table[(n & mask) >>> shift];
    }
  }
  return out + "=".repeat((4 - out.length % 4) % 4);
}
function rc4Encrypt(key, plaintext) {
  const s = [];
  for (let i2 = 0; i2 < 256; i2++) s.push(i2);
  let j = 0;
  for (let i2 = 0; i2 < 256; i2++) {
    j = (j + s[i2] + key[i2 % key.length]) % 256;
    [s[i2], s[j]] = [s[j], s[i2]];
  }
  let i = 0;
  j = 0;
  const out = [];
  for (let k = 0; k < plaintext.length; k++) {
    i = (i + 1) % 256;
    j = (j + s[i]) % 256;
    [s[i], s[j]] = [s[j], s[i]];
    out.push(plaintext.charCodeAt(k) ^ s[(s[i] + s[j]) % 256]);
  }
  return out;
}
function generateRandomBytes(length = 3) {
  const out = [];
  for (let n = 0; n < length; n++) {
    const rd = Math.floor(Math.random() * 1e4);
    out.push(rd & 255 & 170 | 1);
    out.push(rd & 255 & 85 | 2);
    out.push(jsShiftRight(rd, 8) & 170 | 5);
    out.push(jsShiftRight(rd, 8) & 85 | 40);
  }
  return fromCharCodes(out);
}
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function generateFingerprint(platform = "Win32") {
  const innerWidth = randInt(1024, 1920);
  const innerHeight = randInt(768, 1080);
  const outerWidth = innerWidth + randInt(24, 32);
  const outerHeight = innerHeight + randInt(75, 90);
  const screenY = Math.random() < 0.5 ? 0 : 30;
  const sizeWidth = randInt(1024, 1920);
  const sizeHeight = randInt(768, 1080);
  const availWidth = randInt(1280, 1920);
  const availHeight = randInt(800, 1080);
  return `${innerWidth}|${innerHeight}|${outerWidth}|${outerHeight}|0|${screenY}|0|0|${sizeWidth}|${sizeHeight}|${availWidth}|${availHeight}|${innerWidth}|${innerHeight}|24|24|${platform}`;
}
const MS_TOKEN_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789=_";
function generateMsToken(length = 107) {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += MS_TOKEN_CHARS[Math.floor(Math.random() * MS_TOKEN_CHARS.length)];
  }
  return out;
}
const AID = 6383;
const PAGE_ID = 0;
const UA_KEY = [0, 1, 14];
const SORT_INDEX = [
  18,
  20,
  52,
  26,
  30,
  34,
  58,
  38,
  40,
  53,
  42,
  21,
  27,
  54,
  55,
  31,
  35,
  57,
  39,
  41,
  43,
  22,
  28,
  32,
  60,
  36,
  23,
  29,
  33,
  37,
  44,
  45,
  59,
  46,
  47,
  48,
  49,
  50,
  24,
  25,
  65,
  66,
  70,
  71
];
const SORT_INDEX_2 = [
  18,
  20,
  26,
  30,
  34,
  38,
  40,
  42,
  21,
  27,
  31,
  35,
  39,
  41,
  43,
  22,
  28,
  32,
  36,
  23,
  29,
  33,
  37,
  44,
  45,
  46,
  47,
  48,
  49,
  50,
  24,
  25,
  52,
  53,
  54,
  55,
  57,
  58,
  59,
  60,
  65,
  66,
  70,
  71
];
function generateABogus(params, opts) {
  const options = opts.options ?? [0, 1, 14];
  const userAgent = opts.userAgent;
  const fingerprint = opts.fingerprint || generateFingerprint();
  const body = opts.body ?? "";
  const abDir = {
    8: 3,
    18: 44,
    66: 0,
    69: 0,
    70: 0,
    71: 0
  };
  const startEncryption = Date.now();
  const array1 = paramsToArray(paramsToArray(params));
  const array2 = paramsToArray(paramsToArray(body));
  const array3 = paramsToArray(
    base64Encode(fromCharCodes(rc4Encrypt(UA_KEY, userAgent)), 1),
    false
  );
  const endEncryption = Date.now();
  abDir[20] = startEncryption >>> 24 & 255;
  abDir[21] = startEncryption >>> 16 & 255;
  abDir[22] = startEncryption >>> 8 & 255;
  abDir[23] = startEncryption & 255;
  abDir[24] = Math.floor(startEncryption / 256 / 256 / 256 / 256);
  abDir[25] = Math.floor(startEncryption / 256 / 256 / 256 / 256 / 256);
  abDir[26] = options[0] >>> 24 & 255;
  abDir[27] = options[0] >>> 16 & 255;
  abDir[28] = options[0] >>> 8 & 255;
  abDir[29] = options[0] & 255;
  abDir[30] = Math.floor(options[1] / 256) & 255;
  abDir[31] = options[1] % 256 & 255;
  abDir[32] = options[1] >>> 24 & 255;
  abDir[33] = options[1] >>> 16 & 255;
  abDir[34] = options[2] >>> 24 & 255;
  abDir[35] = options[2] >>> 16 & 255;
  abDir[36] = options[2] >>> 8 & 255;
  abDir[37] = options[2] & 255;
  abDir[38] = array1[21];
  abDir[39] = array1[22];
  abDir[40] = array2[21];
  abDir[41] = array2[22];
  abDir[42] = array3[23];
  abDir[43] = array3[24];
  abDir[44] = endEncryption >>> 24 & 255;
  abDir[45] = endEncryption >>> 16 & 255;
  abDir[46] = endEncryption >>> 8 & 255;
  abDir[47] = endEncryption & 255;
  abDir[48] = abDir[8];
  abDir[49] = Math.floor(endEncryption / 256 / 256 / 256 / 256);
  abDir[50] = Math.floor(endEncryption / 256 / 256 / 256 / 256 / 256);
  abDir[51] = PAGE_ID >>> 24 & 255;
  abDir[52] = PAGE_ID >>> 16 & 255;
  abDir[53] = PAGE_ID >>> 8 & 255;
  abDir[54] = PAGE_ID & 255;
  abDir[55] = PAGE_ID;
  abDir[56] = AID;
  abDir[57] = AID & 255;
  abDir[58] = AID >>> 8 & 255;
  abDir[59] = AID >>> 16 & 255;
  abDir[60] = AID >>> 24 & 255;
  abDir[64] = fingerprint.length;
  abDir[65] = fingerprint.length;
  const sortedValues = SORT_INDEX.map((i) => abDir[i] ?? 0);
  let abXor = (fingerprint.length & 255) >>> 8 & 255;
  for (let index = 0; index < SORT_INDEX_2.length - 1; index++) {
    if (index === 0) abXor = abDir[SORT_INDEX_2[index]] ?? 0;
    abXor ^= abDir[SORT_INDEX_2[index + 1]] ?? 0;
  }
  sortedValues.push(...charCodes(fingerprint));
  sortedValues.push(abXor);
  const bytesStr = generateRandomBytes() + transformBytes(sortedValues);
  return abogusEncode(bytesStr, 0);
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
  try {
    const res = await fetch("https://ttwid.bytedance.com/ttwid/union/register/", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": WEB_UA },
      body: JSON.stringify({
        region: "cn",
        aid: 1768,
        needFid: false,
        service: "www.ixigua.com",
        migrate_info: { ticket: "", source: "node" },
        cbUrlProtocol: "https",
        union: true
      })
    });
    const setCookie = res.headers.get("set-cookie") || "";
    const matched = setCookie.match(/ttwid=([^;]+)/);
    if (matched) {
      ttwidCache = { value: matched[1], expire: Date.now() + 30 * 60 * 1e3 };
      return matched[1];
    }
  } catch {
  }
  return "";
}
function buildDetailParams(id, msToken) {
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
    ["round_trip_time", "50"],
    ["msToken", msToken]
  ];
  return params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
}
async function fetchDetailByApi(id) {
  const ttwid = await getTtwid();
  const fingerprint = generateFingerprint();
  let filterMsg = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(400 + Math.floor(Math.random() * 500));
    const msToken = generateMsToken();
    const params = buildDetailParams(id, msToken);
    const abogus = generateABogus(params, {
      userAgent: WEB_UA,
      fingerprint,
      options: [0, 1, 8]
    });
    const url = `${DETAIL_API}?${params}&a_bogus=${encodeURIComponent(abogus)}`;
    const cookie = [ttwid ? `ttwid=${ttwid}` : "", `msToken=${msToken}`].filter(Boolean).join("; ");
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": WEB_UA,
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "zh-CN,zh;q=0.9",
          Referer: `https://www.douyin.com/video/${id}`,
          ...cookie ? { Cookie: cookie } : {}
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
      return output(404, "解析失败，未找到有效内容（抖音接口签名被拒或分享页结构已变更，请稍后重试）");
    }
    return formatData(detail);
  } catch (e) {
    return output(500, e instanceof Error ? e.message : "解析失败");
  }
}
const dy = { parse };

export { dy as default, parse };
