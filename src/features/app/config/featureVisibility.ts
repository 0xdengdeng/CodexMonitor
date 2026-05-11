/**
 * 集中控制各 feature 在 UI 上是否可见。
 *
 * 见 docs/product-cuts.md「核心产品原则」:**只隐藏 UI,不砍前端代码**。
 * 把对应 flag 设为 `true` 即可恢复显示,零返工。
 *
 * 后端 Tauri 命令 / Cargo 依赖 / hook 实现 / i18n / CSS 一律不动。
 */
export const FEATURE_VISIBILITY = {
  debugPanel: false,
  debugButton: false,
  /** GitHub Issues / Pull Requests UI(本地 git changes/commit log 不受影响) */
  githubIntegration: false,
  /** "新 worktree agent" / "克隆 agent" menu — branch switcher 不受影响 */
  worktreeAgentMenu: false,
} as const;
