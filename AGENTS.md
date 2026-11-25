# AGENTS.md — RexynDevtron-Develop-Book（电子书 / 文档仓库）

> 本文件是文档仓库的 AI 入口。两本 Docusaurus 电子书是**叙述层的事实源**：实现细节写在这里，各代码仓库的 `AGENTS.md` 只保留精简结论。

## 1. 仓库与分支（唯一例外）

- 独立 git 仓库：`origin` = `git@github.com:chinamcafee/RexynDevtron-Develop-Book.git`，**没有 upstream**。
- **允许直接在 `main` 上提交与推送**，不需要 `rexyn-dev`（这是全项目群唯一的例外）。
- 忽略：`node_modules/`、`build/`、`.docusaurus/`、`.cache-loader/`、日志与系统文件。

## 与 RexynOpsProjects 的关系

本项目不是独立的 Devtron 发行版，而是 **RexynOps 的执行层**。`DevtronProjects` 下所有仓库 fork 自上游 Devtron 并做深度二次开发，目的只有一个：把 Devtron 的应用交付与 K8s 集群资源能力，接进 `RexynOpsProjects` 这个"AI 全自主的公有云运维 Agent"。

```text
RexynDesktop（运维工作台 / HITL）
RexynControlPlane（编排 / 策略 / 审批 / 跨云 Provider）
        │  REST API / Webhook / GitOps
Devtron fork（k3s/k8s 应用交付控制平面）   ← 本项目
        │  Argo CD / Helm / K8s API
目标 k3s / k8s 集群
```

- **上游**：保持与 Devtron 官方仓库可同步；定制只落 `rexyn-dev`，不向上游提 PR。
- **下游**：RexynOps 通过 Devtron API（`/orchestrator/...`）、Webhook 与 GitOps 仓库获取事实、触发部署/回滚；RexynDesktop 可将 Devtron Dashboard 作为受管 Web 控制台打开（内置浏览器 / Browser Use），RexynControlPlane 则直接调用 API。
- **分工**：AI 推理、策略与审批、跨云采购、证据与审计在 RexynOps 侧；本项目只做**确定性执行与事实回传**，不内置 RexynOps 的模型与策略，也不替代 Argo CD。
- **契约**：跨边界以 Devtron HTTP API 与 `contracts/error-codes.yaml`（`businessCode`/`params`）为准；RexynOps 不直连 Devtron 数据库。
- **文档**：本仓库的定制与部署细节写在 `RexynDevtron-Develop-Book`；RexynOps 侧的系统设计写在 `RexynOpsProjects/docs/RexynOps-DevDocs`。

**本仓库的角色**：Devtron fork 的执行层手册（源码剖析 + 编译部署），与 RexynOps 的架构文档是并列关系，不重复其决策。

## 2. 两本书的分工

| 书 | 内容 | 目录 |
| --- | --- | --- |
| Tutorial-DevelopDevtron | 源码剖析与二次开发（含 RexynOps 定制机制） | `Tutorial-DevelopDevtron/docs` |
| Tutorial-CompileDeployDevtron | 编译、镜像、部署与验证 | `Tutorial-CompileDeployDevtron/docs` |

## 3. 文档与代码的同步契约

任何实现变更，按"先细节、后精简"两步走：

```text
1. 实现改动
2. 详细设计/原理/命令写进两本书对应章节（Develop 书优先）
3. 把结论、边界、验证命令大幅精简后回写到对应仓库的 AGENTS.md
```

不允许"下周补文档"。

## 4. 章节映射（常用）

| 变更点 | Develop 书 | Compile 书 |
| --- | --- | --- |
| 仓库增删 / 分支模型 | `overview`、`rexyn-branch-strategy` | `repos`、`branch-strategy` |
| Rexyn 定位 / 接口面 | `rexyn-positioning` | `architecture` |
| 后端 API / 错误码 | `devtron-api`、`backend-error-codes` | — |
| 业务域 / wire / 内置 chart | `devtron-domain`、`devtron-wire`、`devtron-inner-charts` | `workflow`、`deploy` |
| 微服务 | `repo-services` + `svc-*` | `build-services` |
| 前端 / 多语种 | `repo-dashboard`、`repo-fe-common-lib`、`dashboard-i18n` | `build-dashboard` |
| 迁移 / 通知 / 安装 / chart | `repo-migrator`、`repo-notifier`、`repo-inception`、`repo-charts` | `deploy`、`build-misc` |
| 运行时链路 | `runtime-callchain` | `architecture` |
| 构建 / 镜像清单 / 兼容矩阵 | — | `build-overview`、`appendix`、`compat-matrix` |

## 5. 新增或调整章节时

1. 在对应 `docs/*.md` 写内容，`id` 与文件名保持一致；
2. 更新 `sidebars.js`（分部分归类）；
3. 更新对应书的 `README.md` 目录清单；
4. 跑一次构建确认没有断链：

```bash
cd Tutorial-DevelopDevtron && npm run build
cd Tutorial-CompileDeployDevtron && npm run build
```

## 6. 写作约定

- 中文正文，代码/命令/字段名保留英文。
- 路径写成 `$ROOT/...` 或相对路径，不写个人机器绝对路径。
- 命令必须能直接复制执行；环境相关的 IP、密码用占位符并注明获取方式。
- 不复制大段源码；给文件路径 + 关键片段。
- 章节内用"结论先行"结构：先表格/短句给结论，再展开原因。

## 7. 不要做的事

- 不把"临时验证过程、失败尝试、临时路径"写进正文。
- 不在书里承诺未实现的能力；未完成项统一放"已知边界"。
- 不新建与既有章节重叠的内容，先搜索现有章节。
