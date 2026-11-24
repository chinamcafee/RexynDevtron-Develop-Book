---
id: svc-ci-runner
title: ci-runner｜流水线里的构建工人
sidebar_position: 6
---

# ci-runner｜流水线里的构建工人

## 它是什么

每次你在 Devtron 里点 "Build"，Kubernetes 里会临时起一个 Pod，里面跑的就是 `ci-runner` 镜像。它负责：

```text
git clone → 构建上下文准备 → docker build → docker push → 回写结果
```

跑完就销毁。所以正常状态下 `kubectl get pods` 看不到它。

## 代码结构

```text
ci-runner/
├── main.go
├── App.go
├── app/
│   └── CiCdProcessor.go      # 主流程：读环境变量 → 执行各阶段
├── executor/                 # 执行器（shell / docker）
├── helper/                   # 各种辅助（git、docker、buildx）
├── pubsub/                   # 状态回写（NATS）
├── util/
├── buildkitd.default.toml    # buildkit 配置
├── docker-daemon.json        # dind 的 daemon 配置
├── dockerd-entrypoint.sh     # 容器入口（启动 dockerd）
├── buildpack.json            # buildpack 构建支持
└── vendor/
```

## 镜像为什么这么大

```dockerfile
FROM golang:1.25-alpine3.21 AS build-env
...
FROM docker:20.10.24-dind       # ← 最终阶段是 dind
```

它必须在容器里跑 docker（DinD，Docker-in-Docker），所以基础镜像自带完整的 Docker daemon + CLI，体积约 300MB。

替代方案是挂载宿主机的 docker socket，但在 K8s 里不安全也不通用，Devtron 选了 DinD。

## 一次构建的环境变量契约

`ci-runner` 完全靠**环境变量**驱动，这是它与 devtron 之间的契约。核心几个：

| 变量 | 含义 |
| --- | --- |
| `DOCKER_REGISTRY_URL` / `DOCKER_REGISTRY_USER` / `DOCKER_REGISTRY_PASSWORD` | 推镜像用 |
| `CI_PROJECT_PATH` | 仓库地址 |
| `GIT_CHECKOUT_PATH` / `SOURCE_REPO_BRANCH` / `SOURCE_REPO_COMMIT` | 源码位置 |
| `DOCKERFILE_PATH` | Dockerfile 位置（可被 buildpack 替代） |
| `DOCKER_IMAGE_TAG` | 产出镜像的 tag |
| `DOCKER_BUILD_ARGS` | 构建参数 |
| `PIPELINE_NAME` / `WORKFLOW_ID` | 用于回写状态 |

查看完整的：

```bash
grep -rhoE "os.Getenv\(\"[A-Z_]+\"\)" $ROOT/devtron-services/ci-runner/app/*.go | sort -u | head -40
```

## 主要阶段

```text
CiCdProcessor
 ├── 1. 从 NATS / env 读取任务参数
 ├── 2. git checkout（用 git-ask-pass.sh 处理凭证）
 ├── 3. 准备 docker daemon（dind 已由 entrypoint 启动）
 ├── 4. 登录 registry
 ├── 5. 执行构建（Dockerfile 或 buildpack）
 ├── 6. 推镜像（含多 tag）
 └── 7. 发布状态到 NATS
```

## 我要改它

| 需求 | 位置 |
| --- | --- |
| 加一个新的构建参数 | `app/CiCdProcessor.go` + devtron 侧传参 |
| 支持新的构建方式（如 Nix/ko） | `executor/` + `helper/` |
| 改镜像 tag 生成规则 | `helper/` + devtron 的 `pkg/pipeline` |
| 加构建缓存（S3/Minio） | `helper/` 里的 buildx 参数 + `buildkitd.default.toml` |
| 改状态回写 | `pubsub/` |

## 调试 ci-runner

因为它跑完就消失，调试要"留住现场"：

```bash
# 1) 触发一次构建后立刻看 Pod
kubectl -n devtron-ci get pods -w

# 2) 如果 Pod 很快就没了，把 workflow 的 ttl 调大，或临时改成 sleep
kubectl -n argo get workflows

# 3) 看 Argo Workflow 的日志（比 Pod 日志更持久）
kubectl -n argo logs -l workflows.argoproj.io/workflow=<name>

# 4) 本地直接跑镜像模拟
docker run --rm --privileged \
  -e DOCKER_REGISTRY_URL=... -e CI_PROJECT_PATH=... \
  rexyn-devtron/ci-runner:local
```

:::warning 必须 `--privileged`
dind 需要 privileged 才能启动 dockerd。这也是 CI 安全上的一个关注点：构建容器等价于宿主机 root 权限。
:::

## 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 构建卡在 "Preparing" | git clone 失败 | 看 Pod 日志里的 `git-ask-pass` 报错 |
| `Cannot connect to the Docker daemon` | dockerd 没起来 | 看 entrypoint 日志，确认 privileged |
| 推镜像 401 | registry 凭证错/过期 | 检查 Devtron 里的 registry 配置 |
| 构建成功但 Devtron 显示失败 | 状态回写失败（NATS） | 看 `pubsub` 日志与 nats 连通性 |

## 与 Argo Workflows 的关系

```text
devtron 创建 Workflow（CR）
   └── workflow-controller 调度
         └── 起 Pod 跑 ci-runner 镜像
               └── 完成后 Workflow 状态变 Succeeded
                     └── devtron 轮询/监听后更新流水线状态
```

所以 `ci-runner` 的代码里**不关心 K8s**——它只关心"把这一件事做完，然后报结果"。调度是 Argo 的事。
