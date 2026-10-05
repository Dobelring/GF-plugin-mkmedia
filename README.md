# GF-plugin-mkmedia · MK媒体·官方

QQ **官方机器人**（QQ 开放平台 `GF-` 插件）功能插件：**视频解析 + 表情制作**。
运行于 [kakake](https://github.com/tc-404/kakake) 插件平台。

> 解析模块与表情素材移植自 [kakake-plugin-mkbot](https://github.com/tc-404/kakake-plugin-mkbot)（作者：三个句号），
> 发送层按官方机器人 REST API（富媒体两步上传 + 大文件分片上传）重新实现。
> 与 OneBot / NapCat 插件（`kakake-`）不通用。

详细文档见 [说明.md](说明.md)。

## 功能一览

- **视频解析**（群里发链接即触发）：哔哩哔哩 / 抖音（含图集、实况）/ 小红书 / 快手 / YouTube / TikTok
- **表情制作**（发 `表情菜单` 查看全部）：摸头 / 贴贴 / 爬 / 嘲讽 / 戒导证书等 20 个模板，GIF/PNG 合成走独立 worker 线程
- **群管理指令**：`开启/关闭视频解析`、`开启/关闭表情制作`（群主/管理员，按群生效）

## 安装

1. 把整个 `GF-plugin-mkmedia` 文件夹放到 kakake 的 `plugins/` 目录；
2. Web 控制台 → 连接（QQ 官方机器人账号）→ 插件里启用；
3. 群里发 `媒体菜单` 验证。

表情制作需要 sharp：首次使用会自动安装到 `data/runtime-deps/`（默认源失败自动换 npmmirror）。

## 已知限制

- 官方机器人拿不到 QQ 号/头像，表情来源须为消息图片或引用带图消息；
- 被动回复条数有限（群聊 5 条 / 单聊 4 条），大图集只发前几张；
- 小红书须用 app「分享→复制链接」的短链（`xhslink.cn` / `xhslink.com`），浏览器地址栏的裸链接缺 `xsec_token` 解析不了；
- **YouTube / TikTok 在大陆服务器上需配置 HTTP 代理**（config.json 的 `"代理"` 字段，如 `http://127.0.0.1:7890`），其余平台直连不受影响；
- 修改插件代码后需重启 kakake 进程（多文件 ESM 插件，控制台重载不换嵌套模块）。

## 致谢

- [kakake-plugin-mkbot](https://github.com/tc-404/kakake-plugin-mkbot) — 解析模块与表情模板素材来源
- [kakake](https://github.com/tc-404/kakake) — 宿主平台（GF 插件机制见其「工具 → 插件开发」）
