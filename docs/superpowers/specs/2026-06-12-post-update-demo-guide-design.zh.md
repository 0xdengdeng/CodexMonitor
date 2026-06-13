# 更新后演示引导设计

## 目标

CodexMonitor 应在部分功能型更新后展示一段短小、类似视频的产品演示。这个演示不是录屏文件，而是由版本化配置驱动的应用内动画，用轻量复刻的真实 UI 展示新功能路径，并提供暂停、重播、跳过、查看发布说明和去试试等明确操作。

这个体验面向回访用户，帮助他们理解重要工作流变化，同时避免把首页重新变成营销页，也不强迫用户走冗长的新手教程。

## 产品决策

采用 **产品内模拟短片** 方案。

面向用户的标题、发布说明和开屏引导统一使用产品名「启航AI智慧平台」。
`CodexMonitor` 仅作为工程仓库、代码标识、路径或内部架构说明中的名称。

用户更新并重启应用后，如果当前版本配置了值得演示的新功能，就显示一个紧凑的居中面板。面板包含：

- 带版本信息的「更新内容」标题。
- 一段展示新工作流的 UI 动画场景。
- 2-4 步短时间轴。
- 操作按钮：暂停、重播、跳过、发布说明、去试试。
- `prefers-reduced-motion` 下的静态步骤降级。

对于值得演示的版本，这个方案替代纯文字的更新后 toast。只有 bugfix 或低重要度小版本继续走现有发布说明 toast。

## 当前状态

应用已有更新后链路：

- `useUpdater` 会在 relaunch 前保存待展示的更新版本。
- 重启后，`useUpdater` 读取待展示版本，拉取 GitHub release notes，并暴露 `postUpdateNotice`。
- `UpdateToast` 负责展示 loading、ready 和 fallback 三种发布说明状态。
- 用户关闭通知后，清理待展示标记。

本设计扩展这条链路，不替换下载、安装和重启行为。

## 用户和时机

用户：

- 刚完成更新的现有用户。
- 已理解基本项目和会话模型的用户。
- 可能快速跳过演示、但仍需要注意重大工作流变化的高频用户。

时机：

- 成功更新后的首次启动。
- 仅在当前版本存在配置好的 demo-worthy change 时出现。
- 不在每次启动出现，也不用于所有 patch 版本。

成功标准：

- 用户能在约 20-30 秒内理解变化。
- 用户只有一个清晰下一步：去真实功能位置试用。
- 同版本关闭后不再自动出现。
- 对动态敏感用户提供等价静态说明。

## 交互行为

### 默认流程

1. 应用更新后重启。
2. `useUpdater` 像现在一样检测 pending version 和 release-note URL。
3. 应用检查该版本是否存在 `UpdateDemoGuide` 配置。
4. 如果存在演示且用户未在该版本关闭过，则显示演示 modal。
5. 除非用户偏好减少动态，否则演示自动播放。
6. 用户可以暂停、重播、跳过、打开发布说明或去试试。
7. 点击「去试试」后关闭面板、清理 pending 标记、跳转到目标界面，并在可行时展示一次性上下文高亮。

### 减少动态流程

当 `prefers-reduced-motion: reduce` 匹配时：

- 不自动播放移动动画。
- 用静态步骤展示相同信息。
- `Replay` 只用于静态步骤切换，或直接隐藏。
- 保留「去试试」「发布说明」「跳过」。

### 关闭规则

- 「跳过」、关闭按钮、Escape 和「去试试」都会把当前版本标记为已看。
- 打开发布说明本身不关闭演示。
- 如果演示配置缺失或无效，则继续使用现有发布说明 fallback。
- 已看状态应和 pending update marker 分开存储，方便未来增加手动「更新内容」入口。

## 内容模型

第一版使用本地手动 registry。这样能保证质量，也避免把普通 bugfix 错误推广成功能演示。

```ts
type UpdateDemoGuide = {
  version: string;
  featureId: string;
  importance: "major" | "minor";
  titleKey: string;
  subtitleKey: string;
  durationMs: number;
  releaseNotesUrl?: string;
  steps: UpdateDemoStep[];
  tryIt: UpdateDemoTarget;
};

type UpdateDemoStep = {
  id: string;
  labelKey: string;
  captionTitleKey: string;
  captionBodyKey: string;
  startMs: number;
  endMs: number;
  focus: DemoFocusTarget;
};

type DemoFocusTarget =
  | "workspace-home.composer"
  | "workspace-home.attachment-button"
  | "workspace-home.run-mode"
  | "settings.ai"
  | "settings.advanced"
  | "home.add-project";

type UpdateDemoTarget = {
  type: "home" | "workspace-home" | "settings";
  focus?: DemoFocusTarget;
  settingsSection?: string;
};
```

规则：

