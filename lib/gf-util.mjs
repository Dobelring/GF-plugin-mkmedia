/**
 * QQ 官方机器人（GF-）事件的小工具集。
 * 事件字段是「平铺」的（event.content / event.group_openid / event.author...），
 * 与 OneBot 的 event.message 消息段数组完全是两套结构。
 */

/** 取发送者 openid（群聊 member_openid / 单聊 user_openid） */
export function getUserOpenid(event) {
  const a = (event && event.author) || {};
  return String(a.user_openid || a.member_openid || a.union_openid || a.id || '');
}

/** 是否群聊消息（两个事件名都要认，见 GF 开发手册 §3.1） */
export function isGroupMessage(event) {
  return event?.t === 'GROUP_AT_MESSAGE_CREATE' || event?.t === 'GROUP_MESSAGE_CREATE';
}

/** 是否单聊消息 */
export function isC2cMessage(event) {
  return event?.t === 'C2C_MESSAGE_CREATE';
}

/** 是否可处理的消息事件 */
export function isChatMessage(event) {
  return isGroupMessage(event) || isC2cMessage(event);
}

/**
 * 剥掉 @ 机器人前缀：官方文档说 content 已去掉 @ 前缀，但「接收所有消息」模式下
 * 实测可能是 `<@openid> 指令` 的形式，必须自己剥，否则指令匹配不上。
 */
export function stripMention(s) {
  return String(s || '')
    .replace(/^(?:<@!?[^>]*>\s*)+/g, '')
    .replace(/^(?:@\S+\s*)+/g, '')
    .trim();
}

/** 消息正文（群聊事件 content 已去 @ 前缀，这里再兜底剥一次） */
export function messageText(event) {
  return stripMention(event?.content);
}

/** 去掉全部空白（表情指令全等匹配用） */
export function compactText(s) {
  return String(s || '').replace(/\s+/g, '');
}

/**
 * 读取 message_scene.ext 里的键值（msg_idx / ref_msg_idx）。
 * ext 元素是 "key=value" 字符串。
 */
export function readExt(event, key) {
  const ext = (event && event.message_scene && event.message_scene.ext) || [];
  for (const item of ext) {
    const s = String(item);
    const i = s.indexOf('=');
    if (i > 0 && s.slice(0, i) === key) return s.slice(i + 1);
  }
  return '';
}

/**
 * 事件去重键：官方会重复推送同一条消息，用 msg_idx 最可靠，回退 event.id。
 */
export function dedupKey(event) {
  return readExt(event, 'msg_idx') || String(event?.id || '');
}

/**
 * 分类消息附件。
 * 注意 content_type 是 image/jpeg / image/png / image/gif / video/mp4 / voice / file，
 * 模拟器里可能写成 image 简写，所以用 startsWith('image')。
 */
export function pickAttachments(event) {
  const list = Array.isArray(event?.attachments) ? event.attachments : [];
  const out = { images: [], videos: [], voices: [], files: [] };
  for (const a of list) {
    const ct = String(a.content_type || '');
    if (ct.startsWith('image')) out.images.push(a);
    else if (ct.startsWith('video')) out.videos.push(a);
    else if (ct === 'voice') out.voices.push(a);
    else out.files.push(a);
  }
  return out;
}

/**
 * 取「引用消息」里的附件与文本（message_type=103 时 msg_elements[] 携带被引用内容）。
 */
export function quotedContent(event) {
  if (Number(event?.message_type) !== 103) return { images: [], text: '' };
  const els = Array.isArray(event?.msg_elements) ? event.msg_elements : [];
  const images = [];
  const texts = [];
  const walk = (list) => {
    for (const el of list) {
      for (const a of Array.isArray(el?.attachments) ? el.attachments : []) {
        const ct = String(a.content_type || '');
        if (ct.startsWith('image') && a.url) images.push(a);
      }
      const t = String(el?.content || '').trim();
      if (t) texts.push(t);
      if (Array.isArray(el?.msg_elements) && el.msg_elements.length) walk(el.msg_elements);
    }
  };
  walk(els);
  return { images, text: texts.join('\n') };
}

/**
 * 收集卡片消息（message_type=3）里可解析的链接：ark_data.fields.jump_url 等。
 * 官方群里分享 B 站视频常以卡片出现，content 只是摘要文本。
 */
export function cardUrls(event) {
  const ark = event?.ark_data;
  if (!ark) return [];
  const out = [];
  const push = (v) => {
    const s = String(v || '').trim();
    if (/^https?:\/\//i.test(s)) out.push(s);
  };
  const fields = ark.fields || {};
  push(fields.jump_url);
  push(fields.url);
  push(fields.preview);
  return out;
}
