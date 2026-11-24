---
id: overview
title: 生态全景：11 个仓库各自的位置
sidebar_position: 1
---

# 生态全景：11 个仓库各自的位置

这里说的 11 个仓库 = **核心 8 个**（产出 Devtron 自己的镜像）+ **周边 3 个**（chart 里三个外部镜像的上游源码，已一并 fork）。

在 RexynOps 的研发口径里，真正进入"定制 + 上游同步"循环的是 **10 个**：`chart-versions-fix` 是 2023 年冻结的一次性修数据工具，只作存档（见[第七部分 · RexynOps 定制](./rexyn-positioning)）。

## 一张分层图

```text
┌──────────────────────────────────────────────────────────────┐
│  交互层                                                       │
│  dashboard（React SPA）  ← 依赖 →  devtron-fe-common-lib       │
└───────────────────────────┬──────────────────────────────────┘
                            │ HTTP /orchestrator/*
┌───────────────────────────▼──────────────────────────────────┐
│  控制平面                                                     │
│  devtron（Go，单体 API + 业务编排）                             │
│    ├── 内嵌 Helm Chart（charts/devtron）                       │
│    └── 调 gRPC → kubelink                                     │
└───┬──────────────┬──────────────┬──────────────┬─────────────┘
    │ NATS         │ gRPC         │ HTTP         │ K8s API
┌───▼────┐  ┌──────▼─────┐  ┌─────▼──────┐  ┌────▼─────────┐
│ nats   │  │  kubelink  │  │ git-sensor │  │ inception    │
└────────┘  └────────────┘  └────────────┘  │ (Operator)   │
                                            └──────────────┘
┌────────────┐ ┌────────────┐ ┌─────────────┐ ┌──────────────┐
│ kubewatch  │ │    lens    │ │ chart-sync  │ │  migrator    │
│ 事件监听    │ │ 健康/指标  │ │ Chart 同步   │ │  DB 迁移     │
└────────────┘ └────────────┘ └─────────────┘ └──────────────┘
┌────────────┐ ┌────────────┐
│ ci-runner  │ │image-scanner│   ← 由流水线按需拉起，不常驻
└────────────┘ └────────────┘
```

## 每个仓库的"一句话定位"

| 仓库 | 类比 | 定位 | 代码规模 |
| --- | --- | --- | --- |
| `devtron` | 大脑 | 所有业务逻辑、API、编排、内置 Chart | ~18k 文件 |
| `devtron-services` | 手脚 | 与集群/Git/镜像打交道的微服务集合 | ~48k 文件 |
| `dashboard` | 脸 | Web 控制台 | ~1.8k 文件 |
| `devtron-fe-common-lib` | 化妆品 | 前端公共组件与 hooks | ~1.5k 文件 |
| `inception` | 装配工 | Operator，安装/升级模块 | 99 文件 |
| `migrator` | 迁徙者 | 数据库 schema 迁移 | ~950 文件 |
| `notifier` | 邮差 | 通知（邮件/Slack/Webhook） | 140 文件 |
| `charts` | 工具箱 | 各集成模块的 Helm Chart | ~1.1k 文件 |
| `kubectl`（周边） | 扳手 | 迁移/重启 Job 用的 kubectl 客户端 | 779 文件 |
| `dex`（周边） | 门禁 | OIDC Provider；Devtron 用法下只当 rootfs | 619 文件 |
| `chart-versions-fix`（周边） | 一次性清洁工 | 清理 2023 年前遗留的重复 chart 数据 | 10 文件 |

## 周边 3 个仓库的边界

它们不属于 Devtron 业务代码，但在"完全脱离 `quay.io/devtron`"这件事上各占一个位置：

| 仓库 | 谁在调用它 | 去掉会怎样 | 新部署是否需要 |
| --- | --- | --- | --- |
| `kubectl` | 迁移 Job 的 `migration-wait`、`devtron-rollout`、grafana Job | 迁移后不再自动重启 devtron/kubelink；Job 不再等迁移完成 | 需要 |
| `dex` | `argocd-dex-server` 的 `dex` 容器（command 被覆盖为 `authenticator rundex`） | SSO 登录不可用；本地 admin 登录不受影响 | 需要（可用 Alpine 替身） |
| `chart-versions-fix` | devtron 迁移 Job 的 initContainer `clean-duplicate-chart` | 无运行时影响；只影响"2023 年前老库升级" | **不需要** |

:::danger 关于 `chart-versions-fix` 的标记
这个仓库的最后提交是 2023-12-14 的 `wip`，与迁移 `205_app_store_unique_constraint` 的提交**同一天**。它不是"停更的组件"，而是和 205 配套的一次性修数据工具。

