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
| Codex | `pages/codex/buildCodexSurface.ts` | ✅ 已就位（P3） | 侧栏 / 主区消息 / 输入区 / Home / 顶栏 / TabBar / TabletNav / 三 Toast |
| Git | `pages/git/buildGitSurface.ts` | ✅ 已就位（P2） | Git 文件面板 / Diff viewer / 文件树 / Prompts 面板 |
| Shell（跨页辅助） | `pages/shell/buildShellSurface.ts` | ✅ 已就位（P1） | Plan 面板 / 终端 Dock / Debug 面板 / 紧凑空态节点 |

三个 surface 已全部迁出。`src/features/app/hooks/useMainAppLayoutSurfaces.ts` 现在只做"上下文聚合 + 调 3 个 builder"，~550 行（原 1240）。

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

### MainApp.tsx 顶层 hook 索引（按归属页面分类）

> **目的**：想调"某页面的 X 行为"时，先查这个表定位到 hook 名 + MainApp.tsx 的行号，比通读 1940 行高效。
> **维护**：搬动 hook 调用、增减 hook、改行号区段时同步本表。

行号以 `MainApp.tsx` 当前提交为准（2026-05-12 P4 时校准）。

#### 应用级 / 跨页（不归任何单页）

| Hook | 行号 | 作用 |
|---|---|---|
| `useAppBootstrapOrchestration` | 100 | appSettings / doctor / codexUpdate / debug 基础态 |
| `useLayoutController` | 246 | 视口尺寸 / 侧栏宽 / 折叠状态 / 隔行渲染开关 |
| `useTauriEvent` | 1420 | 监听 Tauri OS 事件（深链接等） |
| `useUpdaterController` | 544 | 自动更新（toast 状态 + 启动 / 关闭） |
| `useMobileServerSetup` | 176 | 移动端连接向导 |
| `useErrorToasts` | 274 | 错误 toast 全局状态 |
| `useMainAppModals` | 948 | 应用级模态框（设置 / 添加 workspace / clone / 工作区分组等） |
| `useMainAppSettingsActions` | 920 | 设置相关动作 |
| `useAppShellOrchestration` | 1446 | shell 编排（centerMode / showHome / showGitDetail 等） |
| `useMainAppShellProps` | 1867 | 最终壳层 props（含 layout 入参）|
| `useMainAppDisplayNodes` | 1552 | 展示节点（含 workspaceHomeNode）|
| `useMainAppLayoutSurfaces` | 1627 | 把所有状态聚合成 codex / git / shell 三个 surface |
| `useMainAppLayoutNodes` | 1823 | surface → 实际 ReactNode |

#### Workspace 管理（侧栏 / Home / 顶栏共用）

| Hook | 行号 | 作用 |
|---|---|---|
| `useWorkspaceController` | 136 | workspaces CRUD（核心） |
| `useWorkspaceSelection` | 889 | 选 workspace / 切换主页 |
| `useWorkspaceOrderingOrchestration` | 914 | workspace 排序与分组操作 |
| `useWorkspaceFromUrlPrompt` | 932 | 从 URL 添加 workspace |
| `useMainAppWorkspaceLifecycle` | 1280 | workspace 加载 / 连接生命周期 |
| `useMainAppWorkspaceActions` | 1297 | workspace 增删等用户动作 |
| `useMainAppWorktreeState` | 1266 | worktree 当前态（父 workspace / 名称 / 改名提示）|
| `useRenameWorktreePrompt` | 770 | worktree 重命名表单 |
| `useWorkspaceLaunchScript` | 845 | 单个启动脚本（当前 workspace） |
| `useWorkspaceLaunchScripts` | 855 | 启动脚本集合（多 workspace 编辑器） |
| `useWorktreeSetupScript` | 875 | worktree 创建后的 setup 脚本 |

#### Thread 管理（侧栏列表 + Codex 主区都用）

