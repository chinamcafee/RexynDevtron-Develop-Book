---
id: prereq
title: 准备本机环境
sidebar_position: 1
---

# 准备本机环境

## 1. 确认硬件与系统

```bash
uname -m          # 期望：arm64
sysctl -n hw.ncpu
sysctl -n hw.memsize | awk '{print $1/1024/1024/1024" GB"}'
```

建议 ≥ 8 核 / 32GB。本书的三节点集群每台 4C/10G，加上 Docker 构建缓存，峰值会占到 20GB 左右。

## 2. 安装并检查 OrbStack

```bash
brew install orbstack          # 或从官网下载安装包
orbctl version
```

确认 Docker 可用（OrbStack 自带 Docker engine，不需要 Docker Desktop）：

```bash
docker version --format '{{.Server.Version}}'
docker context ls
```

## 3. 安装命令行工具

```bash
brew install kubectl helm
kubectl version --client
helm version --short
```

`helm` 需要 **3.8+**；`kubectl` 与集群版本差 ±1 个 minor 即可。

## 4. Node.js（只有编译 dashboard 才需要）

```bash
node -v     # 建议 20/22/24
npm -v
```

> 编译 dashboard 时用的是 Docker 里的 `node:24-alpine`，本机 Node 主要用来跑 Docusaurus 电子书本身。

## 5. 关于 Go：**本机不需要装**

所有 Go 组件都在 Dockerfile 的多阶段构建里用官方 `golang:1.25/1.26` 镜像编译，本机不需要 Go 环境。这是刻意的设计——避免本机 Go 版本与仓库 `go.mod` 不一致导致的玄学问题。

如果你确实想在宿主机上跑单测，再单独装 Go 1.26 即可，但编译镜像仍建议走 Docker。

## 6. 拉齐基础镜像（可选，但强烈建议）

构建时最容易卡住的就是"拉基础镜像"。先一次性拉好：

```bash
for img in golang:1.25-alpine3.21 golang:1.25.0 golang:1.26-alpine golang:1.26.6 \
           ubuntu:24.04 alpine:3.21.2 node:24-alpine docker:20.10.24-dind \
           fholzer/nginx-brotli:v1.31.8; do
  docker pull --platform linux/arm64 "$img"
done
```

:::info 为什么是 `fholzer/nginx-brotli:v1.31.8`
dashboard 仓库的 `Dockerfile` 里写的是 `fholzer/nginx-brotli:v1.26.2`，**这个 tag 已经被上游删除**，直接构建会报 `not found`。本书改用仍在维护的 `v1.31.8`（同样支持 arm64），并用一个 `Dockerfile.local` 承载这个改动，避免污染仓库原文件。
:::

## 7. 目录约定

全书统一使用这个路径，你可以替换成自己的，但后面命令里出现 `$ROOT` 时请对应替换：

```bash
export ROOT=$HOME/InnovationProjects/DevtronProjects
mkdir -p "$ROOT"
```

最终目录长这样：

```text
$ROOT/
├── devtron/
├── devtron-services/
├── dashboard/
├── devtron-fe-common-lib/
├── inception/
├── migrator/
├── notifier/
├── charts/
├── local-values.yaml          # 部署用的镜像覆盖文件
├── Tutorial-CompileDeployDevtron/
└── Tutorial-DevelopDevtron/
```

## 8. 检查磁盘

```bash
df -h /
```

至少留 80GB：11 个仓库约 1.3GB，Docker 构建缓存 15–25GB，三台虚拟机各 8–10GB。

## 常见环境问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `docker pull` 报 `EOF` / `auth.docker.io` 超时 | Docker Hub 限流或网络抖动 | 重试；或给 Docker 配镜像加速 |
| `orbctl create` 卡在 `creating` | OrbStack 首次拉取 Ubuntu 镜像 | 等 1–2 分钟，或换 `ubuntu:22.04` |
| `kubectl` 连不上集群 | kubeconfig 里的 server 还是 `127.0.0.1` | 改成虚拟机 IP，见[搭集群](./cluster) |
