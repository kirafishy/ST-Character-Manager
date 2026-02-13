# 优化实施计划

## 1. 角色卡 Tag 跨设备通用方案
**目标**: 解决插件 Tag 数据只存在于本地浏览器缓存，无法随角色卡文件迁移的问题。

**方案**: 利用角色卡标准 (V2/V3 Spec) 中的 `tags` 字段。
1.  **数据层改造 (`data.js`)**:
    *   新增 `syncTagsToCard(char)` 函数：读取插件中该角色的 Tag，写入到角色卡文件的 `data.tags` 字段。
    *   修改 `addTagToChar` 和 `removeTagFromChar`：在操作成功后，检查设置，如果开启了“自动同步”，则触发写入。
2.  **设置项 (`settings.js`)**:
    *   在“数据与存储”或“行为与功能”中增加“自动将 Tag 写入角色卡”的开关。
    *   增加一个手动按钮“立即将所有 Tag 写入角色卡”，用于批量处理已有数据。

## 2. 设置界面 UI 优化
**目标**: 修复移动端显示问题。

**实施**:
1.  **CSS 调整 (`style.css`)**:
    *   针对 `cm-settings-container` 中的 Flex 布局添加 `@media (max-width: 768px)` 规则。
    *   强制源语言、目标语言、自定义输入框在移动端 `flex-direction: column`。
    *   限制自定义语言输入框的最大宽度，防止溢出。

## 3. 翻译界面 UI 优化
**目标**: 提升移动端可用性。

**实施**:
1.  **Toolbar 布局 (`translation/style.css`)**:
    *   优化 `.cm-trans-toolbar-row`，允许 `flex-wrap: wrap`。
    *   调整按钮间距和大小，适应触摸操作。
2.  **下拉菜单遮挡修复**:
    *   检查 `.cm-trans-container` 的 `overflow` 属性，确保下拉菜单不被截断。
    *   提升 `.cm-trans-dropdown-menu` 的 `z-index`。
3.  **顶部容器自适应**:
    *   移除固定高度限制，允许内容自然撑开。

## 执行顺序
1.  **Code Mode**: 修改 `style.css` 和 `translation/style.css` 解决 UI 问题 (Task 2 & 3)。
2.  **Code Mode**: 修改 `data.js` 和 `settings.js` 实现 Tag 同步功能 (Task 1)。