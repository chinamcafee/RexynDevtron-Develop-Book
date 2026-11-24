---
id: verify
title: 验证清单
sidebar_position: 4
---

# 验证清单

部署完成后，按下面 6 项逐条验证。全部通过才算"跑起来了"。

## 1. 集群层

```bash
export KUBECONFIG=$HOME/.kube/k3s137.yaml
kubectl get nodes
kubectl get sc
```

- [ ] 3 个节点全部 `Ready`
- [ ] 存在 `local-path (default)` StorageClass

## 2. 工作负载层

```bash
kubectl -n devtroncd get pods --no-headers | awk '{print $3}' | sort | uniq -c
```

- [ ] 结果只有 `Running` 和 `Completed`，没有 `CrashLoopBackOff` / `Error` / `Pending`

逐个看关键组件：

```bash
kubectl -n devtroncd get deploy,sts
```

期望全部 `READY` 达标：

```text
deployment.apps/dashboard        1/1
deployment.apps/devtron          1/1
deployment.apps/inception        1/1
deployment.apps/kubelink         1/1
deployment.apps/kubewatch        1/1
deployment.apps/lens             1/1
deployment.apps/argocd-server    1/1
statefulset.apps/git-sensor      1/1
statefulset.apps/devtron-nats    1/1
statefulset.apps/postgresql      2/2
```

## 3. 镜像来源层（本项目最核心的验收点）

```bash
kubectl get pods -A -o jsonpath='{range .items[*]}{range .spec.containers[*]}{.image}{"\n"}{end}{range .spec.initContainers[*]}{.image}{"\n"}{end}{end}' \
  | sort | uniq -c | sort -rn
```

- [ ] 所有 `devtron / dashboard / kubelink / kubewatch / lens / git-sensor / chart-sync / inception / migrator / authenticator / dex` 的镜像都以 **`rexyn-devtron/`** 开头
- [ ] 只剩下 `postgres`、`nats`、`argocd`、`redis`、`workflow-controller`、各类 exporter 是外部镜像

实测结果：

```text
   4 quay.io/argoproj/argocd:v2.13.3
   4 rexyn-devtron/migrator:local
   3 rexyn-devtron/git-sensor:local
   3 rexyn-devtron/devtron:local
   2 quay.io/devtron/postgres:14.9
   2 rexyn-devtron/lens:local
   1 rexyn-devtron/kubelink:local
   1 rexyn-devtron/kubewatch:local
   1 rexyn-devtron/kubectl:local
   1 rexyn-devtron/inception:local
   ...
```

## 4. 服务层

```bash
kubectl -n devtroncd get svc devtron-service
curl -s -o /dev/null -w "dashboard=%{http_code}\n" http://192.168.139.95:30080/dashboard/
```

- [ ] Service 类型是 `NodePort`，端口 `80:30080`
- [ ] 返回 `200`

## 5. 认证层

```bash
PW=$(kubectl -n devtroncd get secret devtron-secret -o jsonpath='{.data.ADMIN_PASSWORD}' | base64 -d)

curl -s -X POST http://192.168.139.95:30080/orchestrator/api/v1/session \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$PW\"}"
```

- [ ] 返回 `{"code":200,"status":"OK","result":{"token":"eyJ..."}}`

:::warning 路径别写错
是 `/orchestrator/api/v1/session`。写成 `/orchestrator/user/login` 会得到 `401 UN-AUTHENTICATED`——这是路由不存在时的兜底响应，不是密码错。
:::

## 6. 业务层（带 Token 调真实接口）

```bash
TOKEN=$(curl -s -X POST http://192.168.139.95:30080/orchestrator/api/v1/session \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$PW\"}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['result']['token'])")

curl -s -o /dev/null -w "team=%{http_code}\n"   -H "token: $TOKEN" http://192.168.139.95:30080/orchestrator/team
curl -s -o /dev/null -w "global=%{http_code}\n" -H "token: $TOKEN" http://192.168.139.95:30080/orchestrator/global
```

- [ ] `team=200`（说明认证 + 数据库 + RBAC 链路通了）

## 7. UI 层

浏览器打开：

```text
http://192.168.139.95:30080/dashboard
```

依次确认：

- [ ] 出现登录页（左侧插画 + 右侧表单）
- [ ] 点 "Login as administrator"，输入 `admin` + 密码能进入
- [ ] 左侧导航出现 Application Management / Resource Browser / Security / Automation / Global Configuration / Stack Manager
- [ ] Resource Browser 能列出 `devtroncd` 命名空间下的 Pod

## 8. Installer 终态

```bash
kubectl -n devtroncd get installers installer-devtron -o jsonpath='{.status.sync.status}{"\n"}'
# Applied
```

- [ ] 状态从 `Downloaded` 变成 `Applied`

## 9. CD 链路（推荐做，最能说明"能用"）

前面 8 项只证明"装起来了"。要证明"能干活"，做一次真实同步：

```yaml title="smoke-app.yaml"
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: smoke-test
  namespace: devtroncd
spec:
  project: default
  source:
    repoURL: https://github.com/argoproj/argocd-example-apps.git
    path: guestbook
    targetRevision: HEAD
  destination:
    server: https://kubernetes.default.svc
    namespace: smoke-test
  syncPolicy:
    automated: { prune: true, selfHeal: true }
    syncOptions: [ CreateNamespace=true ]
```

```bash
kubectl apply -f smoke-app.yaml
sleep 45
kubectl -n devtroncd get application smoke-test \
  -o jsonpath='sync={.status.sync.status} health={.status.health.status}{"\n"}'
# sync=Synced health=Healthy

kubectl -n smoke-test get deploy --no-headers
# guestbook-ui   1/1   1   1
```

- [ ] `sync=Synced`、`health=Healthy`
- [ ] Deployment 就绪

清理：

```bash
kubectl -n devtroncd delete application smoke-test
kubectl delete ns smoke-test --wait=false
```

这一步同时验证了 Argo CD → apiserver → 目标命名空间的整条 CD 通路。如果这一步通过，Devtron 的核心能力就是可用的。

## 10. 事件回流（可选）

```bash
kubectl -n devtroncd logs deploy/kubewatch --tail=200 | grep -c APPLICATION_STATUS_UPDATE
```

- [ ] 输出 > 0，说明"集群事件 → NATS → Devtron"的回路是通的

## 一页版检查脚本

```bash title="verify.sh"
#!/bin/bash
export KUBECONFIG=$HOME/.kube/k3s137.yaml
NODE_IP=192.168.139.95

echo "1) nodes:        $(kubectl get nodes --no-headers | awk '{print $2}' | sort -u | tr '\n' ' ')"
echo "2) pods:         $(kubectl -n devtroncd get pods --no-headers | awk '{print $3}' | sort | uniq -c | tr '\n' ' ')"
echo "3) local images: $(kubectl get pods -A -o jsonpath='{range .items[*]}{range .spec.containers[*]}{.image}{"\n"}{end}{end}' | grep -c rexyn-devtron)"
echo "4) dashboard:    $(curl -s -o /dev/null -w '%{http_code}' http://$NODE_IP:30080/dashboard/)"

PW=$(kubectl -n devtroncd get secret devtron-secret -o jsonpath='{.data.ADMIN_PASSWORD}' | base64 -d)
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST http://$NODE_IP:30080/orchestrator/api/v1/session \
  -H 'Content-Type: application/json' -d "{\"username\":\"admin\",\"password\":\"$PW\"}")
echo "5) login api:    $CODE"
echo "6) installer:    $(kubectl -n devtroncd get installers installer-devtron -o jsonpath='{.status.sync.status}')"
```

全部符合预期即为通过。
