# Deploy Plugin Design (define-first)

> CodexMonitor/AgentDesk 侧的"一键部署"客户端 —— 消费 ADG 部署平台已**冻结**的 deploy-token 契约,
> 把一个工作区打包上传到网关,轮询到 running,展示构建日志与访问 URL。
>
> 状态:**v3(app-only 收敛)。设计已过一轮 subagent 多角度检视(采纳全部 must-fix);待用户 review,T1/T2 已实现。**
> ADG 侧契约来源(冻结):`ai-development-gateway` branch `feat/generate-image-function-tool`,
> `internal/deploy/api/contract.go` + `internal/deploy/docs/token-design.md`(2026-06-22 核对)。
>
> 决策已定(用户 2026-06-22):
> - **MVP = 核心闭环**:首次创建 + 重部署 + 轮询到 running/failed + 构建日志(build log)。
> - **UI = 工作区动作 + 部署面板**;token 配置进 Settings。
> - **仅本地模式**:远程/daemon 模式部署**置灰**(workspace 文件在 daemon 侧才需的 parity 留 v2)。

---

## 0. 名词与边界

- **deploy token**:`sk-adgd_<slug>_<32 base62>`,租户在控制台 SPA 自助签发的**专用部署凭据**,
  与 LLM 的 `sk-adg_*`(enterprise_ai 登录)**两个独立凭据**。插件**只消费**,**不**做签发/吊销。
- **app**(ADG 术语)= 被部署的工作区。CodexMonitor 一个 workspace ↔ ADG 一个 app(1:1,记 appId)。
- 与 enterprise_ai(LLM 登录)正交:仅复用 `service_base_url()` 解析网关地址,其余自包含。
- **仅本地模式**:打包工作区需读本地文件,远程模式下工作区在 daemon 主机、token 也不在 app 侧,本版**直接置灰**(对齐文件附件的处理),不做 daemon parity。

## 1. ADG 契约回顾(插件必须严格对齐,不可改)

- Base:`{service_base_url()}/admin/api/me/apps`(与 SPA 同路由,双鉴权:cookie 或 `sk-adgd_` Bearer)。
- 鉴权:每请求 `Authorization: Bearer sk-adgd_*`,无 cookie。
- 创建:`POST /admin/api/me/apps` `multipart/form-data`,part 名**严格**为:
  - `metadata`(form field,**JSON 字符串**)= `{name, template_id?, source_platform?, env?}`。
  - `source`(file part)= tar.gz 归档。**body 硬上限 100 MiB**(`MaxBytesReader`,超限 400)。
  - → `201` + AppDTO(`latest_deploy.status="pending"`)。
- 轮询:`GET /admin/api/me/apps/{appID}` → AppDetailDTO,看 `latest_deploy.status`:`pending→building→running|failed`。
- 重部署:`POST /admin/api/me/apps/{appID}/deploy` `multipart`,`metadata`=RedeployRequest `{source_platform?, env?}`
  (**无 name 字段** —— ADG 保留原 app 名);新 `source` 必填。
- 构建日志:`GET /admin/api/me/apps/{appID}/logs?type=build&deployment=<deploymentID>` → `text/plain`(整段)。
- AppDTO 字段:`id,name,template_id,source_platform,subdomain,url,status,desired_state,latest_deploy,created_at,updated_at`。
  DeploymentDTO:`id,app_id,status,url?,replicas,resources,error_message?,build_log_ref?,created_at,...`。
  - `latest_deploy.id` 是 DB 主键,**只要 latest_deploy 存在就非空**(pending 即有);build log 用它做 query。
  - 失败构建**仍带 build_log_ref**(ADG `85f4ebc` 修复)→ failed 可拉日志。
- 显示优先级:`status=suspended` > `desired_state=stopped` > `latest_deploy.status`。
- 错误信封:`{"error":{"code","message"}}`。完整 code 表见 §6(已对齐 `classify()`)。

## 2. 数据模型(Rust ↔ TS 同步;define-first 硬边界)—— 已实现(T1)

### 2.1 跨进程 DTO（`src-tauri/src/types.rs` ↔ `src/types.ts`,Rust `#[serde(rename_all="camelCase")]`）

