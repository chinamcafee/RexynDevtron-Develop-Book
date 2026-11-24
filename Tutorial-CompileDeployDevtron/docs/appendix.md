---
id: appendix
title: 附录：命令全集
sidebar_position: 3
---

# 附录：命令全集

复制粘贴就能跑的完整流程，从零到可用。

## 0. 变量

```bash
export ROOT=$HOME/InnovationProjects/DevtronProjects
export NODE1=192.168.139.95
export NODE2=192.168.139.43
export NODE3=192.168.139.61
export KUBECONFIG=$HOME/.kube/k3s137.yaml
```

## 1. Fork + Clone

```bash
mkdir -p "$ROOT" && cd "$ROOT"
for r in devtron devtron-services dashboard devtron-fe-common-lib inception migrator notifier charts; do
  curl -s -X POST -H "Authorization: Bearer $GITHUB_TOKEN" \
       -H "Accept: application/vnd.github+json" \
       "https://api.github.com/repos/devtron-labs/$r/forks" -o /dev/null
done
sleep 30
for r in devtron devtron-services dashboard devtron-fe-common-lib inception migrator notifier charts; do
  git clone "git@github.com:chinamcafee/$r.git" "$r"
  git -C "$r" remote add upstream "https://github.com/devtron-labs/$r.git"
done
```

## 2. 编译

```bash
cd "$ROOT"

# devtron 主程序
docker build --platform linux/arm64 -t rexyn-devtron/devtron:local ./devtron &

# 微服务（每个子目录独立构建）
for c in git-sensor kubelink kubewatch lens chart-sync ci-runner image-scanner authenticator; do
  docker build --platform linux/arm64 -t "rexyn-devtron/$c:local" "./devtron-services/$c" &
done

# dashboard（需要 Dockerfile.local）
sed 's#fholzer/nginx-brotli:v1.26.2#fholzer/nginx-brotli:v1.31.8#' dashboard/Dockerfile > dashboard/Dockerfile.local
docker build --platform linux/arm64 -f dashboard/Dockerfile.local -t rexyn-devtron/dashboard:local ./dashboard &

# inception / notifier
docker build --platform linux/arm64 -t rexyn-devtron/inception:local ./inception &
docker build --platform linux/arm64 -t rexyn-devtron/notifier:local ./notifier &

wait
```

migrator 单独做（见下节）。

## 3. migrator（本地改造版）

```bash
cat > "$ROOT/migrator/Dockerfile.local" <<'EOF'
FROM golang:1.25-alpine AS build-env
RUN apk add --no-cache git gcc musl-dev
RUN go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@v4.16.2

FROM alpine:3.21
RUN apk add --no-cache ca-certificates git bash
COPY --from=build-env /go/bin/migrate /usr/local/bin/migrate
ENTRYPOINT ["/usr/local/bin/migrate"]
EOF
docker build --platform linux/arm64 -f "$ROOT/migrator/Dockerfile.local" -t rexyn-devtron/migrator:local "$ROOT/migrator"
```

## 4. 镜像搬运

```bash
docker pull --platform linux/arm64 quay.io/devtron/dex:v2.30.2
docker pull --platform linux/arm64 quay.io/devtron/devtron-utils:dup-chart-repo-v1.1.0
docker pull --platform linux/arm64 quay.io/devtron/kubectl:latest

docker tag quay.io/devtron/dex:v2.30.2                     rexyn-devtron/dex:v2.30.2
docker tag quay.io/devtron/devtron-utils:dup-chart-repo-v1.1.0 rexyn-devtron/devtron-utils:dup-chart-repo-v1.1.0
docker tag quay.io/devtron/kubectl:latest                  rexyn-devtron/kubectl:local
```

### 4.1 可选：从三个周边 fork 自建

```bash
# kubectl（需要 Go 1.27；上下文里放一份 fork 副本 + main.go + go.mod，见 build-misc 4.3）
docker build --platform linux/arm64 -t rexyn-devtron/kubectl:fork /tmp/kubectl-fork-build

# dex（真 dex，Go 1.27）
docker build --platform linux/arm64 -f "$ROOT/dex/Dockerfile.local" -t rexyn-devtron/dex:fork "$ROOT/dex"

# devtron-utils（全新部署可跳过；老库升级才需要）
docker build --platform linux/arm64 -f "$ROOT/chart-versions-fix/Dockerfile.local" \
  -t rexyn-devtron/devtron-utils:fork "$ROOT/chart-versions-fix"
```

## 5. 集群

