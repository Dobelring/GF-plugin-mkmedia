/**
 * 表情制作渲染核心 —— 移植自 kakake-plugin-mkbot（作者：三个句号）。
 * 素材来自其 默认资源/image/api/bqb/（本插件 assets/bqb/）。
 *
 * 全部函数只依赖注入的 sharp 与 node 内置模块；输出统一为
 * { buffer, mime, ext }，发送由上层负责（官方机器人走分片上传）。
 *
 * input 形状：{ env: { sharp, assetsDir }, avatar?, selfAvatar?, targetAvatar?, displayName?, date?, text? }
 */

import fs from 'node:fs';
import path from 'node:path';

function resolveBqbSubdir(assetsDir, kind) {
  const dir = path.join(String(assetsDir || ''), kind);
  return fs.existsSync(dir) ? dir : '';
}

function templatePath(dir, index, ext, pad = 0) {
  const name = pad > 0 ? `${String(index).padStart(pad, '0')}.${ext}` : `${index}.${ext}`;
  return path.join(dir, name);
}

async function prepareAvatarPng(sharp, avatarBuf, options = {}) {
  const circle = options.circle !== false;
  const size = Math.max(0, Math.floor(Number(options.size) || 0));
  const meta = await sharp(avatarBuf).metadata();
  const aw = Number(meta.width) || 0;
  const ah = Number(meta.height) || 0;
  let pipeline = sharp(avatarBuf).rotate().ensureAlpha();
  if (aw > 0 && ah > 0 && aw !== ah) {
    const side = Math.min(aw, ah);
    const left = Math.floor((aw - side) / 2);
    const top = Math.floor((ah - side) / 2);
    pipeline = sharp(avatarBuf).rotate().extract({ left, top, width: side, height: side }).ensureAlpha();
  }
  if (size > 0) {
    pipeline = pipeline.resize(size, size, { fit: 'fill', kernel: 'lanczos3' });
  }
  const png = await pipeline.png().toBuffer();
  if (!circle) return png;
  const info = await sharp(png).metadata();
  const side = Math.max(1, Number(info.width) || size || 100);
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}"><circle cx="${side / 2}" cy="${side / 2}" r="${side / 2}" fill="white"/></svg>`
  );
  return sharp(png).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}

async function prepareAvatarOvalFitPng(sharp, avatarBuf, maxW, maxH) {
  const png = await sharp(avatarBuf).rotate().resize(maxW, maxH, { fit: 'inside', kernel: 'linear' }).ensureAlpha().png().toBuffer();
  const info = await sharp(png).metadata();
  const w = Math.max(1, Number(info.width) || maxW);
  const h = Math.max(1, Number(info.height) || maxH);
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}" fill="white"/></svg>`
  );
  return sharp(png).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}

