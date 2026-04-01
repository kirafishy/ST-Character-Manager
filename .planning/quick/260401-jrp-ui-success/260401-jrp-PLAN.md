---
phase: quick
plan: 260401-jrp
type: execute
wave: 1
depends_on: []
files_modified:
  - translation/translation-ui.js
  - ui-details.js
autonomous: true
requirements: []
must_haves:
  truths:
    - "翻译成功后 checkbox 视觉上不再显示勾选"
    - "已翻译为 Success 的项重新勾选后会被重新翻译"
    - "更新按钮点击后显示按钮下方 inline 小弹窗而非全屏 modal"
  artifacts:
    - path: "translation/translation-ui.js"
      provides: "checkbox 同步更新 + selected 模式过滤逻辑修复"
      contains: "checkbox.checked = false, mode === 'selected' 不再过滤 SUCCESS"
    - path: "ui-details.js"
      provides: "inline popup 替代 createBaseDialog"
      contains: "绝对定位 popup 元素创建与关闭逻辑"
  key_links:
    - from: "translation/translation-ui.js"
      to: "DOM checkbox elements"
      via: "querySelector 同步 checked 状态"
      pattern: "checkbox\\.checked\\s*=\\s*false"
    - from: "ui-details.js handleUpdate()"
      to: "DOM popup element"
      via: "createElement + appendChild + 绝对定位"
      pattern: "createElement.*popup|style\\.position.*absolute"
---

<objective>
修复三个已实现功能的 UI/逻辑问题：翻译勾选状态 UI 同步、Success 项重新翻译逻辑、更新按钮选择框样式优化

Purpose: 提升翻译工作台的用户体验，消除视觉与数据不一致的问题，优化更新按钮交互
Output: 修复后的 translation-ui.js 和 ui-details.js
</objective>

<execution_context>
@$HOME/.config/opencode/get-shit-done/workflows/execute-plan.md
@$HOME/.config/opencode/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/quick/260401-jrp-ui-success/260401-jrp-CONTEXT.md
@translation/translation-ui.js
@ui-details.js
</context>

<tasks>

<task type="auto">
  <name>Task 1: 修复翻译成功后 checkbox 视觉状态不同步 + Success 项重新翻译逻辑</name>
  <files>translation/translation-ui.js</files>
  <action>
**Issue 1 - checkbox 视觉同步（第 1067 行附近）：**
在 `itemsToRemove.forEach(id => selectedItems.delete(id));` 之后，添加 DOM 同步逻辑：
```javascript
itemsToRemove.forEach(id => {
    selectedItems.delete(id);
    // 同步更新 DOM checkbox 视觉状态
    const checkbox = ov.querySelector(`.cm-trans-checkbox[data-item-id="${id}"]`);
    if (checkbox) checkbox.checked = false;
});
```
注意：需要确认 checkbox 元素是否有 data-item-id 属性，如果没有则使用其他选择器（如通过 itemId 匹配）。查看现有 checkbox 创建逻辑确认属性名。

**Issue 2 - Success 项重新翻译（第 948-953 行）：**
修改 selected 模式的过滤逻辑，当前代码：
```javascript
if (mode === 'selected') {
    if (!selectedItems.has(itemId)) return;
}
if (mode === 'all' || mode === 'group') {
    if (item.status === STATUS.SUCCESS) return;
}
```
改为：
```javascript
if (mode === 'selected') {
    if (!selectedItems.has(itemId)) return;
    // selected 模式下不再过滤 SUCCESS 状态，用户勾选什么就翻译什么
} else if (mode === 'all' || mode === 'group') {
    if (item.status === STATUS.SUCCESS) return;
}
```
关键变更：将 `if (mode === 'all' || mode === 'group')` 改为 `else if`，确保 selected 模式下不会执行 SUCCESS 过滤。

