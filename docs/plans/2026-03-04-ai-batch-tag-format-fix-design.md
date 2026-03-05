# AI 批量标签格式修复设计

## 概述

优化批量 AI 标签生成功能，解决以下两个核心问题：

1. **格式识别失败**：AI 返回格式不稳定，导致解析失败或返回值错误
2. **角色卡字段不全**：传入 Prompt 的字段缺少关键信息，影响标签生成质量

## 需求分析

### 当前问题

| 问题 | 描述 | 影响 |
|------|------|------|
| 格式识别失败 | AI 返回格式不统一，解析器无法稳定提取 `results` 数组 | 批量处理失败 |
| 字段不全 | Prompt 中缺少 `system_prompt`、`post_history_instructions`、`creatorcomment` 等关键字段 | 标签质量下降 |

### 用户期望

1. AI 返回格式稳定可解析，支持 `{"results":[...]}` 主格式，兼容纯数组 `[...]` 回退
2. Prompt 中包含完整的扩展组字段，确保 AI 有足够信息生成准确标签

## 设计方案

### 1. 返回格式协议

**主格式**（优先）：
```json
{
  "results": [
    {"fileName": "角色 1 文件名", "summary": "...", "tags": ["标签 1", "标签 2"]},
    {"fileName": "角色 2 文件名", "summary": "...", "tags": ["标签 1"]}
  ]
}
```

**回退格式**（兼容）：
```json
[
  {"fileName": "角色 1 文件名", "summary": "...", "tags": ["标签 1", "标签 2"]},
  {"fileName": "角色 2 文件名", "summary": "...", "tags": ["标签 1"]}
]
```

**字段规范**：
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `fileName` | string | 是 | 角色文件名，用于匹配 |
| `summary` | string | 是 | 概览内容 |
| `tags` | string[] | 否 | 标签数组，可为空 |

### 2. 角色卡字段扩展

**扩展组必传字段**（在 [`extractCharacterData()`](../../ai-overview/ai-service.js:31) 中确保）：

| 字段 | 来源 | 说明 |
|------|------|------|
| `name` | `char.name` / `data.name` | 角色名 |
| `description` | `data.description` | 角色描述 |
| `personality` | `data.personality` | 性格特征 |
| `scenario` | `data.scenario` | 场景设定 |
| `first_mes` | `data.first_mes` | 首次对话 |
| `mes_example` | `data.mes_example` | 对话示例 |
| `system_prompt` | `data.system_prompt` / `data.extensions.system_prompt` | 系统提示 |
| `post_history_instructions` | `data.post_history_instructions` / `data.extensions.post_history_instructions` | 历史后指令 |
| `creatorcomment` | `data.creator_notes` / `data.creatorcomment` | 创作者注释 |

### 3. 解析器两阶段策略

**阶段 1：结构层解析**（在 [`safeParseJson()`](../../ai-overview/result-parser.js:14) 中实现）
1. 尝试直接 `JSON.parse()`
2. 失败则清理 markdown 标记、提取 JSON 片段
3. 返回解析后的对象

**阶段 2：字段层标准化**（在 [`parseBatchOverviewResult()`](../../ai-overview/result-parser.js:104) 中实现）
1. 优先取 `results` 字段（若存在）
2. 若无 `results`，回退为数组本身
3. 逐角色校验 `fileName` 和 `summary` 必填字段
4. `tags` 非数组时置为空数组

### 4. Prompt 约束强化

在 [`buildBatchOverviewPrompt()`](../../ai-overview/prompt-builder.js:51) 中：

1. **明确主格式**：声明"请返回 `{"results":[...]}` 格式"
2. **声明回退兼容**：补充"若无法返回包裹格式，纯数组 `[...]` 也可接受"
3. **字段键名约束**：强调"必须使用 `fileName`、`summary`、`tags` 作为键名"
4. **禁止 markdown**：要求"不要包含 ```json 等 markdown 标记"

### 5. 错误处理

| 错误类型 | 处理策略 |
|----------|----------|
| 非 JSON 响应 | 返回"格式错误"，整个批次失败 |
| 非对象/非数组 | 返回"格式错误"，整个批次失败 |
| 缺 `results` 且非数组 | 返回"格式错误"，整个批次失败 |
| 角色缺 `summary` | 该角色失败，不影响其他角色 |
| `fileName` 未匹配 | 该角色失败，不影响其他角色 |
| `tags` 非数组 | 自动置为空数组，不报错 |

### 6. 数据流

```
┌─────────────────────────────────────────────────────────────┐
│  1. extractCharacterData()                                   │
│     输出扩展组字段（9 个必传字段）                              │
│                         ↓                                   │
│  2. buildBatchOverviewPrompt()                               │
│     生成主格式约束 Prompt                                     │
│                         ↓                                   │
│  3. AI API 调用                                               │
│     返回 {"results":[...]} 或 [...]                          │
│                         ↓                                   │
│  4. safeParseJson()                                          │
│     清洗并解析为 JS 对象                                       │
│                         ↓                                   │
│  5. parseBatchOverviewResult()                               │
│     提取 results|array，逐角色校验并落库                       │
│                         ↓                                   │
│  6. 覆盖率校验                                                │
│     检查是否有角色被 AI 遗漏                                   │
└─────────────────────────────────────────────────────────────┘
```

## 文件改动清单

### ai-overview/ai-service.js

| 函数 | 改动内容 |
|------|----------|
| `extractCharacterData()` | 确保输出扩展组 9 个字段（已有，无需修改） |

### ai-overview/prompt-builder.js

| 函数 | 改动内容 |
|------|----------|
| `buildBatchOverviewPrompt()` | 1. 修改回复格式示例为 `{"results":[...]}`<br>2. 补充回退兼容说明<br>3. 强调字段键名约束 |

### ai-overview/result-parser.js

| 函数 | 改动内容 |
|------|----------|
| `safeParseJson()` | 无需修改（已有 markdown 清理和 JSON 提取逻辑） |
| `parseBatchOverviewResult()` | 1. 优先取 `results` 字段<br>2. 回退为数组本身<br>3. `tags` 非数组时置为空数组 |

## 向后兼容性

- 纯数组格式仍然有效，作为回退方案
- 现有单角色模式不受影响
- 进度回调结构保持不变

## 验收标准

1. ✅ AI 返回 `{"results":[...]}` 可全部解析成功
2. ✅ AI 返回纯数组 `[...]` 仍可解析成功
3. ✅ 任一角色格式异常仅影响该角色，不影响批次内其他角色
4. ✅ Prompt 中确实包含扩展组 9 个字段（含 `system_prompt`、`post_history_instructions`、`creatorcomment`）
5. ✅ `tags` 字段缺失或非数组时，自动置为空数组，不报错

## 测试要点

1. **格式兼容性验证**：
   - 构造 `{"results":[...]}` 响应，验证解析成功
   - 构造纯数组 `[...]` 响应，验证解析成功
   - 构造带 markdown 标记的响应，验证清理成功

2. **字段完整性验证**：
   - 选择包含 `system_prompt` 的角色卡，验证 Prompt 中确实包含该字段
   - 选择包含 `post_history_instructions` 的角色卡，验证 Prompt 中确实包含该字段
   - 选择包含 `creatorcomment` 的角色卡，验证 Prompt 中确实包含该字段

3. **错误隔离验证**：
   - 模拟单个角色缺 `summary`，验证仅该角色失败
   - 模拟单个角色 `fileName` 未匹配，验证仅该角色失败

4. **边界情况**：
   - 单角色批次
   - 空角色列表
   - 超大角色卡（Token 超限）
