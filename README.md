# Story Tracker

本地剧情观看进度工具。当前试用版为 **0.1.0 · Windows x64 便携版**，附带明日方舟、少女前线、少女前线2：追放和蔚蓝档案的剧情目录。

程序记录目录和观看进度，不提供剧情正文或视频文件。

## 启动

1. 将 ZIP 完整解压到一个可写目录，保留 `importers/` 文件夹与程序的相对位置。
2. 双击 `story-tracker.exe`。
3. 四个游戏的剧情目录已预置，启动后即可查看和记录观看进度。

随包的四份 JSON 位于 `importers/` 各游戏模块内，可通过「导入 / 更新」查看数据提示或重新导入。

运行环境为 Windows 10/11 x64，需要 Microsoft Edge WebView2 Runtime。若系统缺少运行时，可从 [微软官方下载页](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) 安装 Evergreen Runtime。

本发布包无需安装 Node.js，也不包含联网抓取模块。日常使用及本地数据导入不需要联网。

## 记录与查找

- 勾选剧情表示已看，取消勾选表示未看；修改会自动保存。
- 目录支持批量标记、全部收起和全部展开。
- 顶部搜索框可查找章节、活动或剧情名称，并与已看／未看筛选组合使用。
- 可切换「分类内按时间」和「全部按时间」；少前1、少前2还支持声明的主线进度排序。
- 点击右下角「回到顶部 ↑」可返回页面顶部。

## 追加新活动

点击「追加记录」，选择以下方式之一：

- **手动新增**：选择游戏、分类和放入目录，填写活动／章节名称，剧情列表每行一条。开放日期可留空，填写时使用 `YYYY-MM-DD`。
- **导入增量 JSON**：选择符合本程序目录格式的增量文件，查看追加预览后点击「确认追加」。普通列表 JSON 不能直接导入；可通过预览页的「导出 JSON」取得本程序格式的文件。

追加功能仅加入新记录，不覆盖旧记录。相同来源编号会去重；内容冲突时会拒绝追加。首次建立游戏目录请使用「导入 / 更新」。

程序的 JSON 文件选择和导出默认使用程序旁的 `export/` 目录；随包的四份初始数据位于 `importers/` 各游戏模块内。

## 备份与升级

观看记录、当前剧情目录及程序缓存保存在 **程序旁的 `data/` 文件夹**。数据库文件名为 `story-tracker.sqlite3`。

备份时先关闭程序，再复制整个 `data/` 文件夹。恢复时先关闭程序，备份当前 `data/`，再用备份内容恢复到相同位置。数据库可能带有 `-wal`、`-shm` 文件，不要在程序运行时只复制主数据库文件。

升级前备份数据，然后将新版完整解压到另一个目录。关闭程序，将旧版的 `data/` 文件夹复制到新版程序旁，再启动新版。发布 ZIP 中的 `data/` 预置四个游戏的剧情目录，不包含个人观看记录。

本便携版不自动读取旧版保存在用户目录中的记录。如需迁移，先关闭新旧程序，将已备份的旧数据库及配套文件复制到便携版 `data/` 中，保留文件名。

自行追加过剧情后，重新导入旧的完整目录可能将新增项目归档。完整更新前检查预览中的归档项；新增活动优先使用「追加记录」。

「导出 JSON」导出的是剧情目录，**不包含观看标记，不能替代数据库备份**。

## 数据范围与提示

导入预览里的「数据提示」说明各游戏的数据范围与限制。日期精确到天，未核实的日期留空。

| 游戏 | 数据说明 |
| --- | --- |
| 明日方舟 | 剧情目录来自 PRTS，日期采用首次开放日期。 |
| 少女前线 | 目录整理于 2026-10-04，关卡名使用英文；日期采用国服首次开放日，夜战单独记录。 |
| 少女前线2：追放 | 日期采用国服首次开放日；战前与战后合并记录，第0章按一个剧情记录；部分视频链接包含多个关卡。 |
| 蔚蓝档案 | 目录包含国服尚未开放内容；活动与主线使用国服首次开放日期，其他类型暂不记录日期；不计入独立小游戏剧情和网页活动。 |

