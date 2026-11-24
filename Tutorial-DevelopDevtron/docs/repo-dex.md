---
id: repo-dex
title: dex｜只提供 rootfs 的 SSO 门面
sidebar_position: 6
---

# dex｜只提供 rootfs 的 SSO 门面

## 它是什么

`chinamcafee/dex` fork 自 `dexidp/dex`，是一个 Apache-2.0 的 OIDC / OAuth2 Provider。它本身能独立提供登录页、连接 LDAP/GitHub/Google 等上游 IdP。

但在 **Devtron 的用法里，它几乎"不干活"**：

```yaml
# chart 对 argocd-dex-server 的 dex 容器做了 command 覆盖
command: ["/shared/authenticator", "rundex"]
```

也就是说，容器里 PID 1 是 **Devtron 自己编译的 `authenticator`**（来自 `devtron-services/authenticator`），dex 镜像里的 `/usr/local/bin/dex` 和 `entrypoint.sh` 根本不会被执行。

它唯一的作用是提供 **musl 运行时**：authenticator 是动态链接 `/lib/ld-musl-aarch64.so.1` 的，需要一个 Alpine 风格的 rootfs。

```text
dex 镜像 = Alpine rootfs + ca-certificates + (没人执行的 dex 二进制)
```

## 代码结构

```text
dex/
├── cmd/dex/            main：读 config、起 HTTP/gRPC 服务
├── server/             OIDC 端点、登录流程、token 签发
├── storage/            Kubernetes CRD / SQL / memory 三种存储
├── connector/          GitHub、LDAP、OIDC、SAML 等上游连接器
├── web/                go:embed 的前端资源（static/templates/themes）
└── api/v2/             独立的 gRPC API 子模块（go.mod 里 replace 到 ./api/v2）
```

关键点：`web/` 下有真实的 `static/` 和 `templates/`，所以 `go build ./cmd/dex` 可以直接编过，不需要先跑 npm。

## 协作边界

```text
浏览器 / Argo CD / Devtron
        │  OIDC (5556)
        ▼
argocd-dex-server Pod
  └── authenticator rundex  ← 真正干活的二进制（devtron-services/authenticator）
        └── 依赖 dex 镜像提供的 musl rootfs
```

- **本地 admin 登录不走这里**：`POST /orchestrator/api/v1/session` 直接查 `users` 表。
- **SSO 登录才走这里**：GitHub/Google/LDAP 等配置存在 `devtron-cm` 的 SSO 相关字段里。
- dex 挂了不会影响平台主流程，只会让 SSO 登录失败；`argocd-dex-server` 不在关键路径上。

## 我要改它

| 需求 | 做法 |
| --- | --- |
| 换 SSO 提供商 | 优先改 Devtron 的 SSO 配置，不动镜像 |
| 自定义登录页 | 改 `web/templates`，重新 `go build ./cmd/dex` |
| 加 connector | 在 `connector/` 下实现接口，注册到 `cmd/dex` |
| 只想要 rootfs | 用 `alpine:3.21.2 + ca-certificates` 替身即可，8MB |

本地构建（`go.mod` 要求 Go 1.27）：

```dockerfile
FROM golang:1.27-alpine AS build
WORKDIR /src
COPY . .                 # 必须先整体 COPY：go.mod replace 了 ./api/v2
RUN go mod download && CGO_ENABLED=0 go build -o /dex ./cmd/dex
```

:::warning 不要把 dex 当成 Devtron 的认证服务
Devtron 的用户、角色、token 都在 `devtron` 主程序和 `users` 表里。dex 只负责"把外部身份换成 OIDC token"，改认证逻辑应该去 `devtron-services/authenticator` 或 `devtron/pkg/auth`，不是这里。
:::

## 动手验证

```bash
# 1) 看容器里真正跑的是什么
kubectl -n devtroncd get deploy argocd-dex-server -o jsonpath='{.spec.template.spec.containers[0].command}{"\n"}'
# ["/shared/authenticator","rundex"]

kubectl -n devtroncd exec deploy/argocd-dex-server -- ps -o pid,comm
# PID 1 = authenticator

# 2) 验证 fork 编出来的 dex
docker run --rm rexyn-devtron/dex:fork version
# Dex Version: DEV / linux arm64

# 3) SSO 端点是否在听
kubectl -n devtroncd exec deploy/argocd-dex-server -- wget -qO- http://127.0.0.1:5556/dex/.well-known/openid-configuration | head -c 200
```
