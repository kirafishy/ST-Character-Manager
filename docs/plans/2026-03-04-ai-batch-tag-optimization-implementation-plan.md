# AI 标签批量处理优化实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 优化批量 AI 标签生成功能，解决 Token 超限、进度不透明、错误扩散三个问题。

**Architecture:** 采用增量改进方式，在现有架构上添加安全系数、增强进度回调、实现两级失败隔离（批次级+角色级）。

**Tech Stack:** ES Modules, JSDoc, async/await, IndexedDB

---

## Task 1: 优化 Token 估算函数

**Files:**
- Modify: `ai-overview/ai-service.js:230-251`

**Step 1: 修改 estimateCharTokens 函数**

将现有函数替换为优化后的版本：

```javascript
/**
 * 估算角色卡的 Token 数
 * 使用启发式方法：中文按 1.5 字符/token，英文按 4 字符/token
 * 增加安全系数和输出预留空间
 * @param {object} char - 角色对象
 * @returns {number} 估算的 token 数
 */
function estimateCharTokens(char) {
    const data = char.data || {};
    const text = [
        data.description || '',
        data.personality || '',
        data.scenario || '',
        data.first_mes || '',
        data.mes_example || ''
    ].join('');
    
    if (!text) return 100; // 空内容给一个基础值
    
    // 统计中文字符数（CJK 范围）
    const chineseChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
    const nonChineseChars = text.length - chineseChars;
    
    // 中文约 1.5 字符/token，英文约 4 字符/token
    const estimatedTokens = Math.ceil(chineseChars / 1.5 + nonChineseChars / 4);
    
    // 应用安全系数 0.7（防止估算偏差）
    const safeEstimate = Math.ceil(estimatedTokens * 0.7);
    
    // 为输出预留空间（概览150字 + 标签约100字 ≈ 500 tokens）
    const outputReserve = 500;
    
    // Prompt 模板基础开销
    const promptOverhead = 200;
    
    return Math.max(safeEstimate + outputReserve + promptOverhead, 100);
}
```

**Step 2: 手动验证**

启动 SillyTavern，打开开发者工具控制台：
1. 选择几个不同大小的角色卡
2. 在控制台执行估算逻辑验证返回值合理性
3. 确认估算值比原来减少约 30%

**Step 3: Commit**

```bash
git add ai-overview/ai-service.js
git commit -m "feat(ai): 优化 Token 估算，增加安全系数和输出预留"
```

---

## Task 2: 增强进度回调结构

**Files:**
- Modify: `ai-overview/ai-service.js:78-128`

**Step 1: 添加 ProgressEvent 类型定义**

在文件顶部（import 语句之后）添加：

```javascript
/**
 * @typedef {Object} ProgressEvent
 * @property {'batch_start'|'batch_end'|'char_success'|'char_error'} type - 事件类型
 * @property {number} batchIndex - 当前批次索引（从1开始）
 * @property {number} totalBatches - 总批次数
 * @property {number} [charIndex] - 角色在批次中的索引（从1开始）
 * @property {number} [charCount] - 批次内角色总数
 * @property {string} [charName] - 角色名
 * @property {string} [error] - 错误信息
 * @property {number} [successCount] - 批次成功数（batch_end 时）
 * @property {number} [errorCount] - 批次失败数（batch_end 时）
 */
```

**Step 2: 修改 generateBatchOverview 函数签名和实现**

将现有函数替换为：

