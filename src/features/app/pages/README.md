# AgentDesk 页面与 Surface 索引

> **作用**：未来调整某个页面 / 区域时，到这里查"去哪个文件改"。每次拆分、合并、重命名页面 / surface / props，都必须同步更新本表 —— 否则索引会过期，等于没有索引。

## 一、三层架构（自上而下）

```
┌──────────────────────────────────────────────────────────────┐
│ Surface 编排（pages/<名字>/buildXxxSurface.ts）                │
│ ⇒ 从 MainApp 上下文中挑出本 surface 需要的字段，整理成 props 包  │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ 节点工厂（src/features/layout/hooks/layoutNodes/build*Nodes）  │
│ ⇒ props 包 → ReactNode                                         │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ 视口分发（src/features/{Desktop,Tablet,Phone}Layout）          │
│ ⇒ 把节点摆到当前视口对应的位置                                  │
└──────────────────────────────────────────────────────────────┘
```

调用入口：`src/features/app/hooks/useMainAppLayoutSurfaces.ts` 把上下文拆成 `{ codex, git, shell }` 三个 surface；`useMainAppLayoutNodes`（`useLayoutNodes`）把它们交给三个节点工厂；`AppLayout.tsx` 按视口分发到具体布局组件。

## 二、用户视角 5 个页面 → 实际代码位置

`activeTab` 取值：`home | projects | codex | git | log`。

| 用户页面 | activeTab | 入口节点 | 真正的 props 来源 | 备注 |
|---|---|---|---|---|
| 首页 Home | `home` | `homeNode` | `pages/codex/buildCodexSurface.ts` 的 `homeProps` | 桌面 / 平板上是 activeWorkspace=null 时显示；手机上是底部 tab |
| 项目 Projects | `projects` | `sidebarNode` | `pages/codex/buildCodexSurface.ts` 的 `sidebarProps` | 桌面常驻侧栏；手机 / 平板上 tab=projects 时占据主区 |
| 对话 Codex | `codex` | `messagesNode` + `composerNode` + `mainHeaderNode` | `pages/codex/buildCodexSurface.ts` 的 `messagesProps` / `composerProps` / `mainHeaderProps` | 主聊天页 |
| Git 变更 | `git` | `gitDiffPanelNode` + `gitDiffViewerNode` | `pages/git/buildGitSurface.ts` 的 `gitDiffPanelProps` / `gitDiffViewerProps` | 含文件树 / Prompts 面板 / Diff viewer |
| 日志 Log | `log` | `debugPanelFullNode` | `pages/shell/buildShellSurface.ts` 的 `debugPanelProps` | 全屏 debug 视图（紧凑视口） |

跨页常驻：
| 区域 | 入口节点 | props 来源 |
|---|---|---|
| 顶栏（桌面） | `desktopTopbarLeftNode` | `pages/codex/buildCodexSurface.ts` 的 `desktopTopbarProps` + `mainHeaderProps` |
| 平板 Nav | `tabletNavNode` | `pages/codex/buildCodexSurface.ts` 的 `tabletNavProps` |
| 手机 TabBar | `tabBarNode` | `pages/codex/buildCodexSurface.ts` 的 `tabBarProps` |
| 审批 Toast | `approvalToastsNode` | `pages/codex/buildCodexSurface.ts` 的 `approvalToastsProps` |
| 更新 Toast | `updateToastNode` | `pages/codex/buildCodexSurface.ts` 的 `updateToastProps` |
| 错误 Toast | `errorToastsNode` | `pages/codex/buildCodexSurface.ts` 的 `errorToastsProps` |
| Plan 面板 | `planPanelNode` | `pages/shell/buildShellSurface.ts` 的 `planPanelProps` |
| 终端 Dock | `terminalDockNode` | `pages/shell/buildShellSurface.ts` 的 `terminalDockProps` + `terminalState` |
| 紧凑空态（Codex / Git） | `compactEmptyCodexNode` / `compactEmptyGitNode` / `compactGitBackNode` | `pages/shell/buildShellSurface.ts` 的 `compactNavProps` |

## 三、Surface 模块（pages/）

| Surface | 目录 | 拆分状态 | 包含的节点 |
|---|---|---|---|
| Codex | `pages/codex/` | ⏳ 待建（P3） | 侧栏 / 主区消息 / 输入区 / Home / 顶栏 / TabBar / TabletNav / 三 Toast |
| Git | `pages/git/buildGitSurface.ts` | ✅ 已就位（P2） | Git 文件面板 / Diff viewer / 文件树 / Prompts 面板 |
| Shell（跨页辅助） | `pages/shell/buildShellSurface.ts` | ✅ 已就位（P1） | Plan 面板 / 终端 Dock / Debug 面板 / 紧凑空态节点 |

