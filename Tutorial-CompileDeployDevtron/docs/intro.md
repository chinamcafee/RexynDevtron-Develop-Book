---
id: intro
title: 写在前面
sidebar_position: 1
slug: /intro
---

# 《Devtron 编译 + 本地部署》

这是一本**纯操作型**的电子书：从 8 个 GitHub 仓库的 fork 开始，一步一步把 Devtron OSS 的每一个组件编译成 ARM64 镜像，最后在你本机的 OrbStack 上跑出一个功能完整的 Devtron。

书里的每一条命令都是**实际执行过并能复现**的，不是从官方文档抄来的伪代码。凡是官方脚本在当前版本已经跑不通的地方（基础镜像被删、migrator 镜像内容与仓库源码不一致等），书中都给出了替代方案和原因说明。

## 这本书假设你已经具备

| 项目 | 要求 |
| --- | --- |
| 机器 | Apple Silicon Mac（M 系列），内存 ≥ 32GB，磁盘 ≥ 80GB 空闲 |
| 虚拟化 | [OrbStack](https://orbstack.dev)（本文实测 2.2.5） |
| 命令行 | 会用 bash/zsh、git、docker、kubectl、helm |
| 网络 | 能访问 GitHub、Docker Hub、quay.io（拉取基础镜像） |
| 账号 | 一个 GitHub 账号（用于 fork） |

## 你会得到什么

一个三节点的 k3s 集群（`k3s137-1/2/3`），上面运行着：

- **Devtron 平台本体**：dashboard、devtron（orchestrator）、inception（operator）、migrator
- **Devtron 微服务**：git-sensor、kubelink、kubewatch、lens、chart-sync、authenticator
- **周边**：postgres、nats、Argo CD、dex
- **全部由你自己编译的镜像**（`rexyn-devtron/*:local`），而不是 `quay.io/devtron/*`

并且可以通过 `http://<节点IP>:30080/dashboard` 登录，用 `admin` + 集群内 Secret 里的密码进入控制台。

## 全书路线

```text
第一部分  认识仓库版图      →  11 个 fork（8 核心 + 3 周边）
第二部分  准备环境          →  OrbStack 虚拟机、工具链、rexyn-dev 分支
第三部分  编译              →  13 个镜像，逐个 Dockerfile 讲清
第四部分  部署              →  k3s 1.37 集群、镜像导入、Helm 安装、验证
第五部分  运维与迭代        →  踩坑手册、改代码重新发布、命令全集
第六部分  兼容性扩展        →  换 k8s 版本（1.31）会踩什么
```

:::info 为什么以 k3s 1.37 为基准
k3s 1.37 是当前 stable（`v1.37.2+k3s1`），也是本书全部命令**实际验证过**的环境。Devtron 2.2.1 官方只声明支持 K8s ≥1.16，并没有为 1.37 做过适配——书中会说明我们实测下来它是**向前兼容**的，但有一个必须改的网络参数（详见[搭集群](./cluster)）。

如果你手上是 1.31 或更早的版本，直接跳到[兼容性矩阵](./compat-matrix)，那里给出了同一套产物在 1.31 上的差异点。
:::

## 关于"本地编译"的边界

本书坚持两条底线：

1. **Devtron 自有组件，必须来自你 fork 的源码编译**，包括 devtron 主程序、dashboard 前端、7 个微服务、inception、migrator、notifier、authenticator。
2. **第三方依赖（postgres / nats / Argo CD / redis / dex）允许使用上游镜像**——它们本来就不是 Devtron 的代码。其中 `devtron-utils`、`kubectl`、`dex` 三个镜像 Devtron 只发布镜像、不公开源码，书中采用"打本地标签 + 导入集群"的方式处理，并会明确标注。

:::tip 阅读方式
第一次读建议按顺序执行；如果你只想快速拿到一个能跑的本地 Devtron，可以从[第三部分 · 编译总览](./build-overview)开始，直接照抄命令。
:::

## 版本基线

本文写作时锁定的版本组合，建议你也用同一套，避免版本漂移带来的兼容性问题：

| 组件 | 版本 |
| --- | --- |
| Devtron | 2.2.1（chart `devtron-operator` 0.23.4） |
| k3s | `v1.37.2+k3s1`（当前 stable） |
| Kubernetes | 1.37 |
| containerd | 2.3.7（k3s 内置） |
| Argo CD | v2.13.3 |
| Go（各 Dockerfile 内置） | 1.25 / 1.26 |
| Node（dashboard） | 24-alpine |
| Docusaurus（本书） | 3.10.2 |
| OrbStack | 2.2.5 |
| Ubuntu（虚拟机） | 24.04 LTS arm64 |
