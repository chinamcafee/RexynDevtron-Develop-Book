---
id: deploy
title: Helm 部署本地版
sidebar_position: 3
---

# Helm 部署本地版

## 1. 准备 values 覆盖文件

把下面内容保存为 `$ROOT/local-values.yaml`。原理：chart 的 `common.image` 会优先用组件级 `registry`，所以只改 `registry` 就能把某个组件指向本地镜像，**第三方镜像（postgres/nats/argocd）仍然走上游**。

```yaml title="$ROOT/local-values.yaml"
global:
  containerRegistry: quay.io/devtron   # 第三方镜像仍来自上游

installer:
  registry: rexyn-devtron
  image: inception
  tag: local

components:
  dashboard:
    registry: rexyn-devtron
    image: "dashboard:local"
  devtron:
    registry: rexyn-devtron
    image: "devtron:local"
    cicdImage: "devtron:local"
  ciRunner:
    registry: rexyn-devtron
    image: "ci-runner:local"
  argocdDexServer:
    registry: rexyn-devtron
    image: "dex:v2.30.2"
    initContainer:
      authenticator: "authenticator:local"
  kubelink:
    registry: rexyn-devtron
    image: "kubelink:local"
  kubewatch:
    registry: rexyn-devtron
    image: "kubewatch:local"
  gitsensor:
    registry: rexyn-devtron
    image: "git-sensor:local"
  lens:
    registry: rexyn-devtron
    image: "lens:local"
  migrator:
    registry: rexyn-devtron
    image: "migrator:local"
    kubectlImage: "kubectl:local"
  chartSync:
    registry: rexyn-devtron
    image: "chart-sync:local"
```

:::note 全 fork 自建的写法
如果按[编译周边组件](./build-misc) 4.3 把三个周边镜像也从 fork 编出来，只需改两行：

```yaml
  argocdDexServer:
    image: "dex:fork"
  migrator:
    kubectlImage: "kubectl:fork"
```

`devtron-utils`（`duplicateChartImage`）对全新部署不需要，可以从 chart 里直接删掉那个 initContainer，见 4.4。
:::

:::tip 一行验证
渲染一遍，确认所有 devtron 组件都指向 `rexyn-devtron/`：

```bash
cd $ROOT/devtron
helm template devtron ./charts/devtron -n devtroncd \
  -f ../local-values.yaml \
  --set 'installer.modules={cicd}' \
  --set 'argo-cd.enabled=true' \
  | grep -oE "image: [^ ]+" | sed 's/image: //' | sort -u
```

输出里应该只有 `quay.io/argoproj/*`、`quay.io/devtron/{postgres,nats*}`、`public.ecr.aws/*` 这几类还是外部地址。
:::

## 2. 安装

```bash
export KUBECONFIG=$HOME/.kube/k3s137.yaml
cd $ROOT/devtron

helm upgrade --install devtron ./charts/devtron -n devtroncd --create-namespace \
  -f $ROOT/local-values.yaml \
  --set 'installer.modules={cicd}' \
  --set 'argo-cd.enabled=true' \
  --timeout 20m
```

两个 `--set` 的含义：

| 参数 | 作用 |
| --- | --- |
| `installer.modules={cicd}` | 启用 CI/CD 模块（决定 devtron 用 `cicdImage`、创建 gitsensor/grafana 等） |
| `argo-cd.enabled=true` | 部署 Argo CD 子 chart。**不装它，Devtron 的 CD 功能是不可用的**——内部固定访问 `argocd-server.devtroncd` |

## 3. 观察启动

```bash
kubectl -n devtroncd get pods -w
```

前三分钟大概率长这样（正常，见[架构](./architecture#数据库与初始化顺序)）：

```text
postgresql-postgresql-0            0/2  Init:0/1
postgresql-migrate-devtron-xxx     0/1  Init:0/2
kubelink-xxx                       0/1  CrashLoopBackOff
lens-xxx                           0/1  CrashLoopBackOff
```

等到迁移 Job 全部 `Completed`，各服务会自己恢复：

```bash
kubectl -n devtroncd get pods --no-headers | awk '{print $3}' | sort | uniq -c
```

期望：

```text
      5 Completed
     14 Running
```

## 4. 暴露服务（NodePort 30080）

chart 默认把 `devtron-service` 建成 `LoadBalancer`，但 k3s 的 servicelb 在这个场景下没分配外部 IP（`EXTERNAL-IP` 一直 `<pending>`）。直接改成固定的 NodePort：

```bash
PORTNAME=$(kubectl -n devtroncd get svc devtron-service -o jsonpath='{.spec.ports[0].name}')

kubectl -n devtroncd patch svc devtron-service -p "{
  \"spec\": {
    \"type\": \"NodePort\",
    \"ports\": [{
      \"name\": \"$PORTNAME\",
      \"port\": 80,
      \"protocol\": \"TCP\",
      \"targetPort\": \"$PORTNAME\",
      \"nodePort\": 30080
    }]
  }
}"
```

访问地址：`http://<任意节点IP>:30080/dashboard`

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://192.168.139.95:30080/dashboard/
# 200
```

## 5. 拿到管理员密码

```bash
kubectl -n devtroncd get secret devtron-secret -o jsonpath='{.data.ADMIN_PASSWORD}' | base64 -d; echo
```

登录：用户名固定 `admin`，密码为上一条命令的输出。

## 6. 关于 inception 会不会覆盖你的镜像

很多人担心：inception 是 Operator，它会不会去 GitHub 拉官方清单把镜像改回 `quay.io`？

答案是**不会**。看一下它要执行的安装脚本内容：

```bash
curl -s https://raw.githubusercontent.com/devtron-labs/devtron/v2.2.1/manifests/installation-script
```

```text
LTAG="v2.2.1";
REPO_RAW_URL="https://raw.githubusercontent.com/devtron-labs/devtron/";
shebang = `#!/bin/bash`;
sleep50 = shebang + `sleep 50`;
ignore = shellScript sleep50;
log("executed devtron setup installation");
```

它只是空转 + 打日志。真正创建资源的是 Helm chart，所以你的镜像覆盖是安全的。

## 7. 常用运维命令

```bash
# 看组件状态
kubectl -n devtroncd get deploy,sts

# 看 installer 状态（Applied 表示完成）
kubectl -n devtroncd get installers installer-devtron -o jsonpath='{.status.sync.status}{"\n"}'

# 重启某个组件（改完镜像后）
kubectl -n devtroncd rollout restart deploy/devtron

# 看某个组件日志
kubectl -n devtroncd logs deploy/devtron --tail=100 -f

# 端口转发（不想用 NodePort 时）
kubectl -n devtroncd port-forward svc/devtron-service 8000:80
```