```javascript
/**
 * 批量生成角色概览（打包模式）
 * @param {object[]} characters - 角色对象数组
 * @param {number} tokenLimit - Token 上限
 * @param {function} onProgress - 进度回调 (event: ProgressEvent) => void
 * @param {boolean} forceGenerateTags - 是否强制生成标签（覆盖已有标签）
 * @returns {Promise<{success: number, errors: number, results: object[], batchInfo: {total: number, failed: number}}>}
 */
export async function generateBatchOverview(characters, tokenLimit, onProgress, forceGenerateTags = false) {
    const config = getAIConfig();
    
    if (!config.apiKey || !config.apiKey.trim()) {
        throw new Error('未配置 AI API Key，请在设置中配置 OpenAI 渠道');
    }
    
    if (!config.baseUrl || !config.baseUrl.trim()) {
        throw new Error('未配置 AI API Base URL，请在设置中配置 OpenAI 渠道');
    }
    
    const results = [];
    let success = 0;
    let errors = 0;
    let failedBatches = 0;
    
    const batches = groupCharactersByTokenLimit(characters, tokenLimit);
    const totalBatches = batches.length;
    
    for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const batchIndex = i + 1;
        
        // 批次开始事件
        if (onProgress) {
            onProgress({
                type: 'batch_start',
                batchIndex,
                totalBatches,
                charCount: batch.length
            });
        }
        
        let batchSuccess = 0;
        let batchErrors = 0;
        
        try {
            const batchPrompt = buildBatchOverviewPrompt(batch.map(extractCharacterData), state.tags.map(t => t.name), forceGenerateTags);
            const response = await callOpenAI(config, batchPrompt, 4096);
            const batchResults = await parseBatchOverviewResult(response, batch, forceGenerateTags);
            
            for (let j = 0; j < batchResults.length; j++) {
                const result = batchResults[j];
                if (result.success) {
                    success++;
                    batchSuccess++;
                    if (onProgress) {
                        onProgress({
                            type: 'char_success',
                            batchIndex,
                            totalBatches,
                            charIndex: j + 1,
                            charCount: batch.length,
                            charName: result.charName
                        });
                    }
                } else {
                    errors++;
                    batchErrors++;
                    if (onProgress) {
                        onProgress({
                            type: 'char_error',
                            batchIndex,
                            totalBatches,
                            charIndex: j + 1,
                            charCount: batch.length,
                            charName: result.charName,
                            error: result.error
                        });
                    }
                }
                results.push(result);
            }
        } catch (e) {
            // 批次级失败：整个批次 API 调用失败
            failedBatches++;
            batchErrors = batch.length;
            errors += batch.length;
            
            for (let j = 0; j < batch.length; j++) {
                const char = batch[j];
                if (onProgress) {
                    onProgress({
                        type: 'char_error',
                        batchIndex,
                        totalBatches,
                        charIndex: j + 1,
                        charCount: batch.length,
                        charName: char.name,
                        error: e.message
                    });
                }
                results.push({
                    fileName: char.fileName || char.avatar,
                    charName: char.name,
                    success: false,
                    error: e.message
                });
            }
        }
        
        // 批次结束事件
        if (onProgress) {
            onProgress({
                type: 'batch_end',
                batchIndex,
                totalBatches,
                successCount: batchSuccess,
                errorCount: batchErrors
            });
        }
    }
    
    return { 
        success, 
        errors, 
        results,
        batchInfo: {
            total: totalBatches,
            failed: failedBatches
        }
    };
}
```

**Step 3: Commit**

```bash
git add ai-overview/ai-service.js
git commit -m "feat(ai): 增强批量处理进度回调，支持批次和角色级别事件"
```

---

## Task 3: 实现角色级失败隔离

**Files:**
- Modify: `ai-overview/result-parser.js:103-175`

**Step 1: 修改 parseBatchOverviewResult 函数签名**

更新函数签名，添加 `forceGenerateTags` 参数：

```javascript
/**
 * 解析批量角色的 AI 响应并保存
 * @param {string} aiResponse - AI 返回的原始文本
 * @param {object[]} characters - 角色对象数组
 * @param {boolean} forceGenerateTags - 是否强制生成标签（覆盖已有标签）
 * @returns {Promise<object[]>}
 */
export async function parseBatchOverviewResult(aiResponse, characters, forceGenerateTags = false) {
```

**Step 2: 更新函数内部逻辑，增强错误隔离**

将现有函数体替换为：

```javascript
export async function parseBatchOverviewResult(aiResponse, characters, forceGenerateTags = false) {
    const results = safeParseJson(aiResponse);
    
    if (!results) {
        throw new Error('AI 响应解析失败：无法解析为 JSON');
    }
    
    if (!Array.isArray(results)) {
        throw new Error('AI 响应格式错误：期望数组');
    }
    
    const outputResults = [];
    
    for (const item of results) {
        const char = characters.find(c => (c.fileName || c.avatar) === item.fileName);
        
        if (!char) {
            outputResults.push({
                fileName: item.fileName,
                charName: '未知',
                success: false,
                error: '未找到对应的角色文件'
            });
            continue;
        }
        
        if (!item.summary) {
            outputResults.push({
                fileName: item.fileName,
                charName: char.name,
                success: false,
                error: 'AI 未返回概览内容'
            });
            continue;
        }
        
        const fileName = char.fileName || char.avatar;
        
        // 角色级错误隔离：每个角色的保存操作独立 try-catch
        try {
            // 1. 先保存 summary
            await saveCharacterData(fileName, (data) => {
                const cm = getCmManager({ data });
                cm.summary = item.summary;
            });
            
            // 2. 使用统一入口应用标签，确保 state.tags/state.tagMap 同步更新
            // forceGenerateTags=true 时总是应用标签，否则检查是否已有标签
            const shouldApplyTags = forceGenerateTags || !checkCharHasTags(char);
            
            if (item.tags && Array.isArray(item.tags) && shouldApplyTags) {
                const sanitizedTags = sanitizeTags(item.tags);
                const applyResult = await applyTagsByNames(fileName, sanitizedTags, { replace: true });
                
                console.log(`[AI Batch] ${char.name}: +${applyResult.added} -${applyResult.removed} created:${applyResult.created}`);
            }
            
            outputResults.push({
                fileName: item.fileName,
                charName: char.name,
                success: true,
                summary: item.summary,
                tags: item.tags || []
            });
        } catch (e) {
            console.error(`[AI Batch] Failed for ${char.name}:`, e);
            outputResults.push({
                fileName: item.fileName,
                charName: char.name,
                success: false,
                error: `保存失败：${e.message}`
            });
        }
    }
    
    return outputResults;
}

/**
 * 检查角色是否有标签（辅助函数）
 * @param {object} char - 角色对象
 * @returns {boolean}
 */
function checkCharHasTags(char) {
    const cm = getCmManager(char);
    return cm.tags && cm.tags.length > 0 && !(cm.tags.length === 1 && cm.tags[0] === '');
}
```

