---
id: repo-kubectl
title: kubectl｜被 Job 当工具用的官方客户端
sidebar_position: 5
---

# kubectl｜被 Job 当工具用的官方客户端

## 它是什么

`chinamcafee/kubectl` fork 自 `kubernetes/kubectl`，它不是"另一个 kubectl 实现"，而是 Kubernetes 官方把 `staging/src/k8s.io/kubectl` 这个 Go module 单独镜像出来的仓库。

```text
kubernetes/kubernetes
  └── staging/src/k8s.io/kubectl   ← 真正的源码
        └── 同步到 → kubernetes/kubectl（本仓库）
```

所以它**没有 `main.go`**，只有 `pkg/`。真正的入口在母仓 `kubernetes/kubernetes/cmd/kubectl/main.go`，内容只有几行：

```go
func main() {
    command := cmd.NewDefaultKubectlCommand()
    if err := command.Execute(); err != nil {
        os.Exit(1)
    }
}
```

Devtron 不需要"完整 kubectl 仓库"，只需要这个模块 + 一个几行的 main 包装。

## 代码结构

```text
kubectl/
├── go.mod                 module k8s.io/kubectl（当前要求 Go 1.27）
├── pkg/
│   ├── cmd/               NewDefaultKubectlCommand()，所有子命令的注册入口
│   ├── cmd/rollout/       rollout status / restart —— Devtron 只用这个
│   ├── cmd/apply/         apply / create
│   ├── cmd/get/           get / describe
│   └── ...                其余子命令
└── testdata/
```

对二次开发来说，90% 的场景只会碰 `pkg/cmd` 与 `pkg/cmd/rollout`。

## 它在 Devtron 里的三个调用点

| 调用点 | 位置 | 干什么 |
| --- | --- | --- |
| `migration-wait` | `app-sync-job` 的 initContainer | 轮询 4 个迁移 Job，直到全部成功 |
| `devtron-rollout` | `postgresql-migrate-casbin` 的 initContainer | 迁移后 `kubectl rollout restart deploy/devtron deploy/kubelink`，让新 RBAC 生效 |
| `kubectl-grafana.sh` | `grafana-org-job` | 新建 Grafana org 后重启 Grafana |

三个位置都跑在 `devtron` ServiceAccount 下，所以 kubectl 的权限 = 这个 SA 的 RBAC。改权限时不要只盯着 devtron 进程，Job 里的 kubectl 也会受影响。

## 我要改它

| 需求 | 做法 |
| --- | --- |
| 加一个自定义子命令 | 在 `pkg/cmd` 下新建包，注册进 `NewDefaultKubectlCommand` |
| 只改 rollout 行为 | 改 `pkg/cmd/rollout/restart.go` |
| 换版本 | fork `kubernetes/kubernetes`，checkout `v1.37.x`，`go build ./cmd/kubectl` |
| 本地构建 | 用 `replace k8s.io/kubectl => ./kubectl-src` + 自写 main（见编译书 4.3） |

:::warning 两个约束
1. **本仓库没有 version tag**，只能编 `master`（1.38-dev）。与 1.37 集群相差一个 minor，在 k8s skew 策略内。
2. `go.mod` 要求 **Go 1.27**；且模块依赖树很大，`go mod tidy` 首次要 5–10 分钟。
:::

## 动手验证

```bash
cd $ROOT/kubectl
head -3 go.mod                       # module k8s.io/kubectl
ls pkg/cmd | head                    # 没有 main.go，只有子命令包

docker run --rm rexyn-devtron/kubectl:fork version --client
docker run --rm rexyn-devtron/kubectl:fork rollout restart --help

# 集群里谁在用它
kubectl -n devtroncd get job -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.template.spec.initContainers[*].image}{"\n"}{end}'
```
