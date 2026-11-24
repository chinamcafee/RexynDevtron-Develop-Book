---
id: troubleshooting
title: 踩坑手册
sidebar_position: 1
---

# 踩坑手册

这一节记录的是**本次真实构建/部署过程中实际遇到的每一个坑**，以及最终的解决办法。按"集群层 → 构建层 → 部署层"排序。

## 坑 A：k3s 1.37 默认 flannel 下 Pod 能 ping 通但 TCP 不通

```text
$ kubectl exec cli -- nc -z -w3 10.42.1.2 8080
TCP_FAIL
# 但 ping 是通的
```

**原因**：k3s 1.37（containerd 2.3.7）在 OrbStack 的虚拟网络里，默认的 VXLAN 后端会出现"ICMP 通、TCP 丢包"的现象。TCP 握手的 SYN 包过不去，所以所有服务间调用、DNS 查询全部超时。

表现上很像"集群坏了"：CoreDNS 起不来、服务之间连不上、`kubectl exec` 偶尔能进但网络不通。

**解决**：server 安装时指定 `host-gw`：

```bash
--flannel-backend=host-gw
```

:::warning 只能重装
`--flannel-backend` 是集群级参数，装完再改用 `--flannel-conf` 覆盖容易出问题。**发现 TCP 不通就直接重装**，比折腾配置快。
:::

**验证**：

```bash
kubectl run srv --image=busybox:1.36 --restart=Never \
  --overrides='{"spec":{"nodeName":"k3s137-3"}}' --command -- sh -c 'nc -ll -p 8080 -e echo hi'
kubectl run cli --image=busybox:1.36 --restart=Never \
  --overrides='{"spec":{"nodeName":"k3s137-1"}}' --command -- sleep 60
SRV=$(kubectl get pod srv -o jsonpath='{.status.podIP}')
kubectl exec cli -- sh -c "nc -z -w3 $SRV 8080 && echo TCP_OK || echo TCP_FAIL"
```

## 坑 B：1.37 上 `node-role.kubernetes.io/master` 标签没了

```bash
kubectl get node k3s137-1 -o jsonpath='{.metadata.labels}' | tr ',' '\n' | grep role
# node-role.kubernetes.io/control-plane
```

**影响**：任何 `nodeSelector: {node-role.kubernetes.io/master: ""}` 的 workload 会永远 Pending。Devtron 的 chart 不用这个标签，所以不受影响；但你自己的 DaemonSet / 监控组件可能踩到。

**解决**：改用 `node-role.kubernetes.io/control-plane`，或者直接给节点打上 master 标签：

```bash
kubectl label node k3s137-1 node-role.kubernetes.io/master=""
```

## 坑 C：k3s 1.37 自带 Gateway API CRD，kubelink 会多缓存一个 release

```text
kubectl -n kube-system get jobs | grep gateway
# helm-install-gateway-api-crd-xxxxx   Completed
```

kubelink 的 Helm release informer 会把 `gateway-api-crd` 当成一个已安装的 chart 记录到缓存里：

```text
RELEASE_ADD_INFORMER: app detail found  {"appDetail":"appId:\"1|kube-system|gateway-api-crd\" ..."}
```

**这不是故障**，也不需要处理。唯一影响是 Devtron 的 Helm 应用列表里可能多出一条 `gateway-api-crd`。

## 坑 D：首次滚动更新时看到"两个 devtron Pod"

```text
devtron-66f4859685-f9754   1/1   Running
devtron-86dfc45968-7djdm   0/1   Running
kubelink 2/1 (READY 列显示 2/1)
```

**原因**：chart 给这些 Deployment 设了 `minReadySeconds: 60`。新 Pod 就绪后要再等 60 秒才计入 `available`，在此期间旧 ReplicaSet 不会缩容，于是短暂出现两个 Pod，`kubectl get deploy` 显示 `AVAILABLE 0`。

**解决**：等 1–2 分钟自动收敛，不用干预。判断是否卡死：

```bash
kubectl -n devtroncd describe deploy devtron | grep -A3 Conditions
# 正常会从 MinimumReplicasUnavailable 变成 Available
```

## 坑 1：`orbctl delete` 挂住不动

```text
$ orbctl delete sealos-arm-1
（无输出，几十秒后进程被 SIGTERM 杀掉）
```

**原因**：`delete` 默认要求交互确认，在非 TTY 环境里等不到输入。

**解决**：加 `-f`。

```bash
orbctl delete -f k3s137-1 k3s137-2 k3s137-3
```

## 坑 2：`helm upgrade` 报字段所有权冲突

```text
Error: UPGRADE FAILED: conflict occurred while applying object
devtroncd/devtron-service /v1, Kind=Service: Apply failed with 1 conflict:
conflict with "kubectl-patch" using v1: .spec.type
```

**原因**：你之前用 `kubectl patch` 改过 Service（LoadBalancer → NodePort），Helm 用 server-side apply 时就抢不到这个字段。

**解决**：把字段所有权还给 helm，再升级。

```bash
# 1) 用 helm 作为 field-manager 强制接管
kubectl apply --server-side --force-conflicts --field-manager=helm -f - <<'EOF'
apiVersion: v1
kind: Service
metadata:
  name: devtron-service
  namespace: devtroncd
spec:
  type: LoadBalancer
  ports:
  - name: devtron
    port: 80
    protocol: TCP
    targetPort: devtron
    nodePort: 32466
  selector:
    app: devtron
EOF

# 2) 正常 upgrade
helm upgrade devtron devtron/devtron-operator -n devtroncd --reuse-values ...

# 3) 升完再改回 NodePort 30080
```

## 坑 3：`fholzer/nginx-brotli:v1.26.2` 不存在

