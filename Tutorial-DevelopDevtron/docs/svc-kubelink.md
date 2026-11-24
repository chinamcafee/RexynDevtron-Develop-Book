---
id: svc-kubelink
title: kubelink｜与集群对话的 gRPC 服务
sidebar_position: 3
---

# kubelink｜与集群对话的 gRPC 服务

## 它是什么

`kubelink` 是 devtron 的"集群代理"。devtron 想读集群里的资源、渲染 Helm、看 Pod 状态，都通过它。

```text
devtron ──gRPC :50051──► kubelink ──client-go──► kube-apiserver
```

**为什么不让 devtron 直接连集群？**

| 原因 | 说明 |
| --- | --- |
| 隔离 | devtron 只需要"业务权限"，真正碰集群的凭证只在一个组件里 |
| 可缓存 | kubelink 用 informer 缓存资源，减少 apiserver 压力 |
| 可水平扩展 | 多副本 kubelink 可以分担大量资源读取 |

## 代码结构

```text
kubelink/
├── Main.go              # gRPC server 启动
├── App.go / Wire.go     # 装配
├── api/                 # gRPC 接口实现
├── pkg/
│   ├── cluster/         # 集群连接管理（kubeconfig、token）
│   ├── k8sInformer/     # informer 缓存
│   ├── helmClient/      # Helm 渲染与操作
│   ├── service/         # 业务逻辑
│   ├── remoteConnection/# 远程集群连接
│   ├── cache/           # 本地缓存
│   └── asyncProvider/   # NATS 异步
├── grpc/                # gRPC 服务端封装
├── converter/           # k8s 对象 → DTO
└── vendor/
```

## 关键能力

| 能力 | 入口 | 说明 |
| --- | --- | --- |
| 集群注册与连接 | `pkg/cluster` | 支持 in-cluster 和外部 kubeconfig |
| 资源读取 | `pkg/k8sInformer` + `api/` | Pod/Deployment/Service 等 |
| Helm 渲染 | `pkg/helmClient` | 把 chart + values 变成 manifest |
| Helm release 管理 | `pkg/helmClient` | install/upgrade/uninstall |
| 应用树 | `pkg/service` | 把 Deployment→RS→Pod 组成树 |

## 一次"查看应用 Pod"的调用

```text
dashboard → devtron GET /orchestrator/app/.../pods
   └── devtron → kubelink.GetPodList (gRPC)
         └── kubelink → informer cache 命中 → 立即返回
                        （未命中则查 apiserver）
```

informer 的意义：Devtron 的 UI 会频繁刷新资源列表，如果每次都打 apiserver，几百个应用就会把集群打挂。

## 我要改它，从哪下手

| 需求 | 位置 |
| --- | --- |
| 支持新的资源类型展示 | `api/` + `pkg/service` + `converter/` |
| 改 Helm 渲染行为（如固定某个 value） | `pkg/helmClient/` |
| 支持新的集群认证方式（OIDC/exec plugin） | `pkg/cluster/` |
| 提高大集群性能 | `pkg/k8sInformer` 的 resync 周期、缓存策略 |

:::warning 改这里要重新编译两个镜像
kubelink 的 gRPC 接口变了，devtron 侧的 client 也要改（`client/grpc/kubelink`）。两个仓库都要重新构建、同时更新，否则会 `unknown method`。
:::

## 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| UI 上 Pod 列表一直转圈 | kubelink 连不上集群 / 超时 | `kubectl logs deploy/kubelink` 找 `dial tcp` |
| `context deadline exceeded` | apiserver 慢 / 集群大 | 调大超时，或看 informer 是否 OOM |
| 部署卡在 "Rendering" | Helm 渲染失败 | 日志里找 `helm template failed` |

## 动手验证

```bash
# 1) 看端口
kubectl -n devtroncd get svc kubelink-service-headless -o wide

# 2) 看它连了哪些集群
kubectl -n devtroncd logs deploy/kubelink --tail=100 | grep -i "cluster\|kubeconfig"

# 3) 看 informer 缓存了哪些资源
kubectl -n devtroncd logs deploy/kubelink --tail=200 | grep -i "informer\|watch"

# 4) 看内存占用（informer 吃内存，大集群要关注）
kubectl top pod -n devtroncd | grep kubelink
```
