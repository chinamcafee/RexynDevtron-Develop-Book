---
id: build-services
title: 编译 devtron-services 微服务
sidebar_position: 2
---

# 编译 devtron-services 微服务

`devtron-services` 是 monorepo，**每个子目录都是独立的 Go module 和独立构建上下文**。不要在根目录执行 `docker build`。

```text
devtron-services/
├── authenticator/
├── chart-sync/
├── ci-runner/
├── git-sensor/
├── image-scanner/
├── kubelink/
├── kubewatch/
├── lens/
└── common-lib/        # 库，不产出镜像
```

## 1. 确认目录与 Dockerfile

```bash
cd $ROOT/devtron-services
ls -d */ | tr '\n' ' '
ls */Dockerfile | wc -l      # 期望 8
```

## 2. 逐个编译

```bash
cd $ROOT/devtron-services

for c in git-sensor kubelink kubewatch lens chart-sync ci-runner image-scanner authenticator; do
  echo ">>> building $c"
  docker build --platform linux/arm64 -t "rexyn-devtron/$c:local" "./$c" \
    || echo "!!! $c failed"
done
```

耗时参考：`kubelink` 最慢（15–20 分钟，依赖大量 k8s 库），`chart-sync` 最快（5 分钟）。

## 3. 每个 Dockerfile 在做什么

以 `kubelink/Dockerfile` 为例（其他组件结构一致）：

```dockerfile
FROM golang:1.25.0 AS build-env
RUN apt update && \
    apt install git gcc musl-dev make -y && \
    go install github.com/google/wire/cmd/wire@latest
WORKDIR /go/src/github.com/devtron-labs/kubelink
ADD . /go/src/github.com/devtron-labs/kubelink/
RUN GOOS=linux make

FROM ubuntu:24.04@sha256:72297848...
RUN apt update && apt install ca-certificates -y ...
```

四件事：

1. **装 `wire`**：Devtron 全系用 [google/wire](https://github.com/google/wire) 做编译期依赖注入，`make` 的第一步是跑 `wire` 生成 `wire_gen.go`；
2. **`make`**：执行 `clean → wire → go build`，产物是 `./kubelink`；
3. **多阶段**：运行阶段只保留二进制 + CA 证书；
4. **`adduser devtron`**：所有镜像都以非 root 运行（`runAsUser: 1001`），这也是 chart 里 `securityContext` 能生效的前提。

:::note 关于 `fetch-all-env`
有些组件的 Makefile 里 `all: fetch-all-env build`，会先跑 `go run fetchAllEnv/fetchAllEnv.go` 生成环境变量文件。这一步依赖仓库内的 `env_gen.json`，在容器里能正常执行；如果它报错，可以直接 `docker build --build-arg` 跳过，或改用 `make build` 单独跑（不影响产物）。
:::

## 4. 校验产物

```bash
docker images | grep rexyn-devtron
```

期望：

```text
rexyn-devtron/git-sensor:local
rexyn-devtron/kubelink:local
rexyn-devtron/kubewatch:local
rexyn-devtron/lens:local
rexyn-devtron/chart-sync:local
rexyn-devtron/ci-runner:local
rexyn-devtron/image-scanner:local
rexyn-devtron/authenticator:local
```

再抽查一个镜像能不能跑起来：

```bash
docker run --rm --platform linux/arm64 --entrypoint sh rexyn-devtron/lens:local -c "ls -l /usr/local/bin | head"
docker run --rm --platform linux/arm64 rexyn-devtron/chart-sync:local --help 2>&1 | head -3
```

## 5. 常见失败与处理

| 报错 | 原因 | 处理 |
| --- | --- | --- |
| `go: downloading ... i/o timeout` | Go module 代理不通 | 重试；或在 Dockerfile 里加 `ENV GOPROXY=https://goproxy.cn,direct` |
| `fatal: not a git repository` | `.dockerignore` 排除了 `.git`，ldflags 里的 commit 为空 | **无害**，镜像照常产出，只是版本号为空 |
| `wire: ... command not found` | 基础镜像里 `go install` 失败 | 重跑该组件；确认网络可达 `proxy.golang.org` |
| `failed to fetch anonymous token ... EOF` | Docker Hub 抖动 | 重试即可（本书实测 `image-scanner`、`notifier` 各失败一次，重试成功） |
| `no space left on device` | 构建缓存占满 | `docker builder prune -f` |

## 6. 关于 `ci-runner` 的特殊性

`ci-runner` 的 Dockerfile 最后阶段是 `FROM docker:20.10.24-dind`——它本身是个 **dind 镜像**，因为 CI 流水线要在里面跑 docker build。这意味着：

- 镜像体积较大（~300MB）；
- 它不会被部署成长驻 Pod，而是由 Argo Workflows 在每次 CI 时创建、用完即删。

所以 `docker images` 里看到它存在即可，不用等它在集群里跑起来。