蔚蓝档案当前校对范围：

- 已对照简中来源的剧情标题：主线 91 条、活动 55 条、特殊作战 12 条；其余 2369 条为繁中转简体，尚未逐条核对。
- 羁绊目录的角色姓名优先采用已有简中对照；缺少独立对照的换装版沿用同一角色的简中姓名，换装描述保留来源译名。缺少可靠姓名对照的角色保留来源译名。
- **1105 条羁绊剧情标题未逐条校对**；角色姓名核对不代表剧情标题已核对。
- 活动日期已核实 49/57 个活动，主线日期已核实 381/428 条剧情；其余留空。日期或标题修订以更新预览为准。

## 数据来源

- 明日方舟：[PRTS 剧情一览](https://prts.wiki/w/剧情一览)、[活动一览](https://prts.wiki/w/活动一览)。
- 少女前线：[IOP Wiki Story](https://iopwiki.com/wiki/Story) 及对应章节／活动页面。
- 少女前线2：[收藏没有福利的天依](https://space.bilibili.com/193691415)、[泠喵喵喵喵](https://space.bilibili.com/6478956) 的剧情视频目录与分集名称，并结合游戏目录人工核对；日期参照 [IOP Wiki GFL2 Events](https://iopwiki.com/wiki/GFL2_Events)。具体视频来源保存在各剧情节点中。
- 蔚蓝档案：[electricgoat/ba-data](https://github.com/electricgoat/ba-data)、[SchaleDB 简中角色数据](https://github.com/SchaleDB/SchaleDB/blob/70a2c4b8982ca860687898e61848847a60ffe3b8/data/cn/students.json)、[国服官网](https://bluearchive-cn.com/)，以及人工核对的 Bilibili 分集标题。具体来源链接保存在数据中。

## 致谢

感谢以下 Wiki、数据维护者与视频作者提供的剧情目录、开放日期和标题对照资料：

- **明日方舟**：[PRTS](https://prts.wiki/)。
- **少女前线**：[IOP Wiki](https://iopwiki.com/)。
- **少女前线2：追放**：[IOP Wiki](https://iopwiki.com/)，以及 UP 主 [收藏没有福利的天依](https://space.bilibili.com/193691415)、[泠喵喵喵喵](https://space.bilibili.com/6478956)。
- **蔚蓝档案**：[electricgoat/ba-data](https://github.com/electricgoat/ba-data)、[SchaleDB](https://github.com/SchaleDB/SchaleDB)，以及 UP 主 [player0520](https://space.bilibili.com/456162506)、[威威字幕君](https://space.bilibili.com/7045822)、[Modlinks](https://space.bilibili.com/3537121453279854)、[EastSummer_东夏](https://space.bilibili.com/1696052)、[by北辰y](https://space.bilibili.com/602821873)。

本工具为非官方项目。第三方名称及来源内容的权利归相应权利方，使用和再分发需遵守来源条款。

## 许可证

本项目原创程序代码采用 [MIT](LICENSE)。第三方软件声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)，许可原文随包保存在 `licenses/`。

游戏目录的来源、适用许可与修改说明见 [DATA_LICENSES.md](DATA_LICENSES.md)。PRTS 相关整理内容采用 CC BY-NC-SA 4.0，IOP Wiki 相关社区内容采用 CC BY-SA 3.0。

## 从源码运行

开发环境：Windows x64、Node.js 24、Rust MSVC 工具链、Visual Studio C++ 构建工具和 WebView2 Runtime。

在源码根目录执行：

    npm ci
    npm run importers:install
    npm run desktop:dev

前端与导入模块测试使用 `npm test`，数据库测试使用 `npm run test:db`。构建程序使用 `npm run desktop:build`。便携打包需先生成四份导出目录及 BA 校对报告；现成便携包从 Release 下载。