**Step 3: Commit**

```bash
git add ai-overview/result-parser.js
git commit -m "feat(ai): 实现角色级失败隔离，单个角色失败不影响其他角色"
```

---

## Task 4: 更新 index.js 调用方式

**Files:**
- Modify: `index.js:2317-2332`

**Step 1: 修改批量处理模式的进度回调逻辑**

将现有的批量处理模式代码块替换为：

```javascript
        } else {
            // 批量处理模式
            let processedCount = 0;
            let batchSuccess = 0;
            let batchErrors = 0;
            
            const result = await generateBatchOverview(targetChars, tokenLimit, (event) => {
                if (cancelled) return;
                
                processedCount++;
                
                switch (event.type) {
                    case 'batch_start':
                        updateProgressBar(
                            Math.round((processedCount / total) * 100),
                            `正在处理第 ${event.batchIndex}/${event.totalBatches} 批次（共 ${event.charCount} 个角色）`,
                            `✅ 成功：${batchSuccess} | ❌ 失败：${batchErrors}`
                        );
                        break;
                        
                    case 'char_success':
                        batchSuccess++;
                        notify(`✅ ${event.charName}: 生成成功`, 'success', 1000);
                        updateProgressBar(
                            Math.round((processedCount / total) * 100),
                            `正在处理第 ${event.batchIndex}/${event.totalBatches} 批次`,
                            `✅ 成功：${batchSuccess} | ❌ 失败：${batchErrors}`
                        );
                        break;
                        
                    case 'char_error':
                        batchErrors++;
                        notify(`❌ ${event.charName}: ${event.error}`, 'error', 1500);
                        updateProgressBar(
                            Math.round((processedCount / total) * 100),
                            `正在处理第 ${event.batchIndex}/${event.totalBatches} 批次`,
                            `✅ 成功：${batchSuccess} | ❌ 失败：${batchErrors}`
                        );
                        break;
                        
                    case 'batch_end':
                        // 批次完成，可以在这里添加额外处理
                        break;
                }
            }, overwriteExisting);
            
            success = result.success;
            errors = result.errors;
        }
```

**Step 2: 更新完成提示信息**

修改完成时的提示（约在 2334-2342 行），添加批次失败信息：

```javascript
        if (!cancelled) {
            const batchInfoStr = result.batchInfo && result.batchInfo.failed > 0 
                ? `（${result.batchInfo.failed} 个批次失败）` 
                : '';
            updateProgressBar(100, '批量处理完成！' + batchInfoStr, `成功：${success} | 失败：${errors}`);
            setTimeout(() => hideProgressBar(), 2000);
            
            // 刷新界面
            renderView();
            renderTagSidebar();
            
            notify(`批量完成：成功 ${success}, 失败 ${errors}${batchInfoStr}`, 'success');
        }
```

**Step 3: Commit**

```bash
git add index.js
git commit -m "feat(ui): 更新批量处理进度显示，支持批次和角色级别进度信息"
```

---

## Task 5: 手动测试验证

**测试场景：**

1. **Token 估算测试**
   - 选择 5-10 个不同大小的角色卡
   - 选择批量处理模式，观察分批信息
   - 验证不再出现 Token 超限错误

2. **进度显示测试**
   - 选择多个角色执行批量 AI 标签
   - 验证进度条显示：`正在处理第 X/Y 批次（共 Z 个角色）`
   - 验证角色完成时的通知

3. **失败隔离测试**
   - 可以通过临时修改 API URL 模拟 API 失败
   - 验证单个角色失败不影响其他角色
   - 验证整个批次失败后继续处理下一批

4. **边界情况测试**
   - 单个角色卡批量处理
   - 空角色卡（无 description 等）
   - 超大角色卡（触发单角色单批次）

---

## 实现顺序总结

1. `ai-overview/ai-service.js` - Token 估算优化
2. `ai-overview/ai-service.js` - 进度回调增强
3. `ai-overview/result-parser.js` - 角色级失败隔离
4. `index.js` - 更新调用方式
5. 手动测试验证

**预计总改动：**
- 新增代码约 80 行
- 修改代码约 50 行
- 涉及 3 个文件