| Hook | 行号 | 作用 |
|---|---|---|
| `useThreads` | 429 | threads CRUD（核心，对话页 +侧栏列表都依赖） |
| `useThreadListSortKey` | 125 | 列表排序偏好 |
| `useThreadListActions` | 698 | 列表排序刷新动作 |
| `useThreadRows` | 744 | 线程行渲染数据（侧栏组装） |
| `useNewAgentDraft` | 731 | 新 agent 草稿态 |
| `useThreadSelectionHandlersOrchestration` | 325 | 选 thread 时的连锁切换 |
| `useThreadCodexBootstrapOrchestration` | 193 | thread 初次加载的参数引导 |
| `useThreadCodexSyncOrchestration` | 670 | thread codex 参数同步 |
| `useMainAppThreadCodexState` | 410 | thread codex 状态（model / effort / preset 等） |
| `useThreadUiOrchestration` | 1376 | thread UI 编排（drafts / autoarchive 等） |
| `useRemoteThreadLiveConnection` | 523 | 远程线程实时连接 |
| `useMainAppMobileThreadRefresh` | 536 | 移动端线程刷新 |
| `useTrayRecentThreads` | 746 | 托盘"最近线程"投递 |

#### 侧栏 / 顶栏（codex surface 的常驻 chrome）

| Hook | 行号 | 作用 |
|---|---|---|
| `useMainAppSidebarMenuOrchestration` | 1474 | 侧栏菜单与右键操作 |
| `useAccountSwitching` | 719 | 账号切换 UI |
| `useOpenAppIcons` | 930 | "用应用打开"按钮 icon 加载 |

#### 对话页（Codex）专属

| Hook | 行号 | 作用 |
|---|---|---|
| `useModels` | 282 | 模型列表（输入区下拉） |
| `useCollaborationModes` | 299 | 协作模式列表 |
| `useCollaborationModeSelection` | 422 | 已选协作模式 payload |
| `useSkills` | 397 | 技能列表（@ skill 选择） |
| `useCustomPrompts` | 398 | 自定义 prompts（输入区 / git prompts 共用） |
| `useApps` | 663 | 第三方 apps（输入区 @ 触发） |
| `useComposerShortcuts` | 372 / 377 | 输入区快捷键（两次调用，分别处理新会话与发送） |
| `useComposerMenuActions` | 382 | 输入区菜单动作 |
| `useMainAppComposerWorkspaceState` | 1151 | 输入区工作区态（draft / 队列 / 图片 / files 等） |
| `useComposerEditorState` | 637 | 输入区编辑器态（展开 / 折叠等） |
| `useComposerQuickActions` | 1620 | 快捷按钮（/new /compact /review） |
| `useInterruptShortcut` | 1328 | 中断当前回合的快捷键 |
| `useCopyThread` | 765 | 复制线程到剪贴板 |
| `usePlanReadyActions` | 1434 | plan 就绪后的接受 / 修改动作 |
| `useResponseRequiredNotificationsController` | 708 | "需要你回复"系统通知 |
| `useArchiveShortcut` | 1533 | 归档当前线程快捷键 |
| `useAutoExitEmptyDiff` | 752 | git 视图无 diff 时自动切回 chat |

#### Git 页专属

| Hook | 行号 | 作用 |
|---|---|---|
| `useMainAppGitState` | 568 | Git 大状态（status / branches / diffs / commits / PRs / issues / 远程） |
| `usePullRequestComposer` | 1347 | PR composer（选 PR + 草拟评审消息） |
| `useBranchSwitcherShortcut` | 1034 | 分支切换快捷键 |
| `useMainAppPromptActions` | 1253 | Prompts 面板的 CRUD 动作（位于 Git 文件面板 tab） |

#### Shell 页 / 跨页辅助（Plan / Terminal / Debug）

| Hook | 行号 | 作用 |
|---|---|---|
| `useTerminalController` | 799 | 终端状态 + tab 管理 |
| Debug 相关状态 | 100 | 来自 `useAppBootstrapOrchestration` 返回 |
| Plan 数据 | 410 | 来自 `useMainAppThreadCodexState` 返回的 `activePlan` |

#### 首页（Home）专属

