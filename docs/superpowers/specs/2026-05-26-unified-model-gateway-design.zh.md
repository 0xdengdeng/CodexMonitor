# 统一模型网关设计

## 目标

CodexMonitor 通过一个统一网关协议支持 Doubao、DeepSeek、GPT 以及未来更多模型家族。CodexMonitor 不直接编码供应商特定的请求格式、鉴权规则、模型名称、能力差异或错误语义。网关负责供应商路由和协议归一化；CodexMonitor 负责账号连接、模型选择体验、Codex runtime 配置同步，以及每轮对话的模型选择。

## 设计原则

- Codex `config.toml` 中只保留一个 Codex runtime provider：`agentdesk_managed`。
- Doubao、DeepSeek、GPT 和未来供应商都作为网关路由的模型目录项出现，而不是客户端里的一级 Codex provider。
- 使用稳定模型 ID，避免展示名称变化影响持久化设置。
- 显式表达模型能力，让 UI 行为由数据驱动，而不是依赖模型名字字符串匹配。
- 迁移必须兼容现有 `managedRuntime.model` 值和历史会话。
- 身份提示词和 base instructions 必须供应商中立，避免非 GPT 模型声称自己基于 GPT。

## 范围

范围内：

- 定义统一网关模型目录协议。
- 定义 CodexMonitor 设置模型和前端模型结构，使其支持 provider-aware 的模型选择。
- 定义单一网关 Codex provider 的 runtime 配置同步行为。
- 定义模型选择如何从设置和输入区流向 `turn/start`。
- 定义混合供应商路由下的提示词身份策略。
- 定义迁移和测试要求。

范围外：

- 在客户端直接管理 Doubao、DeepSeek、OpenAI 或其他上游供应商 API Key。
- 在 CodexMonitor 内部做供应商特定请求/响应转换。
- 网关计费、额度统计、供应商 failover 算法；这里只定义客户端需要的元数据。
- 把 collaboration modes 重设计为主要模型选择器。

## 当前状态

CodexMonitor 已经有一条 managed runtime 路径：

- `ManagedRuntimeConfig` 存储 `enabled`、`baseUrl`、`model`、`imageModel` 和 `nativeImageGeneration`。
- runtime 配置同步会向 Codex `config.toml` 写入 `model_provider = "agentdesk_managed"` 和一个 `[model_providers.agentdesk_managed]` 配置块。
- `runtime_model_list` 从 managed runtime 的 `/models` 端点读取模型列表。
- `useModels` 会优先尝试 `getRuntimeModelList`，失败后回退到 workspace `model/list`。
- 输入区会把选中的 `model` 发送给 `send_user_message`，再转发到 Codex app-server 的 `turn/start`。

这已经接近目标架构。缺失的是一个 provider-aware、capability-aware、稳定 ID 的模型目录协议。

## 推荐架构

CodexMonitor 继续把 Codex 配置为单一 managed Responses provider：

```toml
model_provider = "agentdesk_managed"
model = "openai:gpt-5.5"

[model_providers.agentdesk_managed]
name = "agentDesk Managed Runtime"
base_url = "<gateway>/v1"
wire_api = "responses"
env_key = "<runtime-api-key-env>"
requires_openai_auth = false
supports_websockets = true
stream_idle_timeout_ms = 300000
```

选中的 `model` 是网关别名，例如 `openai:gpt-5.5`、`deepseek:deepseek-chat` 或 `doubao:doubao-seed-1.6`。Codex 会把这个别名作为 Responses 请求里的 model 发给网关。网关再把别名解析到真实供应商和真实模型。

网关负责：

- 把网关模型 ID 映射到上游供应商模型。
- 当供应商不是原生 Responses 兼容时，转换请求字段。
- 把流式输出归一化为 Responses 兼容输出。
- 把供应商错误归一化为稳定错误结构。
- 执行供应商可用性、租户权限、额度和路由策略。

CodexMonitor 负责：

