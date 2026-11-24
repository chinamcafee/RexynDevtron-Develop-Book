---
id: compat-matrix
title: 兼容性矩阵：换 k8s 版本会踩什么
sidebar_position: 4
---

# 兼容性矩阵：换 k8s 版本会踩什么

本书主线用 **k3s v1.37.2+k3s1**。但很多人手上的集群是 1.31、1.33 或者公司统一下发的某个版本，所以这一章把"同一套产物换版本"的差异列清楚。

## 实测结果

| k8s 版本 | k3s | 运行时 | 结果 | 关键差异 |
| --- | --- | --- | --- | --- |
| **1.37**（本书基准） | `v1.37.2+k3s1` | 2.3.7 | ✅ 全部通过 | 必须 `--flannel-backend=host-gw`；`master` 角色标签消失；自带 Gateway API CRD |
| **1.31** | `v1.31.14+k3s1` | 2.1.5 | ✅ 全部通过 | 默认 VXLAN 可用；有 `master` 角色标签；无 Gateway API |
| 1.32 – 1.36 | — | — | 未实测 | 按下面 checklist 自测 |

两套环境用的是**完全相同的镜像、values 和部署命令**，一行都没改。

## 1.31 vs 1.37 的逐项对比

### 部署侧

| 检查项 | 1.31 | 1.37 |
| --- | --- | --- |
| 节点 Ready | 3/3 | 3/3 |
| Deployment + StatefulSet | 15 | 15（逐项一致） |
| 迁移 Job | 4 个 Completed | 4 个 Completed |
| Pod 总状态 | 16 Running / 5 Completed | 17 Running / 5 Completed |
| Dashboard `/dashboard` | 200 | 200 |
| 登录 `/orchestrator/api/v1/session` | 200 | 200 |
| `installer` CR 状态 | Applied | Applied |
| team / cluster / env API | 200 | 200 |

> 17 vs 16 的差异来自 `argo/workflow-controller` 与 `app-sync-job` 的运行时机，不是组件差异。

### 网络侧

| 项 | 1.31 | 1.37 |
| --- | --- | --- |
| 默认 flannel 后端 | VXLAN，跨节点 TCP 正常 | **VXLAN：ICMP 通、TCP 不通** |
| 本书采用的配置 | 默认（VXLAN） | `host-gw` |
| 跨节点 TCP 验证 | `TCP_OK` | `TCP_OK`（host-gw 下） |

**这是唯一一个"不改就跑不起来"的差异**。判断方法：

```bash
# 在 node1 起一个 nc 服务端，在 node3 起客户端
kubectl exec cli -- sh -c "nc -z -w3 $SRV_IP 8080 && echo TCP_OK || echo TCP_FAIL"
```

`ping` 通但 `nc` 不通 → 换 host-gw。

### 平台细节

| 项 | 1.31 | 1.37 | 影响 |
| --- | --- | --- | --- |
| 节点角色标签 | `control-plane` + `master` | **只有 `control-plane`** | 用 `master` 做 nodeSelector 的自定义 workload 会 Pending；Devtron chart 不依赖它 |
| 内置 CRD | 无 | Gateway API CRD（`helm-install-gateway-api-crd` Job） | kubelink 会把 `gateway-api-crd` 当成一个 Helm release 缓存，日志可见；功能无影响 |
| Role 显示 | `control-plane,master` | `control-plane` | 只影响 `kubectl get nodes` 的显示 |
| containerd | 2.1.5 | 2.3.7 | 无感知 |

## 功能验证：1.37 上的 CD 链路

"Pod 起来了"不等于"能干活"。在 1.37 上额外做了一次真实同步：

```yaml title="smoke-app.yaml"
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: smoke-137
  namespace: devtroncd
spec:
  project: default
  source:
    repoURL: https://github.com/argoproj/argocd-example-apps.git
    path: guestbook
    targetRevision: HEAD
  destination:
    server: https://kubernetes.default.svc
    namespace: smoke-137
  syncPolicy:
    automated: { prune: true, selfHeal: true }
    syncOptions: [ CreateNamespace=true ]
```