```rust
pub enum DeployStatus { Idle, Uploading, Pending, Building, Running, Failed, Stopped, Suspended } // serde lowercase

pub struct DeployMetadata { pub name: String, pub source_platform: Option<String> } // template/env → v2

// 从 ADG AppDTO/AppDetailDTO 提取插件用得到的字段
pub struct DeployApp {
    pub app_id: String, pub name: String,
    pub template_id: Option<String>, pub source_platform: Option<String>,  // 重部署原样回传
    pub subdomain: Option<String>, pub url: Option<String>,
    pub status: DeployStatus,             // 综合展示态(suspended>stopped>deploy_status)
    pub desired_state: Option<String>,
    pub deploy_status: DeployStatus,      // latest_deploy.status 原值
    pub error_message: Option<String>,
    pub deployment_id: Option<String>,    // latest_deploy.id —— build log query 参数
    pub build_log_ref: Option<String>,    // 仅"日志可用"指示;非空时 deployment_id 必非空
}
```
TS 镜像见 `src/types.ts`(`DeployStatus`/`DeployMetadata`/`DeployApp`/`WorkspaceDeployState`,camelCase)。

### 2.2 持久化（`WorkspaceSettings.deploy`,落 `workspaces.json`)
`WorkspaceDeployState{appId, appName, sourcePlatform?, subdomain?, lastStatus?, lastDeployAt?}`。
**create/redeploy 判定**:`deploy?.appId` 无 → 创建;有 → 重部署。`appName` 首次部署后**不可变**(改名 v2)。

## 3. 后端分层(app-only;逻辑仍单源于 shared core 便于 v2 接 daemon)

### 3.1 密钥存储 —— 泛化 `runtime_secret_core` 为"命名密钥" —— 已实现(T2)
内部泛型助手 `get/set/clear/exists_named_secret(file_name[, env, cache])` 按文件名区分 secret,**共享** AES key 文件
(`runtime-secret.key`)、目录、0700/0600 权限;runtime key 行为逐字保持(独立 `OnceLock` 缓存,互不读写)。
deploy token = 第二个命名密钥:文件 `adg-deploy-token.json`、env `AGENTDESK_ADG_DEPLOY_TOKEN`、独立缓存;
`ensure_adg_deploy_token`(`sk-adgd_` 前缀,**不**复用 `ensure_adg_api_key`)。已有 2 单测(前缀区分 + 隔离持久化)。

### 3.2 Shared core `src-tauri/src/shared/deploy_core.rs`(唯一逻辑源)

```
build_workspace_archive_core(root) -> Result<(Vec<u8>, Vec<String>), String>
  - WalkBuilder 复用 files.rs 过滤(排 .git/node_modules/dist/target/release-artifacts)+ 守 .gitignore
  - 安全密钥 DENYLIST(无条件强排,不依赖 .gitignore):.env / .env.* / *.pem / *.key / id_rsa* /
    .ssh/ / .aws/ / .npmrc / .netrc / credentials.json / *.p12 / *.keystore
  - 返回 (tar.gz 字节, 警告清单);警告 = denylist 外的可疑命名(*secret*/*token*)供前端二次确认
  - 确定性排序(可测);上传前 100 MiB 预检超限 → Err(附实际大小)
  - 依赖:Cargo.toml 加 tar="0.4" + flate2="1"(T4 加完先 cargo build 验证)

deploy_app_from_json(app: &Value) -> DeployApp
  - status 优先级:suspended → Suspended;else desired_state=="stopped" → Stopped;else deploy_status
  - deployment_id = latest_deploy.id;build_log_ref = latest_deploy.build_log_ref
deploy_user_facing_error(status, body) -> String
  - 复用 enterprise_ai::error_code_and_message 解析;按 §6 映射;未知 → "部署失败(HTTP <status>)"(不吞)+ WARN
  - 脱敏:返回/记录前把 /sk-adgd_[A-Za-z0-9_]+/ → [REDACTED]
sanitize_dns_label(name) -> String  // 小写、[a-z0-9-]、非法→-、收尾去-、≤63;空→app-<id前6>

async deploy_create_core(root, name, source_platform, token, base_url) -> DeployApp
  - Form::new().text("metadata", serde_json::to_string(&CreateReq{name,source_platform})?)
              .part("source", Part::bytes(gz).file_name("workspace.tar.gz").mime_str("application/gzip")?)
  - client.post("{base_url}/admin/api/me/apps").bearer_auth(token).multipart(form); 非2xx → deploy_user_facing_error
async deploy_redeploy_core(app_id, root, source_platform, token, base_url) -> DeployApp // metadata 无 name
async deploy_status_core(app_id, token, base_url) -> DeployApp
async deploy_build_log_core(app_id, deployment_id, token, base_url) -> String  // deployment_id 必传,无则 Err
```
HTTP 构造/`.bearer_auth`/状态检查镜像 `enterprise_ai.rs:200-289`;`base_url` 由调用方传 `service_base_url()`。
> 逻辑放 shared core(而非直接塞进 app adapter)是为 v2 接 daemon parity 留单一来源;本版只有 app adapter 调它。

### 3.3 App adapter `src-tauri/src/deploy/mod.rs`(Tauri 命令;**本地执行,远程模式直接报错**)