**决策依据：**
- Issue 1: 不重新渲染整个 body，避免闪烁和性能开销（per CONTEXT.md 决策）
- Issue 2: selected 模式下移除 SUCCESS 过滤，all/group 模式保持原行为（per CONTEXT.md 决策）
  </action>
  <verify>
    <automated>grep -n "checkbox.checked = false" translation/translation-ui.js && grep -n "else if (mode === 'all'" translation/translation-ui.js</automated>
  </verify>
  <done>
- checkbox 清除时 DOM 状态同步更新，视觉上不再显示勾选
- selected 模式下 SUCCESS 项会被加入翻译队列，all/group 模式仍跳过 SUCCESS 项
  </done>
</task>

<task type="auto">
  <name>Task 2: 更新按钮选择框改为按钮下方 inline 小弹窗</name>
  <files>ui-details.js</files>
  <action>
**替换 handleUpdate() 方法（第 3005-3030 行）：**

将 `createBaseDialog` 调用替换为 inline popup 实现：

1. **创建 popup 元素：**
   - 使用 `doc.createElement('div')` 创建 popup 容器
   - 设置样式：`position: absolute`, `z-index: 1000`, `background: var(--bg-color)`, `border: 1px solid var(--border-color)`, `border-radius: 8px`, `padding: 8px`, `box-shadow: 0 4px 12px rgba(0,0,0,0.15)`
   - 内容包含两个按钮：从本地文件更新、从 URL 更新（保持原有按钮样式和内容）

2. **定位逻辑：**
   - 获取更新按钮的位置：`updateBtn.getBoundingClientRect()`
   - 设置 popup 位置：`top: rect.bottom + 4px`, `left: rect.left`
   - 将 popup 添加到 `doc.body`

3. **关闭逻辑：**
   - 点击外部关闭：添加 `doc.addEventListener('click', handler)`，点击 popup 外部时移除 popup
   - 选择选项后关闭：点击任一按钮后移除 popup
   - 注意：按钮点击事件需要 `event.stopPropagation()` 防止触发外部关闭

4. **事件绑定：**
   - 保持原有的 `handleUpdateFromFile()` 和 `handleUpdateFromUrl()` 调用
   - 使用 `requestAnimationFrame` 确保 DOM 渲染后绑定事件

**决策依据：**
- 不使用 createBaseDialog（modal），直接操作 DOM 创建 popup 元素（per CONTEXT.md 决策）
- 点击外部或选择选项后自动关闭（per CONTEXT.md 决策）
- popup 的样式、动画、关闭时机等细节由 agent 自行决定（per CONTEXT.md 决策）
  </action>
  <verify>
    <automated>grep -n "createBaseDialog" ui-details.js | grep -c "handleUpdate" || echo "PASS: handleUpdate 不再使用 createBaseDialog"</automated>
  </verify>
  <done>
- handleUpdate() 不再调用 createBaseDialog
- 点击更新按钮后在按钮下方显示 inline 小弹窗
- 弹窗包含"从本地文件更新"和"从 URL 更新"两个选项
- 点击外部或选择选项后弹窗自动关闭
  </done>
</task>

</tasks>

<verification>
- 手动验证：在 SillyTavern 中测试翻译功能，确认成功后 checkbox 视觉状态正确
- 手动验证：勾选已翻译为 Success 的项并重新翻译，确认会被重新翻译
- 手动验证：点击角色卡详情页更新按钮，确认显示 inline 小弹窗而非全屏 modal
</verification>

<success_criteria>
- [ ] translation-ui.js 中 checkbox 清除时同步更新 DOM checked 状态
- [ ] translation-ui.js 中 selected 模式不再过滤 SUCCESS 状态
- [ ] ui-details.js 中 handleUpdate() 使用 inline popup 替代 createBaseDialog
- [ ] 所有修改在 SillyTavern 中手动验证通过
</success_criteria>

<output>
After completion, create `.planning/quick/260401-jrp-ui-success/260401-jrp-SUMMARY.md`
</output>
