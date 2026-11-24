---
id: build-misc
title: inception / migrator / notifier 与镜像搬运
sidebar_position: 5
---

# inception / migrator / notifier 与镜像搬运

## 1. inception（Operator）

```bash
cd $ROOT/inception
docker build --platform linux/arm64 -t rexyn-devtron/inception:local .
```

镜像很小（~60MB）。它是个标准的 kubebuilder Operator：

```text
inception/
├── api/            # Installer CRD 的 Go 类型
├── controllers/    # Reconcile 逻辑
├── pkg/
│   ├── language/            # 内置的脚本解释器（执行安装脚本）
│   └── providerIdentifier/  # 探测云厂商（AWS/GCP/阿里云元数据）
└── main.go
```

> 你会看到日志里刷 `http://169.254.169.254/... i/o timeout`，那是它在探测云厂商元数据（本地环境必然失败），**不影响功能**。

## 2. notifier（通知服务）

```bash
cd $ROOT/notifier
docker build --platform linux/arm64 -t rexyn-devtron/notifier:local .
```

Node/TypeScript 服务，默认不部署（chart 里 `notifier.enabled: false`）。要启用再改 values。

## 3. migrator：**必须本地改造**

这是全书唯一一个"仓库源码与官方镜像不一致"的组件，值得单独讲。

### 现象

如果直接用仓库自带的 `Dockerfile` 构建：

```bash
cd $ROOT/migrator
docker build --platform linux/arm64 -t rexyn-devtron/migrator:local .
```

部署后 Job 全部失败：

```text
postgresql-migrate-devtron-xxx   0/1   Error   Exit Code: 127
```

日志里是 `migrate: not found`。

### 原因

chart 里的迁移命令是：

```bash
/bin/sh -c "migrate -path /scripts/sql -database postgres://... up"
```

它调的是 **golang-migrate 官方 CLI**（`migrate`）。而 `migrator` 仓库的 `main.go` 是个自定义程序（克隆 Git 仓库→跑迁移），产物叫 `migrator` 且不在 PATH 里。

对比官方镜像可以看到真相：

```bash
docker run --rm --platform linux/arm64 --entrypoint sh quay.io/devtron/migrator:v4.16.2 \
  -c "which migrate; ls /usr/local/bin"
# /usr/local/bin/migrate
# migrate
```

也就是说：**这个镜像装的是 golang-migrate CLI，不是仓库里的二进制**。

### 解决：用 `Dockerfile.local` 装 CLI

```dockerfile title="migrator/Dockerfile.local"
FROM golang:1.25-alpine AS build-env
RUN apk add --no-cache git gcc musl-dev
RUN go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@v4.16.2

FROM alpine:3.21
RUN apk add --no-cache ca-certificates git bash
COPY --from=build-env /go/bin/migrate /usr/local/bin/migrate
ENTRYPOINT ["/usr/local/bin/migrate"]
```

```bash
cd $ROOT/migrator
docker build --platform linux/arm64 -f Dockerfile.local -t rexyn-devtron/migrator:local .
docker run --rm --platform linux/arm64 --entrypoint sh rexyn-devtron/migrator:local -c "migrate -version"
# dev   ← 从源码编译没有注入版本号，正常
```

:::tip 为什么要 `-tags 'postgres'`
golang-migrate 的数据库驱动是编译期按 tag 引入的，不加 `postgres` tag，跑起来会报 `unknown driver postgres`。
:::

## 4. 三个周边仓库的镜像（都已 fork，可完全自建）

这三个镜像不来自核心 8 仓库，而是三个独立上游仓库。它们已经和核心仓库一起 fork 到 `chinamcafee` 下（见[仓库清单](./repos)），因此既可以"搬运"，也可以**从 fork 源码编出来**。

| 组件 | fork 仓库 | 是否参与运行时 | 新版本是否必需 |
| --- | --- | --- | --- |
| kubectl | `chinamcafee/kubectl` | 是（迁移等待 / 迁移后重启） | 是 |
| dex | `chinamcafee/dex` | 是（SSO 端点） | 是（也可用 Alpine 替身） |
| devtron-utils | `chinamcafee/chart-versions-fix` | 否（一次性数据修复） | **否**，见 4.4 |

### 4.1 先搬运（最省事的做法）

```bash
for pair in \
  "quay.io/devtron/dex:v2.30.2|rexyn-devtron/dex:v2.30.2" \
  "quay.io/devtron/devtron-utils:dup-chart-repo-v1.1.0|rexyn-devtron/devtron-utils:dup-chart-repo-v1.1.0" \
  "quay.io/devtron/kubectl:latest|rexyn-devtron/kubectl:local" ; do
  src=${pair%%|*}; dst=${pair##*|}
  docker pull --platform linux/arm64 "$src"
  docker tag "$src" "$dst"
  echo "tagged $dst"
done
```

