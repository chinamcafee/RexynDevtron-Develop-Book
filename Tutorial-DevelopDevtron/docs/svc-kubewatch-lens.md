---
id: svc-kubewatch-lens
title: kubewatch + lens｜事件监听与健康度
sidebar_position: 4
---

# kubewatch + lens｜事件监听与健康度

这两个服务经常被混为一谈，其实职责差别很大。

| 服务 | 一句话 | 数据方向 |
| --- | --- | --- |
| `kubewatch` | 监听集群事件，把变化写进 DB | 集群 → DB |
| `lens` | 计算应用/环境的健康度与部署指标 | DB → 聚合 → 展示 |

## 一、kubewatch：集群的"耳朵"

### 它做什么

```text
kube-apiserver watch
   → 发现 Deployment/Pod/Service 变化
   → 写入 postgres（应用状态、资源快照）
   → （可选）发 NATS 事件
```

注意：Devtron 里的 `kubewatch` **不是**那个开源的 bitnami/kubewatch（发 Slack 通知的那个），它是 Devtron 自己的实现，只是名字相同。

### 代码结构

```text
kubewatch/
├── main.go
├── cmd/                  # 保留了 cobra 命令结构（历史遗留）
│   ├── root.go
│   ├── resource.go       # 监听资源
│   ├── slack.go / webhook.go / mattermost.go  # 早期通知能力
│   └── version.go
├── pkg/                  # 真正的业务逻辑
├── config/
└── install.yaml          # 独立部署时的清单（Devtron 里由 chart 管）
```

### 关键设计：为什么要有它

Devtron 需要知道"我部署的东西现在是什么状态"。两种做法：

1. 每次 UI 请求时实时查集群（慢，且打 apiserver）
2. **后台持续 watch，写进 DB，UI 读 DB**（kubewatch 的选择）

代价是 DB 会有一张不断更新的状态表，好处是 UI 响应快、能做历史趋势。

### 我要改它

| 需求 | 位置 |
| --- | --- |
| 监听新的资源类型 | `cmd/resource.go` + `pkg/` |
| 改状态写库逻辑 | `pkg/` 下的 repository 调用 |
| 加事件通知 | 与 `notifier` 配合，或走 NATS |

## 二、lens：健康度与指标

### 它做什么

```text
读 DB（部署历史、资源状态）
   → 计算健康度分数
   → 提供 API 给 dashboard
```

`lens` 的名字来自"放大镜"——用来观察应用健康状况。

### 代码结构

```text
lens/
├── main.go
├── pkg/
│   ├── DeploymentMetricService.go   # 部署指标（成功/失败、耗时）
│   ├── IngestionService.go          # 数据摄入
│   ├── constants/                   # 健康度阈值
│   ├── middleware/
│   └── utils/
├── api/                             # REST 接口
├── bean/                            # DTO
├── internal/
└── client/
```

### 健康度是怎么算的

粗略逻辑（`pkg/constants` + `DeploymentMetricService`）：

```text
对一个应用：
  期望副本数 vs 就绪副本数
  + 最近的部署是否成功
  + 是否有 CrashLoop / ImagePullBackOff
  ↓
  Healthy / Degraded / Missing / Progressing
```

这套状态最终会显示在 dashboard 的应用列表里（那个彩色圆点）。

### 我要改它

| 需求 | 位置 |
| --- | --- |
| 改健康度判定规则 | `pkg/constants/` + `DeploymentMetricService.go` |
| 加新的指标（如 MTTR） | `pkg/IngestionService.go` |
| 改 API 返回结构 | `api/` + `bean/` |

## 三、两者的配合

```text
kubewatch 写状态 ──► postgres ──► lens 计算 ──► API ──► dashboard 展示
```

如果你发现"UI 上应用状态不更新"：

1. 先看 `kubewatch` 有没有在写库（日志里有没有 watch 事件）
2. 再看 `lens` 有没有算出来（直接调它的 API）
3. 最后看 dashboard 的轮询

## 动手验证

```bash
# kubewatch 在监听什么
kubectl -n devtroncd logs deploy/kubewatch --tail=80 | head -30

# lens 的健康度 API（走 devtron 的反代）
TOKEN=...
curl -s -H "token: $TOKEN" http://192.168.139.95:30080/orchestrator/lens/... | head

# 看 lens 的库连接
kubectl -n devtroncd exec deploy/lens -- env | grep -i "PG_\|DB_"
```

## 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 应用状态一直 `Unknown` | kubewatch 没权限 watch | 检查 RBAC / ServiceAccount |
| 健康度算错 | 阈值配置 | 看 `pkg/constants` |
| lens 启动即退出 | 连不上 `lens` 库 | 等 migrate job 完成 |

:::tip 一个容易忽略的点
kubewatch 和 lens 都依赖 **同一个 postgres 实例的不同 database**（`orchestrator` / `lens`）。如果你换外部数据库，记得两个库都要建。
:::