```bash
for i in 1 2 3; do orbctl create -a arm64 --cpus 4 --memory 8G ubuntu:24.04 k3s137-$i; done

cat > /tmp/prep.sh <<'EOF'
set -e
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -qq
sudo apt-get install -y -qq curl ca-certificates iptables iproute2
sudo swapoff -a || true
printf 'br_netfilter\noverlay\n' | sudo tee /etc/modules-load.d/k3s.conf >/dev/null
sudo modprobe br_netfilter; sudo modprobe overlay
printf 'net.ipv4.ip_forward = 1\nnet.bridge.bridge-nf-call-iptables = 1\n' | sudo tee /etc/sysctl.d/99-k3s.conf >/dev/null
sudo sysctl --system >/dev/null 2>&1 || true
EOF
for m in k3s137-1 k3s137-2 k3s137-3; do (orb -m $m sh -s < /tmp/prep.sh) & done; wait

orb -m k3s137-1 sh -c "curl -sfL https://get.k3s.io | sudo INSTALL_K3S_VERSION=v1.37.2+k3s1 sh -s - server \
  --write-kubeconfig-mode 644 --node-ip $NODE1 --advertise-address $NODE1 --tls-san $NODE1 \
  --flannel-iface eth0 --flannel-backend=host-gw --disable traefik"

TOKEN=$(orb -m k3s137-1 sudo cat /var/lib/rancher/k3s/server/node-token | tr -d '\r')
orb -m k3s137-2 sh -c "curl -sfL https://get.k3s.io | sudo K3S_URL=https://$NODE1:6443 K3S_TOKEN='$TOKEN' INSTALL_K3S_VERSION=v1.37.2+k3s1 sh -s - agent --node-ip $NODE2 --flannel-iface eth0"
orb -m k3s137-3 sh -c "curl -sfL https://get.k3s.io | sudo K3S_URL=https://$NODE1:6443 K3S_TOKEN='$TOKEN' INSTALL_K3S_VERSION=v1.37.2+k3s1 sh -s - agent --node-ip $NODE3 --flannel-iface eth0"

orb -m k3s137-1 sudo cat /etc/rancher/k3s/k3s.yaml | sed "s#https://127.0.0.1:6443#https://$NODE1:6443#" > ~/.kube/k3s137.yaml
chmod 600 ~/.kube/k3s137.yaml
kubectl get nodes
```

## 6. 导入镜像

```bash
for img in $(docker images --format '{{.Repository}}:{{.Tag}}' | grep '^rexyn-devtron/'); do
  for n in k3s137-1 k3s137-2 k3s137-3; do
    docker save "$img" | orb -m $n sudo k3s ctr -n k8s.io images import - >/dev/null
  done
  echo "imported $img"
done
```

## 7. 部署

```bash
cd "$ROOT/devtron/charts/devtron" && helm dependency build .

cd "$ROOT/devtron"
helm upgrade --install devtron ./charts/devtron -n devtroncd --create-namespace \
  -f "$ROOT/local-values.yaml" \
  --set 'installer.modules={cicd}' \
  --set 'argo-cd.enabled=true' \
  --timeout 20m
```

`$ROOT/local-values.yaml` 内容见[部署](./deploy#1-准备-values-覆盖文件)。

## 8. 暴露服务

```bash
PORTNAME=$(kubectl -n devtroncd get svc devtron-service -o jsonpath='{.spec.ports[0].name}')
kubectl -n devtroncd patch svc devtron-service -p "{
  \"spec\": {\"type\": \"NodePort\",
  \"ports\": [{\"name\": \"$PORTNAME\",\"port\": 80,\"protocol\": \"TCP\",
  \"targetPort\": \"$PORTNAME\",\"nodePort\": 30080}]}}"
```

## 9. 验收

```bash
kubectl -n devtroncd get pods
kubectl -n devtroncd get secret devtron-secret -o jsonpath='{.data.ADMIN_PASSWORD}' | base64 -d; echo
curl -s -o /dev/null -w "%{http_code}\n" http://$NODE1:30080/dashboard/
```

浏览器访问 `http://$NODE1:30080/dashboard`，用户名 `admin`。

## 命令速查

| 目的 | 命令 |
| --- | --- |
| 看节点 | `kubectl get nodes` |
| 看 Pod | `kubectl -n devtroncd get pods` |
| 看日志 | `kubectl -n devtroncd logs deploy/devtron -f --tail=100` |
| 进容器 | `kubectl -n devtroncd exec -it deploy/devtron -- sh` |
| 重启 | `kubectl -n devtroncd rollout restart deploy/<name>` |
| 端口转发 | `kubectl -n devtroncd port-forward svc/devtron-service 8000:80` |
| 导入镜像 | `docker save <img> \| orb -m <node> sudo k3s ctr -n k8s.io images import -` |
| 看节点镜像 | `orb -m <node> sudo k3s ctr -n k8s.io images ls -q` |
| 进机器 | `orb -m k3s137-1 bash` |
| 停集群 | `orbctl stop k3s137-1 k3s137-2 k3s137-3` |
| 删集群 | `orbctl delete -f k3s137-1 k3s137-2 k3s137-3` |
