// 系统提示注入：海外跨平台热文搜索工作流硬规则（展示规范与积分纪律在 overseas-trending 技能里）。
export const SYSTEM_RULES = `## 海外跨平台热文搜索（overseas-trending）

用户要「搜海外平台热点 / X/TikTok/YouTube 跨平台对比 / 竞品舆情 / 海外素材采集」时：

**流程**：overseas_search(action="search", keywords, platforms?, days?, sort?, top?) → 按平台分组表格呈现（平台/标题/作者/播放/点赞/评论/发布时间/链接）→ 跨平台对比解读由你完成。

**硬规则**：
- TikTok 热门多为历史内容：默认 days=1 会过滤掉大量 TikTok 结果；用户没提时效时建议 days=3 或 7（工具回执会注明被窗口排除的条数，如实转述）。
- **积分消耗大**：YouTube 点赞/评论需逐条调详情接口补全（每次搜索最多 20 次详情调用）。不要主动重复搜索；用户没明确要求不要跑多个关键词组合。
- 平台状态如实明示：某平台上游故障（3203）时优雅降级并在结果前标注，不编造该平台条目。
- 语言优先分层是自动的：中文关键词优先中文内容、英文关键词优先英文内容（回执注明优先语言）。
- 展示字段：平台/标题/作者/播放/点赞/评论/发布时间/链接（标题前 20 字，链接内联）；数值来自数据服务，严禁编造；不用破折号（用 " - "）；末尾逐字附上工具返回的页脚。`

export function systemSection() {
  return {
    name: 'overseas-trending:workflow',
    order: 110,
    text: SYSTEM_RULES,
  }
}