每个命令先 `if remote_backend::is_remote_mode(&state).await { return Err("部署暂仅支持本地模式") }`,再调 core。

| Tauri 命令 | 本地实现 |
|---|---|
| `deploy_app(workspace_id, metadata)` | 解析 workspace.path → archive → create/redeploy(按 appId);**成功后立即写回** WorkspaceSettings.deploy;返回 DeployApp(+ 归档警告清单) |
| `deploy_status(workspace_id)` | 读 appId → status_core |
| `deploy_build_log(workspace_id)` | 读 appId+deploymentId → build_log_core(无 deploymentId → 明确"暂无构建") |
| `deploy_token_status() -> bool` | `exists_adg_deploy_token()` |
| `deploy_set_token(token)` | `ensure_adg_deploy_token` + `set_adg_deploy_token` |
| `deploy_clear_token()` | `clear_adg_deploy_token()` |

**name 来源 + DNS 清洗**:`metadata.name` 默认 = `sanitize_dns_label(workspace.name)`;清洗结果在 §4.2 回显。用户自定义 name = v2。

**appId 写回失败(fail-fast,防重复 app)**:create 成功拿 appId 后**立即**经 `workspaces_core` 写回。写回失败 →
**硬错误**,文案含 appId(`"应用已创建(ID: {appId})但本地未能保存,请记录此 ID 或重试"`),**不**继续轮询。
后备闸:appId 若丢失,下次走 create → name 确定性 → ADG 返回 `409 name_taken`,UI 提示"可能上次未保存"(v2 提供找回)。

### 3.4 daemon —— **本版不做**(app-only);逻辑已在 shared core,v2 加 `rpc/deploy.rs` + dispatcher 即可接 parity。

### 3.5 IPC wrapper + 注册
`src/services/tauri.ts` 6 个薄包装;`src-tauri/src/lib.rs` `invoke_handler!` 注册 6 命令 + `mod deploy;`。

## 4. 前端 UI

### 4.1 Settings —— token 配置
Settings 既有 ADG/账号区附近加"部署"小节:password 输入粘贴 `sk-adgd_`、保存/清除、状态(已配/未配)、
一行说明 + "去控制台签发令牌"外链(`{service_base_url()}` 的 SPA 部署令牌页)。调 `deploySetToken/deployClearToken/deployTokenStatus`。
**不**在 settings.json 存明文 token。

### 4.2 工作区动作 + 部署面板
- 触发:WorkspaceHome / 工作区头部"部署"动作。**远程模式置灰**(对齐文件附件:`buildCodexSurface.ts` 按 `backendMode==="remote"` 关闭);
  token 未配 → 引导去 Settings。
- 二级面板:`src/features/app/pages/shell/buildShellSurface.ts`(返回 `planPanelProps/...`)新增 `deployPanelProps`;
  经 `useMainAppLayoutSurfaces` 喂 deploy 状态;新组件 `DeployPanel` 与 plan/terminal 并列(参 `pages/README.md`)。
  - 展示:名称(回显清洗后)、状态徽标、URL(running 可点)、进行中轮询动画、失败 error_message + 构建日志(按需拉,等宽)。
  - 按钮:部署/重新部署(进行中禁用)。归档警告清单 → ModalShell 二次确认。
- **stale appId 恢复**:重部署遇 `404 not_found`(app 被服务端删,区别于 `deploy_not_mounted`)→ 提示"该应用已不存在",
  提供"重新创建"(清 appId 重跑)。i18n `deploy.error.appDeleted`。
- 新 feature slice `src/features/deploy/{hooks,components}`:`useDeploy(workspaceId)` 状态机
  (idle→uploading→poll→running/failed)+ 轮询;组件用 DS 原语(守 ESLint 护栏)。

### 4.3 i18n(`src/features/i18n/i18n.tsx`,en+zh 对等;`t('deploy.*')`)
`deploy.action/panelTitle/deploying/redeploy/viewLog/open/tokenMissing/remoteUnsupported/settingsTitle/settingsHelp/secretWarning/recreate/error.*`。

## 5. 轮询与流式行为(MVP 默认)
- 轮询 `deploy_status` 固定 2s 到 `running|failed`,**上限 15 分钟**。
- **超时 = 显式终态**(非静默放弃):置 `status=Failed` + `errorMessage="部署超时(15 分钟未完成),请到控制台查看或重试"`;需用户显式确认才允许再次部署。
- 构建日志:**按需**整段拉(`?type=build&deployment=`);失败态自动拉一次;不做 follow 流(v2)。
- 轮询由前端 `useDeploy` 驱动;不引入后端长连接。

## 6. 错误码 → 文案映射(`deploy_user_facing_error` + i18n)

> 来源:`ai-development-gateway` `internal/deploy/handlers/audit.go::classify()` @ `feat/generate-image-function-tool`(2026-06-22 核对)。

