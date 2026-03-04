# AI 标签批量处理优化设计

## 概述

优化批量 AI 标签生成功能，解决以下问题：
1. Token 估算不准确导致超限报错
2. 进度条信息不够详细，用户无法了解处理进度
3. 批次/角色失败导致整体中断，缺乏错误隔离机制

## 需求分析

### 当前问题

| 问题 | 描述 | 影响 |
|------|------|------|
| Token 超限 | 分批后仍可能超出模型 Token 上限 | 批量处理失败 |
| 进度不透明 | 仅显示成功/失败数量，无批次/角色信息 | 用户体验差 |
| 错误扩散 | 一个批次或角色失败影响整体 | 效率低下 |

### 用户期望

1. 根据模型 Token 上限准确分批，避免超限报错
2. 进度条显示：批次进度 + 当前处理的角色
3. 失败隔离：单个角色失败不影响其他角色

## 设计方案

### 1. Token 估算优化

**改进点**：引入安全系数 + 输出预留空间

**实现逻辑**：
```javascript
function estimateCharTokens(char) {
    // 1. 基础估算（现有逻辑）
    const text = [description, personality, scenario, first_mes, mes_example].join('');
    const chineseChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
    const nonChineseChars = text.length - chineseChars;
    const estimatedTokens = Math.ceil(chineseChars / 1.5 + nonChineseChars / 4);
    
    // 2. 应用安全系数 0.7（防止估算偏差）
    const safeEstimate = Math.ceil(estimatedTokens * 0.7);
    
    // 3. 为输出预留空间（概览150字 + 标签约100字 ≈ 500 tokens）
    const outputReserve = 500;
    
    // 4. Prompt 模板基础开销
    const promptOverhead = 200;
    
    return Math.max(safeEstimate + outputReserve + promptOverhead, 100);
}
```

**效果**：假设模型 Token 上限 4096，实际可用输入约 3300 tokens

### 2. 进度回调增强

**新增进度事件类型**：

| 事件类型 | 触发时机 | 携带数据 |
|----------|----------|----------|
| `batch_start` | 批次开始处理 | batchIndex, totalBatches, charCount |
| `batch_end` | 批次处理完成 | batchIndex, successCount, errorCount |
| `char_success` | 角色处理成功 | charName, charIndex, batchIndex |
| `char_error` | 角色处理失败 | charName, charIndex, batchIndex, error |

**回调签名**：
```javascript
/**
 * @typedef {Object} ProgressEvent
 * @property {'batch_start'|'batch_end'|'char_success'|'char_error'} type
 * @property {number} batchIndex - 当前批次索引（从1开始）
 * @property {number} totalBatches - 总批次数
 * @property {number} [charIndex] - 角色在批次中的索引
 * @property {number} [charCount] - 批次内角色总数
 * @property {string} [charName] - 角色名
 * @property {string} [error] - 错误信息
 * @property {number} [successCount] - 批次成功数
 * @property {number} [errorCount] - 批次失败数
 */

/**
 * @param {ProgressEvent} event
 */
function onProgress(event) { ... }
```

**进度条显示格式**：

```
主文本：正在处理第 2/5 批次（共 15 个角色）
副文本：✅ 成功：8 | ❌ 失败：2
```

角色完成时的通知：
```
✅ 角色名: 生成成功
❌ 角色名: 保存失败 - 错误原因
```

### 3. 失败隔离机制

**层级 1 - 批次级隔离**：

```
批次 1: API 成功 → 解析结果
批次 2: API 失败 → 记录错误 → 继续批次 3
批次 3: API 成功 → 解析结果
```

**层级 2 - 角色级隔离**：

```
批次内角色处理：
  角色 A: 保存成功 ✅
  角色 B: 保存失败 ❌（记录错误，继续）
  角色 C: 保存成功 ✅
```

**实现要点**：
- API 请求失败：使用 try-catch 包裹，捕获后记录错误并 continue
- 结果解析失败：在 parseBatchOverviewResult 中为每个角色单独 try-catch
- 保持已成功结果：即使部分失败，成功的结果也要保存

### 4. 数据流设计

```
┌─────────────────────────────────────────────────────────────┐
│                    用户选择角色                              │
│                         ↓                                   │
│                 配置弹窗（选择模型/模式）                     │
│                         ↓                                   │
│    ┌─────────────────────────────────────────────────┐      │
│    │ 预估 Token → 分批                                │      │
│    │ 显示：将分为 N 批次处理，共 M 个角色              │      │
│    └─────────────────────────────────────────────────┘      │
│                         ↓                                   │
│    ┌─────────────────────────────────────────────────┐      │
│    │ 批次循环:                                        │      │
│    │   ├─ 进度：批次 N/M（共 X 个角色）               │      │
│    │   ├─ API 请求                                    │      │
│    │   │    ├─ 成功 → 解析结果                        │      │
│    │   │    │    ├─ 角色 A 保存成功 ✅                │      │
│    │   │    │    ├─ 角色 B 保存失败 ❌（记录）         │      │
│    │   │    │    └─ 角色 C 保存成功 ✅                │      │
│    │   │    └─ 失败 → 记录批次错误 → 继续下一批       │      │
│    │   └─ 进度更新                                    │      │
│    └─────────────────────────────────────────────────┘      │
│                         ↓                                   │
│    ┌─────────────────────────────────────────────────┐      │
│    │ 完成汇总:                                        │      │
│    │ ✅ 成功：X | ❌ 失败：Y                          │      │
│    │ 点击查看详情（如有失败）                         │      │
│    └─────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

## 文件改动清单

### ai-overview/ai-service.js

| 函数 | 改动内容 |
|------|----------|
| `estimateCharTokens` | 引入安全系数和输出预留空间 |
| `generateBatchOverview` | 1. 新增详细的 `onProgress` 回调结构<br>2. 批次级失败隔离<br>3. 返回更详细的结果统计 |

### ai-overview/result-parser.js

| 函数 | 改动内容 |
|------|----------|
| `parseBatchOverviewResult` | 1. 角色级失败隔离<br>2. 返回每个角色的处理结果 |

### index.js

| 函数 | 改动内容 |
|------|----------|
| `batchAIGenerateTags` | 1. 处理新的进度回调格式<br>2. 显示批次进度信息<br>3. 完成后汇总显示 |

## 向后兼容性

- 进度回调参数设计为可选，不传则使用简化模式
- 现有调用方式仍然有效，新增功能为增量改进
- 返回结果结构扩展，原有字段保持不变

## 测试要点

1. **Token 估算验证**：选择不同大小的角色卡，验证分批合理性
2. **进度显示验证**：确认批次和角色信息正确显示
3. **失败隔离验证**：模拟 API 失败和解析失败，确认不影响其他处理
4. **边界情况**：单批次、空角色、超大角色卡等场景