```text
ERROR: failed to build: failed to solve: fholzer/nginx-brotli:v1.26.2: not found
```

**解决**：改用 `v1.31.8`（仍在维护，支持 arm64），通过 `Dockerfile.local` 承载改动。

```bash
sed 's#v1.26.2#v1.31.8#' Dockerfile > Dockerfile.local
docker build -f Dockerfile.local -t rexyn-devtron/dashboard:local .
```

## 坑 4：迁移 Job 全部 `Exit Code: 127`

```text
postgresql-migrate-devtron-xxx   0/1   Error   127
日志：/bin/sh: migrate: not found
```

**原因**：`migrator` 仓库的 Dockerfile 编的是自定义程序，而 chart 调用 `migrate`（golang-migrate CLI）。

**解决**：用 `Dockerfile.local` 安装官方 CLI。

```dockerfile
RUN go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@v4.16.2
```

详见[编译周边组件](./build-misc#3-migrator必须本地改造)。

## 坑 5：`rexyn-devtron/kubectl:latest` 拉不到

```text
Failed to pull image "rexyn-devtron/kubectl:latest": pull access denied
```

**原因**：`:latest` 的默认 `imagePullPolicy` 是 `Always`，而本地镜像不在任何 registry 里。

**解决**：换成非 `latest` 的 tag。

```bash
docker tag rexyn-devtron/kubectl:latest rexyn-devtron/kubectl:local
# values 里：components.migrator.kubectlImage: "kubectl:local"
```

## 坑 6：前 3 分钟满屏 CrashLoopBackOff

```text
kubelink   CrashLoopBackOff
lens       CrashLoopBackOff
panic: dial tcp 10.43.2.153:5432: connect: connection refused
```

**原因**：postgres 还没就绪，这些服务连库失败就 panic 退出。

**解决**：**什么都不用做**。等 `postgresql-migrate-*` 变成 `Completed`，它们会自己起来。如果 10 分钟后还在 CrashLoop，再去看 postgres 的日志。

## 坑 7：`helm template` 报缺依赖

```text
Error: found in Chart.yaml, but missing in charts/ directory: argo-cd, security, redis
```

**解决**：

```bash
cd $ROOT/devtron/charts/devtron
helm dependency build .
```

## 坑 8：dashboard 构建时 `yarn install` 报锁文件被改

```text
error Your lockfile needs to be updated, but yarn was run with `--immutable`.
```

**原因**：改过 `package.json`（比如加了 `resolutions`）但没更新 `yarn.lock`。

**解决**：本地先跑一次 `yarn install` 生成新 lock，或构建时去掉 `--immutable`。

## 坑 9：Docker Hub 间歇性 `EOF`

```text
failed to fetch anonymous token: Get "https://auth.docker.io/token?...": EOF
```

**原因**：Docker Hub 限流/网络抖动。`image-scanner`、`notifier` 各失败过一次。

**解决**：直接重试。本书的做法是失败后单独再跑一次：

```bash
docker build --platform linux/arm64 -t rexyn-devtron/image-scanner:local $ROOT/devtron-services/image-scanner
```

## 坑 10：Chrome 打不开 `192.168.139.x`

```text
ERR_ADDRESS_UNREACHABLE
```

**原因**：macOS 的"本地网络"权限 + Chrome 自带 DoH，导致 Chrome 访问私有网段失败（curl / Safari 正常）。

**解决**：任选其一

```bash
# A. 用端口转发，然后访问 http://localhost:8000
kubectl -n devtroncd port-forward svc/devtron-service 8000:80

# B. 给 Chrome 开"本地网络"权限（系统设置 → 隐私与安全性 → 本地网络）
# C. 用 Safari
```

## 坑 11：`devtron-service` 一直 `EXTERNAL-IP: <pending>`

**原因**：chart 声明的是 `LoadBalancer`，k3s 的 servicelb 在这个组合下没有分配外部 IP（也没创建 svclb DaemonSet）。

**解决**：改 NodePort（本文做法），或装 MetalLB。

## 坑 12：登录接口 401，但密码是对的

**原因**：用了 `/orchestrator/user/login`。

**解决**：用 `/orchestrator/api/v1/session`。

```bash
curl -X POST http://<ip>:30080/orchestrator/api/v1/session \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<ADMIN_PASSWORD>"}'
```

## 坑 13：`ctr import` 后 kubelet 说镜像不存在

**原因**：忘了 `-n k8s.io`，镜像进了 default namespace。

**解决**：

```bash
orb -m <node> sudo k3s ctr -n k8s.io images ls -q | grep rexyn-devtron
```

如果没有输出，重新导入并带上 namespace。

## 坑 14：inception 日志刷云厂商探测超时

```text
Get "http://169.254.169.254/latest/dynamic/instance-identity/document": i/o timeout
```

**原因**：inception 启动时会探测 AWS/GCP/阿里云元数据服务，本地环境当然连不上。

**解决**：忽略。不影响任何功能。

## 快速自检表

| 症状 | 先看这里 |
| --- | --- |
| Pod 起不来 | `kubectl -n devtroncd describe pod <name>` 看 Events |
| 镜像拉不到 | `kubectl -n devtroncd describe pod` 里的 `Failed to pull`，确认 tag 与 `imagePullPolicy` |
| 服务 panic 连库失败 | 等 postgres 就绪；`kubectl logs postgresql-postgresql-0 -c postgres` |
| 页面能开但 401 | 检查 `/orchestrator/api/v1/session` 路径 + 密码来源 |
| 构建慢 | 正常；第二次增量构建会快很多 |
| 磁盘爆 | `docker builder prune -f`、`docker image prune -f` |
