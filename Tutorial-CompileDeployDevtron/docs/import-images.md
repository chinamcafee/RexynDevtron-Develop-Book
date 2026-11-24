---
id: import-images
title: 把本地镜像送进集群
sidebar_position: 2
---

# 把本地镜像送进集群

本地 `docker build` 出来的镜像只在 OrbStack 的 Docker daemon 里，**k3s 的 containerd 看不到**。有三种做法：

| 方案 | 优点 | 缺点 | 本书选择 |
| --- | --- | --- | --- |
| 集群内部署 registry | 标准、可共享 | 需要给 Docker 配 insecure-registry（要重启 daemon），或给 registry 配 TLS | ✗ |
| 每台节点 `ctr import` | 零依赖、确定性强 | 镜像要传到 3 台节点 | ✓ |
| 只用一台节点 + nodeSelector | 传得快 | 失去多节点调度能力 | ✗ |

## 1. 为什么放弃内置 registry

实践中发现两个卡点：

1. `docker push` 到 `192.168.139.95:5000` 会报 `server gave HTTP response to HTTPS client`；
2. 修它需要改 `~/.orbstack/config/docker.json` 的 `insecure-registries` 并**重启 Docker engine**，而 OrbStack CLI 没有提供单独重启 Docker 的命令（`orbctl config add docker.insecure_registries` 也不支持）。

`ctr import` 没有这些副作用，且天然满足"镜像已在节点上、不需要联网"的诉求。

## 2. 导入脚本

```bash title="/tmp/import-images.sh"
#!/bin/bash
set -u
NODES="k3s137-1 k3s137-2 k3s137-3"
IMAGES=$(docker images --format '{{.Repository}}:{{.Tag}}' | grep '^rexyn-devtron/' | sort)

for img in $IMAGES; do
  for n in $NODES; do
    (
      if docker save "$img" | orb -m "$n" sudo k3s ctr -n k8s.io images import - >/dev/null 2>&1; then
        echo "OK   $n <- $img"
      else
        echo "FAIL $n <- $img"
      fi
    ) &
  done
  wait
done
echo "IMPORT_DONE"
```

执行：

```bash
chmod +x /tmp/import-images.sh
/tmp/import-images.sh
```

它会为每个镜像、每台节点并行导入，约 2–4 分钟（本地网络带宽足够，实测单个镜像 2–3 秒）。

## 3. 关键参数解释

| 参数 | 含义 |
| --- | --- |
| `docker save <img>` | 把镜像导出成 tar 流（不打到磁盘） |
| `orb -m <node> sudo ...` | 在指定 OrbStack 虚拟机内执行 |
| `k3s ctr` | k3s 自带的 containerd CLI |
| `-n k8s.io` | **必须指定**。k8s 用的 containerd namespace 是 `k8s.io`，不指定会导到 default 里，kubelet 看不到 |
| `images import -` | 从 stdin 读取 tar |

## 4. 验证

```bash
for n in k3s137-1 k3s137-2 k3s137-3; do
  echo -n "$n: "
  orb -m $n sudo k3s ctr -n k8s.io images ls -q | grep -c rexyn-devtron
done
```

期望三台都是 15（16 个 tag 减去重复的 kubectl）。

看具体清单：

```bash
orb -m k3s137-1 sudo k3s ctr -n k8s.io images ls -q | grep rexyn-devtron
```

```text
docker.io/rexyn-devtron/authenticator:local
docker.io/rexyn-devtron/chart-sync:local
...
```

:::info 为什么带 `docker.io/` 前缀
containerd 会把不带 registry 的镜像名规范化为 `docker.io/...`。kubelet 解析 `rexyn-devtron/devtron:local` 时也会做同样规范化，所以能匹配上，**不用改 values 里的镜像名**。
:::

## 5. 增量更新单个镜像

改完代码只需重编一个组件：

```bash
docker build --platform linux/arm64 -t rexyn-devtron/devtron:local $ROOT/devtron

for n in k3s137-1 k3s137-2 k3s137-3; do
  docker save rexyn-devtron/devtron:local | orb -m $n sudo k3s ctr -n k8s.io images import -
done
```

然后让 Pod 重新拉取：

```bash
kubectl -n devtroncd rollout restart deploy/devtron
```

:::warning 同名 tag 的坑
`import` 会覆盖 containerd 里的同名 tag，但 **已经运行的容器不会自动换镜像**。必须 `rollout restart`，并且 Pod 的 `imagePullPolicy` 要是 `IfNotPresent`（非 `latest` tag 的默认值）。
:::

## 6. 如果确实需要一个 registry

给你留一条可复用的路：用自签 TLS 的 registry，节点侧配 `ca_file`，就能绕开"insecure"限制。

```bash
# 1) 在节点上生成证书（示例）
openssl req -newkey rsa:4096 -nodes -sha256 -keyout domain.key -x509 -days 365 \
  -out domain.crt -subj "/CN=192.168.139.95" -addext "subjectAltName=IP:192.168.139.95"

# 2) 部署 registry:2 并挂载证书
# 3) 各节点 /etc/rancher/k3s/registries.yaml:
```

```yaml
mirrors:
  "192.168.139.95:5000":
    endpoint:
      - "https://192.168.139.95:5000"
configs:
  "192.168.139.95:5000":
    auth: {}
    tls:
      ca_file: /etc/rancher/k3s/registry-ca.crt
```

```bash
sudo systemctl restart k3s        # agent 节点用 k3s-agent
```

Docker 侧则把 `domain.crt` 放到 `~/.docker/certs.d/192.168.139.95:5000/ca.crt` 即可。本书主线不走这条路，因为 `ctr import` 更省事。
