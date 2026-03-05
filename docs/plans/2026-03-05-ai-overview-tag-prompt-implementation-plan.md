# AI 概览与标签生成 Prompt 优化实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 优化 AI 概览与标签生成的 Prompt，实现分级优先、白名单约束、概念簇去重、宁缺毋滥的标签生成规则。

**Architecture:** 纯 Prompt 改造方案，在 `buildOverviewPrompt` 与 `buildBatchOverviewPrompt` 函数中新增"标签生成顺序"与"硬性约束"段落，不改动解析器和服务逻辑。

**Tech Stack:** JavaScript (ES Modules), SillyTavern 插件架构

---

## Task 1: 修改 buildOverviewPrompt 函数

**Files:**
- Modify: `ai-overview/prompt-builder.js:28-43`

**Step 1: 修改 Prompt 模板（需要生成标签的分支）**

将原有的 Prompt 模板从：

```javascript
    } else {
        const maxTags = state.settings.aiMaxTags || 5;
        return `你是一位专业的角色卡分析师。请分析以下角色卡数据，生成概览和标签。

${baseData}

[任务要求]
1. 概览：150字以内，精炼概括角色核心特征
2. 标签：最多${maxTags}个，优先从以下[系统标签库]中选择匹配标签，仅当无匹配时才创建新标签

[系统标签库]
${JSON.stringify(systemTags)}

[回复格式] 严格仅返回JSON，不要markdown标记：
{"summary": "...", "tags": ["标签1", "标签2"]}`;
    }
```

修改为：

```javascript
    } else {
        const maxTags = state.settings.aiMaxTags || 5;
        return `你是一位专业的角色卡分析师。请分析以下角色卡数据，生成概览和标签。

${baseData}

[任务要求]
1. 概览：150字以内，精炼概括角色核心特征
2. 标签：最多${maxTags}个，仅从以下[系统标签库]中选择匹配标签

[标签生成顺序]
1. 先判定分级标签：仅在证据充分时输出（如内容分级 SFW/NSFW）
2. 再筛选特征标签：仅从[系统标签库]中选择匹配标签
3. 最后做去重与裁剪：同一语义簇最多保留 1 个标签，按置信度排序后裁剪到上限

[硬性约束]
- 禁止创造新标签，只能从[系统标签库]中选择
- 不确定就不打标签，宁缺毋滥
- 标签数组可以为空或少于上限
- 若存在冲突候选（语义相近），保留区分度更高者
- 分级标签最多 1 个，仅当证据充分时输出

[系统标签库]
${JSON.stringify(systemTags)}

[回复格式] 严格仅返回JSON，不要markdown标记：
{"summary": "...", "tags": ["标签1", "标签2"]}`;
    }
```

**Step 2: 验证修改**

- 打开 `ai-overview/prompt-builder.js` 确认代码已正确修改
- 确认新增的"标签生成顺序"与"硬性约束"段落格式正确

**Step 3: 提交**

```bash
git add ai-overview/prompt-builder.js
git commit -m "feat(ai-overview): 优化单角色标签生成 Prompt，增加分级优先与白名单约束"
```

---

## Task 2: 修改 buildBatchOverviewPrompt 函数

**Files:**
- Modify: `ai-overview/prompt-builder.js:53-92`

**Step 1: 修改 Prompt 模板**

将原有的 Prompt 模板从：

```javascript
export function buildBatchOverviewPrompt(cardDataList, systemTags, forceGenerateTags = false) {
    const charactersSection = cardDataList.map((card, index) => {
        return `

--- 角色 ${index + 1} (fileName: "${card.fileName}") ---
${buildCharacterDataSection(card)}`;
    }).join('\n');
    
    const maxTags = state.settings.aiMaxTags || 5;
    const tagRequirement = `2. 为每个角色生成标签：最多${maxTags}个，优先从[系统标签库]中选择匹配标签，仅当无匹配时才创建新标签`;
    
    return `你是一位专业的角色卡分析师。请分析以下${cardDataList.length}个角色卡数据，为每个角色生成概览和标签。

[角色卡列表]${charactersSection}

[任务要求]
1. 为每个角色生成概览：150字以内，精炼概括角色核心特征
${tagRequirement}

[系统标签库]
${JSON.stringify(systemTags)}

[回复格式] 严格仅返回JSON，不要markdown标记。主格式为 {"results":[...]}，若无法返回包裹格式则纯数组 [...] 也可接受：
{
  "results": [
    {"fileName": "角色1的fileName", "summary": "...", "tags": ["标签1", "标签2"]},
    {"fileName": "角色2的fileName", "summary": "...", "tags": ["标签1"]}
  ]
}
或回退格式：
[
  {"fileName": "角色1的fileName", "summary": "...", "tags": ["标签1", "标签2"]},
  {"fileName": "角色2的fileName", "summary": "...", "tags": ["标签1"]}
]