:::warning 为什么 kubectl 要把 `latest` 改成 `local`
Kubernetes 对 `:latest` 标签的默认拉取策略是 **Always**。镜像只在本地 containerd 里、根本没有仓库，`Always` 会导致：

```text
Failed to pull image "rexyn-devtron/kubectl:latest": pull access denied
```

改成一个非 `latest` 的 tag（这里用 `local`），默认策略就变回 `IfNotPresent`，本地镜像才用得上。
:::

### 4.2 它们在 chart 里到底干什么

| 镜像 | 使用位置 | 实际执行的命令 | 作用 |
| --- | --- | --- | --- |
| `dex:v2.30.2` | `argocd-dex-server` Deployment 的 `dex` 容器 | **`/shared/authenticator rundex`** | OIDC Provider（Dex），给 Argo CD / Devtron 提供 SSO 端点（5556/5557/5558）。注意：**真正运行的二进制是我们的 authenticator**，dex 镜像只提供 rootfs |
| `kubectl` | ① `postgresql-migrate-casbin` 的 `devtron-rollout`；② `app-sync-job` 的 `migration-wait`；③ `grafana-org-job` | `kubectl rollout restart deploy/devtron && deploy/kubelink`；轮询迁移 Job 状态；执行 `kubectl-grafana.sh` | 给 Job 提供 kubectl 客户端：等待迁移完成、迁移后重启服务 |
| `devtron-utils` | devtron 迁移 Job 的 initContainer `clean-duplicate-chart` | 二进制 `/chart-versions-fix` | 清理 `app_store` / `app_store_application_version` 中的重复记录，并把 `installed_app_versions` 重指到保留的那条 |

### 4.3 从 fork 源码构建（三个都实测通过）

下面三条路线都已在 arm64 上实际跑通，产物分别是 `rexyn-devtron/{kubectl,dex,devtron-utils}:fork`。前提是把三个 fork 仓库 clone 到 `$ROOT`。

#### （a）kubectl：用 fork 的 `k8s.io/kubectl` 模块编译 ✅

`kubectl` 的源码就是 `k8s.io/kubectl` 模块，fork 后位于 `$ROOT/kubectl`。官方入口 `kubernetes/cmd/kubectl/main.go` 只有几行，等价写法：

```go title="main.go"
package main

import (
	"os"

	"k8s.io/kubectl/pkg/cmd"
)

func main() {
	if err := cmd.NewDefaultKubectlCommand().Execute(); err != nil {
		os.Exit(1)
	}
}
```

```dockerfile title="kubectl-fork-build/Dockerfile"
# kubectl fork 的 master 要求 Go 1.27，不能用 1.25
FROM golang:1.27-alpine AS build-env
WORKDIR /src
ENV GOPROXY=https://proxy.golang.org,direct GOFLAGS=-mod=mod
RUN apk add --no-cache git
COPY . .
RUN go mod tidy && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /kubectl .

FROM alpine:3.21.2
RUN apk add --no-cache ca-certificates bash
COPY --from=build-env /kubectl /usr/local/bin/kubectl
ENTRYPOINT ["/usr/local/bin/kubectl"]
```

```go title="kubectl-fork-build/go.mod"
module kubectl-from-fork

go 1.23

require k8s.io/kubectl v0.0.0

// 关键：指向本地 fork，而不是从 proxy 拉
replace k8s.io/kubectl => ./kubectl-src
```

构建前把 fork 复制进上下文（Docker 不能引用上下文之外的目录）：

```bash
cd $ROOT && rm -rf /tmp/kubectl-fork-build && mkdir -p /tmp/kubectl-fork-build
cp -a kubectl /tmp/kubectl-fork-build/kubectl-src
# 再把上面的 main.go / go.mod / Dockerfile 写进 /tmp/kubectl-fork-build

docker build --platform linux/arm64 -t rexyn-devtron/kubectl:fork /tmp/kubectl-fork-build
docker run --rm rexyn-devtron/kubectl:fork version --client
# Client Version: v0.0.0-master+$Format:%H$   ← 未注入 ldflags，正常
```

:::info 三个注意点
1. **不要用 `go install k8s.io/kubernetes/cmd/kubectl@v1.31.14`**——`k8s.io/kubernetes` 的 go.mod 里有 `replace` 指令，Go 会直接拒绝：
   `The go.mod file ... contains one or more replace directives`。要么在克隆下来的 k8s 仓库里 `go build ./cmd/kubectl`（仓库作为 main module，replace 生效），要么用上面这种"模块 + main 包装"的写法。
