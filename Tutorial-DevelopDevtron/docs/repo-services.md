---
id: repo-services
title: devtron-services｜微服务 monorepo 总览
sidebar_position: 1
---

# devtron-services｜微服务 monorepo 总览

## 它是什么

这是 2025 年 Devtron 做的一次重要重构：把原本 8 个独立仓库合并成一个 monorepo。

**为什么合并？**

| 痛点 | 合并后的解法 |
| --- | --- |
| 8 个仓库版本难以对齐 | 一次 commit 产出所有镜像，tag 共享同一个哈希 |
| `common-lib` 频繁改，8 处同步 | 同一个仓库内的相对路径，`replace` 指向本地目录 |
| CI 要为 8 个仓库重复配置 | 一套 pipeline，矩阵构建 |

**代价**：仓库变大（48k 文件），clone 慢，但换来的一致性收益更大。

## 目录与产出

```text
devtron-services/
├── authenticator/     → rexyn-devtron/authenticator:local
├── chart-sync/        → rexyn-devtron/chart-sync:local
├── ci-runner/         → rexyn-devtron/ci-runner:local
├── git-sensor/        → rexyn-devtron/git-sensor:local
├── image-scanner/     → rexyn-devtron/image-scanner:local
├── kubelink/          → rexyn-devtron/kubelink:local
├── kubewatch/         → rexyn-devtron/kubewatch:local
├── lens/              → rexyn-devtron/lens:local
└── common-lib/        → 不产出镜像（库）
```

## 统一的构建约定

每个子目录都长这样：

```text
<service>/
├── Makefile          # all: fetch-all-env build
├── Dockerfile        # 多阶段：golang → alpine/ubuntu
├── go.mod / go.sum
├── App.go            # 入口初始化
├── Wire.go           # 依赖注入声明
└── <pkg>/            # 业务代码
```

根目录的 `Makefile` 只是批量调度：

```makefile
build:
	cd chart-sync && $(MAKE)
	cd ci-runner && $(MAKE)
	cd git-sensor && $(MAKE)
	cd kubelink && $(MAKE)
	cd kubewatch && $(MAKE)
	cd lens && $(MAKE)
	cd image-scanner && $(MAKE)
```

**注意**：`docker build` 时一定要进子目录，因为 Dockerfile 的 `WORKDIR` 和 `ADD .` 都是相对该子目录的。

## 为什么它们都需要 common-lib

```go title="kubelink/go.mod"
module github.com/devtron-labs/kubelink

require github.com/devtron-labs/common-lib v0.0.0

replace github.com/devtron-labs/common-lib => github.com/devtron-labs/devtron-services/common-lib v0.0.0-20260923111547-63187c49cf1a
```

`common-lib` 提供：

- NATS 客户端封装（`pubsub`）
- 日志/指标初始化
- K8s client 的通用封装
- 错误类型与工具函数

**所有服务共用同一份 NATS 抽象**，这是它们能互相通信的基础。

## 服务之间的通信矩阵

| 从 \ 到 | devtron | nats | kubelink | git-sensor | DB |
| --- | --- | --- | --- | --- | --- |
| kubelink | gRPC 响应 | 订阅 | — | — | 读 |
| kubewatch | 写 DB | 发布事件 | — | — | 写 |
| lens | HTTP 响应 | 订阅 | — | — | 写 |
| git-sensor | HTTP 响应 | — | — | — | 写 |
| chart-sync | — | — | — | — | 写 |

> 粗略规律：**读操作走 gRPC/HTTP 同步调用，写事件走 NATS 异步**。

## 一个服务的典型启动流程

以 kubelink 为例：

```go
// Main.go
func main() {
    // 1) 初始化日志
    // 2) 连数据库
    // 3) 注册 gRPC server
    // 4) 启动监听 50051
}
```

```go
// Wire.go
var KubelinkWireSet = wire.NewSet(
    repository.KubelinkRepositorySet,
    service.KubelinkServiceSet,
    ...
)
```

## 我要改它，从哪下手

| 想改的 | 去哪个目录 | 关键文件 |
| --- | --- | --- |
| 集群资源读取逻辑 | `kubelink/` | `pkg/...` + `api/` |
| Helm 渲染 | `kubelink/` | `pkg/helm` 相关 |
| Git 仓库索引 | `git-sensor/` | `pkg/gitsensor` |
| 集群事件监听 | `kubewatch/` | `pkg/...` + `cmd/` |
| 应用健康度算法 | `lens/` | `pkg/...` |
| Chart 仓库同步 | `chart-sync/` | `App.go` 主循环 |
| 构建容器内逻辑 | `ci-runner/` | `app/` |
| 镜像扫描 | `image-scanner/` | `pkg/...` |
| 登录/Dex 对接 | `authenticator/` | `pkg/...` |

## 常见坑

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `undefined: xxx`（common-lib 里的符号） | `replace` 指向的 commit 与本地不一致 | 同步更新各子项目的 `replace` 行 |
| `wire: command not found` | 基础镜像没装 wire | 用仓库自带 Dockerfile 构建 |
| `fatal: not a git repository` | 构建上下文没有 `.git` | 无害，只是版本号为空 |
| 构建产物跑不起来 | `GOOS` 不是 linux | Dockerfile 里已设置，别在宿主机直接 make |

## 动手验证

```bash
cd $ROOT/devtron-services

# 每个子项目的代码量
for d in */; do printf "%-18s %s go files\n" "$d" "$(find $d -name '*.go' -not -path '*/vendor/*' | wc -l | tr -d ' ')"; done

# 看谁依赖 common-lib
grep -l "devtron-services/common-lib" */go.mod

# 看每个服务的 gRPC/HTTP 端口
grep -rn "PORT\|:50051\|:8080" */Makefile */App.go 2>/dev/null | head
```
