# Tampermonkey 脚本合集

把小红书 / 抖音 / 微博作品一键推送到本地 [Eagle](https://eagle.cool/) 素材库的用户脚本（UserScript）。

## 脚本列表

| 脚本 | 版本 | 适用站点 | 说明 |
| --- | --- | --- | --- |
| `抖音作品推送到eagle.user.js` | 2.1.0 | `https://*.douyin.com/*` | 作品详情页的播放器「插件」菜单、作者主页右下角浮动面板：把当前作品（视频或整套图集）推送到 Eagle，支持勾选多个作品批量推送；可按作者名归类（追加为标签，或在目标文件夹下自动建同名子文件夹）；动图（实况）格式可选高清图（webp）/ 动图（mp4）/ 两者都要；可开启「下载原图」（图片优先取原图地址，取不到自动回退到展示图）；保留上游的下载能力；**推送记录持久化**：记住每个作品是否已推送过 Eagle，并在作者主页卡片与详情页显示「已推送」徽标（可在设置里关闭）|
| `小红书作品推送到eagle.user.js` | 1.0.2 | `www.xiaohongshu.com`、`www.rednote.com` | 作品（图文 / 视频）推送到 Eagle，可选目标文件夹与标签；支持手动输入标签、快捷键、可拖动悬浮按钮、下载当前作品 |
| `微博作品推送到eagle.user.js` | 1.0.19 | `weibo.com`、`www.weibo.com`、`s.weibo.com` | 详情页 / 时间线 / 分组 / 搜索页的每条微博注入「存 Eagle」按钮：图集、单视频、动图（live photo）、图文视频混排都能推；**点「存 Eagle」直接按已保存的设置推送（不弹面板）**，文件夹 / 标签 / 开关都在 Tampermonkey 菜单的「设置」里配置；右下角悬浮按钮 **E** 打开**勾选列表**（列出本页微博的摘要与媒体数，可勾选要推的、支持「全选 / 全不选」，再选目标文件夹与标签后推送选中项）；目标文件夹与标签用**独立的选择弹层**（带搜索框、层级用缩进表示、文件夹单选 / 标签可多选、标签来自 Eagle 已有标签且支持手动输入，Esc 或点遮罩关闭），主界面只显示当前选择。整个界面为**深色（黑夜）主题**；右下角悬浮按钮（文字为「插件」）与各面板都**可拖动**，并会记住上次的位置。文件夹与标签的搜索支持不区分大小写的**子串匹配**，批量面板的微博列表会**随页面滚动加载自动更新**（已勾选的条目不受影响）；默认跳过 Eagle 中已存在的素材；卡片以每条帖子唯一的 `footer`/`.card-act` 操作栏为锚点识别（不依赖 `mid` 层级），ID 给出候选列表逐个去接口试；图片按 `original/woriginal → largest → large → 其余缩略档` 收集候选并逐个回退（缩略档统一提到 `large`）；**默认只把微博发布时间写进文件名与注释（不改 Eagle「添加日期」，添加日期保持真实入库时间）**，想让它写进添加日期可在设置里开启；文件名模板支持 `{YYYY}{MM}{DD}{HH}{mm}{ss}`（`{original}` = 媒体原始文件名）（兼容标准格式 / `09-19 08:00` / 秒级时间戳），并自动带 Referer / User-Agent 绕开微博 CDN 防盗链；接口请求按「同域用页面 fetch、跨域用 `GM_xmlhttpRequest`」双通道，并补齐 `X-XSRF-TOKEN` / `Referer` / `X-Requested-With` 等反爬所需请求头 |

## 前置条件

- 浏览器 + [Tampermonkey](https://www.tampermonkey.net/)
- 本地运行 [Eagle](https://eagle.cool/) 桌面版，默认 API 地址 `http://127.0.0.1:41595`

三个脚本走同一套 Eagle 接口契约：优先调用 `/api/item/addFromURL`（Eagle 4.0 桌面版）或 `/api/v2/item/add`，运行时自动探测 API 风格并在 404 时回退；按 `url` + 文件名查重，避免重复入库；素材的来源 URL 写作品页地址，annotation 写入作者 / 发布时间 / 作品 ID 以便回溯。

## 安装

本仓库为 **public**，可直接用 raw 链接安装（Tampermonkey「实用工具 → 从 URL 安装」），或下载文件后拖入浏览器：

| 脚本 | 安装链接 |
| --- | --- |
| 抖音作品推送到eagle | <https://raw.githubusercontent.com/jiebukai/eagle-push/main/%E6%8A%96%E9%9F%B3%E4%BD%9C%E5%93%81%E6%8E%A8%E9%80%81%E5%88%B0eagle.user.js> |
| 小红书作品推送到eagle | <https://raw.githubusercontent.com/jiebukai/eagle-push/main/%E5%B0%8F%E7%BA%A2%E4%B9%A6%E4%BD%9C%E5%93%81%E6%8E%A8%E9%80%81%E5%88%B0eagle.user.js> |
| 微博作品推送到eagle | <https://raw.githubusercontent.com/jiebukai/eagle-push/main/%E5%BE%AE%E5%8D%9A%E4%BD%9C%E5%93%81%E6%8E%A8%E9%80%81%E5%88%B0eagle.user.js> |

## 关于自动更新

三个脚本的 `@namespace` / `@downloadURL` / `@updateURL` / `@supportURL` 均指向本仓库，用于**切断与上游脚本的更新关联**，避免 Tampermonkey 把本地改动自动更新回上游版本。仓库为 public，raw 链接可匿名访问，因此 Tampermonkey 会按 `@version` 比较并自动更新到本仓库发布的新版本。

## 使用

**抖音**：作品详情页 → 播放器「插件」菜单 → 「存到 Eagle」；或作者主页右下角浮动面板 → 勾选多个作品 → 「存 Eagle」。目标文件夹与标签在「设置 → 下载器配置 → 类型选 Eagle」中配置（未选择标签时素材不会写入任何标签）。

推送记录只是「已推送」徽标的缓存，真正的查重始终在 Eagle 侧按来源 URL + 文件名做，所以清空记录不会导致重复推送。自 v2.1.0 起记录上限默认 5 万条，可在「设置 → 下载器配置 → Eagle 推送记录 → 记录上限」里改成 5000 / 2 万 / 5 万 / 不限；落盘记录做了瘦身（约 150 字节/条，不再存指向作品页的 URL 与素材 ID，导出时自动补齐），内存里只保留徽标需要的轻量索引，清理时按 `pushedAt` 索引用游标从最老的开始删，不会再把整库读进内存排序。

**小红书**：打开作品页使用悬浮按钮 / 快捷键唤起面板，选择目标文件夹与标签后推送；也可单独下载当前作品。

**微博**：详情页 / 时间线的每条微博下方有「存 Eagle」按钮，点开面板选好文件夹与标签后推送；按 <kbd>S</kbd>（可改）直接推送当前详情页作品；右下角悬浮按钮 **E** 批量推送当前页可见微博（最多 30 条）。设置面板（Tampermonkey 菜单，或面板里的「设置」）里可配置：Eagle 地址、文件名模板、动图取法（mp4 / 大图 / 两者）、是否跳过已存在、是否带 Referer、是否取大图、是否推送视频封面、快捷键。推送记录相关开关（推送记录 / 已推送标记 / 记录保留 / 清空推送记录）位于「设置 → 下载器配置」页里的「Eagle 推送记录」区，与当前选择的下载器类型无关。

文件名模板占位符：`{username}` `{userid}` `{mblogid}` `{uid}` `{index}` `{content}` `{YYYY}` `{MM}` `{DD}` `{HH}` `{mm}` `{ss}` `{original}` `{ext}`。

## 来源与许可

- `抖音作品推送到eagle.user.js` 衍生自 [zhzLuke96/douyin-dl-user-js](https://github.com/zhzLuke96/douyin-dl-user-js)（MIT），在 v1.5.15 基础上增加了 Eagle 推送能力。脚本头部保留了 `@license MIT` 声明，上游作者与来源说明保留在脚本头部注释块中。
- `小红书作品推送到eagle.user.js` 为自研脚本，复用同一套 Eagle 接口契约，只覆盖小红书 / rednote 的作品页。
- `微博作品推送到eagle.user.js` 为自研脚本，**媒体字段提取规则参考 [vacabun/weibo-dl](https://github.com/vacabun/weibo-dl)（MIT）**：图片取 `pic_infos[].largest.url`、视频取 `page_info.media_info.playback_list[0].play_info.url`（兜底 `stream_url`）、动图取 `pic.video`、混排取 `mix_media_info.items`、转发帖取 `retweeted_status`。该脚本为**源码风格、单文件、无构建**，可直接阅读修改。三个脚本现在读起来是同一路子；其中抖音脚本在 v2.0.0 做了源码化重写：原先的 esbuild 打包产物被展平还原成普通 JavaScript，去掉了 `__esm` / `__name` / `__defProp` / `init_*` 等打包器样板，标识符恢复成语义名（`u3`→`jsx`、`d2`→`useState`、`c3`→`configModalStyles` 等），并按原 TS 工程模块顺序插入了 `// ─── src/... ───` 分区横幅；只有 preact 三个模块仍以 10.28.2 dist 原样内联（文件内有独立 banner 说明）。逐句逻辑与 1.5.12 等价，冒烟测试见 `tests/smoke-dom.test.mjs`。