2. **`kubernetes/kubectl` 仓库没有任何 version tag**，只能编 `master`（当前是 1.38-dev）。客户端比 1.37 服务端高一个 minor，在 k8s 支持的 skew 范围内；要与集群精确对齐，只能 fork `kubernetes/kubernetes` 后 checkout `v1.37.x`。
3. 不加 ldflags 时 `kubectl version` 会显示 `v0.0.0-master+$Format:%H$`。要显示正确版本，补上：
   `-ldflags "-X k8s.io/component-base/version.gitVersion=v1.31.14 -X k8s.io/component-base/version.gitCommit=xxx"`
:::

#### （b）dex：两种自建方式都实测过 ✅

先看事实：chart 把容器 command 覆盖成了 `/shared/authenticator rundex`，**镜像里的 `dex` 二进制和 `entrypoint.sh` 根本不会被执行**。这个镜像的实际作用只有一个——提供 **musl 运行时**（我们的 authenticator 是动态链接 `/lib/ld-musl-aarch64.so.1` 的）。

**方式一：编一个"真 dex"**（来自 `chinamcafee/dex`，适合将来绕开 authenticator）

```dockerfile title="dex/Dockerfile.local"
FROM golang:1.27-alpine AS build
RUN apk add --no-cache git
WORKDIR /src
# 必须先整体 COPY：go.mod 里 replace 了 ./api/v2，单独 download 会找不到
COPY . .
RUN go mod download
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /dex ./cmd/dex

FROM alpine:3.21.2
RUN apk add --no-cache ca-certificates && adduser -D -u 1001 dex
COPY --from=build /dex /usr/local/bin/dex
USER 1001
ENTRYPOINT ["/usr/local/bin/dex"]
```

```bash
cd $ROOT/dex
docker build --platform linux/arm64 -f Dockerfile.local -t rexyn-devtron/dex:fork .
docker run --rm rexyn-devtron/dex:fork version
# Dex Version: DEV / Go Version: go1.27.4 / Go OS/ARCH: linux arm64
```

:::warning 两个坑
1. dex 的 `go.mod` 要求 **Go 1.27**，用 1.25 会直接报 `requires go >= 1.27.0`。
2. `go.mod` 里有 `replace github.com/dexidp/dex/api/v2 => ./api/v2`，所以 `COPY go.mod go.sum` + `go mod download` 的"缓存层写法"会失败，必须先 `COPY . .`。
:::

**方式二：只提供 rootfs 的 Alpine 替身**（8MB，Devtron 的实际用法下完全够）

```dockerfile
FROM alpine:3.21.2
RUN apk add --no-cache ca-certificates && adduser -D -u 1001 devtron
USER 1001
```

```bash
docker build --platform linux/arm64 -t rexyn-devtron/dex:rootfs .
```

**实测**：把集群里 `argocd-dex-server` 的镜像换成 Alpine 替身后，Pod `1/1 Running`、`restarts=0`，容器内 `PID 1 = authenticator`，日志正常输出 `starting dex`；换成"真 dex"镜像同样 1/1 Running。

#### （c）devtron-utils：有源码，但**新部署不需要它** ⚠️

它的源码是 `devtron-labs/chart-versions-fix`，已 fork 为 `chinamcafee/chart-versions-fix`。这个镜像**把源码也打包进去了**（`/app/main.go`、`/app/.git`），可以直接从镜像里取出对照：

```bash
docker run --rm --entrypoint sh -v /tmp/du:/out rexyn-devtron/devtron-utils:dup-chart-repo-v1.1.0 \
  -c "cp -r /app/. /out/"
cat /tmp/du/main.go
```

它做两件事：

1. `cleanDuplicateAppStoreApplicationVersions`：按 `(name, version)` 找出重复的 chart 版本，把 `installed_app_versions` 重指到保留的那条，迁移 `latest` 标记，删除重复行；
2. `cleanDuplicateAppStoreCharts`：按 `(chart 名, repo)` 找出重复的 app_store 记录，保留版本数最多的那个，删除其余。

从 fork 构建（仓库自带 Dockerfile 用的是已过时的 `golang:1.20`，换成 1.25 多架构镜像）：

```dockerfile title="chart-versions-fix/Dockerfile.local"
FROM golang:1.25-alpine AS build
RUN apk add --no-cache git
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /chart-versions-fix

FROM alpine:3.21.2
RUN apk add --no-cache ca-certificates
COPY --from=build /chart-versions-fix /chart-versions-fix
ENTRYPOINT ["/chart-versions-fix"]
```

