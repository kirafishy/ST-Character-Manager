# 项目进度记录

## 最近完成
- [2026-05-07 01:40 CST] 完成快捷键功能移植：新增全局快捷键打开/关闭管理器，state.js 新增 openShortcut 字段，settings 面板新增录制输入框和清除按钮，index.js 注册全局 keydown 监听器（兼容 iframe 双窗口），关闭优先级链：画廊查看器 → 文本弹窗 → 角色详情 → 弹窗 → 主窗口。
- [2026-04-01 01:15 CST] 初始化 session 管理文件，补齐 [`feature-list.json`](feature-list.json)、[`PROGRESS.md`](PROGRESS.md)、[`HANDOFF.md`](HANDOFF.md) 的仓库级基础结构。
- [2026-04-01 09:40 CST] 初始化 GSD 项目结构（`.planning/ROADMAP.md`、`.planning/STATE.md`、`.planning/PROJECT.md`），使 quick workflow 可正常运行。
- [2026-04-01 09:40 CST] 完成 FEAT-013 ~ FEAT-016：翻译 toast 统计反馈、成功项自动清除勾选、导入进度后术语表 UI 刷新。
- [2026-04-01 09:45 CST] 完成 FEAT-017：角色卡详情页更新按钮支持从 URL 更新（Chub.ai、JanitorAI、Pygmalion 等平台）。
- [2026-04-01 14:14 CST] 修复翻译 UI 三个问题：checkbox 视觉状态同步、SUCCESS 项重新翻译逻辑、更新按钮 inline popup（z-index 修复）。
- [2026-04-01] 修复重新翻译 SUCCESS 项时 toast 显示"成功 0 条"的统计问题（重置待翻译项状态为 IDLE 后重新记录基准值）。
- [历史既有] 仓库已形成较完整的设计/实施计划文档体系，现有计划集中维护在 [`docs/plans/`](docs/plans/)。
- [历史既有] 项目核心模块、翻译模块、AI 概览模块与画廊模块的职责已在 [`CLAUDE.md`](CLAUDE.md) 与 [`codemap.md`](codemap.md) 中沉淀。

## 当前状态
- 已完成：为后续 agent 建立 session 启动所需的持久状态文件骨架。
- 已完成：基于 [`README.md`](README.md)、[`CLAUDE.md`](CLAUDE.md)、[`codemap.md`](codemap.md) 与 [`docs/plans/`](docs/plans/) 预填主要功能清单。
- 正在进行：[`docs/plans/2026-03-31-translation-export-import-implementation-plan.md`](docs/plans/2026-03-31-translation-export-import-implementation-plan.md) 对应的“翻译导出与回导修复”仍处于待继续实现/验证状态。
- 已记录：新增 3 条翻译体验待办，已写入 [`feature-list.json`](feature-list.json) 的 `FEAT-013`、`FEAT-014`、`FEAT-015`，用于追踪 toast 结果统计、局部翻译结果口径与成功项取消勾选。
- 已记录：新增 2 条功能待办，已写入 [`feature-list.json`](feature-list.json) 的 `FEAT-016`、`FEAT-017`，用于追踪“翻译保存进度保留已完成术语扫描”与“角色卡详情页更新按钮支持从 URL 更新”。
- 阻塞：当前仓库缺少 [`init.ps1`](init.ps1)，因此尚不满足规则中“session 启动脚本”这一约定；本次任务按用户范围限制，未额外补建该脚本。

## 下一步建议
- 优先级 1：继续推进 [`feature-list.json`](feature-list.json) 中 `FEAT-008` 的实现与手动验证，完成后再将 `status` 改为 `completed`。
- 优先级 2：实现并验证 [`feature-list.json`](feature-list.json) 中 `FEAT-013`、`FEAT-014`、`FEAT-015`，优先修正翻译反馈统计口径，再处理成功项自动取消勾选。
- 优先级 3：实现并验证 [`feature-list.json`](feature-list.json) 中 `FEAT-016`，确保翻译保存进度会保留已完成的术语扫描结果。
- 优先级 4：实现并验证 [`feature-list.json`](feature-list.json) 中 `FEAT-017`，为角色卡详情页“更新”按钮补齐从 URL 更新能力。
- 优先级 5：后续每次 session 结束时，追加更新 [`PROGRESS.md`](PROGRESS.md) 的“最近完成 / 当前状态 / 下一步建议 / 遗留问题”。
- 优先级 6：在条件允许时补齐 [`init.ps1`](init.ps1) 或等效启动脚本，使 session 启动流程闭环。

## 架构决策记录
- [2026-04-01 01:15 CST] 采用“仓库映射型初始化”策略：不是只写空模板，而是把仓库当前可观察到的能力面映射进 [`feature-list.json`](feature-list.json)，避免后续 agent 在无 ground truth 的情况下继续虚构功能状态。
- [2026-04-01 01:15 CST] [`feature-list.json`](feature-list.json) 中的 `passes` 全部初始化为 `false`，即使对应功能看起来已存在，也不凭感觉标记为已通过验证，保持与 [`.roo/rules.md`](.roo/rules.md) 的约定一致。

## 遗留问题
- [`feature-list.json`](feature-list.json) 当前是基于仓库文档与目录结构推断出的初始化清单，不等价于完整人工验收结果；后续应按条目逐项手动验证并更新 `passes`。
- [`docs/plans/`](docs/plans/) 中存在多份历史设计与实施计划，但尚未建立“计划 -> feature 条目 -> 验证结果”的严格一一映射，可在后续编排中继续细化。
