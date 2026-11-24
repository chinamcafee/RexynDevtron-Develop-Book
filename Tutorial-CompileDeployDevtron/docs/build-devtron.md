---
id: build-devtron
title: 编译 devtron 主程序
sidebar_position: 3
---

# 编译 devtron 主程序

这是最重的一个镜像：约 18000 个文件、2000+ 个 Go 包，**首次冷构建 25–35 分钟**。建议单独跑，不要和其他组件抢 CPU。

## 1. 直接构建

```bash
cd $ROOT/devtron
docker build --platform linux/arm64 -t rexyn-devtron/devtron:local .
```

想看进度（构建日志默认会刷屏，建议重定向）：

```bash
docker build --platform linux/arm64 -t rexyn-devtron/devtron:local . > /tmp/devtron-build.log 2>&1 &
tail -f /tmp/devtron-build.log
```

成功时最后几行是：

```text
#15 naming to docker.io/rexyn-devtron/devtron:local done
#15 DONE 5.0s
```

## 2. Dockerfile 拆解

```dockerfile
FROM golang:1.26.6 AS build-env

RUN apt update && apt install git gcc musl-dev make -y && \
    go install github.com/google/wire/cmd/wire@latest

WORKDIR /go/src/github.com/devtron-labs/devtron
ADD . /go/src/github.com/devtron-labs/devtron/
ADD ./vendor/github.com/Microsoft/ /go/src/github.com/devtron-labs/devtron/vendor/github.com/microsoft/

RUN GOOS=linux make build

FROM ubuntu:24.04@sha256:72297848456d...
COPY --from=build-env .../devtron .
COPY --from=build-env .../auth_model.conf .
COPY --from=build-env .../scripts/devtron-reference-helm-charts scripts/devtron-reference-helm-charts
COPY --from=build-env .../scripts/sql scripts/sql
COPY --from=build-env .../scripts/casbin scripts/casbin
```

几个关键点，出问题时按这个顺序排查：

| 步骤 | 作用 | 出错症状 |
| --- | --- | --- |
| `vendor/` 已随仓库提供 | Devtron 用 vendor 模式构建，不依赖网络拉 module | 若删掉 vendor 会非常慢甚至失败 |
| `ADD vendor/github.com/Microsoft/` | 大小写目录修正（macOS 不区分大小写，Linux 区分） | 不修会导致 import 失败 |
| `make build` → `wire` | 生成 `wire_gen.go` | 报 `wire: command not found` |
| 运行阶段 COPY `scripts/sql` | **迁移 SQL 就在镜像里**，migrator 用 `-path` 指向它 | 缺了会报 `no migration found` |
| `scripts/devtron-reference-helm-charts` | Devtron 部署应用时用的内置参考 chart | 缺了创建应用会失败 |

## 3. 关于 `ServerMode`

`Makefile` 里：

```makefile
SERVER_MODE_FULL= FULL
SERVER_MODE_EA_ONLY= EA_ONLY

build:
	$(ENVVAR) GOOS=$(GOOS) go build -o devtron \
		-ldflags="-X '...util.ServerMode=${SERVER_MODE_FULL}'"
```

- `FULL`：完整 OSS 能力（本仓库默认）
- `EA_ONLY`：企业版模式，开源代码里会跳过部分 OSS 逻辑

我们自己构建一律走 `FULL`，chart 里通过 `installer.modules={cicd}` 决定是否使用带 CI/CD 的镜像变体（`cicdImage`）。本书把 `image` 和 `cicdImage` 都指向同一个本地镜像，简化管理。

## 4. 验证镜像

```bash
docker run --rm --platform linux/arm64 --entrypoint sh rexyn-devtron/devtron:local -c \
  "ls -l /devtron /auth_model.conf /scripts/sql | head"
```

期望能看到：

```text
-rwxr-xr-x 1 devtron devtron  ...  /devtron
-rw-r--r-- 1 devtron devtron  ...  /auth_model.conf
/scripts/sql:  (目录，里面是 001_xxx.up.sql ...)
```

再确认二进制架构正确：

```bash
docker run --rm --platform linux/arm64 --entrypoint sh rexyn-devtron/devtron:local -c "file /devtron"
# 期望包含：ELF 64-bit LSB executable, ARM aarch64
```

## 5. 常见问题

**Q：构建很慢，能不能用 `-j`？**
Go 编译本身就会吃满多核；慢的根因是冷缓存。第二次构建（改一行代码）会快很多，因为 Docker 层缓存只失效最后几层。

**Q：报 `go: build constraints exclude all Go files`？**
多半是 `GOOS` 没传对。Dockerfile 里是 `GOOS=linux make build`，如果你在宿主机直接 `make build`（默认 `GOOS=darwin`），产物在容器里跑不起来。

**Q：镜像 500MB+，能瘦身吗？**
能，但没必要。基础镜像是 `ubuntu:24.04`（Devtron 需要 glibc + git + curl），换成 alpine 需要静态编译并调整脚本，收益不大且容易踩坑。

## 6. 顺手把 Chart 也准备好

部署用的 Helm Chart 就在这个仓库里：

```bash
ls $ROOT/devtron/charts/devtron
# Chart.yaml  values.yaml  templates/  crds/ ...
```

它有三个外部依赖（argo-cd / security / redis），仓库里不带，需要先拉：

```bash
cd $ROOT/devtron/charts/devtron
helm dependency build .
ls charts/
# argo-cd-7.7.15.tgz  redis-2.4.0.tgz  security-0.2.2.tgz
```

:::warning 必须先 dependency build
不执行这一步，`helm template` / `helm install` 会直接报：

```text
Error: found in Chart.yaml, but missing in charts/ directory: argo-cd, security, redis
```
:::