```bash
cd $ROOT/chart-versions-fix
docker build --platform linux/arm64 -f Dockerfile.local -t rexyn-devtron/devtron-utils:fork .
docker run --rm --entrypoint /chart-versions-fix rexyn-devtron/devtron-utils:fork
# error in fetching app store application version err dial tcp 127.0.0.1:5432: connect: connection refused
# ↑ 没给数据库，报这个错是正常的，说明二进制能启动
```

:::danger 新版本 / 未来 fork 工程：直接删掉，不要编它
它是**一次性的历史数据修复工具**，不是运行时组件。如果你从未部署过 2023 年前的老版本、以后只做全新部署：

- 空库上迁移 205 建唯一索引必然成功，它无事可做；
- 索引建好后 `chart-sync` 用 `ON CONFLICT DO NOTHING`，新重复不会再产生；
- 每次 `helm upgrade` 它都会空转一次，还多一个"必须能拉到"的镜像。

**删除方式**（只改 chart，不用重编镜像）：

```text
values.yaml:255                    删掉 duplicateChartImage
templates/migrator.yaml:116-139    删掉 name: clean-duplicate-chart 这个 initContainer
devtron-bom.yaml:170               同步删掉（样例配置，非渲染必需）
```

删完后镜像清单从 17 个 tag 降到 16 个，`devtron-utils` 彻底消失。
:::

:::caution 它本身还有三个缺陷（老库场景要注意）
1. 版本去重 key 是 `(name, version)`，**不含 `app_store_id`**；而 205 的唯一索引是 `(app_store_id, name, version)`。跨仓库的同名同版本 chart 会被误合并，已安装应用可能被悄悄改到另一个仓库。
2. 硬删 `app_store_application_version` 前只重指了 `installed_app_versions`，没处理 `chart_group_entry`、`app_store_version_values` 两个外键（均无 `ON DELETE CASCADE`），这些表有数据时会因外键失败。
3. 失败只 `return` 不报错，迁移会继续跑，然后在 205 建索引时炸掉——错误现场被推迟了。

如果确实要保留"老库升级"能力，更稳的做法是用一段幂等 SQL 代替它（放在 205 的 `CREATE UNIQUE INDEX` 之前，或用 ConfigMap + `postgres` 镜像的 `psql` 跑），核心是：按 `(app_store_id, name, version)` 选 `min(id)` 保留、重指三张引用表、再删除重复行。
:::

### 4.4 新部署要不要保留 `devtron-utils`？

一句话：**不要**。

| 判断条件 | 结论 |
| --- | --- |
| 从未部署过 2023 年前的老版本 | 不需要 |
| 以后只做"fork 源码 → 全新部署" | 不需要 |
| 需要恢复 2023 年前的老库 dump | 需要（否则迁移 205 建唯一索引会失败） |

保留它的代价是：多一个必须能拉到的镜像、每次升级空转一次、以及它自身的三个缺陷（见上）。删掉只需改 chart 三处，不必重编任何镜像。

如果你的 fork 想保留"老库可升级"的保险，又不想维护这个镜像，用 4.3(c) 末尾那种幂等 SQL 代替即可。

## 5. 最后的镜像盘点

```bash
docker images | grep rexyn-devtron | awk '{printf "%-55s %s\n", $1":"$2, $7$8}' | sort
```

期望 **16 个 tag**（13 个核心源码产物 + 3 个周边件；kubectl 若同时保留 `:local` 和 `:latest` 会多一个）。如果你按 4.3 从 fork 构建了后三个，把 `:local` / `:v2.30.2` 换成 `:fork` 即可：

- **全 fork 自建**：13 + `kubectl:fork` + `dex:fork` = **15 个**（`devtron-utils` 新部署不需要）；
- **保留老库升级能力**：再加 `devtron-utils:fork` = 16 个。

```text
rexyn-devtron/authenticator:local
rexyn-devtron/chart-sync:local
rexyn-devtron/ci-runner:local
rexyn-devtron/dashboard:local
rexyn-devtron/devtron-utils:dup-chart-repo-v1.1.0
rexyn-devtron/devtron:local
rexyn-devtron/dex:v2.30.2
rexyn-devtron/git-sensor:local
rexyn-devtron/image-scanner:local
rexyn-devtron/inception:local
rexyn-devtron/kubectl:local
rexyn-devtron/kubelink:local
rexyn-devtron/kubewatch:local
rexyn-devtron/lens:local
rexyn-devtron/migrator:local
rexyn-devtron/notifier:local
```
