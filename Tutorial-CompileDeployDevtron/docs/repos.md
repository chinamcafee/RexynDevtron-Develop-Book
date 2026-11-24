---
id: repos
title: 11 个 fork：8 个核心 + 3 个周边
sidebar_position: 1
---

# 11 个 fork：8 个核心 + 3 个周边

Devtron 的开源组织 [devtron-labs](https://github.com/devtron-labs) 下有 60+ 个仓库。落到"把这套平台完整编出来、并且能二次开发"这件事上，需要 fork 的是 **11 个**，分两类：

- **核心 8 个**：直接产出 Devtron 自己的镜像；
- **周边 3 个**：不产出 Devtron 业务镜像，但对应 chart 里三个"外部镜像"，fork 后可以完全脱离 `quay.io/devtron`。

判断依据不是看仓库列表，而是看两件事：

1. 部署清单里到底用了哪些镜像（`charts/devtron/values.yaml`）；
2. 每个镜像的源码从哪来（各仓库 `go.mod` 里的 `replace` 指向哪儿）。

## 核心 8 个仓库

| # | 仓库 | 语言 | 默认分支 | 产出 | 说明 |
| --- | --- | --- | --- | --- | --- |
| 1 | `devtron` | Go | `main` | `devtron:local` | 平台核心（orchestrator），同时内含 Helm Chart |
| 2 | `devtron-services` | Go | `main` | 7 个微服务镜像 | **微服务 monorepo**，见下节 |
| 3 | `dashboard` | TypeScript | `develop` | `dashboard:local` | Web 控制台（React + Vite） |
| 4 | `devtron-fe-common-lib` | TypeScript | `develop` | npm 包 | dashboard 的公共组件库 |
| 5 | `inception` | Go | `main` | `inception:local` | Operator，负责安装/升级 Devtron 模块 |
| 6 | `migrator` | Go | `main` | `migrator:local` | 数据库迁移（实际镜像提供 `migrate` CLI） |
| 7 | `notifier` | TypeScript | `main` | `notifier:local` | 通知服务（邮件/Slack/Webhook） |
| 8 | `charts` | Helm | `main` | Chart 仓库 | 各集成模块的 Helm Chart 集合 |

:::warning 注意分支
`dashboard` 和 `devtron-fe-common-lib` 的默认分支是 **`develop`**，不是 `main`。fork 时如果勾选了"只复制默认分支"，两者都会停在 `develop` 上，这是对的；但如果只复制 main，你会拿到过时的代码。
:::

## 周边 3 个仓库

这三个仓库对应 chart 里三个"不是 devtron-labs 业务代码"的镜像。它们同样值得 fork，原因各不相同：

| # | 仓库 | 上游 | 对应镜像 | 在本书中的地位 |
| --- | --- | --- | --- | --- |
| 9 | `kubectl` | `kubernetes/kubectl` | `kubectl` | 迁移 Job / 重启 Job 的客户端，**建议自建** |
| 10 | `dex` | `dexidp/dex` | `dex:v2.30.2` | 只提供 musl rootfs，**可自建或 Alpine 替身** |
| 11 | `chart-versions-fix` | `devtron-labs/chart-versions-fix` | `devtron-utils:dup-chart-repo-*` | **新版本、未来 fork 工程都无需使用**（见下） |

### 关于第 11 个：`chart-versions-fix` 的定位

它对应的镜像是 `devtron-utils`，只在迁移 Job 里做一件事：**清理 2023 年之前遗留的重复 chart 数据**，好让迁移 `205_app_store_unique_constraint` 能成功建立唯一索引。

```text
chart-versions-fix 最后提交：3384cc5  wip            2023-12-14
迁移 205 的提交：    24f519427  fix: chart sync...  2023-12-14   ← 同一天
```

它不是"停更的组件"，而是"和 205 这个迁移配套发布的一次性修数据工具"，任务完成即冻结。

:::danger 新版本 / 未来 fork 工程无需使用
如果你**从未部署过 Devtron 老版本**，并且以后都是"fork 源码 → 全新部署"，那么这个仓库和它对应的 `devtron-utils` 镜像**完全不需要**：

- 全新安装时数据库是空的，迁移 205 在空表上建唯一索引必然成功；
- 索引建好后，`chart-sync` 的写入是 `ON CONFLICT DO NOTHING`，重复数据不会再产生；
- 它不参与任何运行时逻辑（不是 API、不是控制器、不是 sidecar）。

保留它反而多一个"必须能拉到的镜像"和一次每次升级都执行的空转。本书主线仍会记录它（保证老库可升级），但**全新部署可以直接删掉这个 initContainer**。详见[编译周边组件](./build-misc)第 4.4 节。
:::

**唯一仍然需要它的场景**：恢复一份 2023 年前的老库 dump，或从老环境迁移数据。此时跳过它，迁移 205 会报 `could not create unique index ... duplicate key`。

## devtron-services 是个 monorepo

这是 2025 年之后 Devtron 做的一次重要重构：原本散落的 8 个仓库被合并进 `devtron-services`，一次提交就能产出全部微服务镜像（它们的镜像 tag 共享同一个 commit 短哈希，例如都是 `5c4c89ba-xxx`）。

目录结构：

```text
devtron-services/
├── authenticator/     # 认证服务（argocd authenticator 的 Devtron 分支）
├── common-lib/        # Go 公共库（被其余子项目通过 replace 引用）
├── chart-sync/        # 定时把 Chart 仓库同步进 DB
├── ci-runner/         # CI 流水线的 runner
├── git-sensor/        # Git 仓库扫描、提交索引
├── image-scanner/     # 镜像漏洞扫描（对接 Clair/Trivy）
├── kubelink/          # 与集群交互的 gRPC 服务（Helm 渲染/应用详情）
├── kubewatch/         # 集群资源事件监听
└── lens/              # 应用/环境健康与部署指标
```

证据在 `go.mod` 里，`devtron` 主仓库显式把依赖重定向到了这个 monorepo：

```go title="devtron/go.mod"
replace (
    github.com/devtron-labs/authenticator => github.com/devtron-labs/devtron-services/authenticator v0.0.0-20260922081328-d6604ff59a0a
    github.com/devtron-labs/common-lib => github.com/devtron-labs/devtron-services/common-lib v0.0.0-20260922081328-d6604ff59a0a
)
```

各子项目也一样，例如 `git-sensor/go.mod`：

```go
replace github.com/devtron-labs/common-lib => github.com/devtron-labs/devtron-services/common-lib v0.0.0-20260923111547-63187c49cf1a
```

## 那这些"看着像"的仓库为什么不在清单里？

| 仓库 | 为什么不需要 |
| --- | --- |
| `git-sensor`、`kubelink`、`kubewatch`、`lens`、`chart-sync`、`ci-runner`、`image-scanner` | 已合并进 `devtron-services`，独立仓库停在 2025-04，不再参与构建 |
| `common-lib`、`authenticator` | 同上，已被 monorepo 内的同名目录取代 |
| `silver-surfer` | 只用于 Devtron Enterprise（EA）能力，OSS 部署不启用 |
| `protos` | 作为 Go module 从代理拉取，不需要 fork |
| `devtron-documentation` | 纯文档站 |
| `helm`、`argo-workflows`、`gojenkins`、`quickwit` | 上游项目的 fork，只在特定集成里以模块方式引用，不产出 Devtron 镜像 |
| `kubernetes/kubernetes` | kubectl 的母仓（1.5GB）。只有"按 v1.37.x tag 精确编 kubectl"才需要，日常用 `kubernetes/kubectl` 模块即可 |

## 11 个 fork 的地址

```text
# 核心 8 个
https://github.com/chinamcafee/devtron
https://github.com/chinamcafee/devtron-services
https://github.com/chinamcafee/dashboard
https://github.com/chinamcafee/devtron-fe-common-lib
https://github.com/chinamcafee/inception
https://github.com/chinamcafee/migrator
https://github.com/chinamcafee/notifier
https://github.com/chinamcafee/charts

# 周边 3 个
https://github.com/chinamcafee/kubectl
https://github.com/chinamcafee/dex
https://github.com/chinamcafee/chart-versions-fix
```

:::tip fork 的两个细节
1. **不要勾选 "Copy the main branch only"**。`dashboard` 的默认分支是 `develop`，只复制 main 会丢代码。
2. fork 完成后用 API 校验一次，比肉眼点开 11 个页面可靠：

```bash
for r in devtron devtron-services dashboard devtron-fe-common-lib inception migrator notifier charts \
         kubectl dex chart-versions-fix; do
  curl -s -H "Authorization: Bearer $GITHUB_TOKEN" \
    "https://api.github.com/repos/chinamcafee/$r" \
    | python3 -c "import sys,json;d=json.load(sys.stdin);print('$r', 'fork=',d.get('fork'), 'parent=', (d.get('parent') or {}).get('full_name'))"
done
```
:::

## 分支约定：11 个仓库同名 `rexyn-dev`

这 11 个仓库不直接在上游分支上开发。每个仓库都切一条同名长期分支：

```text
upstream/main（或 develop / master）  ← 只读，定期 merge
        │
        ▼
origin/rexyn-dev                      ← 定制主线，所有镜像从这里出
```

| 口径 | 数量 | 说明 |
| --- | --- | --- |
| fork 仓库 | 11 | 全部已切 `rexyn-dev`，分支名完全一致 |
| 参与定制与同步 | 10 | 除 `chart-versions-fix` 外的全部 |
| 仅存档 | 1 | `chart-versions-fix`：2023-12-14 冻结，不参与运行时 |

建分支、校验、基线快照的完整操作见[切到 rexyn-dev 分支](./branch-strategy)；分支模型与冲突处理原则见配套电子书《源码剖析与二次开发》的“rexyn-dev 分支模型与上游同步”一章。
