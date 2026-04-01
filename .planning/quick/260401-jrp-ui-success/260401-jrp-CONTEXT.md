# Quick Task 260401-jrp: 修复翻译勾选状态UI显示、Success项重新翻译逻辑、更新按钮选择框样式优化 - Context

**Gathered:** 2026-04-01
**Status:** Ready for planning

<domain>
## Task Boundary

修复三个已实现功能的 UI/逻辑问题：
1. 翻译成功后 checkbox 视觉上仍显示勾选（数据已清除但 UI 未同步）
2. 已翻译为 Success 的项重新勾选后应重新翻译（当前被跳过）
3. 角色卡详情页更新按钮的选择框改为按钮下方 inline 小弹窗（非全屏 modal）

</domain>

<decisions>
## Implementation Decisions

### 勾选状态 UI 同步
- 在清除 selectedItems 的同时，通过 DOM 查询找到对应 checkbox 并设置 checked=false
- 不重新渲染整个 body，避免闪烁和性能开销

### Success 项重新翻译
- selected 模式下移除 `if (item.status === STATUS.SUCCESS) return;` 的过滤逻辑
- 用户勾选什么就翻译什么，不再根据状态跳过
- all/group 模式仍保持跳过 SUCCESS 项的行为（避免重复翻译未手动选择的项）

### 更新按钮选择框
- 改为按钮下方 inline 小弹窗（绝对定位）
- 点击外部或选择选项后自动关闭
- 不使用 createBaseDialog（modal），直接操作 DOM 创建 popup 元素

### the agent's Discretion
- popup 的样式、动画、关闭时机等细节由 agent 自行决定
- 具体 CSS 类名和 DOM 结构由 agent 根据现有代码风格决定

</decisions>

<specifics>
## Specific Ideas

- Issue 1 修复位置：translation-ui.js 约第 1067 行，itemsToRemove.forEach 循环内同步更新 checkbox
- Issue 2 修复位置：translation-ui.js 约第 944-949 行，selected 模式的过滤逻辑
- Issue 3 修复位置：ui-details.js handleUpdate() 方法，替换 createBaseDialog 为 inline popup

</specifics>

<canonical_refs>
## Canonical References

No external specs — requirements fully captured in decisions above

</canonical_refs>