| Hook | 行号 | 作用 |
|---|---|---|
| `useWorkspaceInsightsOrchestration` | 1097 | Home 数据洞察（最近 agent runs / usage） |
| `useHomeAccount` | 1124 | Home 账号信息（与侧栏账号是两套数据源） |
| `useTraySessionUsage` | 1141 | 托盘会话使用 |

> **不在本表的**：`useRef` / `useState` / `useMemo` / `useEffect` / `useCallback` 这些 React 原语调用。本表只列**业务 hook**（自定义 `useXxx`）。

> P5 会在 MainApp 收尾时再次核对行号，并把本表里仍然能聚合的 hook 子集做轻量聚合（比如把"对话页专属"里 useComposerXxx 系列 4 个合并为一个 hook）。但不强行重组，保留 hook 顺序与依赖。

## 七、维护守则（任何改动都要回看本表）

1. **新增页面**：建 `pages/<名字>/` 目录、建 `build<名字>Surface.ts`、在节点工厂三选一里追加节点产出、在二 / 三两表里追加一行、在四 / 五（如有变动）刷新。
2. **重命名 props 字段**：先在 `layoutNodes/types.ts` 改类型，再在 surface 文件改产出，再在本表"实际位置"列更新名称。
3. **拆出新 surface**：在 `useMainAppLayoutSurfaces.ts` 主 hook 追加 `<name>: build<Name>Surface(context)`，在三、surface 模块表追加一行，并在四、节点工厂表补充其归属。
4. **移动 / 删除节点**：从二、五个页面表 + 跨页常驻表里把对应行删除或迁移。
5. **每次涉及上述任一动作的 PR**：必须更新本 README 受影响的行，否则不允许合入（subagent 复核会卡）。
6. **反向引用守则**：`pages/<目录>/build<Name>Surface.ts` 反向引用主 hook（`@app/hooks/useMainAppLayoutSurfaces`）**只允许 `import type`**，禁止取值导入。原因：主 hook 同时是这三个 builder 的调用方，值导入会形成运行时循环引用。当前 TypeScript + 打包工具会消除 `import type`，循环安全；一旦改成值导入，立刻成真实环。

## 八、变更日志

- **2026-05-12 P0**：三层架构梳理完成，建立索引。
- **2026-05-12 P1**：`buildSecondarySurface` → `pages/shell/buildShellSurface.ts`。`MainAppLayoutSurfacesContext` 类型 export 以供 surface 文件复用。`useMainAppLayoutSurfaces` 主 hook 主体返回的字段名 `secondary` 暂保留（来自 `LayoutNodesOptions["secondary"]`），等 P3 完成后统一重命名。
- **2026-05-12 P2**：`buildGitSurface` → `pages/git/buildGitSurface.ts`（200 行整体迁移，逻辑零变更）。
- **2026-05-12 P3**：`buildPrimarySurface` → `pages/codex/buildCodexSurface.ts`（420 行整体迁移，函数改名，逻辑零变更）。`REMOTE_THREAD_POLL_INTERVAL_MS` import 从主 hook 转移到 buildCodexSurface（唯一使用点）。`useMainAppLayoutSurfaces.ts` 从 1240 → 551 行。pr-reviewer subagent 复核通过（0 Must-Fix）。新增"反向引用守则 = 仅 `import type`" 入 README 第七节。
- **2026-05-12 P4（轻量版）**：MainApp.tsx 60 个顶层业务 hook 全部按归属页面分类，加入第六节"MainApp.tsx 顶层 hook 索引"。**未做代码搬动**——评估后认为强行搬 hook 会破坏调用顺序依赖图、风险陡增、收益边际递减；文档级索引已能满足"未来调整能找到对应的地方"。每条带 `MainApp.tsx` 行号便于跳转。
- **2026-05-12 P5（收尾）**：全量验证（typecheck ✅ / lint 0 errors ✅ / 989 tests ✅）。`docs/codebase-map.md` 加一行"Find which page owns a UI surface" 指向本 README。整套页面拆分完成。规模盘点：surface 编排从 1240 → 550 行（-690），新增 pages/ 700 行 + README 索引 229 行；逻辑零变更。
