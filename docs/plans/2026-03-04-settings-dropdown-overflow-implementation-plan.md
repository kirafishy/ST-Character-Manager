# 设置页下拉防撑宽修复 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复设置页下拉在长文本场景下撑宽挤出容器的问题，并将模型状态文案固定到按钮下一行，保证按钮贴右。

**Architecture:** 采用“设置页作用域 CSS 约束 + 模型行最小结构增强”的方案。通过统一右侧控件区的可收缩 flex 规则，解决所有设置下拉的宽度溢出；对模型行增加明确 class 容器，实现按钮贴右与状态文案独占下一行。保持数据请求与状态逻辑不变。

**Tech Stack:** JavaScript (ES Modules), CSS (Flexbox), SillyTavern 插件前端

---

### Task 1: 建立失败用例（手动复现基线）

**Files:**
- Modify: [`docs/plans/2026-03-04-settings-dropdown-overflow-implementation-plan.md`](docs/plans/2026-03-04-settings-dropdown-overflow-implementation-plan.md)

**Step 1: 写出失败用例（手动）**

记录失败现象（当前版本）：
1. 打开设置 → AI API 设置。
2. 点击“连接”获取模型列表（包含长模型名）。
3. 观察到下拉宽度膨胀，按钮/右侧元素错位。
4. “已获取 X 个模型”未固定在按钮下方。

**Step 2: 运行失败验证**

Run: 在浏览器中打开插件设置页并执行上面复现步骤。

Expected: 能稳定看到溢出或错位（FAIL 基线成立）。

**Step 3: Commit**

```bash
git add docs/plans/2026-03-04-settings-dropdown-overflow-implementation-plan.md
git commit -m "test: 补充设置页下拉溢出问题复现基线"
```

---

### Task 2: 为模型设置行补充可维护结构类

**Files:**
- Modify: [`settings.js`](settings.js:331)

**Step 1: 写“将失败”的结构断言（手动）**

断言目标（改动前不满足）：
1. 模型行右侧没有统一容器 class。
2. 状态文案与控件未形成同一垂直栈容器。

**Step 2: 最小实现改动**

在模型设置行把右侧改成明确结构：
1. 新增 `cm-setting-control cm-setting-control-stack` 包裹。
2. 同排控件容器新增 `cm-setting-inline-controls`。
3. 状态文案元素保留 id，新增 class `cm-setting-status`。

示例目标结构：

```html
<div class="cm-setting-control cm-setting-control-stack">
  <div class="cm-setting-inline-controls">
    <select id="cmSetOpenaiModelMain" class="cm-select-input">...</select>
    <button id="cmSetFetchModelsMain" class="cm-btn cm-btn-primary">🔗 连接</button>
  </div>
  <div id="cmSetModelStatusMain" class="cm-setting-status"></div>
</div>
```

**Step 3: 运行验证**

Run: 刷新设置页后用 DevTools 查看 DOM。

Expected: 模型项具备上述 class 结构（PASS）。

**Step 4: Commit**

```bash
git add settings.js
git commit -m "refactor: 规范模型设置行右侧控件容器结构"
```

---

### Task 3: 设置页统一防撑宽样式

**Files:**
- Modify: [`style.css`](style.css:2971)

**Step 1: 写失败样式断言（手动）**

改动前断言：
1. 设置页右侧控件区缺少 `min-width: 0` 收缩约束。
2. 设置页下拉缺少统一 `max-width + ellipsis`。

**Step 2: 最小实现改动**

在设置页作用域新增规则：
1. `.cm-settings-container .cm-setting-item > :not(.cm-setting-label)`
   - `flex: 1; min-width: 0; max-width: 100%;`
2. `.cm-settings-container .cm-setting-control`
   - `display: flex; min-width: 0; max-width: 100%;`
3. `.cm-settings-container .cm-setting-control-stack`
   - `flex-direction: column; align-items: stretch; gap: 4px;`
4. `.cm-settings-container .cm-setting-inline-controls`
   - `display: flex; align-items: center; gap: 6px; min-width: 0; width: 100%;`
5. `.cm-settings-container .cm-setting-inline-controls .cm-select-input`
   - `flex: 1; min-width: 0; max-width: 100%;`
6. `.cm-settings-container .cm-setting-inline-controls .cm-btn`
   - `flex-shrink: 0;`
7. `.cm-settings-container .cm-select-input`
   - `min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`
8. `.cm-settings-container .cm-setting-status`
   - `width: 100%; font-size: 11px; color: var(--cm-text-sec);`

**Step 3: 运行验证**

Run: 打开设置页并逐项检查长文本下拉。

Expected: 不再出现下拉撑宽导致的容器溢出（PASS）。

**Step 4: Commit**

```bash
git add style.css
git commit -m "fix: 统一设置页下拉防撑宽与控件区收缩规则"
```

---

### Task 4: 验收与回归检查

**Files:**
- Modify: 无（验证任务）

**Step 1: 执行主验收场景**

1. 点击“连接”后加载长模型名列表。
2. 确认下拉不撑破。
3. 确认按钮贴右。
4. 确认状态文案在按钮下一行。

**Step 2: 执行回归场景**

1. 设置页其他下拉（主题、排序、导入策略、语言）随机切换。
2. 检查布局无异常挤压。

**Step 3: 最终提交**

```bash
git add settings.js style.css
git commit -m "fix: 修复设置页下拉长文本撑宽与模型状态布局错位"
```

