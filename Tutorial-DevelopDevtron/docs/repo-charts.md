---
id: repo-charts
title: charts｜集成模块的 Chart 仓库
sidebar_position: 4
---

# charts｜集成模块的 Chart 仓库

## 它是什么

`devtron-labs/charts` 是 Devtron 维护的 **Helm Chart 集合**，主要是"可一键安装到集群里的基础设施组件"，供 Devtron 的 Chart Store / Stack Manager 使用。

```text
charts/
└── charts/
    ├── devtron/                 # Devtron 自身（与 devtron 仓库里的那份对应）
    ├── devtron-enterprise/      # 企业版
    ├── argocd/
    ├── clair/
    ├── kube-prometheus-stack/
    ├── elasticsearch-curator/
    ├── nats-server/
    ├── karpenter-custom-resources/
    ├── ...
    └── （60+ 个模块）
```

## 与另外两套 chart 的区别

这是全书第三套 chart，别搞混：

| Chart 位置 | 部署对象 | 谁维护 |
| --- | --- | --- |
| `devtron/charts/devtron` | Devtron 平台本身 | devtron 仓库 |
| `devtron/scripts/devtron-reference-helm-charts` | 你的业务应用 | devtron 仓库 |
| `charts/charts/*` | 集群基础设施（argocd、clair、prometheus...） | charts 仓库 |

## 典型内容

```bash
ls $ROOT/charts/charts | head -20
```

```text
OpenVPN            ai-agent          argocd            calico-networking
clair              devtron           devtron-backups   devtron-monitoring
elasticsearch-curator                kube-prometheus-stack
karpenter-custom-resources           nats-server       rollout
...
```

## 它怎么被用到

两条路径：

### 1. 作为 Helm repo 被 Chart Store 索引

chart-sync 定时抓 `index.yaml`，dashboard 的 Chart Store 里就能看到、能一键部署。

### 2. 作为 Stack Manager 的模块

Devtron 的 Stack Manager 里那些"安装 Argo CD / 安装 Clair"按钮，背后就是 apply 这里的 chart。

## 我要改它

| 需求 | 位置 |
| --- | --- |
| 改某个模块的默认值 | `charts/<name>/values.yaml` |
| 加一个新模块 | 新建 `charts/<name>/`，写 Chart.yaml + values + templates |
| 改 Devtron 自身部署（注意重复） | `charts/devtron/`，但通常改 `devtron` 仓库那份 |

:::warning 两份 devtron chart
`charts/charts/devtron` 和 `devtron/charts/devtron` 内容相近但**可能不同步**。部署时以 `devtron` 仓库里的为准（它跟代码同版本发布）。改之前先 diff：

```bash
diff -r $ROOT/devtron/charts/devtron $ROOT/charts/charts/devtron | head
```
:::

## 加一个新模块的最小步骤

```bash
cd $ROOT/charts/charts
mkdir my-module && cd my-module
```

```yaml title="Chart.yaml"
apiVersion: v2
name: my-module
version: 0.1.0
appVersion: "1.0"
description: 我的模块
```

```yaml title="values.yaml"
image:
  repository: nginx
  tag: "1.25"
replicaCount: 1
```

```text
templates/
└── deployment.yaml
```

然后用 `helm lint` 检查：

```bash
helm lint $ROOT/charts/charts/my-module
helm template test $ROOT/charts/charts/my-module | head
```

## 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| Chart Store 里看不到新模块 | index 没更新 | 重新触发 chart-sync |
| 安装失败 `chart requires kubeVersion` | 集群版本太低 | 改 Chart.yaml 的 kubeVersion 或升集群 |
| 与已有 CRD 冲突 | 模块自带 CRD | 用 `--skip-crds` 或先手动装 CRD |

## 动手验证

```bash
# 1) 模块数量
ls $ROOT/charts/charts | wc -l

# 2) 哪些模块带 CRD
find $ROOT/charts/charts -maxdepth 2 -name crds -type d | head

# 3) 两个 devtron chart 的差异
diff -rq $ROOT/devtron/charts/devtron $ROOT/charts/charts/devtron | head
```