- 拉取模型目录。
- 显示 provider-aware 的模型标签和筛选信息。
- 持久化用户选择的默认文本模型 ID 和图片模型 ID。
- 把选中的模型 ID 传给 `turn/start`。
- 避免在 UI 和本地 runtime 代码里写供应商特例。

## 网关模型目录协议

`GET /v1/models` 返回归一化模型目录。保留现有 OpenAI 兼容的 `{ data: [...] }` 结构。

```ts
type GatewayModelCatalogResponse = {
  data: GatewayModel[];
};

type GatewayModel = {
  id: string;
  providerId: string;
  providerName: string;
  model: string;
  displayName: string;
  description?: string;
  type?: "text" | "image" | "multimodal" | "embedding";
  isDefault?: boolean;
  sortOrder?: number;
  capabilities: GatewayModelCapabilities;
  supportedReasoningEfforts?: Array<{
    reasoningEffort: "minimal" | "low" | "medium" | "high" | "xhigh" | string;
    description?: string;
  }>;
  defaultReasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh" | string | null;
  supportedEndpoints?: string[];
};

type GatewayModelCapabilities = {
  text?: boolean;
  toolCalling?: boolean;
  reasoning?: boolean;
  vision?: boolean;
  imageGeneration?: boolean;
  nativeImageGeneration?: boolean;
  webSearch?: boolean;
  computerUse?: boolean;
  parallelToolCalls?: boolean;
};
```

字段规则：

- `id` 是 CodexMonitor 存储并作为模型别名发送给 Codex 的值。
- `providerId` 是稳定的机器可读 ID，例如 `openai`、`deepseek` 或 `doubao`。
- `providerName` 是用户可见名称，例如 `GPT`、`DeepSeek` 或 `Doubao`。
- `model` 是网关理解的供应商侧模型 slug。
- `displayName` 是 UI 主标签。
- `capabilities` 是可扩展字段。旧客户端忽略未知能力字段。
- `isDefault` 是建议值。用户选择和 workspace/thread 偏好仍然优先。
- `sortOrder` 是建议值。未提供时，CodexMonitor 保持服务端顺序。

示例：

```json
{
  "data": [
    {
      "id": "openai:gpt-5.5",
      "providerId": "openai",
      "providerName": "GPT",
      "model": "gpt-5.5",
      "displayName": "GPT-5.5",
      "type": "text",
      "isDefault": true,
      "capabilities": {
        "text": true,
        "toolCalling": true,
        "reasoning": true,
        "vision": true,
        "nativeImageGeneration": true,
        "parallelToolCalls": true
      },
      "supportedReasoningEfforts": [
        { "reasoningEffort": "medium", "description": "Balanced" },
        { "reasoningEffort": "high", "description": "Deep reasoning" }
      ],
      "defaultReasoningEffort": "medium"
    },
    {
      "id": "deepseek:deepseek-chat",
      "providerId": "deepseek",
      "providerName": "DeepSeek",
      "model": "deepseek-chat",
      "displayName": "DeepSeek Chat",
      "type": "text",
      "capabilities": {
        "text": true,
        "toolCalling": true
      }
    },
    {
      "id": "doubao:doubao-seed-1.6",
      "providerId": "doubao",
      "providerName": "Doubao",
      "model": "doubao-seed-1.6",
      "displayName": "Doubao Seed 1.6",
      "type": "text",
      "capabilities": {
        "text": true,
        "toolCalling": true,
        "vision": true
      }
    }
  ]
}
```

## 稳定模型 ID 约定

网关模型 ID 使用：

```text
<providerId>:<model-or-alias>
```

示例：

- `openai:gpt-5.5`
- `deepseek:deepseek-chat`
- `deepseek:deepseek-reasoner`
- `doubao:doubao-seed-1.6`

网关内部可以把这些 ID 映射到不同上游模型名。CodexMonitor 不需要知道这层映射。

向后兼容：

- 现有普通模型 ID，例如 `gpt-5-codex`，继续有效。
- 如果保存设置里出现普通模型字符串，CodexMonitor 应保留它，直到模型目录里出现匹配的 `id` 或 `model`。
- 当网关目录提供 provider-qualified 替代项时，用户可以正常选择；不做自动破坏性迁移。

