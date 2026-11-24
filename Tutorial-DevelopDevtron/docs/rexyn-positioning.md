---
id: rexyn-positioning
title: Devtron 在 RexynOps 版图中的位置
sidebar_position: 1
---

# Devtron 在 RexynOps 版图中的位置

前面六部分讲的是"Devtron 自己长什么样"。从这一章开始换一个视角：**我们为什么要深度定制它，定制成什么形态**。

结论先给：深度定制的 Devtron 不是要做一个"更好的 Devtron"，而是要成为 **Rexyn 全自动公有云 AI 运维体系里负责"应用交付 + 集群控制"的执行层**。它上面的决策、编排、审批由 Rexyn 负责；它下面才是 Kubernetes 和云资源。

## 一、三层结构：决策层 / 控制层 / 执行层

```text
┌─────────────────────────────────────────────────────────────┐
│  Rexyn 决策层（AIOps）                                        │
│  异常检测 · 根因定位 · 容量与成本 · 变更风险评估 · 修复决策      │
│  产出：一条"要做什么"的意图（Intent），不是 kubectl 命令        │
└───────────────────────────┬─────────────────────────────────┘
                            │ 意图 / 策略 / 审批回执
┌───────────────────────────▼─────────────────────────────────┐
│  Rexyn 控制层（编排与治理）                                    │
│  Agent 编排 · 变更窗口 · 审批流 · 多租户配额 · 审计留痕         │
└───────────────────────────┬─────────────────────────────────┘
                            │ Devtron API / Webhook / CRD / 事件
┌───────────────────────────▼─────────────────────────────────┐
│  Devtron（本仓库群，rexyn-dev 分支）                          │
│  CI/CD 编排 · GitOps 同步 · 多集群资源视图 · RBAC · 审计        │
└───────────────────────────┬─────────────────────────────────┘
                            │ Argo CD / kubelink / kubewatch
┌───────────────────────────▼─────────────────────────────────┐
│  Kubernetes 集群（公有云 / 混合云 / 边缘）                      │
└─────────────────────────────────────────────────────────────┘
```

这个分层决定了一条硬规则：**AI 推理不进 Devtron**。Devtron 里只放"确定性的执行逻辑"和"可供推理的事实数据"，模型、策略、评分都在 Rexyn 侧。否则每次换模型都要重编 13 个镜像，上游同步会彻底失守。

## 二、为什么拿 Devtron 当底座

| 需求 | Devtron 已有的能力 | 对应仓库 |
| --- | --- | --- |
| 多集群纳管与凭证 | 集群注册、kubeconfig/token 托管、资源浏览器 | `devtron/pkg/cluster`、`kubelink` |
| 应用交付 | CI 模板、CD 编排、Helm values 三层覆盖 | `devtron/pkg/pipeline`、`pkg/chart` |
| GitOps 执行 | 把意图翻译成 Argo `Application`，交给 Argo CD 同步 | `pkg/argoApplication` |
| 状态回流 | 监听集群事件写库，健康度聚合 | `kubewatch`、`lens` |
| 权限与审计 | casbin RBAC、资源审计日志、API Token | `pkg/auth`、`pkg/apiToken` |
| 可扩展入口 | Plugin、Webhook、`extraManifests`、`customOverrides` | `pkg/plugin`、`api/webhook` |

缺口也很明确，这些就是二次开发要补的：

1. **没有面向机器的意图接口**——现有 API 是"人点按钮"的形状，Rexyn 需要的是"提交一个变更计划，拿到 plan-id，再执行/回滚"。
2. **没有变更前置校验**——没有 dry-run diff、影响面分析、策略校验（比如"生产环境禁止 latest tag"）。
3. **事件不够结构化**——NATS 事件是给内部服务用的，Rexyn 需要稳定 schema 的变更事件流。
4. **多租户与成本维度缺失**——有 team/app，但没有"成本中心 / 配额 / 资源归属"的完整模型。
5. **健康度是二元的**——Healthy/Degraded 不够，AIOps 需要时序指标与偏离基线。

## 三、模块与 Rexyn 能力的映射

