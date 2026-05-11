# 砍掉功能清单 (Product Cuts Log)

> 为了适应 SMB B2B 客户(5-30 人小公司,老板付费 + 半技术员工使用),
> 产品进行了大幅简化。本文档**完整记录每一次砍除**,以便后续需要恢复时能快速找回。

## 🔒 核心产品原则(铁律,任何砍除前必须确认)

1. **前端可删**:UI / props / hook / 集成代码 / 测试 / 前端类型 / 前端 i18n / CSS — 都可以删
2. **后端必须保留**:`src-tauri/*` 整套 Rust 代码 / Cargo 依赖 / Tauri 命令注册 / shared core / Rust types
3. **后端不动的好处**:未来要恢复一个功能,**只需重新接前端 props 链 + 调用现有 Tauri 命令**,不用重写后端

**违反这条原则 = 砍除工作返工**。

## 记录格式

- **砍掉了什么**(UI 入口 / 代码文件 / i18n / 测试)
- **底层是否保留**(便于快速恢复 — 必须是 yes)
- **对应 commit**(git revert 即可恢复)
- **手动恢复路径**(若 commit 跨度太大无法 revert)

---

## Sprint 1 — 2026-05-11

### Cut #1:Settings 13 sections → 4 sections

**保留 4 个**:`ai`(AI 模型) / `projects`(项目) / `about`(关于) / `advanced`(高级)

**砍掉 9 个 nav 入口**(section 实现文件保留,仅 UI 不暴露):

| 旧 nav ID | 原 section 文件 | 用户用不到的原因 |
|----|----|----|
| `environments` | SettingsEnvironmentsSection.tsx | 项目级配置,小老板/员工不懂 |
| `display` | SettingsDisplaySection.tsx | 主题以外都没用;主题切换后续挪到顶部菜单 |
| `composer` | SettingsComposerSection.tsx | 用默认值即可 |
| `dictation` | SettingsDictationSection.tsx | 听写功能小老板用不上,顺便砍 CMake/Clang 依赖 |
| `shortcuts` | SettingsShortcutsSection.tsx | 默认快捷键够用 |
| `open-apps` | SettingsOpenAppsSection.tsx | 用右键菜单替代 |
| `git` | SettingsGitSection.tsx | git UI 入口砍,底层命令仍能跑 |
| `agents` | SettingsAgentsSection.tsx | Multi-agent (866 行) 是工程师 feature |
| `features` | SettingsFeaturesSection.tsx | feature flag 不该暴露给用户 |

**i18n 删除的 nav keys**(13 → 4):
- 英文:删除 `settings.nav.{environments,display,composer,dictation,shortcuts,openApps,git,server,agents,codex,features}`
- 中文:同上 11 个 key

**删除的测试文件**:
- `src/features/settings/components/SettingsView.test.tsx`(2394 行,全部测试已删 section,需要在恢复时重写)

**改动的代码**:
- `src/features/settings/components/settingsTypes.ts`:`CodexSection` 改成 4 个 ID
- `src/features/settings/components/SettingsNav.tsx`:重写 nav,只显示 4 个 entry
- `src/features/settings/components/sections/SettingsSectionContainers.tsx`:精简到 4 个 if branch
- `src/features/settings/components/SettingsView.tsx`:删除 `activeSection === "open-apps"` 特殊处理
- `src/features/app/hooks/useSettingsModalState.ts`:`SettingsSection` union 简化为 4 个
- `src/features/app/components/MainApp.tsx`:`openSettings("codex")` → `openSettings("ai")`,`openSettings("dictation")` → `openSettings("advanced")`

**底层保留**(可立即恢复 UI):
- ✅ 9 个 section 文件 (`src/features/settings/components/sections/Settings*Section.tsx`) 仍在
- ✅ 对应 hook (`useSettings*Section.ts`) 仍在
- ✅ orchestration 里的 `*SectionProps` 仍在(`useSettingsViewOrchestration.ts`)
- ✅ 所有底层 Tauri 命令、Rust shared core 全部不动