## CodexMonitor 数据模型

扩展前端 `ModelOption`，保留供应商元数据：

```ts
type ModelOption = {
  id: string;
  model: string;
  displayName: string;
  description: string;
  supportedReasoningEfforts: Array<{
    reasoningEffort: string;
    description: string;
  }>;
  defaultReasoningEffort: string | null;
  isDefault: boolean;
  type?: string | null;
  providerId?: string | null;
  providerName?: string | null;
  capabilities?: Record<string, boolean>;
  supportedEndpoints?: string[];
};
```

设置层继续支持现有 `managedRuntime.model` 字段，以保证兼容。内部语义上，它应被视为“选中的文本模型 ID”。未来可以再通过迁移把字段名清理为 `defaultTextModelId`，但第一阶段实现不应做大范围设置重命名。

`managedRuntime.imageModel` 继续表示选中的图片模型 ID，也可以使用 provider-qualified ID。

## UI 行为

输入区模型选择器：

- 主标签显示 `displayName`。
- 当目录里出现多个供应商时，把 `providerName` 作为辅助信息显示。
- 保持现有模型选择优先级：用户选择优先，然后是 thread/workspace 偏好，然后是目录默认模型，然后是目录第一项。
- 只有当选中模型声明支持 reasoning effort 时，才显示 reasoning effort 控件。
- 使用 `capabilities` 隐藏或禁用不支持的能力入口，不通过模型名称匹配判断。

设置页默认模型选择器：

- 使用同一份归一化模型目录。
- 保存选中的 `id`，不保存展示名称。
- 当保存的模型不在目录中时，保留一个 `(config)` 选项，避免网关目录临时不可用时丢失设置。

供应商分组：

- 当目录包含多个供应商时，选择器可以按 `providerName` 分组。
- 分组只影响展示，不影响保存的模型 ID 或请求载荷。

## 请求流程

新建会话：

1. CodexMonitor 调用 `thread/start`，传入 `cwd`、approval policy 和动态工具。
2. Codex app-server 从 Codex `config.toml` 解析基础配置。
3. Codex 使用 `agentdesk_managed` 作为 provider。

单轮对话：

1. 用户在 CodexMonitor 中选择模型。
2. CodexMonitor 把选中目录项的 `id` 作为 `model` 字段发送给 `send_user_message`。
3. `send_user_message_core` 把该值转发给 Codex app-server 的 `turn/start`。
4. Codex 使用 `model = "<provider:model>"` 向网关发送 Responses 请求。
5. 网关路由到正确上游供应商，并把归一化 Responses 输出流式返回。

第一版不需要在 `turn/start` 中增加供应商特定字段。

## 提示词身份

当前上游 base instructions 可能包含 “based on GPT-5”。当同一个 Codex runtime 可以路由到 Doubao、DeepSeek、GPT 或未来供应商时，这句话不再正确。

客户端可见的模型身份应改为供应商中立：

```text
You are Codex, an agentic coding assistant. You and the user share one workspace, and your job is to collaborate with them until their goal is genuinely handled.
```

实现选项：

- 推荐：更新上游 Codex 模型 base instructions 和模型目录条目，改为供应商中立文案。
- 兼容兜底：只针对 managed gateway runtime 在 Codex 配置里设置 `base_instructions` 覆盖。

兜底方案应保留现有 Codex 工程行为说明，只替换身份句。不要引入 “You are DeepSeek” 或 “You are Doubao” 这类供应商身份。

## 图片模型路由

文本模型和图片模型继续保持独立选择：

- 文本对话使用 `managedRuntime.model`。
- 原生图片生成通过现有 managed provider header 路径使用 `managedRuntime.imageModel`。

对于 provider-qualified 图片模型 ID，CodexMonitor 写入：

```toml
[model_providers.agentdesk_managed.http_headers]
X-ADG-Image-Model = "openai:gpt-image-2"
```