| 仓库 | 在 Rexyn 里承担 | 定制重心（后续任务） |
| --- | --- | --- |
| `devtron` | 控制平面主体：意图 API、变更编排、策略校验 | 新增 `pkg/rexyn/*` 增量包，不改原有域语义 |
| `devtron-services` | 执行触手：集群读写、事件采集、构建 | `kubelink` 扩资源聚合，`kubewatch` 扩事件 schema |
| `dashboard` | 人机界面：Rexyn 视角的运维工作台 | 新增 Rexyn 页面，复用 common-lib |
| `devtron-fe-common-lib` | 前端能力沉淀 | 只加不改，保持与上游组件签名兼容 |
| `inception` | 安装/升级 | 承载 Rexyn 发行版的模块装配 |
| `migrator` | schema 迁移 | Rexyn 增量表统一走新增迁移号段 |
| `notifier` | 告警出口（钉钉/飞书/企微） | 新增渠道实现，不动既有模板 |
| `charts` | 集成模块与环境模板 | Rexyn 标准环境 Bundle |
| `kubectl` | Job 内客户端 | 基本不动，跟随上游 |
| `dex` | SSO rootfs / OIDC | 基本不动，跟随上游 |
| `chart-versions-fix` | 历史数据修复（一次性） | **冻结**，不参与定制与同步 |

## 四、为什么是 11 个仓库、10 个研发对象

工作区里 11 个 fork 都在 `rexyn-dev` 分支上，但真正进入"定制 + 上游同步"循环的是 **10 个**：

```text
参与研发循环（10）
  devtron · devtron-services · dashboard · devtron-fe-common-lib
  inception · migrator · notifier · charts · kubectl · dex

只作存档（1）
  chart-versions-fix   ← 2023-12-14 冻结的一次性修数据工具
```

`chart-versions-fix` 的上游最后一次提交停在 2023-12-14（`3384cc5 wip`），与迁移 `205_app_store_unique_constraint` 同一天发布；它不参与任何运行时逻辑，新部署完全不需要它（详见[周边仓库 · chart-versions-fix](./repo-chart-versions-fix)）。给它建同名分支只是为了"分支模型统一、脚本批量操作不用写例外"，不安排任何定制，也不期待上游再有更新。

:::tip 这条口径要一致
对外说"11 个仓库"，对内排期说"10 个研发对象"。两本书、记忆文件、脚本里的清单必须用同一套口径，否则同步脚本会在第 11 个仓库上永远报"无更新"。
:::

## 五、Rexyn 需要的五个接口面

深度定制不是"到处加代码"，而是**把 Devtron 收敛成五个稳定的接口面**，让 Rexyn 只依赖这五个面：

| 接口面 | 形态 | 落在哪 | 为什么稳定 |
| --- | --- | --- | --- |
| 意图提交 | `POST /orchestrator/rexyn/plan` | `devtron/api/router` 新增 Rexyn 路由组 | 只新增路由，不动既有路径 |
| 变更执行 | 复用 CD 链路 + `Application` CR | `pkg/argoApplication` | 上游本来就这么干 |
| 事实回读 | 资源快照 / 健康度 / 事件 | `kubelink` gRPC + `lens` API | 上游接口已存在，只扩字段 |
| 事件流 | NATS subject + 稳定 schema | `common-lib/pubsub` 之上再加一层 | 不改 subject 语义，只加新 subject |
| 审计 | 资源审计日志 + `apiToken` | `pkg/kubernetesResourceAuditLogs` | 表结构天然适配 |

这五个面之外的一切（页面、表单、报表）都可以自由改，因为 Rexyn 不依赖它们。

## 六、三条不做的事

| 不做 | 原因 |
| --- | --- |
| 不把模型/推理代码放进 `devtron` | 会把单体撑爆，且每次模型迭代都要重编镜像，上游同步成本指数上升 |
| 不替换 Argo CD 做自己的同步器 | Devtron 的 CD 语义（values 覆盖、部署历史、回滚）全部建立在 Argo 之上，换掉等于重写 |
| 不修改已发布迁移脚本的语义 | `scripts/sql` 是上游与定制的共享契约，只能追加号段，不能改历史 |

## 七、和另一本书的分工

| 书 | 回答 | 什么时候看 |
| --- | --- | --- |
| 本书《源码剖析与二次开发》 | 改哪里、为什么这么改、改动如何与上游共存 | 设计和写代码时 |
| 《编译 + 本地部署》 | 怎么把改完的代码变成集群里跑的东西 | 每次改完要验证时 |

两本书共用同一个仓库群、同一套 `rexyn-dev` 分支。**任何一侧改了实现，另一侧的对应章节必须同批更新**——精简结论在各自仓库根目录的 `AGENTS.md`，详细设计在书里；可执行的对照表在[分支策略 · 文档同步契约](./rexyn-branch-strategy#七文档同步契约)一章。
