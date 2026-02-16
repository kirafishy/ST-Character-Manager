# 核心功能移植计划 (Feature Porting Plan)

本计划旨在将 `SillyTavern-CharacterLibrary-main` 的优秀特性移植到 `ST-Character-Manager` 中，重点提升用户体验、移动端适配及画廊管理能力。

## 1. 目标功能 (Target Features)

### 1.1 角色详情页重构 (Tabbed Interface)
- **现状**: `showDetail` 函数是一个巨大的单体函数，所有内容堆叠在一个模态框中。
- **目标**: 改为 **固定头部 + 标签页** 布局。
- **布局规划**:
  - **固定头部 (Fixed Header)**:
    - 左侧：头像。
    - 右侧：基础信息（文件名、创建者、Token数等）、标签 (Tags)、操作按钮（收藏、下载、删除、更新）、引用链接 (Source Link)。
    - *注：这些内容不随标签切换而改变。*
- **标签规划**:
  - **详情 (Details)**: 角色备注 (Description/Creator Notes)、First Message、替代称呼 (Alternate Names) 等核心角色数据。
  - **扩展 (Extended)**: 角色专属世界书 (World Info)、正则脚本 (Regex Scripts)、酒馆助手脚本 (Author's Note/Depth Prompt) 等高级扩展数据。
  - **画廊 (Gallery)**: 集成画廊视图，直接在 Tab 内显示。
  - **编辑 (Edit)**:
    - 功能：直接修改 PNG Metadata（角色名、描述、首条消息等）。
    - 安全：增加 **“解锁编辑” (Unlock to Edit)** 按钮，防止误触修改。

### 1.2 画廊增强 (Gallery Overhaul)
- **查看器 (Viewer)**:
  - 支持滚轮缩放 (Zoom) 和拖拽平移 (Pan)。
  - 底部缩略图导航条 (Thumbnail Strip)。
- **交互 (Interaction)**:
  - **上传**: 支持 **拖拽上传 (Drag & Drop)** 和 **点击按钮上传 (Click to Upload)**。
  - 批量管理（保留现有功能并优化）。

### 1.3 移动端优化 (Mobile Optimization)
- **手势**: 支持左右滑动切换角色 (Swipe Navigation)。
- **导航**: 适配 Android 物理返回键 (History API `pushState`)，关闭模态框而不退出应用。

### 1.4 作者附言 (Creator's Notes)
- **安全渲染**: 使用沙箱化 `<iframe>` 渲染作者的 HTML/Markdown 附言，防止 XSS 攻击。

### 1.5 维护工具 (Maintenance)
- **画廊清理**: 扫描 `user/images` 目录，识别并删除没有对应角色的“孤儿”文件夹。

## 2. 技术实现方案 (Technical Implementation)

### 2.1 文件结构调整
建议新增/修改以下文件以保持代码整洁：

- `ui-details.js`: (New) 接管 `index.js` 中的 `showDetail` 逻辑，实现 Tab 切换框架。
- `gallery-viewer.js`: (New) 专门处理灯箱（Lightbox）的高级交互逻辑（缩放、平移）。
- `gallery.js`: (Modify) 专注于画廊数据获取和网格渲染，移除旧的灯箱逻辑。
- `mobile-adapter.js`: (New) 处理手势和 History API。
- `utils-iframe.js`: (New) 处理沙箱 iframe 的创建和通信。

### 2.2 关键逻辑迁移

#### A. 详情页重构 (`ui-details.js`)
- 创建 `CharacterDetails` 类或模块。
- **布局构建**:
  - `renderHeader()`: 渲染固定头部（头像、基础信息、操作栏）。
  - `renderTabs()`: 渲染 Tab 导航条。
  - `renderContent()`: 渲染各 Tab 内容容器。
- **Tab 内容渲染**:
  - `renderDetailsTab()`: 渲染 Description, First Message 等。
  - `renderExtendedTab()`: 渲染 World Info, Regex, Scripts。
  - `renderGalleryTab()`: 渲染画廊网格。
  - `renderEditTab()`: 渲染 Metadata 编辑器（带解锁逻辑）。

#### B. 画廊查看器 (`gallery-viewer.js`)
- 移植 `SillyTavern-CharacterLibrary` 的 `GalleryViewer` 类。
- 使用 CSS `transform: translate(...) scale(...)` 实现平移缩放。
- 监听 `wheel`, `mousedown`, `mousemove`, `mouseup`, `touchstart`, `touchmove`, `touchend` 事件。

#### C. 移动端适配 (`mobile-adapter.js`)
- **Back Button**:
  ```javascript
  history.pushState({ modal: 'char-details' }, '');
  window.onpopstate = (e) => { if (!e.state) closeModal(); };
  ```
- **Swipe**:
  - 监听 `touchstart`, `touchend` 计算 X 轴位移。
  - 阈值判定（如 > 50px）触发 `prevChar()` 或 `nextChar()`。

#### D. 孤儿文件夹清理 (`gallery-cleanup.js`)
- 逻辑：
  1. 获取所有角色卡文件名 -> 提取角色名 (Name1)。
  2. 扫描 `user/images/` 下的所有文件夹名 (Name2)。
  3. 找出在 Name2 中存在但 Name1 中不存在的文件夹。
  4. 提供 UI 供用户确认删除。

## 3. 执行步骤 (Execution Steps)

### Phase 1: 基础架构与详情页重构
1.  [ ] 创建 `ui-details.js`，实现基础 Tab 框架。
2.  [ ] 将 `index.js` 中的 `showDetail` 逻辑拆分并迁移到 `ui-details.js`。
3.  [ ] 更新 `style.css` 添加 Tab 样式。

### Phase 2: 画廊功能升级
4.  [ ] 创建 `gallery-viewer.js`，实现缩放/平移灯箱。
5.  [ ] 修改 `gallery.js`，使其适配 Tab 布局（嵌入式显示而非弹窗）。
6.  [ ] 实现画廊上传功能（拖拽 + 点击按钮）。

### Phase 3: 移动端体验优化
7.  [ ] 创建 `mobile-adapter.js`。
8.  [ ] 实现 Android 返回键支持。
9.  [ ] 实现左右滑动切换角色。

### Phase 4: 高级功能与收尾
10. [ ] 实现 Creator's Notes 沙箱渲染。
11. [ ] 实现画廊孤儿文件夹清理工具。
12. [ ] 全面测试与 Bug 修复。

## 4. 依赖分析
- **外部依赖**: 无。
- **内部依赖**: 需要访问 `state.js` (当前角色), `context.js` (SillyTavern 上下文), `api.js` (文件操作)。
