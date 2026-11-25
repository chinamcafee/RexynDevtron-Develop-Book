---
id: cluster
title: 用 OrbStack 搭三节点 k3s 1.37
sidebar_position: 1
---

# 用 OrbStack 搭三节点 k3s 1.37

:::note 生产集群不必从 OrbStack 开始
本章用 OrbStack 在本机搭三节点，目的是**可重复地验证**编译产物。真实环境里集群有两种来源：

- **已有集群**：只要拿到 kubeconfig，直接跳到[部署 Devtron](./deploy)；
- **从零装机**：由 RexynOps 在已接管的云主机上先跑 `k3s` recipe，再跑 `devtron` recipe。

两条路的区别只在"谁装 K3s"，Devtron 自身的安装参数、chart values、验证步骤完全相同。后一条路的细节见《源码剖析与二次开发》第七部分 `rexyn-cloud-layers`（Devtron 之下：从"只有云账号"到"可部署的集群"）。
:::

## 0. 先记住两个 1.37 特有的坑

在动手之前先看这两条，能省掉一次重装：

| 坑 | 现象 | 解法 |
| --- | --- | --- |
| **默认 VXLAN 在 OrbStack 下 TCP 不通** | Pod 能 ping 通，但 `curl`/`nc` 全超时；CoreDNS 解析失败，服务之间连不上 | 安装 server 时加 `--flannel-backend=host-gw` |
| **`node-role.kubernetes.io/master` 标签被移除** | 用 master 做 nodeSelector 的 workload 永远 Pending | 改用 `node-role.kubernetes.io/control-plane`；Devtron chart 本身不受影响 |

第一条是硬性要求：同一个 Pod 网络，ICMP 通但 TCP 不通，排查起来非常费时间（详见[踩坑手册](./troubleshooting)）。

## 1. 创建三台虚拟机

```bash
for i in 1 2 3; do
  orbctl create -a arm64 --cpus 4 --memory 8G ubuntu:24.04 k3s137-$i
done
orbctl list | grep k3s137
```

```text
k3s137-1  running  ubuntu  noble  arm64  808.5 MB  192.168.139.95
k3s137-2  running  ubuntu  noble  arm64  808.5 MB  192.168.139.43
k3s137-3  running  ubuntu  noble  arm64  678.2 MB  192.168.139.61
```

:::note 为什么是 4C/8G
Devtron 整套栈空闲时约 1.2GB 内存、~100m CPU（`kubectl top nodes` 实测）。8GB 给三台机器留了足够余量，跑 CI 构建时也不会 OOM。宿主机 32GB 即可承载。
:::

## 2. 初始化三台节点

```bash title="/tmp/prep.sh"
set -e
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -qq
sudo apt-get install -y -qq curl ca-certificates iptables iproute2
sudo swapoff -a || true
sudo sed -i '/[[:space:]]swap[[:space:]]/ s/^/#/' /etc/fstab || true
sudo systemctl disable --now ufw >/dev/null 2>&1 || true

printf 'br_netfilter\noverlay\n' | sudo tee /etc/modules-load.d/k3s.conf >/dev/null
sudo modprobe br_netfilter; sudo modprobe overlay

printf 'net.ipv4.ip_forward = 1\nnet.bridge.bridge-nf-call-iptables = 1\nnet.bridge.bridge-nf-call-ip6tables = 1\n' \
  | sudo tee /etc/sysctl.d/99-k3s.conf >/dev/null
sudo sysctl --system >/dev/null 2>&1 || true
echo "PREP_OK $(hostname)"
```

```bash
for m in k3s137-1 k3s137-2 k3s137-3; do
  (orb -m $m sh -s < /tmp/prep.sh 2>&1 | grep PREP_OK) &
done; wait
```

期望三行 `PREP_OK k3s137-x`。

## 3. 装 server 节点（关键参数都在这）

```bash
orb -m k3s137-1 sh -c 'curl -sfL https://get.k3s.io | \
  sudo INSTALL_K3S_VERSION=v1.37.2+k3s1 sh -s - server \
    --write-kubeconfig-mode 644 \
    --node-ip 192.168.139.95 \
    --advertise-address 192.168.139.95 \
    --tls-san 192.168.139.95 \
    --tls-san k3s137-1 \
    --flannel-iface eth0 \
    --flannel-backend=host-gw \
    --disable traefik'
```

逐个参数解释：

| 参数 | 为什么必须 |
| --- | --- |
| `INSTALL_K3S_VERSION=v1.37.2+k3s1` | 显式锁版本。不锁会跟随 stable，未来升级可能引入新行为 |
| `--node-ip` / `--advertise-address` | OrbStack 机器多网卡，不指定可能选到 docker0 之类的地址 |
| `--tls-san` | 让宿主机能用 `https://192.168.139.95:6443` 访问（kubeconfig 里要改） |
| `--flannel-iface eth0` | 指定 overlay 网卡 |
| **`--flannel-backend=host-gw`** | **1.37 + OrbStack 的关键**：默认 VXLAN 下跨节点 TCP 不通 |
| `--disable traefik` | 本书用 NodePort 暴露服务，省掉 ingress controller 的内存 |