[字段约束] 必须使用以下键名：
- fileName: 角色文件名（用于匹配）
- summary: 概览内容（必填）
- tags: 标签数组（可选）`;
}
```

修改为：

```javascript
export function buildBatchOverviewPrompt(cardDataList, systemTags, forceGenerateTags = false) {
    const charactersSection = cardDataList.map((card, index) => {
        return `

--- 角色 ${index + 1} (fileName: "${card.fileName}") ---
${buildCharacterDataSection(card)}`;
    }).join('\n');
    
    const maxTags = state.settings.aiMaxTags || 5;
    
    return `你是一位专业的角色卡分析师。请分析以下${cardDataList.length}个角色卡数据，为每个角色生成概览和标签。

[角色卡列表]${charactersSection}

[任务要求]
1. 为每个角色生成概览：150字以内，精炼概括角色核心特征
2. 为每个角色生成标签：最多${maxTags}个，仅从[系统标签库]中选择匹配标签

[标签生成顺序]
1. 先判定分级标签：仅在证据充分时输出（如内容分级 SFW/NSFW）
2. 再筛选特征标签：仅从[系统标签库]中选择匹配标签
3. 最后做去重与裁剪：同一语义簇最多保留 1 个标签，按置信度排序后裁剪到上限

[硬性约束]
- 禁止创造新标签，只能从[系统标签库]中选择
- 不确定就不打标签，宁缺毋滥
- 标签数组可以为空或少于上限
- 若存在冲突候选（语义相近），保留区分度更高者
- 分级标签最多 1 个，仅当证据充分时输出

[系统标签库]
${JSON.stringify(systemTags)}

[回复格式] 严格仅返回JSON，不要markdown标记。主格式为 {"results":[...]}，若无法返回包裹格式则纯数组 [...] 也可接受：
{
  "results": [
    {"fileName": "角色1的fileName", "summary": "...", "tags": ["标签1", "标签2"]},
    {"fileName": "角色2的fileName", "summary": "...", "tags": ["标签1"]}
  ]
}
或回退格式：
[
  {"fileName": "角色1的fileName", "summary": "...", "tags": ["标签1", "标签2"]},
  {"fileName": "角色2的fileName", "summary": "...", "tags": ["标签1"]}
]

[字段约束] 必须使用以下键名：
- fileName: 角色文件名（用于匹配）
- summary: 概览内容（必填）
- tags: 标签数组（可选，可为空）`;
}
```

**Step 2: 验证修改**

- 打开 `ai-overview/prompt-builder.js` 确认代码已正确修改
- 确认新增的"标签生成顺序"与"硬性约束"段落格式正确
- 确认已删除 `tagRequirement` 变量（不再需要）

**Step 3: 提交**

```bash
git add ai-overview/prompt-builder.js
git commit -m "feat(ai-overview): 优化批量角色标签生成 Prompt，增加分级优先与白名单约束"
```

---

## Task 3: 手动测试验证

**测试环境:** SillyTavern 主项目 + 当前插件

**Step 1: 启动 SillyTavern**

```bash
cd O:\Container\silly_tavern\SillyTavernchat-main
npm start
```

**Step 2: 测试单角色标签生成**

1. 在 SillyTavern 中打开角色管理插件
2. 选择一个没有标签的角色卡
3. 点击"AI 生成概览"按钮
4. 验证：
   - 生成的标签是否全部来自系统标签库
   - 是否无语义相近的重复标签
   - 若角色有明确分级特征，是否优先输出分级标签

**Step 3: 测试批量标签生成**

1. 选择多个角色卡
2. 点击"批量 AI 生成"按钮
3. 验证：
   - 每个角色的标签是否全部来自系统标签库
   - 是否无语义相近的重复标签
   - 标签数量是否可少于上限或为空

**Step 4: 记录测试结果**

在测试过程中记录：
- 是否有新造标签出现
- 是否有语义相近标签重复
- 分级标签判定是否合理

---

## 文件改动清单

| 文件 | 改动类型 | 改动内容 |
|------|----------|----------|
| `ai-overview/prompt-builder.js` | 修改 | `buildOverviewPrompt` 新增"标签生成顺序"与"硬性约束"段落 |
| `ai-overview/prompt-builder.js` | 修改 | `buildBatchOverviewPrompt` 新增"标签生成顺序"与"硬性约束"段落，删除 `tagRequirement` 变量 |

---

## 验收标准

| 编号 | 标准 | 验证方式 |
|------|------|----------|
| 1 | 输出标签全部来自系统标签库（零新造词） | 检查输出标签是否全部存在于 systemTags |
| 2 | 同一语义簇不重复 | 人工抽样检查（同事/职场、傲娇/口是心非 等） |
| 3 | 关键分级先判定，证据不足时不输出分级标签 | 检查分级标签的准确性 |
| 4 | 标签允许为空或少于上限，不为凑数降低准确性 | 验证标签数量分布 |