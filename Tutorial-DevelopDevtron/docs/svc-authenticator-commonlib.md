---
id: svc-authenticator-commonlib
title: authenticator + common-lib｜认证与公共库
sidebar_position: 8
---

# authenticator + common-lib｜认证与公共库

这两个不是"独立服务"，但都会被别的组件引用，值得单独一章。

## 一、authenticator：Dex 的 Devtron 定制版

### 它是什么

Devtron 的 SSO 基于 [Dex](https://dexidp.io/)。`authenticator` 是 Devtron 维护的一个分支/封装，充当：

```text
浏览器 → devtron → authenticator（Dex）→ GitHub/Google/LDAP
```

在部署里，它以 **initContainer** 的形式出现在 `argocd-dex-server` 里：

```yaml
initContainers:
- name: authenticator
  image: rexyn-devtron/authenticator:local
  command: [/bin/sh, -c, "cp /authenticator /shared/ && ..."]
```

也就是说：**它把自己的二进制拷给 dex 容器用**。

### 为什么是这个形态

Dex 的官方镜像不支持 Devtron 需要的某些配置（比如从 ConfigMap 动态生成 connector）。Devtron 用 initContainer 把自己的 `authenticator` 二进制塞进 dex 容器，覆盖默认行为。

### 我要改它

| 需求 | 位置 |
| --- | --- |
| 支持新的 OIDC Provider | `pkg/` 下的 connector 实现 |
| 改登录页行为 | `pkg/` + 模板 |
| 本地账号登录 | 与 devtron 的 `pkg/auth` 配合 |

:::warning 改它风险较高
认证链路一旦断了，你就登不进 Devtron 了。改完先在本地用 `curl` 验证 `/orchestrator/api/v1/session` 还能通，再更新集群。
:::

## 二、common-lib：所有 Go 服务的公共底座

### 它提供什么

```text
common-lib/
├── pubsub/          # NATS 封装（发布/订阅/重试）
├── logger/          # zap 初始化
├── utils/           # 通用工具（时间、字符串、错误）
├── k8s/             # client-go 的通用封装
├── sql/             # GORM 通用配置
└── ...
```

### 为什么它很重要

它定义了**服务之间的通信契约**。比如 NATS 的 subject 命名、消息体结构、重试语义，都在这里。改它等于改所有服务的通信行为。

```bash
ls $ROOT/devtron-services/common-lib
```

### 版本同步的坑

因为每个服务都用 `replace` 指向 monorepo 里的**某个 commit**：

```go
replace github.com/devtron-labs/common-lib => github.com/devtron-labs/devtron-services/common-lib v0.0.0-20260923111547-63187c49cf1a
```

如果你只 pull 了 `devtron` 仓库，它的 `replace` 可能指向一个 `devtron-services` 里还不存在的 commit（或者反过来），导致：

```text
go: github.com/devtron-labs/common-lib@v0.0.0-2026...: reading ...: 404 Not Found
```

**解决办法**：把两个仓库拉到相近的时间点，或者手动把 `replace` 改成 `../devtron-services/common-lib`（本地路径）做联调：

```go
replace github.com/devtron-labs/common-lib => ../devtron-services/common-lib
```

这条本地 replace 是**二次开发时最实用的技巧**：改 `common-lib` 立刻对 `devtron`/`kubelink` 生效，不用提交、不用等 CI。

:::tip 别忘了改回来
本地路径 replace 不能提交（CI 上没有那个相对路径），联调完记得恢复成版本号。
:::

## 三、两者在运行时的位置

```text
┌─────────────┐
│ authenticator│  initContainer，给 dex 提供二进制
└─────────────┘

┌─────────────┐
│ common-lib   │  编译期链接进每个 Go 服务（不是独立进程）
└─────────────┘
```

所以 `kubectl get pods` 里看得到 authenticator（作为 init），但**永远看不到 common-lib**——它是代码，不是服务。

## 动手验证

```bash
# 1) 确认 authenticator 作为 initContainer 存在
kubectl -n devtroncd get pod -l app=argocd-dex-server -o jsonpath='{.items[0].spec.initContainers[*].image}'

# 2) 确认 dex 用的是我们拷进去的二进制
kubectl -n devtroncd exec deploy/argocd-dex-server -- ls -l /shared 2>/dev/null

# 3) 看 common-lib 被哪些服务引用
grep -l "common-lib" $ROOT/devtron-services/*/go.mod
```
