/**
 * 配置读写。configPath 指向 data/<账号>/<插件>/config.json。
 * 全局开关 + 按群覆盖（群管理员用指令切换，写 groups.<group_openid>）。
 */

import fs from 'node:fs';

export const DEFAULT_CONFIG = {
  视频解析: true,
  表情制作: true,
  图集最多发送: 4,
  视频: { 下载上限MB: 60 },
  groups: {},
};

export function loadConfig(ctx) {
  try {
    const raw = JSON.parse(fs.readFileSync(ctx.configPath, 'utf-8'));
    return { ...structuredClone(DEFAULT_CONFIG), ...raw, groups: raw.groups && typeof raw.groups === 'object' ? raw.groups : {} };
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

export function saveConfig(ctx, cfg) {
  try {
    fs.mkdirSync(ctx.dataPath, { recursive: true });
    fs.writeFileSync(ctx.configPath, JSON.stringify(cfg, null, 2), 'utf-8');
  } catch (e) {
    ctx.logger?.warn?.(`[mkmedia] 保存配置失败: ${e?.message}`);
  }
}

/** 功能在该群是否开启：groups.<gid>.<key> 覆盖全局 */
export function featureEnabled(cfg, event, key) {
  if (!cfg[key]) return false;
  const gid = event?.group_openid;
  if (!gid) {
    const uid = event?.author?.user_openid || event?.author?.member_openid;
    if (uid && cfg.groups?.[uid]?.[key] != null) return !!cfg.groups[uid][key];
    return true;
  }
  const override = cfg.groups?.[gid]?.[key];
  if (override != null) return !!override;
  return true;
}

function isAdmin(event) {
  const role = String(event?.author?.member_role || '').toLowerCase();
  return role === 'admin' || role === 'owner';
}

function setGroupFeature(cfg, event, key, value) {
  const gid = event?.group_openid;
  if (!gid) return false;
  if (!cfg.groups[gid]) cfg.groups[gid] = {};
  cfg.groups[gid][key] = value;
  return true;
}

/**
 * 处理配置/菜单指令。命中返回 { handled: true }。
 * 指令：开启/关闭视频解析、开启/关闭表情制作（群管理员）、媒体菜单、表情菜单、官方媒体配置
 */
export async function handleAdminAndMenu(ctx, event, text, cfg) {
  const t = String(text || '').trim();

  if (t === '表情菜单') {
    const { BQB_MENU } = await import('./bqb-handle.mjs');
    return { handled: true, reply: BQB_MENU };
  }
  if (t === '媒体菜单' || t === 'mkmedia菜单') {
    const lines = [
      'MK媒体·官方（QQ官方机器人）',
      '【视频解析】群里直接发 B站/抖音/小红书/快手/YouTube/TikTok 链接或分享卡片即可自动解析（无需指令）',
      '【表情制作】发「表情菜单」查看全部模板',
      '【群管理】开启视频解析 / 关闭视频解析 / 开启表情制作 / 关闭表情制作（仅群主/管理员）',
      '【全局开关】编辑数据目录下 config.json（视频解析/表情制作 字段）',
    ];
    return { handled: true, reply: lines.join('\n') };
  }
  if (t === '官方媒体配置') {
    const gid = event?.group_openid;
    const ov = gid ? cfg.groups?.[gid] : null;
    const lines = [
      `视频解析：${featureEnabled(cfg, event, '视频解析') ? '开' : '关'}${ov && ov['视频解析'] != null ? '（本群覆盖）' : '（全局）'}`,
      `表情制作：${featureEnabled(cfg, event, '表情制作') ? '开' : '关'}${ov && ov['表情制作'] != null ? '（本群覆盖）' : '（全局）'}`,
      `图集最多发送：${cfg['图集最多发送']} 张`,
    ];
    return { handled: true, reply: lines.join('\n') };
  }

  const toggle = t.match(/^(开启|关闭)(视频解析|表情制作)$/);
  if (toggle) {
    if (!event?.group_openid) {
      return { handled: true, reply: '该开关请在群聊里使用（单聊请改 config.json 的全局开关）。' };
    }
    if (!isAdmin(event)) {
      return { handled: true, reply: '只有群主/管理员可以切换这个开关。' };
    }
    const value = toggle[1] === '开启';
    const key = toggle[2];
    if (setGroupFeature(cfg, event, key, value)) {
      saveConfig(ctx, cfg);
      return { handled: true, reply: `已${toggle[1]}本群的「${key}」。` };
    }
    return { handled: true, reply: '设置失败。' };
  }
  return { handled: false };
}