当前过渡期，剩余 surface 的产出逻辑还在 `src/features/app/hooks/useMainAppLayoutSurfaces.ts`：
- `buildPrimarySurface` 行 227-647（将迁为 `pages/codex/buildCodexSurface.ts`）
- ~~`buildGitSurface`~~ → 已迁到 `pages/git/buildGitSurface.ts`
- ~~`buildSecondarySurface`~~ → 已迁到 `pages/shell/buildShellSurface.ts`

> 注：surface 命名调整 — 原 `primary/secondary` 是按"主 / 辅"层切；新名 `codex/shell` 按职责切，避免和"主 tab"语义混淆。

## 四、节点工厂（仅引用，不归 pages/ 管）

| 工厂 | 文件 |
|---|---|
| Codex 节点 | `src/features/layout/hooks/layoutNodes/buildPrimaryNodes.tsx` |
| Git 节点 | `src/features/layout/hooks/layoutNodes/buildGitNodes.tsx` |
| Shell 节点 | `src/features/layout/hooks/layoutNodes/buildSecondaryNodes.tsx` |
| 类型 | `src/features/layout/hooks/layoutNodes/types.ts` |

**节点工厂只做"props → ReactNode"。** 想调整**长什么样** → 改对应节点工厂里的 JSX。想调整**传什么 props** → 改 `pages/<目录>/build<Name>Surface.ts`。

> P1-P3 完成后，节点工厂内部命名也会跟随更名：`Primary→Codex` / `Secondary→Shell`。届时本表会同步刷新文件名。

## 五、视口分发（仅引用）

| 视口 | 文件 |
|---|---|
| 桌面 | `src/features/layout/components/DesktopLayout.tsx` |
| 平板 | `src/features/layout/components/TabletLayout.tsx` |
| 手机 | `src/features/layout/components/PhoneLayout.tsx` |
| 分发器 | `src/features/app/components/AppLayout.tsx` |

## 六、MainApp 编排入口

`src/features/app/components/MainApp.tsx` 是顶层装配点，调用顺序：
1. `useAppBootstrapOrchestration` 等 bootstrap 钩子拿到 appSettings / doctor / debug 等基础态
2. 一连串领域 hook（threads / git / composer / plan / terminal / settings ...）产出状态
3. `useMainAppLayoutSurfaces(...)` 把上述状态聚合成 `{ codex, git, shell }` 三个 surface
4. `useMainAppLayoutNodes(layoutSurfaces)` → ReactNode 三块（实际是节点 ~18 个）
5. 拼装 `MainAppShellProps` → 渲染 `<MainAppShell {...props} />`

> P4 会把第 2 步里"页面专属"的 hook 调用聚合成 `useCodexPageState / useGitPageState / useShellState` 放进 pages/ 下；MainApp 自身收缩到 ≤ ~300 行。

## 七、维护守则（任何改动都要回看本表）

1. **新增页面**：建 `pages/<名字>/` 目录、建 `build<名字>Surface.ts`、在节点工厂三选一里追加节点产出、在二 / 三两表里追加一行、在四 / 五（如有变动）刷新。
2. **重命名 props 字段**：先在 `layoutNodes/types.ts` 改类型，再在 surface 文件改产出，再在本表"实际位置"列更新名称。
3. **拆出新 surface**：在 `useMainAppLayoutSurfaces.ts` 主 hook 追加 `<name>: build<Name>Surface(context)`，在三、surface 模块表追加一行，并在四、节点工厂表补充其归属。
4. **移动 / 删除节点**：从二、五个页面表 + 跨页常驻表里把对应行删除或迁移。
5. **每次涉及上述任一动作的 PR**：必须更新本 README 受影响的行，否则不允许合入（subagent 复核会卡）。

## 八、变更日志

- **2026-05-12 P0**：三层架构梳理完成，建立索引。
- **2026-05-12 P1**：`buildSecondarySurface` → `pages/shell/buildShellSurface.ts`。`MainAppLayoutSurfacesContext` 类型 export 以供 surface 文件复用。`useMainAppLayoutSurfaces` 主 hook 主体返回的字段名 `secondary` 暂保留（来自 `LayoutNodesOptions["secondary"]`），等 P3 完成后统一重命名。
- **2026-05-12 P2**：`buildGitSurface` → `pages/git/buildGitSurface.ts`（200 行整体迁移，逻辑零变更）。