**新版本、以及未来所有"从 fork 全新部署"的工程，都不需要使用它。** 全新空库上 205 建索引必然成功；索引建好后 `chart-sync` 用 `ON CONFLICT DO NOTHING`，重复数据也不会再产生。

唯一仍需它的场景：恢复 2023 年前的老库 dump。此时跳过它，205 会报 `could not create unique index ... duplicate key`。
:::

## 三条需要先建立的认知

### 1. devtron 是"单体"，不是微服务

尽管周边有 7 个服务，**真正的业务逻辑全部在 `devtron` 这一个 Go 程序里**。它不是被拆成几十个微服务的架构，而是一个"单体 + 若干专用 sidecar"的结构：

- 单体负责：应用/流水线/环境/权限/Chart/部署编排
- sidecar 负责：**访问外部系统**（Git、K8s API、镜像仓库、集群事件）

这样设计的好处是业务事务都在一个进程内，缺点是 `devtron` 二进制很大、启动要连数据库和 NATS。

### 2. 它重度依赖 Argo CD，但不暴露 Argo CD

Devtron 把 Argo CD 当成"部署执行器"藏在身后：

```text
你点"部署" → devtron 生成 Application CR → Argo CD 同步到集群 → kubewatch 监听事件 → devtron 回写状态
```

所以 `kubectl get applications -A` 能看到一堆 Application，但用户从不直接操作它们。

### 3. 代码生成（wire）是硬性约定

`devtron` 和 `devtron-services` 里几乎每个服务都有三个文件：

```text
Wire.go        ← 你写的：ProviderSet 声明
wire_gen.go    ← wire 生成的：真正的构造函数调用链
App.go         ← 你写的：InitializeApp，调用 wire_gen 里生成的函数
```

**`wire_gen.go` 不要手改**，改完 `Wire.go` 后跑 `wire` 重新生成。忘记跑会得到"明明写了却没生效"的诡异现象。

## 仓库之间的版本耦合

这是最容易踩的坑：核心 8 个仓库不是独立发版的。

```text
devtron/go.mod
  ├── replace github.com/devtron-labs/common-lib     → devtron-services/common-lib@<commit>
  └── replace github.com/devtron-labs/authenticator  → devtron-services/authenticator@<commit>
```

也就是说：**`devtron` 的代码里引用的 `common-lib`，是 `devtron-services` 那个 commit 里的版本**。如果你只更新 `devtron` 而不更新 `devtron-services`，可能出现 `undefined: xxx` 的编译错误。

排查方法：

```bash
grep -n "devtron-services" $ROOT/devtron/go.mod
grep -n "devtron-services" $ROOT/devtron-services/*/go.mod | head
```

## 一张表：改不同东西该去哪个仓库

| 你想改的 | 去哪个仓库 | 具体位置 |
| --- | --- | --- |
| 新增 API | `devtron` | `api/router` + `api/restHandler` + `pkg/*` |
| 加一个页面 | `dashboard` | `src/Pages` |
| 加一个通用组件 | `devtron-fe-common-lib` | `src/Shared/Components` |
| 改 CI 构建流程 | `devtron-services` | `ci-runner/` |
| 改 Helm 渲染逻辑 | `devtron` + `kubelink` | `pkg/chart` + `kubelink/pkg` |
| 改通知渠道 | `notifier` | `src/destination` |
| 改安装/升级流程 | `inception` | `controllers/installer_controller.go` |
| 加数据库表 | `devtron` | `scripts/sql/` + `internal/sql/repository` |
| 改部署 chart 默认值 | `devtron` | `charts/devtron/values.yaml` |
| 加一个 Marketplace 集成 | `charts` | `charts/<模块名>/` |

## 分支：11 个仓库统一叫 rexyn-dev

上游分支（`main` / `develop` / `master`）只做"镜像"，不在上面提交。所有定制落在每个仓库同名的 `rexyn-dev` 分支上：

```text
upstream/main ──fetch+merge──► rexyn-dev ──push──► origin/rexyn-dev
   （只读）                     （唯一长期分支）        （自己的 fork）
```

这么做的两个直接好处：

1. **上游同步是一次 merge，不是一场考古**——`git log --oneline upstream/main..rexyn-dev` 就是"我们到底改了什么"的完整清单；
2. **批量操作不用写例外表**——11 个仓库分支名一致，脚本一个循环就能 fetch / merge / push / 统计。

分支模型、冲突高发区、同步后的验证矩阵，见[rexyn-dev 分支模型与上游同步](./rexyn-branch-strategy)。
