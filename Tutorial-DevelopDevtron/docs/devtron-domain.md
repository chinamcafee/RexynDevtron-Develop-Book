---
id: devtron-domain
title: devtron｜业务域：pipeline / app / chart / argo
sidebar_position: 3
---

# devtron｜业务域：pipeline / app / chart / argo

`pkg/` 下有 56 个包，但有四个是绝对核心：`pipeline`、`app`、`chart`、`argoApplication`。这一章逐个拆。

## 一、pipeline：CI/CD 流水线

```text
pkg/pipeline/
├── CiCdPipelineOrchestrator.go   # 流水线的"总装"
├── CiHandler.go                  # 触发构建、跟踪构建状态
├── CdHandler.go                  # 部署编排
├── CiBuildConfigService.go       # 构建配置（Dockerfile 路径、参数）
├── CiTemplateService.go          # CI 模板
├── CiLogService.go               # 构建日志
├── AppArtifactManager.go         # 制品（镜像）管理
└── ...
```

### 关键概念：Material → Template → Pipeline → Workflow

```text
CiMaterial（源码：Git 仓库 + 分支）
    +
CiTemplate（构建方式：Dockerfile / Buildpack）
    ↓
CiPipeline（一条 CI 流水线 = material + template + 环境变量）
    ↓ 触发
Argo Workflow（真正跑构建的 K8s 工作流）
    ↓ 产出
AppArtifact（镜像 + tag）
```

理解这四个对象的层级，`pkg/pipeline` 里一半的代码就通了。

### 触发一次构建的调用链

```text
CiHandler.HandleCiTriggerRequest
  └── CiCdPipelineOrchestrator.GetCiPipeline
        └── CiService.BuildCiWorkflowRequest   ← 组装 Argo Workflow spec
              └── ArgoWorkflowExecutor.Execute  ← 提交给 Argo
                    └── 轮询/监听 workflow 状态 → 更新 DB
```

`ci-runner` 镜像里跑的就是这个 workflow 的容器。

### 想改构建逻辑？

| 需求 | 改哪里 |
| --- | --- |
| 构建时多注入一个环境变量 | `CiBuildConfigService` + `CiPipeline` 的 env 字段 |
| 换构建工具（如从 docker build 换 buildkit） | `pkg/pipeline/CiService.go` 里组装 workflow 的模板 + `ci-runner` 仓库 |
| 自定义构建镜像 | chart 里的 `DEFAULT_CI_IMAGE`，或应用级 CI 配置 |
| 改构建日志的存储 | `CiLogService.go` + blob storage 配置 |

## 二、app：应用生命周期

```text
pkg/app/
├── AppCrudOperationService.go   # 增删改查
├── AppListingService.go         # 列表页（带过滤、分页）
├── AppService.go                # 应用详情
├── ReleaseDataService.go        # 发布记录
└── deploymentEventHandler.go    # 部署事件处理
```

`AppListingService` 是前端首页的数据源，代码量很大但逻辑简单：**拼装**。它把应用基本信息、环境、健康状态、最近部署拼成一个 DTO 返回。

:::tip 性能坑
列表页会 join 很多表。如果你的环境应用多，首页会明显变慢。优化点在 `AppListingService` 里的批量查询（`FindByIds` 之类），不要 N+1。
:::

## 三、chart：Helm 相关

```text
pkg/chart/
├── ChartService.go          # Chart 仓库/版本管理
├── ChartTemplateService.go  # 渲染
└── ...
```

Devtron 的部署本质是"Helm chart + values 覆盖"：

```text
全局默认 values（内置参考 chart）
  ← 环境级覆盖
    ← 应用级覆盖
      ← 部署时的临时覆盖
```

三层合并的结果才是最终 values。这套覆盖逻辑在 `pkg/chart` + `kubelink` 里。

### 内置参考 chart 在哪

```bash
ls $ROOT/devtron/scripts/devtron-reference-helm-charts
```

它会被打进 devtron 镜像（Dockerfile 里有 COPY），部署时作为"模板"使用。

## 四、argoApplication：把 Devtron 的意图翻译成 Argo Application

```text
pkg/argoApplication/
├── ArgoApplicationService.go   # 创建/更新/删除 Application CR
└── ...
```

关键映射关系：

| Devtron 概念 | Argo CD 概念 |
| --- | --- |
| 应用 + 环境 | `Application` |
| 部署的 chart 版本 | `Application.spec.source.targetRevision` |
| values 覆盖 | `Application.spec.source.helm.values` |
| 部署目标集群/命名空间 | `Application.spec.destination` |
| 部署历史 | `Application.status.history` |

:::warning 别直接改 Application
你可以 `kubectl edit application`，但**下一次 Devtron 同步会覆盖你的修改**。所有变更都应该走 Devtron 的 API，让它在 DB 和 CR 之间保持一致。
:::

## 五、四个域怎么串起来

```text
创建应用（app）
   ↓
配置 CI（pipeline: CiPipeline + CiTemplate + CiMaterial）
   ↓ 构建
产出制品（pipeline: AppArtifact）
   ↓
配置 CD（chart + 环境 values）
   ↓ 部署
生成 Application（argoApplication）
   ↓
Argo CD 同步 → kubectl apply
   ↓
kubewatch 监听 → 写回状态（app: deploymentEventHandler）
```

## 六、其他值得知道的包

| 包 | 作用 | 什么时候会用到 |
| --- | --- | --- |
| `pkg/eventProcessor` | 事件处理框架 | 加新的异步任务 |
| `pkg/asyncProvider` | NATS 发布/订阅封装 | 跨服务通知 |
| `pkg/executor` | 执行器（跑 workflow/job） | 改任务执行方式 |
| `pkg/cluster` | 集群注册与凭证 | 多集群管理 |
| `pkg/dockerRegistry` | 镜像仓库配置 | 加新的 registry 类型 |
| `pkg/gitops` | GitOps 配置 | 改 Git 写入逻辑 |
| `pkg/variables` | 变量/密钥管理 | 加新的变量作用域 |

## 动手验证

```bash
cd $ROOT/devtron

# 看 pipeline 域有多少文件
ls pkg/pipeline/*.go | wc -l

# 找"触发构建"的入口
grep -rn "func.*HandleCiTriggerRequest" pkg/ api/ | head

# 看 Application CR 是怎么被构造的
grep -rn "argoproj.io/v1alpha1" pkg/argoApplication/*.go | head

# 看内置参考 chart 有哪些
ls scripts/devtron-reference-helm-charts | head
```