```bash
kubectl apply -f smoke-app.yaml
kubectl -n devtroncd get application smoke-137 -o jsonpath='sync={.status.sync.status} health={.status.health.status}{"\n"}'
# sync=Synced health=Healthy
kubectl -n smoke-137 get deploy --no-headers
# guestbook-ui   1/1   1   1
```

这条链路串起了：Argo CD（v2.13.3）→ 1.37 apiserver → 目标 namespace，证明**CD 引擎在 1.37 上可用**。

再用 kubewatch 确认事件回流：

```bash
kubectl -n devtroncd logs deploy/kubewatch --tail=200 | grep -i "APPLICATION_STATUS_UPDATE" | tail -1
```

能看到 `APPLICATION_STATUS_UPDATE` 的发布记录，说明"集群事件 → NATS → Devtron"的回路也通。

## 把本书流程降到 1.31

只有三处要改：

### 1. 安装命令换版本

```bash
orb -m k3s131-1 sh -c 'curl -sfL https://get.k3s.io | \
  sudo INSTALL_K3S_VERSION=v1.31.14+k3s1 sh -s - server \
    --write-kubeconfig-mode 644 \
    --node-ip <IP1> --advertise-address <IP1> \
    --tls-san <IP1> --tls-san k3s131-1 \
    --flannel-iface eth0 \
    --disable traefik'
```

**不要加 `--flannel-backend=host-gw`**——1.31 下默认 VXLAN 是正常工作的，加不加都能跑（加了也没问题，但没必要）。

### 2. kubeconfig 文件名

```bash
... > ~/.kube/k3s131.yaml
export KUBECONFIG=$HOME/.kube/k3s131.yaml
```

### 3. 其余全部不变

镜像导入、`helm install`、values 覆盖、NodePort 30080——一条都不用改。

## 换到新版本时的自测 checklist

引入 1.32~1.36 等未实测版本时，按这个顺序验证（每步都有明确的通过标准）：

```text
[ ] 1. kubectl get nodes            → 3/3 Ready
[ ] 2. 跨节点 TCP（nc 测试）         → TCP_OK
[ ] 3. kubectl get sc               → local-path 是 default
[ ] 4. 4 个 migrate Job             → 全部 Completed
[ ] 5. kubectl get pods -n devtroncd → 无 CrashLoop / Pending
[ ] 6. /dashboard                    → 200
[ ] 7. 登录 API                      → 200 + token
[ ] 8. installer                    → Applied
[ ] 9. Argo smoke app               → Synced + Healthy
[ ] 10. kubewatch 事件               → 有 APPLICATION_STATUS_UPDATE
```

前 3 条不过，后面的都不用看——一定是集群层的问题。

## 已知的"看起来像故障但不是"的三件事

换版本时容易误判，先排除：

| 现象 | 真相 |
| --- | --- |
| `/orchestrator/k8s/capacity/node?clusterId=1` 返回 500 `resource name may not be empty` | **1.31 和 1.37 都一样**，是 Devtron 自身接口的问题，与集群版本无关 |
| 刚部署时 `kubelink`/`lens`/`kubewatch` 连续 CrashLoopBackOff | postgres 没起来，等迁移 Job 完成会自愈 |
| `kubectl get nodes` 里 control-plane 只有 1 个且没有 master 角色 | 1.37 的正常表现，不是集群坏了 |

## 一句话结论

> **Devtron 2.2.1 对 k8s 1.31 → 1.37 是向前兼容的**：镜像、Chart、values 全都不用改；唯一必须调整的是 k3s 1.37 在 OrbStack 下的 flannel 后端（`host-gw`）。

如果你的环境不是 OrbStack（比如云上 VM），这条也可能不适用——先在目标环境跑一次第 2 步的 TCP 测试再决定。