:::warning host-gw 只能写在 server 上
`--flannel-backend` 是集群级参数，agent 节点不接受这个 flag。所有 agent 只要 `--node-ip` + `--flannel-iface` 即可。
:::

安装完成后确认服务起来了：

```bash
orb -m k3s137-1 sudo systemctl status k3s --no-pager | head -5
```

## 4. 加入两台 agent

```bash
TOKEN=$(orb -m k3s137-1 sudo cat /var/lib/rancher/k3s/server/node-token | tr -d '\r')

join() {
  orb -m "$1" sh -c "curl -sfL https://get.k3s.io | \
    sudo K3S_URL=https://192.168.139.95:6443 K3S_TOKEN='$TOKEN' \
    INSTALL_K3S_VERSION=v1.37.2+k3s1 sh -s - agent \
      --node-ip $2 --flannel-iface eth0"
}

join k3s137-2 192.168.139.43 &
join k3s137-3 192.168.139.61 &
wait
```

## 5. 导出 kubeconfig

k3s 生成的 kubeconfig 指向 `127.0.0.1`，必须替换成节点 IP：

```bash
orb -m k3s137-1 sudo cat /etc/rancher/k3s/k3s.yaml \
  | sed 's#https://127.0.0.1:6443#https://192.168.139.95:6443#' \
  > ~/.kube/k3s137.yaml
chmod 600 ~/.kube/k3s137.yaml

export KUBECONFIG=$HOME/.kube/k3s137.yaml
kubectl get nodes -o wide
```

期望（注意 **ROLES 列只有 `control-plane`，没有 `master`**——这是 1.37 的变化）：

```text
NAME       STATUS   ROLES           AGE   VERSION        INTERNAL-IP      CONTAINER-RUNTIME
k3s137-1   Ready    control-plane   68s   v1.37.2+k3s1   192.168.139.95   containerd://2.3.7-k3s1
k3s137-2   Ready    <none>          31s   v1.37.2+k3s1   192.168.139.43   containerd://2.3.7-k3s1
k3s137-3   Ready    <none>          32s   v1.37.2+k3s1   192.168.139.61   containerd://2.3.7-k3s1
```

:::info 1.37 自带 Gateway API
安装后 `kube-system` 里会多一个 `helm-install-gateway-api-crd` 的 Completed Job——k3s 1.37 把 Gateway API 的 CRD 内置了。它对 Devtron 无影响，但 kubelink 会把它当成一个 Helm release 缓存起来（后面日志里看到 `gateway-api-crd` 不用奇怪）。
:::

## 6. 验证存储与跨节点网络

```bash
kubectl get sc
# local-path (default)   rancher.io/local-path   Delete   WaitForFirstConsumer
```

`postgres` / `nats` / `git-sensor` 的 PVC 都依赖它，必须是 default。

**跨节点 TCP 必须单独验证**（这是 host-gw 是否生效的直接证据）：

```bash
kubectl run srv --image=busybox:1.36 --restart=Never \
  --overrides='{"spec":{"nodeName":"k3s137-3"}}' \
  --command -- sh -c 'nc -ll -p 8080 -e echo hello'

kubectl run cli --image=busybox:1.36 --restart=Never \
  --overrides='{"spec":{"nodeName":"k3s137-1"}}' --command -- sleep 120

kubectl wait --for=condition=Ready pod/srv pod/cli --timeout=90s
SRV=$(kubectl get pod srv -o jsonpath='{.status.podIP}')
kubectl exec cli -- sh -c "nc -z -w3 $SRV 8080 && echo TCP_OK || echo TCP_FAIL"

kubectl delete pod srv cli --force --grace-period=0
```

必须看到 `TCP_OK`。如果这里是 `TCP_FAIL` 但 `ping` 能通，说明 flannel 用的是 VXLAN，需要重装集群并加上 `--flannel-backend=host-gw`。

## 7. 记录地址

```bash
cat > $ROOT/cluster-hosts.txt <<'EOF'
k3s137-1 192.168.139.95
k3s137-2 192.168.139.43
k3s137-3 192.168.139.61
EOF
```

:::warning IP 会变
OrbStack 机器的 IP 在重启后可能变化。集群内部通信依赖安装时写死的 IP，所以**不要删了重建**；需要暂停时用 `orbctl stop` / `orbctl start`，IP 通常保持不变。若确实变了，需要重导 kubeconfig 并检查 `--node-ip`。
:::
