# AI 批量标签格式修复实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复批量 AI 标签生成功能的格式识别问题和字段不全问题，确保稳定解析 AI 返回结果并传入完整角色卡字段。

**Architecture:** 采用"强约束格式优先"策略，在 Prompt 中明确 `{"results":[...]}` 为主格式，解析器优先取 `results` 字段并回退纯数组，同时确保 Prompt 包含扩展组 9 个必传字段。

**Tech Stack:** JavaScript (ES Modules), SillyTavern API, IndexedDB

---

## 任务清单

### Task 1: 修改 buildBatchOverviewPrompt() 的回复格式约束

**Files:**
- Modify: [`ai-overview/prompt-builder.js`](../../ai-overview/prompt-builder.js:51)

**Step 1: 读取当前 buildBatchOverviewPrompt() 实现**

读取 [`ai-overview/prompt-builder.js`](../../ai-overview/prompt-builder.js:51) 第 51-79 行，确认当前 Prompt 模板结构。

**Step 2: 修改回复格式示例**

将第 74-78 行的回复格式从：
```javascript
return `...
[回复格式] 严格仅返回 JSON 数组，不要 markdown 标记：
[
  {"fileName": "角色 1 的 fileName", "summary": "...", "tags": ["标签 1", "标签 2"]},
  {"fileName": "角色 2 的 fileName", "summary": "...", "tags": ["标签 1"]}
]`;
```

修改为：
```javascript
return `...
[回复格式] 严格仅返回 JSON，不要 markdown 标记。主格式为 {"results":[...]}，若无法返回包裹格式则纯数组 [...] 也可接受：
{
  "results": [
    {"fileName": "角色 1 的 fileName", "summary": "...", "tags": ["标签 1", "标签 2"]},
    {"fileName": "角色 2 的 fileName", "summary": "...", "tags": ["标签 1"]}
  ]
}
或回退格式：
[
  {"fileName": "角色 1 的 fileName", "summary": "...", "tags": ["标签 1", "标签 2"]},
  {"fileName": "角色 2 的 fileName", "summary": "...", "tags": ["标签 1"]}
]`;
```

**Step 3: 补充字段键名约束**

在回复格式说明后追加：
```
[字段约束] 必须使用以下键名：
- fileName: 角色文件名（用于匹配）
- summary: 概览内容（必填）
- tags: 标签数组（可选）
```

**Step 4: 验证修改**

读取修改后的文件，确认：
- 主格式 `{"results":[...]}` 已声明
- 回退格式 `[...]` 已声明
- 字段键名约束已添加

**Step 5: 提交**

```bash
git add ai-overview/prompt-builder.js
git commit -m "fix(ai-batch): 强化批量标签返回格式约束，声明主格式为 {results:[...]} 并兼容纯数组回退"
```

---

### Task 2: 修改 parseBatchOverviewResult() 优先取 results 字段

**Files:**
- Modify: [`ai-overview/result-parser.js`](../../ai-overview/result-parser.js:104)

**Step 1: 读取当前 parseBatchOverviewResult() 实现**

读取 [`ai-overview/result-parser.js`](../../ai-overview/result-parser.js:104) 第 104-140 行，确认当前解析逻辑。

**Step 2: 修改 results 提取逻辑**

将第 105-114 行从：
```javascript
export async function parseBatchOverviewResult(aiResponse, characters, forceGenerateTags = false) {
    const results = safeParseJson(aiResponse);
    
    if (!results) {
        throw new Error('AI 响应解析失败：无法解析为 JSON');
    }
    
    if (!Array.isArray(results)) {
        throw new Error('AI 响应格式错误：期望数组');
    }
```

修改为：
```javascript
export async function parseBatchOverviewResult(aiResponse, characters, forceGenerateTags = false) {
    const parsed = safeParseJson(aiResponse);
    
    if (!parsed) {
        throw new Error('AI 响应解析失败：无法解析为 JSON');
    }
    
    // 两阶段解析：优先取 results 字段，回退为数组
    let results;
    if (parsed.results && Array.isArray(parsed.results)) {
        results = parsed.results;
    } else if (Array.isArray(parsed)) {
        results = parsed;
    } else {
        throw new Error('AI 响应格式错误：期望 {"results":[...]} 或 [...]');
    }
```

**Step 3: 添加 tags 字段标准化**