| HTTP | ADG code | 文案(zh) |
|---|---|---|
| 401 | (Bearer 失败) | 部署令牌无效或已吊销,请在 Settings 重新配置 |
| 404 | `deploy_not_mounted` | 该网关未启用部署功能 |
| 404 | `not_found` | 应用已不存在(可能被删除),请重新创建 |
| 404 | `no_build_log` | 暂无构建日志 |
| 403 | `deploy_not_enabled` | 你的租户未开通部署,请联系管理员 |
| 403 | `app_quota_exceeded` / `resource_quota_exceeded` | 部署额度已用尽 |
| 403 | `app_suspended` | 应用已被平台下架,请联系管理员 |
| 409 | `name_taken` | 名称/子域名已被占用(也可能上次未保存),请换名或找回 |
| 409 | `deploy_in_progress` | 该应用正在构建中,请稍候 |
| 409 | `no_deployment` / `not_suspended` | 没有可操作的活动部署 |
| 400 | `source_required` / `invalid_archive` | 源码归档为空或无法识别 |
| 400 | `template_not_buildable` / `invalid` | 模板/参数不被支持 |
| (本地预检) | archive>100MiB | 工程超过 100 MiB 上限(实际 N MiB),请清理后重试 |
| 429 | `build_concurrency_limit` | 并发构建已达上限,请稍后重试 |
| 503 | `builder_busy` | 构建队列已满,请稍后重试 |
| 其它/500 | `internal` / 未知 | 部署失败(HTTP <status>) |

## 7. 测试计划(TDD;fail-fast,无 silent fallback)

Rust 单测(`deploy_core` + named-secret[已过]):
- archive:排除目录 + **密钥 denylist** 强排、守 .gitignore、空目录、确定性顺序;>100 MiB 守卫 Err;denylist 外可疑文件 → 警告清单。
- `deploy_app_from_json`:status 优先级、缺字段、failed 带 error_message + 非空 deployment_id + build_log_ref。
- `deploy_user_facing_error`:§6 每 code → 文案;未知 → 带 HTTP status 兜底(不吞)+ 脱敏(sk-adgd_ → [REDACTED])。
- `sanitize_dns_label`:空格/斜杠/大写/超长/全非法→DNS label;清洗后空 → `app-<id前6>`。
- (HTTP 调用不打真网;同 enterprise_ai 只测纯解析/映射。)

前端 vitest:
- `useDeploy` 状态机:无 appId→create、有 appId→redeploy;poll 到 running/failed/超时停;404 not_found→提示重建;name_taken→提示找回。
- token 缺失→引导 Settings;远程模式动作置灰;面板各态渲染;归档警告二次确认;Settings token 表单 set/clear。

## 8. 非目标(v2)
**daemon/远程 parity**(本版置灰)/ env 编辑 / 自定义域名 / 部署历史 / runtime 日志流(follow)/ stop-start /
多 token / 多账号 / 应用删除 / 导出 / 用户自定义 app 名 / 重命名 / orphan 一键找回。
**已知局限**:build-time env(VITE_*/NEXT_PUBLIC_*)因 .env 被强排,MVP 不支持构建期注入(静态站不受影响)→ v2 经 ADG env 机制。

## 9. 实施步骤(define-first:契约先行)
1. ✅ **T1 类型契约**:`types.rs`↔`types.ts`(DeployStatus/DeployMetadata/DeployApp/WorkspaceDeployState)。
2. ✅ **T2 named-secret 泛化 + deploy token + `ensure_adg_deploy_token`**(隔离/前缀单测过)。
3. **T3** `deploy_core` 纯函数:archive(denylist/警告)+ `deploy_app_from_json` + `deploy_user_facing_error`(脱敏/兜底)+ `sanitize_dns_label`(含单测;HTTP 留桩)。
4. **T4** Cargo 加 tar/flate2(`cargo build` 验证)→ `deploy_core` HTTP → app adapter `deploy/mod.rs`(远程 guard + 写回失败硬错误)+ `lib.rs` 注册 + `tauri.ts`。
5. **T5** 前端 `features/deploy`(useDeploy + DeployPanel)+ buildShellSurface 接线 + 远程置灰 + Settings token 区 + i18n(含 vitest)。
6. **T6** 验证矩阵 + UAT 真跑(对 adg-uat,需用户配 token)。

## 10. 验证矩阵(每步按 AGENTS.md)
`npm run typecheck` 恒跑;触前端 → `npm run test` + `npm run lint`;触 Rust → `cd src-tauri && cargo check` +
`cargo build --bin agentdesk-daemon --bin agentdesk-daemonctl`;`cargo test`(deploy_core/secret/sanitize 单测)。
