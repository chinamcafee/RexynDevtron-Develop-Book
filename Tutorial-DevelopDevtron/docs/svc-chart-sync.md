---
id: svc-chart-sync
title: chart-sync｜Chart 仓库同步器
sidebar_position: 5
---

# chart-sync｜Chart 仓库同步器

## 它是什么

Devtron 的 Chart Store 里能看到成百上千个 chart、每个 chart 有几十个版本。这些元数据不是实时查来的，而是 **chart-sync 定时抓取并写进数据库**的结果。

```text
Helm 仓库（index.yaml）
   │  chart-sync 定时拉取
   ▼
postgres（chart 元数据、版本列表）
   │
   ▼
dashboard 的 Chart Store 页面
```

## 代码结构

```text
chart-sync/
├── main.go
├── App.go
├── pkg/                  # 同步逻辑
├── internals/            # DB 访问
├── util/
├── fetchAllEnv/          # 生成环境变量文件
└── vendor/
```

## 它怎么工作

```text
启动
 └── 循环（默认间隔由配置决定）
       ├── 找出所有已配置的 chart repo
       ├── 拉取每个 repo 的 index.yaml
       ├── 解析 chart + version
       ├── 与 DB 中的记录 diff
       └── 新增/更新/标记删除
```

关键点：**它只同步元数据，不下载 chart 包**。真正 `helm pull` 是在部署时由 devtron / kubelink 做的。

## 部署形态

在 chart 里它是 **Job**（`app-sync-job`），不是 Deployment：

```bash
kubectl -n devtroncd get jobs | grep app-sync
kubectl -n devtroncd logs job/app-sync-job-xxxxx
```

Job 完成后就退出。下一次同步由 devtron 触发（新建 Job）。

:::tip 为什么是 Job
同步是一次性的批处理，用 Job 可以避免常驻进程空转；失败时也能通过 Job 的 backoff 重试。
:::

## 一个真实的 Job 长什么样

```bash
kubectl -n devtroncd get job app-sync-job-xxxxx -o yaml | head -40
```

你会看到：

- initContainer `clean-duplicate-chart`（用 `devtron-utils` 镜像）
- 主容器 `chart-sync`（我们编译的镜像）
- 挂载 `devtron-cm` / `devtron-common-cm` 配置

`clean-duplicate-chart` 的作用是清理"同一个 chart 的重复记录"，这也是为什么它有独立的 init 容器。

## 我要改它

| 需求 | 位置 |
| --- | --- |
| 支持新的 chart repo 类型（OCI registry） | `pkg/` 下的 repo 客户端 |
| 改同步频率 | devtron 侧的调用逻辑 + chart-sync 的配置 |
| 同步时过滤某些 chart | `pkg/` 的解析逻辑 |
| 加同步统计/日志 | `pkg/` + `internals/` |

## 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| Chart Store 里没有新加的仓库 | 同步 Job 没跑成功 | 看 Job 日志，常见是 repo URL 不通 |
| 版本列表不全 | `index.yaml` 太大被截断，或解析失败 | 看日志里的 parse error |
| Job 一直 Running | 仓库多、网络慢 | 调大 activeDeadlineSeconds |

## 动手验证

```bash
# 看最近一次同步
kubectl -n devtroncd get jobs --sort-by=.metadata.creationTimestamp | tail -3

# 看某个 Job 的日志
kubectl -n devtroncd logs job/<job-name> --tail=50

# 看 DB 里的 chart 数量
kubectl -n devtroncd exec postgresql-postgresql-0 -c postgres -- \
  psql "postgresql://postgres:<pw>@127.0.0.1:5432/orchestrator" \
  -c "select count(*) from chart_repo;"
```

## 与 `charts` 仓库的区别

别混淆：

| 仓库 | 作用 |
| --- | --- |
| `devtron-services/chart-sync` | **同步工具**（代码） |
| `charts`（独立仓库） | **chart 内容**（YAML） |

chart-sync 同步的是"别人仓库里的 chart"（比如 Bitnami、你的私有 Harbor），而 `charts` 仓库是 Devtron 自己维护的集成模块 chart。
