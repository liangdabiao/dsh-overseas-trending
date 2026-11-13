# dsh-overseas-trending · 海外跨平台热文搜索

> 输入任意关键词（中文/英文），一次搜索 X / TikTok / YouTube 三平台热门内容，每平台 Top N 统一列表，语言优先分层，深色主题交互式 HTML 报告（卡片/表格双视图）。

dsh 插件（完整形态：原生工具 + 数据持久化 + 侧栏看板）。平台适配器模式，移植自 [redfox-community](https://github.com/redfox-data/redfox-community) 的 skills/overseas-trending-search，Python 引擎（digest.py + sources/ 共 963 行）全量重写为 Node。
<img width="1743" height="1389" alt="image" src="https://github.com/user-attachments/assets/c153e61e-9731-44c2-9f03-8d75fa88ab77" />

<img width="1998" height="1332" alt="image" src="https://github.com/user-attachments/assets/a47752ac-3f15-4983-a5a2-edac070770d9" />


## ⚠️ 实测要点（对上游的适配）

- **TikTok searchVideo 接口已变更**：需 `offset` + `count` 参数（上游脚本仅传 keyword，会报 3203「count不能为空」）——插件已适配新参数。
- **积分消耗大**：YouTube 点赞/评论需逐条调 videoDetail 补全（每关键词最多 20 次，可调小省积分）——一次三平台搜索约 23+ 次接口调用；三平台**并行**采集（实测 X 约 9s、TikTok 约 13s、YouTube 约 33s，并行后整轮约 25-60s，面板上会有按钮倒计时与状态行提示）。
- **X search 必填 searchType=Top**（缺失会误报 3203）。
- **TikTok 热门多为历史内容**：默认 1 天窗口会滤掉大量结果，建议放宽到 3-7 天或 0（工具回执注明排除数）。

## 功能

- **overseas_search 工具**（agent 对话内使用）
  - `search`：keywords × platforms 循环采集（平台故障优雅降级，状态如实标注）→ 时间窗口过滤 → 语言分层 + 组内降序 + 每平台 Top N
  - `list` / `get`：搜索历史与补读
- **语言优先分层**：中文关键词优先中文内容、英文关键词优先英文内容，其他语言兜底（字符集识别，无第三方依赖）
- **统一记录 schema**：platform / title / url / author / likes / comments / views / shares / publish_time / lang
- **侧栏看板**：搜索表单（平台多选/时间窗口/排序/条数/详情补全量）、平台状态统计格、历史归档、交互式 HTML 报告（上游模板：筛选 chips + 卡片/表格双视图 + 全字段）
- **overseas-trending 技能**：展示规范 + 积分纪律 + 平台状态转述规则

## 安装

```bash
dsh plugin --profile web add file:D:/dsh-research/dsh-overseas-trending
```

前置：dsh >= 0.2.1-rc.2；RedFox API Key（[红狐 hub 获取](https://redfox.hk/settings/api-keys?source=github)，`ak_` 开头）。

## 开发

```bash
npm install        # 安装依赖并构建 dist/client.js
npm test           # 单测（node --test）
npm run smoke      # 离线冒烟：假三平台服务器（降级/语言分层/时间窗口）+ 工具直调 + 面板 API 全路由
npm run dev        # 开发预览：DSH_HOME=<数据目录> node scripts/devserver.mjs 5210
npm run live       # 真实搜索：DSH_HOME=<目录> node scripts/live.mjs [关键词] ak_xxx
```

数据目录：`$DSH_HOME/overseas-trending/`（settings.json + searches/<id>/meta.json、raw.json、report.html）。

## License

MIT