async function composeAvatarUnderTemplate(sharp, templateFile, avatarPng, loc) {
  const tplMeta = await sharp(templateFile).metadata();
  const cw = Math.max(1, Number(tplMeta.width) || 1);
  const ch = Math.max(1, Number(tplMeta.height) || 1);
  const w = Math.max(1, Math.floor(loc.w));
  const h = Math.max(1, Math.floor(loc.h));
  const avatarResized = await sharp(avatarPng).resize(w, h, { fit: 'fill', kernel: 'linear' }).png().toBuffer();
  const templatePng = await sharp(templateFile).ensureAlpha().png().toBuffer();
  return sharp({ create: { width: cw, height: ch, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: avatarResized, left: Math.floor(loc.x), top: Math.floor(loc.y) },
      { input: templatePng, left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
}

async function composeAvatarOverTemplate(sharp, templateFile, avatarPng, loc) {
  const w = Math.max(1, Math.floor(loc.w));
  const h = Math.max(1, Math.floor(loc.h));
  const avatarResized = await sharp(avatarPng).resize(w, h, { fit: 'fill', kernel: 'linear' }).png().toBuffer();
  return sharp(templateFile).ensureAlpha().composite([{ input: avatarResized, left: Math.floor(loc.x), top: Math.floor(loc.y) }]).png().toBuffer();
}

async function composeAvatarOnWhiteWithTemplate(sharp, templateFile, avatarPng, loc) {
  const tplMeta = await sharp(templateFile).metadata();
  const cw = Math.max(1, Number(tplMeta.width) || 1);
  const ch = Math.max(1, Number(tplMeta.height) || 1);
  const w = Math.max(1, Math.floor(loc.w));
  const h = Math.max(1, Math.floor(loc.h));
  const avatarResized = await sharp(avatarPng).resize(w, h, { fit: 'fill', kernel: 'linear' }).png().toBuffer();
  const templatePng = await sharp(templateFile).ensureAlpha().png().toBuffer();
  return sharp({ create: { width: cw, height: ch, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
    .composite([
      { input: avatarResized, left: Math.floor(loc.x), top: Math.floor(loc.y) },
      { input: templatePng, left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
}

async function composeRubFrame(sharp, templateFile, selfAvatarPng, targetAvatarPng, targetLoc, selfLoc) {
  const targetResized = await sharp(targetAvatarPng)
    .resize(Math.max(1, Math.floor(targetLoc.w)), Math.max(1, Math.floor(targetLoc.h)), { fit: 'fill', kernel: 'lanczos3' })
    .png()
    .toBuffer();
  let selfPipeline = sharp(selfAvatarPng).resize(
    Math.max(1, Math.floor(selfLoc.w)),
    Math.max(1, Math.floor(selfLoc.h)),
    { fit: 'fill', kernel: 'lanczos3' }
  );
  const angle = Number(selfLoc.angle) || 0;
  if (angle !== 0) {
    selfPipeline = selfPipeline.rotate(angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
  }
  const selfResized = await selfPipeline.png().toBuffer();
  return sharp(templateFile)
    .ensureAlpha()
    .composite([
      { input: targetResized, left: Math.floor(targetLoc.x), top: Math.floor(targetLoc.y) },
      { input: selfResized, left: Math.floor(selfLoc.x), top: Math.floor(selfLoc.y) },
    ])
    .png()
    .toBuffer();
}

/** 竖向拼接所有帧 + pageHeight 让 sharp 视为多页，一次输出 GIF */
async function encodeGifFromPngFrames(sharp, frames, delayMs) {
  if (!frames.length) throw new Error('bqb: empty gif frames');
  const firstMeta = await sharp(frames[0]).metadata();
  const fw = Math.max(1, Number(firstMeta.width) || 1);
  const fh = Math.max(1, Number(firstMeta.height) || 1);
  const normalized = [];
  for (const frame of frames) {
    normalized.push(await sharp(frame).ensureAlpha().resize(fw, fh, { fit: 'fill' }).png().toBuffer());
  }
  const delays = Array.isArray(delayMs)
    ? delayMs.map((d) => Math.max(20, Math.floor(d)))
    : Math.max(20, Math.floor(delayMs));
  return sharp({
    create: {
      width: fw,
      height: fh * normalized.length,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      pageHeight: fh,
    },
  })
    .composite(normalized.map((input, i) => ({ input, left: 0, top: i * fh })))
    .gif({ delay: delays, loop: 0, effort: 1 })
    .toBuffer();
}

/* ───────────────────────── 渲染函数 ───────────────────────── */

export async function renderCrawl(input) {
  const { sharp, env } = input;
  const dir = resolveBqbSubdir(env.assetsDir, 'crawl');
  if (!dir) throw new Error('bqb-crawl: 素材目录不存在');
  let num = Math.floor(Number(input.num) || 0);
  if (num < 1 || num > 92) num = 1 + Math.floor(Math.random() * 92);
  const tpl = templatePath(dir, num, 'jpg', 2);
  if (!fs.existsSync(tpl)) throw new Error(`bqb-crawl: 模板不存在 ${num}`);
  const avatarPng = await prepareAvatarPng(sharp, input.avatar, { circle: true, size: 100 });
  const composed = await sharp(tpl).ensureAlpha().composite([{ input: avatarPng, left: 0, top: 400 }]).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  return { buffer: composed, mime: 'image/jpeg', ext: 'jpg' };
}

const PLAY_LOCS = [
  { x: 180, y: 60, w: 100, h: 100 }, { x: 184, y: 75, w: 100, h: 100 }, { x: 183, y: 98, w: 100, h: 100 },
  { x: 179, y: 118, w: 110, h: 100 }, { x: 156, y: 194, w: 150, h: 48 }, { x: 178, y: 136, w: 122, h: 69 },
  { x: 175, y: 66, w: 122, h: 85 }, { x: 170, y: 42, w: 130, h: 96 }, { x: 175, y: 34, w: 118, h: 95 },
  { x: 179, y: 35, w: 110, h: 93 }, { x: 180, y: 54, w: 102, h: 93 }, { x: 183, y: 58, w: 97, h: 92 },
  { x: 174, y: 35, w: 120, h: 94 }, { x: 179, y: 35, w: 109, h: 93 }, { x: 181, y: 54, w: 101, h: 92 },
  { x: 182, y: 59, w: 98, h: 92 }, { x: 183, y: 71, w: 90, h: 96 }, { x: 180, y: 131, w: 92, h: 101 },
];
export async function renderPlay(input) {
  const { sharp, env } = input;
  const dir = resolveBqbSubdir(env.assetsDir, 'play');
  if (!dir) throw new Error('bqb-play: 素材目录不存在');
  const avatarPng = await prepareAvatarPng(sharp, input.avatar, { circle: true });
  const imgFrames = [];
  for (let i = 0; i < 18; i++) {
    const tpl = templatePath(dir, i, 'png');
    if (!fs.existsSync(tpl)) throw new Error(`bqb-play: 模板不存在 ${i}`);
    imgFrames.push(await composeAvatarUnderTemplate(sharp, tpl, avatarPng, PLAY_LOCS[i]));
  }
  const rawFrames = [];
  for (let i = 18; i < 38; i++) {
    const tpl = templatePath(dir, i, 'png');
    if (!fs.existsSync(tpl)) throw new Error(`bqb-play: 模板不存在 ${i}`);
    rawFrames.push(await sharp(tpl).ensureAlpha().png().toBuffer());
  }
  const sequence = [...imgFrames.slice(0, 12), ...imgFrames.slice(0, 12), ...imgFrames.slice(0, 8), ...imgFrames.slice(12, 18), ...rawFrames];
  const buffer = await encodeGifFromPngFrames(sharp, sequence, 60);
  return { buffer, mime: 'image/gif', ext: 'gif' };
}

const BITE_LOCS = [
  { x: 90, y: 90, w: 105, h: 150 }, { x: 90, y: 83, w: 96, h: 172 }, { x: 90, y: 90, w: 106, h: 148 },
  { x: 88, y: 88, w: 97, h: 167 }, { x: 90, y: 85, w: 89, h: 179 }, { x: 90, y: 90, w: 106, h: 151 },
];
export async function renderBite(input) {
  const { sharp, env } = input;
  const dir = resolveBqbSubdir(env.assetsDir, 'bite');
  if (!dir) throw new Error('bqb-bite: 素材目录不存在');
  const avatarPng = await prepareAvatarPng(sharp, input.avatar, { circle: true });
  const frames = [];
  for (let i = 0; i < 6; i++) {
    const tpl = templatePath(dir, i, 'png');
    if (!fs.existsSync(tpl)) throw new Error(`bqb-bite: 模板不存在 ${i}`);
    frames.push(await composeAvatarUnderTemplate(sharp, tpl, avatarPng, BITE_LOCS[i]));
  }
  for (let i = 6; i < 16; i++) {
    const tpl = templatePath(dir, i, 'png');
    if (!fs.existsSync(tpl)) throw new Error(`bqb-bite: 模板不存在 ${i}`);
    frames.push(await sharp(tpl).ensureAlpha().png().toBuffer());
  }
  const buffer = await encodeGifFromPngFrames(sharp, frames, 70);
  return { buffer, mime: 'image/gif', ext: 'gif' };
}

const PETPET_LOCS = [
  { x: 14, y: 20, w: 98, h: 98 }, { x: 12, y: 33, w: 101, h: 85 }, { x: 8, y: 40, w: 110, h: 76 },
  { x: 10, y: 33, w: 102, h: 84 }, { x: 12, y: 20, w: 98, h: 98 },
];
export async function renderPetpet(input) {
  const { sharp, env } = input;
  const dir = resolveBqbSubdir(env.assetsDir, 'petpet');
  if (!dir) throw new Error('bqb-petpet: 素材目录不存在');
  const avatarPng = await prepareAvatarPng(sharp, input.avatar, { circle: input.circle !== false });
  const frames = [];
  for (let i = 0; i < PETPET_LOCS.length; i++) {
    const tpl = templatePath(dir, i, 'png');
    if (!fs.existsSync(tpl)) throw new Error(`bqb-petpet: 模板不存在 ${i}`);
    frames.push(await composeAvatarUnderTemplate(sharp, tpl, avatarPng, PETPET_LOCS[i]));
  }
  const buffer = await encodeGifFromPngFrames(sharp, frames, 60);
  return { buffer, mime: 'image/gif', ext: 'gif' };
}

const EAT_LOC = { x: 2, y: 38, w: 34, h: 34 };
export async function renderEat(input) {
  const { sharp, env } = input;
  const dir = resolveBqbSubdir(env.assetsDir, 'eat');
  if (!dir) throw new Error('bqb-eat: 素材目录不存在');
  const avatarPng = await prepareAvatarPng(sharp, input.avatar, { circle: false });
  const frames = [];
  for (let i = 0; i < 3; i++) {
    const tpl = templatePath(dir, i, 'png');
    if (!fs.existsSync(tpl)) throw new Error(`bqb-eat: 模板不存在 ${i}`);
    frames.push(await composeAvatarOnWhiteWithTemplate(sharp, tpl, avatarPng, EAT_LOC));
  }
  const buffer = await encodeGifFromPngFrames(sharp, frames, 50);
  return { buffer, mime: 'image/gif', ext: 'gif' };
}

const SUCK_LOCS = [
  { x: 82, y: 100, w: 130, h: 119 }, { x: 82, y: 94, w: 126, h: 125 }, { x: 82, y: 120, w: 128, h: 99 },
  { x: 81, y: 164, w: 132, h: 55 }, { x: 79, y: 163, w: 132, h: 55 }, { x: 82, y: 140, w: 127, h: 79 },
  { x: 83, y: 152, w: 125, h: 67 }, { x: 75, y: 157, w: 140, h: 62 }, { x: 72, y: 165, w: 144, h: 54 },
  { x: 80, y: 132, w: 128, h: 87 }, { x: 81, y: 127, w: 127, h: 92 }, { x: 79, y: 111, w: 132, h: 108 },
];
export async function renderSuck(input) {
  const { sharp, env } = input;
  const dir = resolveBqbSubdir(env.assetsDir, 'suck');
  if (!dir) throw new Error('bqb-suck: 素材目录不存在');
  const avatarPng = await prepareAvatarPng(sharp, input.avatar, { circle: true });
  const frames = [];
  for (let i = 0; i < SUCK_LOCS.length; i++) {
    const tpl = templatePath(dir, i, 'png');
    if (!fs.existsSync(tpl)) throw new Error(`bqb-suck: 模板不存在 ${i}`);
    frames.push(await composeAvatarOnWhiteWithTemplate(sharp, tpl, avatarPng, SUCK_LOCS[i]));
  }
  const buffer = await encodeGifFromPngFrames(sharp, frames, 80);
  return { buffer, mime: 'image/gif', ext: 'gif' };
}

export async function renderJiujiu(input) {
  const { sharp, env } = input;
  const dir = resolveBqbSubdir(env.assetsDir, 'jiujiu');
  if (!dir) throw new Error('bqb-jiujiu: 素材目录不存在');
  const avatarPng = await prepareAvatarOvalFitPng(sharp, input.avatar, 75, 51);
  const frames = [];
  for (let i = 0; i < 8; i++) {
    const tpl = templatePath(dir, i, 'png');
    if (!fs.existsSync(tpl)) throw new Error(`bqb-jiujiu: 模板不存在 ${i}`);
    const tplMeta = await sharp(tpl).metadata();
    const cw = Math.max(1, Number(tplMeta.width) || 1);
    const ch = Math.max(1, Number(tplMeta.height) || 1);
    const templatePng = await sharp(tpl).ensureAlpha().png().toBuffer();
    frames.push(
      await sharp({ create: { width: cw, height: ch, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([
          { input: avatarPng, left: 5, top: 0 },
          { input: templatePng, left: 0, top: 0 },
        ])
        .png()
        .toBuffer()
    );
  }
  const buffer = await encodeGifFromPngFrames(sharp, frames, 60);
  return { buffer, mime: 'image/gif', ext: 'gif' };
}

const SCRATCH_LOCS = [
  { x: 4, y: 5, w: 53, h: 46 }, { x: 7, y: 6, w: 50, h: 45 }, { x: 6, y: 8, w: 50, h: 42 },
  { x: 7, y: 7, w: 50, h: 44 }, { x: 4, y: 8, w: 53, h: 42 }, { x: 7, y: 7, w: 52, h: 45 },
];
export async function renderScratchHead(input) {
  const { sharp, env } = input;
  const dir = resolveBqbSubdir(env.assetsDir, 'scratch_head');
  if (!dir) throw new Error('bqb-scratch-head: 素材目录不存在');
  const avatarPng = await prepareAvatarPng(sharp, input.avatar, { circle: true, size: 68 });
  const frames = [];
  for (let i = 0; i < SCRATCH_LOCS.length; i++) {
    const tpl = templatePath(dir, i, 'png');
    if (!fs.existsSync(tpl)) throw new Error(`bqb-scratch-head: 模板不存在 ${i}`);
    frames.push(await composeAvatarOverTemplate(sharp, tpl, avatarPng, SCRATCH_LOCS[i]));
  }
  const buffer = await encodeGifFromPngFrames(sharp, frames, 100);
  return { buffer, mime: 'image/gif', ext: 'gif' };
}

const RUB_TARGET_LOCS = [
  { x: 39, y: 91, w: 75, h: 75 }, { x: 49, y: 101, w: 75, h: 75 }, { x: 67, y: 98, w: 75, h: 75 },
  { x: 55, y: 86, w: 75, h: 75 }, { x: 61, y: 109, w: 75, h: 75 }, { x: 65, y: 101, w: 75, h: 75 },
];
const RUB_SELF_LOCS = [
  { x: 102, y: 95, w: 70, h: 80, angle: 0 }, { x: 108, y: 60, w: 50, h: 100, angle: 0 },
  { x: 97, y: 18, w: 65, h: 95, angle: 0 }, { x: 65, y: 5, w: 75, h: 75, angle: -20 },
  { x: 95, y: 57, w: 100, h: 55, angle: -70 }, { x: 109, y: 107, w: 65, h: 75, angle: 0 },
];
export async function renderRub(input) {
  const { sharp, env } = input;
  const dir = resolveBqbSubdir(env.assetsDir, 'rub');
  if (!dir) throw new Error('bqb-rub: 素材目录不存在');
  const selfPng = await prepareAvatarPng(sharp, input.selfAvatar, { circle: true });
  const targetPng = await prepareAvatarPng(sharp, input.targetAvatar, { circle: true });
  const frames = [];
  for (let i = 0; i < 6; i++) {
    const tpl = templatePath(dir, i, 'png');
    if (!fs.existsSync(tpl)) throw new Error(`bqb-rub: 模板不存在 ${i}`);
    frames.push(await composeRubFrame(sharp, tpl, selfPng, targetPng, RUB_TARGET_LOCS[i], RUB_SELF_LOCS[i]));
  }
  const buffer = await encodeGifFromPngFrames(sharp, frames, 50);
  return { buffer, mime: 'image/gif', ext: 'gif' };
}

function escapeXml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function parseDateParts(dateStr) {
  const raw = String(dateStr ?? '').trim();
  if (raw) {
    const m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
    throw new Error('bqb-abstinence: 日期格式应为 YYYY-MM-DD');
  }
  const now = new Date();
  return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
}

function buildTextOverlaySvg(width, height, name, y, mo, d) {
  const font = 'Noto Sans SC, Microsoft YaHei, PingFang SC, sans-serif';
  const safeName = escapeXml(name);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><text x="150" y="690" font-family="${font}" font-size="18" fill="#000">戒导人：<tspan text-decoration="underline">${safeName}</tspan></text><text x="150" y="780" font-family="${font}" font-size="20" fill="#000"><tspan text-decoration="underline">${y}</tspan>年<tspan text-decoration="underline"> ${mo} </tspan>月<tspan text-decoration="underline"> ${d} </tspan>日</text></svg>`;
  return Buffer.from(svg);
}

export async function renderAbstinence(input) {
  const { sharp, env } = input;
  const dir = resolveBqbSubdir(env.assetsDir, 'abstinence');
  const basePath = path.join(dir, 'base.png');
  const stampPath = path.join(dir, 'stamp.png');
  if (!dir || !fs.existsSync(basePath) || !fs.existsSync(stampPath)) {
    throw new Error('bqb-abstinence: 素材不存在（需 base.png、stamp.png）');
  }
  const displayName = String(input.displayName ?? '').trim() || '戒导人';
  const { y, m, d } = parseDateParts(input.date);
  const baseMeta = await sharp(basePath).metadata();
  const cw = Math.max(1, Number(baseMeta.width) || 900);
  const ch = Math.max(1, Number(baseMeta.height) || 900);
  const avatarPng = await sharp(input.avatar).rotate().resize(270, 360, { fit: 'inside', kernel: 'linear' }).png().toBuffer();
  const textSvg = buildTextOverlaySvg(cw, ch, displayName, y, m, d);
  const buffer = await sharp(basePath)
    .ensureAlpha()
    .composite([
      { input: textSvg, left: 0, top: 0 },
      { input: avatarPng, left: 80, top: 380 },
      { input: stampPath, left: 310, top: 660 },
    ])
    .png()
    .toBuffer();
  return { buffer, mime: 'image/png', ext: 'png' };
}

const ACG_DEFAULT_TEXT = '走，跟我去二次元吧';
function buildTextSvg(width, height, text) {
  const font = 'Noto Sans SC, Microsoft YaHei, PingFang SC, sans-serif';
  const safe = escapeXml(text);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><style>text{font-family:${font};fill:#fff;font-weight:600;}</style><text x="30" y="780" font-size="38">${safe}</text></svg>`;
  return Buffer.from(svg);
}

export async function renderAcgEntrance(input) {
  const { sharp, env } = input;
  const dir = resolveBqbSubdir(env.assetsDir, 'acg_entrance');
  if (!dir) throw new Error('bqb-acg-entrance: 素材目录不存在');
  const tpl = path.join(dir, '0.png');
  if (!fs.existsSync(tpl)) throw new Error('bqb-acg-entrance: 模板不存在 0.png');
  const meta = await sharp(tpl).metadata();
  const w = Math.max(1, Number(meta.width) || 900);
  const h = Math.max(1, Number(meta.height) || 900);
  const photo = await sharp(input.avatar).rotate().resize(290, 410, { fit: 'cover', position: 'centre', kernel: 'lanczos3' }).ensureAlpha().png().toBuffer();
  const text = String(input.text ?? '').trim() || ACG_DEFAULT_TEXT;
  const textSvg = buildTextSvg(w, h, text);
  const framePng = await sharp(tpl).ensureAlpha().composite([{ input: textSvg, left: 0, top: 0 }]).png().toBuffer();
  const buffer = await sharp({ create: { width: w, height: h, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
    .composite([
      { input: photo, left: 190, top: 265 },
      { input: framePng, left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
  return { buffer, mime: 'image/png', ext: 'png' };
}

export async function renderAddiction(input) {
  const { sharp, env } = input;
  const dir = resolveBqbSubdir(env.assetsDir, 'addiction');
  if (!dir) throw new Error('bqb-addiction: 素材目录不存在');
  const tpl = path.join(dir, '0.png');
  if (!fs.existsSync(tpl)) throw new Error('bqb-addiction: 模板不存在 0.png');
  const photo = await sharp(input.avatar).rotate().resize(91, 91, { fit: 'cover', position: 'centre', kernel: 'lanczos3' }).ensureAlpha().png().toBuffer();
  const buffer = await sharp(tpl).ensureAlpha().composite([{ input: photo, left: 0, top: 0 }]).png().toBuffer();
  return { buffer, mime: 'image/png', ext: 'png' };
}

function pickDominantColors(data) {
  const buckets = Array.from({ length: 8 }, () => ({ r: 0, g: 0, b: 0, count: 0 }));
  let sampled = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 16) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const idx = ((r >> 7) << 2) | ((g >> 7) << 1) | (b >> 7);
    const cur = buckets[idx];
    cur.r += r; cur.g += g; cur.b += b; cur.count += 1;
    sampled += 1;
  }
  const colors = buckets
    .filter((b) => b.count > 0 && b.count / Math.max(1, sampled) > 0.01)
    .sort((a, b) => b.count - a.count)
    .map((b) => `rgb(${Math.round(b.r / b.count)},${Math.round(b.g / b.count)},${Math.round(b.b / b.count)})`);
  return colors.length > 0 ? colors : ['rgb(255,255,255)'];
}

function makeSeedFromBuffer(buf) {
  let seed = 0;
  const len = Math.min(buf.length, 256);
  for (let i = 0; i < len; i++) seed = (seed * 131 + buf[i]) >>> 0;
  return seed || 1;
}

function nextRand(seed) {
  return (seed * 1664525 + 1013904223) >>> 0;
}

function buildBlocksSvg(maskRaw, maskW, maskH, colors, seed0) {
  let seed = seed0 >>> 0;
  const blocks = [];
  const points = [];
  const x1 = 200, y1 = 300, x2 = 400, y2 = 650;
  for (let tries = 0; tries < 1200 && points.length < 150; tries++) {
    seed = nextRand(seed);
    const x = x1 + (seed % (x2 - x1 + 1));
    seed = nextRand(seed);
    const y = y1 + (seed % (y2 - y1 + 1));
    if (x < 0 || y < 0 || x >= maskW || y >= maskH) continue;
    const idx = (y * maskW + x) * 4;
    const alpha = maskRaw[idx + 3] ?? 0;
    const r = maskRaw[idx] ?? 0;
    const g = maskRaw[idx + 1] ?? 0;
    const b = maskRaw[idx + 2] ?? 0;
    if (alpha < 8 || (r < 8 && g < 8 && b < 8)) continue;
    if (points.some((p) => Math.abs(x - p.x) < 13 && Math.abs(y - p.y) < 13)) continue;
    points.push({ x, y });
    seed = nextRand(seed);
    const color = colors[seed % colors.length];
    blocks.push(`<rect x="${x}" y="${y}" width="10" height="10" fill="${color}" transform="rotate(45 ${x} ${y})"/>`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${maskW}" height="${maskH}">` + blocks.join('') + `</svg>`;
  return Buffer.from(svg);
}

export async function renderDontTouch(input) {
  const { sharp, env } = input;
  const dir = resolveBqbSubdir(env.assetsDir, 'dont_touch');
  if (!dir) throw new Error('bqb-dont-touch: 素材目录不存在');
  const tpl = path.join(dir, '0.png');
  const mask = path.join(dir, 'mask.png');
  if (!fs.existsSync(tpl)) throw new Error('bqb-dont-touch: 模板不存在 0.png');
  if (!fs.existsSync(mask)) throw new Error('bqb-dont-touch: 模板不存在 mask.png');
  const photo = await sharp(input.avatar).rotate().resize(250, 250, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } }).ensureAlpha().png().toBuffer();
  const colorSample = await sharp(photo).resize(200, 200, { fit: 'inside' }).ensureAlpha().raw().toBuffer();
  const colors = pickDominantColors(colorSample);
  const maskMeta = await sharp(mask).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const blocksSvg = buildBlocksSvg(maskMeta.data, maskMeta.info.width, maskMeta.info.height, colors, makeSeedFromBuffer(input.avatar));
  const buffer = await sharp(tpl)
    .ensureAlpha()
    .composite([
      { input: blocksSvg, left: 0, top: 0 },
      { input: photo, left: 25, top: 460 },
    ])
    .png()
    .toBuffer();
  return { buffer, mime: 'image/png', ext: 'png' };
}

function seededNext(seed) {
  return (seed * 1664525 + 1013904223) >>> 0;
}

function makeSeed(buf) {
  let seed = 0;
  const len = Math.min(buf.length, 512);
  for (let i = 0; i < len; i++) seed = (seed * 131 + buf[i]) >>> 0;
  return seed || 1;
}

function buildDotSvg(width, height, dusts) {
  const circles = dusts
    .filter((d) => !d.dead && d.radius > 0)
    .map((d) => `<circle cx="${d.x.toFixed(2)}" cy="${d.y.toFixed(2)}" r="${d.radius.toFixed(2)}" fill="#000"/>`)
    .join('');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${circles}</svg>`);
}

/** 纯程序化生成（无素材）：35 帧径向灰化波 + 灰尘粒子 */
export async function renderFadeAway(input) {
  const { sharp } = input;
  let image = sharp(input.avatar).rotate().ensureAlpha();
  const meta = await image.metadata();
  const maxWidth = 200;
  if ((meta.width || 0) > maxWidth) image = image.resize({ width: maxWidth });
  const basePng = await image.png().toBuffer();
  const info = await sharp(basePng).metadata();
  const width = Math.max(1, Number(info.width) || 1);
  const height = Math.max(1, Number(info.height) || 1);
  const raw = await sharp(basePng).ensureAlpha().raw().toBuffer();
  const centerX = (width * 2) / 3;
  const centerY = (height * 3) / 2;
  const radius = Math.sqrt(centerX * centerX + centerY * centerY);
  const step = radius / 24;
  const dusts = [];
  let seed = makeSeed(input.avatar);
  const frames = [];
  for (let i = 0; i < 35; i++) {
    if (i <= 9) {
      frames.push(basePng);
      continue;
    }
    if (i < 28) {
      const t = i - 9;
      const r1 = step * (t + 4);
      const r2 = step * (t + 5);
      const r3 = step * (t + 11);
      const pixelOverlays = [];
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4;
          const a = raw[idx + 3] ?? 0;
          if (a === 0) continue;
          const dx0 = x - centerX;
          const dy0 = y - centerY;
          const dist = Math.sqrt(dx0 * dx0 + dy0 * dy0);
          if (dist <= r1) continue;
          if (dist <= r2) {
            pixelOverlays.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="black"/>`);
            continue;
          }
          if (dist <= r3) {
            seed = seededNext(seed);
            const rand = (seed & 65535) / 65535;
            let factor = 0.5 + (dist - r2) / Math.max(1e-3, r3 - r2);
            factor = Math.max(0, Math.min(1, factor));
            factor *= 0.9 + 0.2 * rand;
            const gray = Math.max(0, Math.min(255, Math.round((((raw[idx] ?? 0) + (raw[idx + 1] ?? 0) + (raw[idx + 2] ?? 0)) / 3) * factor)));
            pixelOverlays.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="rgb(${gray},${gray},${gray})" fill-opacity="${(a / 255).toFixed(3)}"/>`);
          } else {
            const rr = raw[idx] ?? 0;
            const gg = raw[idx + 1] ?? 0;
            const bb = raw[idx + 2] ?? 0;
            pixelOverlays.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="rgb(${rr},${gg},${bb})" fill-opacity="${(a / 255).toFixed(3)}"/>`);
          }
        }
      }
      for (let r = Math.floor(r1); r < Math.floor(r2); r++) {
        for (let theta = 0; theta < 180; theta++) {
          const rad = (theta * Math.PI) / 180;
          const x = Math.floor(centerX + r * Math.cos(rad));
          const y = Math.floor(centerY - r * Math.sin(rad));
          if (x < 0 || x >= width || y < 0 || y >= height) continue;
          const idx = (y * width + x) * 4;
          const a = raw[idx + 3] ?? 0;
          if (a === 0) continue;
          seed = seededNext(seed);
          if ((seed & 65535) / 65535 < 0.1) {
            const rr = Math.max(1, r);
            dusts.push({
              x, y, vx: 0, vy: 0,
              dx: (x - centerX) / rr,
              dy: (1.5 * (y - centerY)) / rr,
              radius: 1 + ((seed >>> 16) & 65535) / 65535 * 2,
              dead: false,
            });
          }
        }
      }
      for (const dot of dusts) {
        if (dot.dead) continue;
        const a = (0.02 * step) / Math.max(1, dot.radius);
        dot.vx += a * dot.dx;
        dot.vy += a * dot.dy;
        dot.x += dot.vx;
        dot.y += dot.vy;
        seed = seededNext(seed);
        if ((seed & 65535) / 65535 < 0.25) dot.radius -= 1;
        if (dot.radius <= 0 || dot.x + dot.radius < 0 || dot.x - dot.radius > width || dot.y + dot.radius < 0 || dot.y - dot.radius > height) {
          dot.dead = true;
        }
      }
      const frameSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${pixelOverlays.join('')}</svg>`);
      const dustSvg = buildDotSvg(width, height, dusts);
      frames.push(
        await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
          .composite([
            { input: frameSvg, left: 0, top: 0 },
            { input: dustSvg, left: 0, top: 0 },
          ])
          .png()
          .toBuffer()
      );
    } else {
      for (const dot of dusts) {
        if (dot.dead) continue;
        const a = (0.02 * step) / Math.max(1, dot.radius);
        dot.vx += a * dot.dx;
        dot.vy += a * dot.dy;
        dot.x += dot.vx;
        dot.y += dot.vy;
        seed = seededNext(seed);
        if ((seed & 65535) / 65535 < 0.25) dot.radius -= 1;
        if (dot.radius <= 0 || dot.x + dot.radius < 0 || dot.x - dot.radius > width || dot.y + dot.radius < 0 || dot.y - dot.radius > height) {
          dot.dead = true;
        }
      }
      const dustSvg = buildDotSvg(width, height, dusts);
      frames.push(
        await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
          .composite([{ input: dustSvg, left: 0, top: 0 }])
          .png()
          .toBuffer()
      );
    }
  }
  const buffer = await sharp({
    create: { width, height: height * frames.length, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 }, pageHeight: height },
  })
    .composite(frames.map((f, i) => ({ input: f, left: 0, top: i * height })))
    .gif({ delay: 80, loop: 0, effort: 1 })
    .toBuffer();
  return { buffer, mime: 'image/gif', ext: 'gif' };
}

const POUND_LOCS = [
  { x: 135, y: 240, w: 138, h: 47 }, { x: 135, y: 240, w: 138, h: 47 }, { x: 150, y: 190, w: 105, h: 95 },
  { x: 150, y: 190, w: 105, h: 95 }, { x: 148, y: 188, w: 106, h: 98 }, { x: 146, y: 196, w: 110, h: 88 },
  { x: 145, y: 223, w: 112, h: 61 }, { x: 145, y: 223, w: 112, h: 61 },
];
export async function renderPound(input) {
  const { sharp, env } = input;
  const dir = resolveBqbSubdir(env.assetsDir, 'pound');
  if (!dir) throw new Error('bqb-pound: 素材目录不存在');
  const avatarPng = await prepareAvatarPng(sharp, input.avatar, { circle: false });
  const frames = [];
  let outW = 0;
  let outH = 0;
  for (let i = 0; i < 8; i++) {
    const tpl = templatePath(dir, i, 'png');
    if (!fs.existsSync(tpl)) throw new Error(`bqb-pound: 模板不存在 ${i}`);
    if (!outW || !outH) {
      const meta = await sharp(tpl).metadata();
      outW = Math.max(1, Number(meta.width) || 1);
      outH = Math.max(1, Number(meta.height) || 1);
    }
    const { x, y, w, h } = POUND_LOCS[i] ?? POUND_LOCS[0];
    const avatarResized = await sharp(avatarPng).resize(Math.max(1, Math.floor(w)), Math.max(1, Math.floor(h)), { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();
    const templateBuf = await sharp(tpl).ensureAlpha().png().toBuffer();
    frames.push(
      await sharp({ create: { width: outW, height: outH, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
        .composite([
          { input: avatarResized, left: Math.floor(x), top: Math.floor(y) },
          { input: templateBuf, left: 0, top: 0 },
        ])
        .png()
        .toBuffer()
    );
  }
  const buffer = await encodeGifFromPngFrames(sharp, frames, 50);
  return { buffer, mime: 'image/gif', ext: 'gif' };
}

export async function renderSoldOut(input) {
  const { sharp, env } = input;
  const dir = resolveBqbSubdir(env.assetsDir, 'sold_out');
  const tpl = path.join(dir, '0.png');
  if (!dir || !fs.existsSync(tpl)) throw new Error('bqb-sold_out: 素材不存在（需 sold_out/0.png）');
  const rotated = sharp(input.avatar).rotate().ensureAlpha();
  const meta0 = await rotated.metadata();
  const w0 = Number(meta0.width) || 0;
  const h0 = Number(meta0.height) || 0;
  let avatarResized = rotated;
  if (w0 > h0) avatarResized = rotated.resize({ height: 600, kernel: 'lanczos3' });
  else avatarResized = rotated.resize({ width: 600, kernel: 'lanczos3' });
  const avatarPng = await avatarResized.png().toBuffer();
  const meta = await sharp(avatarPng).metadata();
  const w = Math.max(1, Number(meta.width) || 1);
  const h = Math.max(1, Number(meta.height) || 1);
  const iconPng = await sharp(tpl).ensureAlpha().png().toBuffer();
  const iconMeta = await sharp(iconPng).metadata();
  const iconW = Math.max(1, Number(iconMeta.width) || 1);
  const iconH = Math.max(1, Number(iconMeta.height) || 1);
  const overlay = await sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 80 / 255 } } }).png().toBuffer();
  const buffer = await sharp(avatarPng)
    .ensureAlpha()
    .composite([
      { input: overlay, left: 0, top: 0 },
      { input: iconPng, left: Math.floor((w - iconW) / 2), top: Math.floor((h - iconH) / 2) },
    ])
    .png()
    .toBuffer();
  return { buffer, mime: 'image/png', ext: 'png' };
}

export async function renderTaunt(input) {
  const { sharp, env } = input;
  const dir = resolveBqbSubdir(env.assetsDir, 'taunt');
  const tpl = path.join(dir, '0.png');
  if (!dir || !fs.existsSync(tpl)) throw new Error('bqb-taunt: 素材不存在（需 taunt/0.png）');
  const avatarPng = await prepareAvatarPng(sharp, input.avatar, { circle: false, size: 230 });
  const buffer = await sharp(tpl).ensureAlpha().composite([{ input: avatarPng, left: 245, top: 245 }]).png().toBuffer();
  return { buffer, mime: 'image/png', ext: 'png' };
}

export async function renderThinkWhat(input) {
  const { sharp, env } = input;
  const dir = resolveBqbSubdir(env.assetsDir, 'think_what');
  const tpl = path.join(dir, '0.png');
  if (!dir || !fs.existsSync(tpl)) throw new Error('bqb-think-what: 素材不存在（需 think_what/0.png）');
  const meta = await sharp(tpl).metadata();
  const w = Math.max(1, Number(meta.width) || 1);
  const h = Math.max(1, Number(meta.height) || 1);
  const photo = await sharp(input.avatar).rotate().resize(534, 493, { fit: 'cover', position: 'centre', kernel: 'lanczos3' }).ensureAlpha().png().toBuffer();
  const framePng = await sharp(tpl).ensureAlpha().png().toBuffer();
  const buffer = await sharp({ create: { width: w, height: h, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
    .composite([
      { input: photo, left: 530, top: 0 },
      { input: framePng, left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
  return { buffer, mime: 'image/png', ext: 'png' };
}

export async function renderWhatIWant(input) {
  const { sharp, env } = input;
  const dir = resolveBqbSubdir(env.assetsDir, 'what_i_want_to_do');
  const tpl = path.join(dir, '0.png');
  if (!dir || !fs.existsSync(tpl)) throw new Error('bqb-what-i-want-to-do: 素材不存在（需 what_i_want_to_do/0.png）');
  const avatarPng = await prepareAvatarPng(sharp, input.avatar, { circle: true });
  const avatarFit = await sharp(avatarPng).resize(270, 270, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const buffer = await sharp(tpl).ensureAlpha().composite([{ input: avatarFit, left: 350, top: 590 }]).png().toBuffer();
  return { buffer, mime: 'image/png', ext: 'png' };
}

export async function renderYouDontGet(input) {
  const { sharp, env } = input;
  const dir = resolveBqbSubdir(env.assetsDir, 'you_dont_get');
  const tpl = path.join(dir, '0.png');
  if (!dir || !fs.existsSync(tpl)) throw new Error('bqb-you-dont-get: 素材不存在（需 you_dont_get/0.png）');
  const meta = await sharp(tpl).metadata();
  const w = Math.max(1, Number(meta.width) || 1);
  const h = Math.max(1, Number(meta.height) || 1);
  const photo = await sharp(input.avatar).rotate().resize(142, 139, { fit: 'cover', position: 'centre', kernel: 'lanczos3' }).ensureAlpha().png().toBuffer();
  const framePng = await sharp(tpl).ensureAlpha().png().toBuffer();
  const buffer = await sharp({ create: { width: w, height: h, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
    .composite([
      { input: photo, left: 217, top: 181 },
      { input: framePng, left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
  return { buffer, mime: 'image/png', ext: 'png' };
}

export const BQB_RENDERERS = {
  crawl: renderCrawl,
  play: renderPlay,
  bite: renderBite,
  petpet: renderPetpet,
  eat: renderEat,
  suck: renderSuck,
  jiujiu: renderJiujiu,
  scratch_head: renderScratchHead,
  rub: renderRub,
  abstinence: renderAbstinence,
  acg_entrance: renderAcgEntrance,
  addiction: renderAddiction,
  dont_touch: renderDontTouch,
  fade_away: renderFadeAway,
  pound: renderPound,
  sold_out: renderSoldOut,
  taunt: renderTaunt,
  think_what: renderThinkWhat,
  what_i_want_to_do: renderWhatIWant,
  you_dont_get: renderYouDontGet,
};

/** 统一渲染入口：input = { kind, env: { sharp, assetsDir }, ...payload } */
export async function renderBqb(input) {
  const fn = BQB_RENDERERS[input.kind];
  if (!fn) throw new Error(`未知的表情模板: ${input.kind}`);
  const env = input.env || {};
  // 把 env 摊平到顶层：渲染函数按 { sharp, env } 解构
  return fn({ ...env, ...input });
}