- 第一版每个版本只配置一个主演示。
- 文案放在 `src/features/i18n/i18n.tsx`，registry 只引用 key。
- 如果未来一个版本需要多个演示，先展示一个主演示，其余放到发布说明或后续「更新内容中心」。
- 无效配置 fail closed，回到现有发布说明 toast。

## UI 结构

主组件：

- `UpdateDemoGuideModal`

辅助组件：

- `UpdateDemoReel`：动画场景和时间轴。
- `UpdateDemoControls`：暂停、重播、跳过、发布说明、去试试。
- `UpdateDemoStaticSteps`：减少动态或静态降级。
- `useUpdateDemoGuide`：解析配置、已看状态、播放状态和用户动作。

使用现有设计系统：

- 用 `ModalShell` 承载 modal 外壳和可访问性结构。
- 复用现有按钮、toast 和颜色 token 习惯。
- 不新建第二套 modal shell 样式。

视觉方向保持产品原生、工具感：

- 用轻量、清晰的真实 app 界面复刻。
- 不做全屏营销 hero。
- 不使用大面积装饰渐变或纯视觉背景。
- 动画用于解释工作流，不用于炫技。

## 集成点

更新链路：

- 扩展 `useUpdater` 或 `useUpdaterController`，解析 `postUpdateDemoGuide`。
- 保留现有 `postUpdateNotice` 作为发布说明 fallback。
- demo modal 激活时，`UpdateToast` 不渲染发布说明 toast。

布局：

- 通过现有顶层布局/modal 路径渲染该 modal。
- 普通更新状态继续使用现有 toast viewport。

导航：

- 「去试试」调用 app orchestration 提供的类型化 handler。
- `home` 目标：选择 Home。
- `workspace-home` 目标：优先使用当前 active workspace；如果没有 workspace，则选择 Home，并在功能依赖项目时指向添加项目入口。
- `settings` 目标：打开对应设置 section。

高亮：

- 第一版只支持少数已知目标的最小高亮。
- 如果目标未挂载或没有 workspace，应跳到最接近的相关界面，不展示坏掉的高亮。
- 高亮只展示一次，不阻塞交互。

## 可访问性

要求：

- Modal 有可访问名称和描述。
- 键盘用户能访问所有控件。
- Escape 关闭并标记当前版本已看。
- 自动播放超过五秒的动态内容必须有暂停机制。
- 尊重 `prefers-reduced-motion`。
- 字幕和步骤文案包含必要信息，不能只靠视觉运动解释功能。

外部依据：

- W3C WCAG 2.2「Pause, Stop, Hide」说明自动移动内容需要暂停、停止或隐藏机制。
- MDN 说明 `prefers-reduced-motion` 可用于为系统层设置了减少动态的用户提供更少动画的体验。

## 持久化

建议 localStorage key：

```text
codexmonitor.updateDemo.seenVersions
codexmonitor.updateDemo.lastDismissedFeature
```

pending post-update version key 继续由现有 updater 链路拥有。只有在用户关闭、去试试或发布说明 fallback 被关闭后，demo 才消费或清理该 pending 标记。

## 范围外

- 打包录屏视频文件。
- 完整「更新内容中心」或历史更新页。
- 远程 CMS 驱动的公告活动。
- 除版本和本地 app 状态外的用户分群。
- 第一版支持多演示播放列表。
- 埋点分析，除非后续任务先定义应用级 analytics 策略。

## 测试计划

聚焦测试：

- Registry resolver 只对匹配版本和有效配置返回 guide。
- 已看版本存储能阻止同版本重复展示。
- 有配置时，demo guide 优先于发布说明 toast。
- 无配置时，现有发布说明 toast 仍正常出现。
- 「跳过」、关闭、Escape 和「去试试」都会标记为已看。
- 「发布说明」打开 URL，但不关闭 modal。
- reduced-motion 模式展示静态步骤并禁用自动播放。
- 「去试试」针对 home、workspace-home、settings 目标调用正确导航 handler。

手动 smoke check：

- 用带 guide 的 mocked pending version 启动。
- 用无 guide 的 pending version 启动。
- 切换系统或浏览器 reduced motion，验证静态降级。
- 验证键盘 tab 顺序和 Escape 行为。

## 推进阶段

Phase 1:

- 添加本地 registry 和一个配置好的 demo modal。
- 接入现有 post-update notice 链路。
- 保留发布说明 fallback。

Phase 2:

- 为最重要目标添加一次性上下文高亮。
- 如产品需要，增加手动打开「更新内容」的入口。

Phase 3:

- 只有当本地 registry 维护成本随发布节奏变高时，再考虑远程配置。

## 参考

- W3C WCAG 2.2 Understanding SC 2.2.2 Pause, Stop, Hide: https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html
- MDN, Using media queries for accessibility: https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Media_queries/Using_for_accessibility
- Flows feature announcement examples and best practices: https://flows.sh/examples/feature-announcement
- AnnounceKit feature announcement guide: https://announcekit.app/blog/new-feature-announcement-with-examples/