**恢复方法**:
1. **完整恢复(快)**:`git revert <commit-hash>`(此 sprint 是一个 commit 还是多个 commit 见 git log)
2. **手动恢复某一个 section**:
   - 在 `settingsTypes.ts` 的 `SETTINGS_SECTION_IDS` 加回该 ID
   - 在 `SettingsNav.tsx` 加回对应 `PanelNavItem`
   - 在 `SettingsSectionContainers.tsx` 加回对应 `if (activeSection === "xxx")` 分支
   - 在 `i18n.tsx` 加回 `settings.nav.{xxx}` 中英文 key

### Cut #2:Home 首屏砍掉营销 hero / journey / command-panel

**砍掉**:
- Hero(kicker + title + subtitle):"AI project workbench / Start from a project..."
- Journey card(4 步引导):Sign in → Use a project → Describe → Confirm
- Command panel:占位的"告诉 AI 你需要什么"假输入框

**原因**:员工每天打开看的是最近项目,不是营销文案。**新员工的引导靠销售上门现场教**,不靠产品自己讲。

**改成**:简单顶部标题 "我的项目" + 添加项目按钮,然后直接是最近的 agent 运行列表 + 用量。

**i18n key 已删除**:
- `home.kicker`(中英)
- `home.title`(中英)
- `home.subtitle`(中英)

**i18n key 暂留(下个 cleanup commit 清)**:
- `home.journey.*`(5 个)
- `home.command.*`(8 个)
- `home.guard.*`(3 个)

**底层保留**:
- ✅ `HomeActions` / `HomeLatestAgentsSection` / `HomeUsageSection` 全部保留并继续展示
- ✅ `home.css` 类名(`home-hero` / `home-journey-card` / `home-command-panel`)在 CSS 文件里仍在,但 Home.tsx 不再渲染。CSS 后续清理。

**恢复方法**:
1. **完整恢复**:`git revert <commit-hash>`
2. **手动恢复**:从 git 历史拉回旧 Home.tsx,加回 i18n key 即可。

---

## Sprint 2 — 2026-05-11

### Cut #3:Composer / WorkspaceHome / MainApp 主链砍 Dictation

**砍掉**:
- `ComposerInput` 麦克风按钮 + DictationWaveform + 错误/提示条
- `ComposerMobileActionsMenu` 听写按钮
- `Composer` 顶层 12 个 dictation* props 全部砍
- `useComposerDraftEffects` 内部听写插入逻辑 + dictationTranscript 参数
- `WorkspaceHome` 12 个 dictation* props + 内部 dictation useEffect + isDictationBusy 分支
- `MainApp` 全套 dictation* 接线 + dictationUi / dictationModel 传递
- `useMainAppLayoutSurfaces` 全套 dictation* 字段 + dictationUi 块
- `useMainAppModals` dictationModel 配置块 + dictationModelStatus props
- `ComposerInput.dictation.test.tsx` 整个测试文件删

**残留**(下一 commit 砍):
- `src/features/dictation/*`(整个目录)
- `useDictationController` hook
- `utils/dictation.ts` (`computeDictationInsertion`)
- `SettingsDictationSection.tsx` + `useSettingsDictationSection` 
- `SettingsView` 仍接收 dictation props(props 流到 Settings)
- `useSettingsViewOrchestration` dictationSectionProps
- `useAppSettings` dictationEnabled / dictationModelId 字段
- `types.ts` DictationModelStatus / DictationTranscript / DictationSessionState
- `useAppBootstrap` dictation state
- `services/events.ts` / `services/tauri.ts` dictation 事件 / 命令
- **Rust backend**:`src-tauri/src/dictation/*` + Cargo.toml whisper-rs / CMake / Clang
- i18n 中的 dictation keys (`settings.dictation.*`, `composer.dictation.*`)
- CSS `composer-dictation-*` 类名

**底层验证**:用户在产品里再也找不到任何"麦克风按钮"或"听写"入口,但安装包体积尚未变小(后端 + Cargo 没动)。降低安装门槛需等 Rust backend 砍除 commit。

**恢复方法**:从 git 历史拉回 Composer / ComposerInput / WorkspaceHome / MainApp / useMainAppLayoutSurfaces 等文件。复杂度高,**强烈建议用 `git revert <commit>` 整体回退**而非手动恢复。

---

### Cut #4:前端 Dictation dead code 全砍(后端 / Cargo 完整保留)