网关只在实际使用图片生成时校验图片模型。普通文本对话不应因为图片模型不可用而失败。

## 错误处理

网关模型目录错误：

- 如果 `/v1/models` 失败，且 workspace `model/list` 可用，CodexMonitor 回退到 workspace `model/list`。
- 如果两者都失败，UI 保留保存的 config model 作为可选 `(config)` 模型。
- 不能仅因为目录刷新失败就清空用户现有选择。

对话路由错误：

- 网关应返回稳定错误码，例如 `model_not_found`、`model_unavailable`、`provider_unauthorized`、`quota_exceeded` 和 `capability_unsupported`。
- CodexMonitor 显示归一化错误信息，并保留用户选中的模型。
- 如果网关明确表示模型永久不可用，UI 可以建议用户选择其他模型，但不能在失败的 turn 中自动切换模型。

能力不匹配：

- UI 应尽量阻止明显不匹配，例如为文本对话选择 image-only 模型。
- 网关仍然是最终权威；当客户端过旧时，网关返回 `capability_unsupported`。

## 迁移

现有设置：

- `managedRuntime.model = "gpt-5-codex"` 继续有效。
- `managedRuntime.model = "openai:gpt-5.5"` 成为推荐的新格式。
- 空的 `managedRuntime.model` 继续表示“使用网关或 Codex 默认模型”。

模型列表解析：

- 继续接受 `displayName` 和 `display_name`。
- 继续接受 `supportedReasoningEfforts` 和 `supported_reasoning_efforts`。
- 增加 `providerId`、`provider_id`、`providerName` 和 `provider_name`。
- 忽略未知目录字段。

会话元数据：

- 历史会话模型字符串按原样展示。
- 恢复会话时不重写历史模型元数据。

## 测试

前端：

- 解析带供应商元数据的模型目录项。
- 保留现有普通模型目录项。
- 当保存配置通过 `id` 匹配 provider catalog 条目时，优先使用该条目。
- 对旧保存值回退到通过 `model` 匹配。
- runtime 目录失败时，保留保存的 `(config)` 选项。
- 只有模型提供 reasoning 元数据时才显示 reasoning 控件。

Backend/Tauri：

- runtime 配置同步原样写入 provider-qualified `model`。
- runtime 配置同步保持单一 `agentdesk_managed` provider。
- runtime 配置同步把 provider-qualified `imageModel` 写入 `X-ADG-Image-Model`。
- 设置迁移保留现有普通模型字符串。
- `runtime_model_list_core` 接受归一化目录响应，不改写 provider 字段。

集成：

- 用户选择 `deepseek:deepseek-chat` 时，`turn/start` 收到完全相同的 model 值。
- 用户选择 `doubao:doubao-seed-1.6` 时，`turn/start` 收到完全相同的 model 值。
- 网关目录不可用时，现有选中模型仍可见且可用。
- 非 GPT 模型在新建 managed-runtime 会话中不会收到 GPT-specific 身份说明。

## 推出计划

1. 扩展网关 `/v1/models` 响应，加入供应商和能力元数据。
2. 扩展 CodexMonitor 模型解析和 `ModelOption`，保留供应商元数据。
3. 更新模型选择器展示，使多供应商场景下能显示供应商信息。
4. 继续把 `managedRuntime.model` 作为保存的模型 ID，并原样传给 Codex。
5. 把 managed-runtime 提示词身份更新为供应商中立文案。
6. 为普通模型 ID 和 provider-qualified ID 增加兼容测试。

## 成功标准

- Doubao、DeepSeek、GPT 和未来供应商都能通过同一个 `/v1/models` 目录出现。
- CodexMonitor 可以保存并发送稳定的 provider-qualified 模型 ID，且不需要供应商特定分支。
- 新增供应商只需要网关目录和路由工作；除非引入新的 UI 可见能力，否则不需要改 CodexMonitor 代码。
- 非 GPT 模型不再以 GPT-specific 的系统身份回答。
- 现有用户设置和历史会话继续可用。