在第 158 行后（`if (item.tags && Array.isArray(item.tags) && shouldApplyTags)` 之前）追加：
```javascript
// tags 字段标准化：非数组时置为空数组
const normalizedTags = (item.tags && Array.isArray(item.tags)) ? item.tags : [];
```

并将第 158-161 行从：
```javascript
if (item.tags && Array.isArray(item.tags) && shouldApplyTags) {
    const sanitizedTags = sanitizeTags(item.tags);
    // forceGenerateTags=true 时使用 replace:true 覆盖现有标签，否则使用 replace:false 合并
    const applyResult = await applyTagsByNames(fileName, sanitizedTags, { replace: forceGenerateTags });
```

修改为：
```javascript
if (normalizedTags.length > 0 && shouldApplyTags) {
    const sanitizedTags = sanitizeTags(normalizedTags);
    // forceGenerateTags=true 时使用 replace:true 覆盖现有标签，否则使用 replace:false 合并
    const applyResult = await applyTagsByNames(fileName, sanitizedTags, { replace: forceGenerateTags });
```

**Step 4: 验证修改**

读取修改后的文件，确认：
- `results` 提取逻辑优先取 `results` 字段
- 回退为纯数组
- `tags` 非数组时标准化为空数组

**Step 5: 提交**

```bash
git add ai-overview/result-parser.js
git commit -m "fix(ai-batch): 解析器优先取 results 字段并兼容纯数组回退，tags 非数组时置空"
```

---

### Task 3: 验证 extractCharacterData() 已包含扩展组字段

**Files:**
- Verify: [`ai-overview/ai-service.js`](../../ai-overview/ai-service.js:31)

**Step 1: 读取 extractCharacterData() 实现**

读取 [`ai-overview/ai-service.js`](../../ai-overview/ai-service.js:31) 第 31-45 行。

**Step 2: 确认字段完整性**

验证以下 9 个扩展组字段是否全部存在：
- [ ] `name`
- [ ] `description`
- [ ] `personality`
- [ ] `scenario`
- [ ] `first_mes`
- [ ] `mes_example`
- [ ] `system_prompt`
- [ ] `post_history_instructions`
- [ ] `creatorcomment`

**Step 3: 记录验证结果**

若字段完整，记录"验证通过，无需修改"。
若字段缺失，追加缺失字段。

**Step 4: 提交（如有修改）**

```bash
git add ai-overview/ai-service.js
git commit -m "fix(ai-batch): 确保 extractCharacterData() 输出扩展组 9 个必传字段"
```

---

### Task 4: 手动功能验证

**Files:**
- 无需修改代码

**Step 1: 准备测试角色卡**

选择 3-5 个角色卡用于测试，确保：
- 至少 1 个包含 `system_prompt`
- 至少 1 个包含 `post_history_instructions`
- 至少 1 个包含 `creatorcomment`

**Step 2: 启动 SillyTavern 主项目**

```bash
cd O:\Container\silly_tavern\SillyTavernchat-main
npm start
```

**Step 3: 在浏览器中打开插件设置**

- 配置 OpenAI API Key 和 Base URL
- 启用 Debug Mode（可选）

**Step 4: 执行批量 AI 标签生成**

- 选择测试角色卡
- 点击"批量 AI 生成标签"
- 观察进度条和日志输出

**Step 5: 验证结果**

检查：
- [ ] 所有角色卡是否成功生成概览和标签
- [ ] 控制台日志中 Prompt 是否包含扩展组字段
- [ ] 无格式解析错误

**Step 6: 记录验证结果**

在文档末尾追加验证报告：
```markdown
## 验证报告

**测试日期:** YYYY-MM-DD
**测试角色数:** N
**成功数:** X
**失败数:** Y
**问题记录:** [如有]
```

---

## 完成标准

- [ ] Task 1 完成并提交
- [ ] Task 2 完成并提交
- [ ] Task 3 验证通过
- [ ] Task 4 手动验证通过
- [ ] 所有代码已推送到 git

---

## 执行选项

计划已完成并保存到 [`docs/plans/2026-03-04-ai-batch-tag-format-fix-implementation-plan.md`](../../docs/plans/2026-03-04-ai-batch-tag-format-fix-implementation-plan.md)。

**两种执行方式可选：**

1. **Subagent-Driven（当前会话）** - 我 dispatch 子代理逐个任务执行，每个任务间进行代码审查，快速迭代
2. **Parallel Session（独立会话）** - 打开新会话使用 executing-plans 技能批量执行

请选择执行方式喵~