按用户原则「前端可改,后端保留」,把前端剩余 dictation 实现全部砍除。

**前端删除**:
- `src/features/dictation/` 整个目录(DictationWaveform + 3 hook)
- `src/utils/dictation.ts`
- `src/features/app/hooks/useDictationController.ts`
- `src/features/composer/hooks/useComposerDictationControls.ts`
- `src/features/settings/components/sections/SettingsDictationSection.tsx`

**前端集成清理**:
- `useAppBootstrap`:不再 import useDictationController
- `useComposerKeyDown`:删 `isDictationBusy` 参数 + 2 处 bail-out
- `Composer`:不再传 `isDictationBusy: false`
- `SettingsView`:删 dictationModelStatus / onDownloadDictationModel / onCancelDictationDownload / onRemoveDictationModel props
- `useSettingsViewOrchestration`:删 dictationSectionProps + localizedDictationModels + selectedDictationModel + dictationReady + metaKeyLabel(只服务听写)+ isWindowsPlatform 顺手清理
- `MainApp`:删 `dictationEnabled: appSettings.dictationEnabled`
- `useMainAppLayoutSurfaces`:删 "dictationEnabled" union 成员
- `useAppSettings`:删 dictation 4 字段默认值
- `useAppSettings.test`:删测试断言
- `src/types.ts`:删 AppSettings 4 个 dictation 字段 + `DictationModelState` / `DictationDownloadProgress` / `DictationModelStatus` / `DictationSessionState` / `DictationEvent` / `DictationTranscript` 6 个类型
- `services/tauri.ts`:删 8 个 dictation Tauri 命令 wrapper(`getDictationModelStatus` / `downloadDictationModel` / `cancelDictationDownload` / `removeDictationModel` / `startDictation` / `requestDictationPermission` / `stopDictation` / `cancelDictation`)+ `withModelId` helper
- `services/events.ts`:删 `subscribeDictationDownload` / `subscribeDictationEvents` 2 个订阅器 + 2 个 event hub

**后端完整保留**(原则要求):
- ✅ `src-tauri/src/dictation/` 整个目录(mod.rs + real.rs + stub.rs ≈ 54KB)
- ✅ `src-tauri/src/lib.rs` 8 个 dictation Tauri 命令注册仍在(只是前端不再调用)
- ✅ `src-tauri/src/types.rs` AppSettings dictation 4 字段(serde 会把前端发来的 settings 忽略掉这些字段,旧 settings.json 仍兼容)
- ✅ `src-tauri/src/state.rs` DictationState 字段
- ✅ `Cargo.toml` `whisper-rs = "0.12"` / `cpal = "0.15"`
- ✅ CMake / LLVM-Clang 仍是必须安装依赖

**前端死代码剩余**(下一 commit 清):
- `src/features/i18n/i18n.tsx` settings.dictation.* / composer.dictation.* 等死 keys
- `src/styles/composer.css` `.composer-dictation-*` 死 CSS 类

**用户可见影响**:零(只是清理 dead code,UI 在 commit #3 690eb44 时就已经看不到 dictation)

**安装门槛 / 包体积影响**:零(后端 Rust 没动,whisper-rs 仍在编译)→ 这是用户原则下的妥协,**包体积优化无法在此次 sprint 完成**

**恢复方法**:`git revert <commit>` 即可,或手动重接 props 链调用现有 Tauri 命令(后端仍在)

---

## 待砍未砍清单(进行中)

以下功能在 Sprint 1 仅砍了 Settings nav 入口,**功能本身和数据流仍在工作**。
后续 sprint 视情况彻底删除或保留底层:

- [ ] Dictation 整套(组件 + Tauri 命令 + Whisper 模型 + CMake/Clang 依赖)
- [ ] Terminal dock 整套
- [ ] Debug panel
- [ ] Skills library / Prompts library 复杂版
- [ ] Git/PR/GitHub UI (`@/features/git/`)
- [ ] Worktree / Branch / Clone agent UI
- [ ] Multi-agent (subagent) UI
- [ ] Plan view 工程师版
- [ ] Composer 高级 feature(Reasoning effort / Collaboration / Access mode 选择器)
- [ ] iOS / Tailscale remote backend(放 advanced,但 UI 待简化)
