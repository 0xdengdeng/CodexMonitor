# 砍掉功能清单 (Product Cuts Log)

> 为了适应 SMB B2B 客户(5-30 人小公司,老板付费 + 半技术员工使用),
> 产品进行了大幅简化。本文档**完整记录每一次砍除**,以便后续需要恢复时能快速找回。
>
> 每条记录格式:
> - **砍掉了什么**(UI 入口 / 代码文件 / i18n / 测试)
> - **底层是否保留**(便于快速恢复)
> - **对应 commit**(git revert 即可恢复)
> - **手动恢复路径**(若 commit 跨度太大无法 revert)

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
