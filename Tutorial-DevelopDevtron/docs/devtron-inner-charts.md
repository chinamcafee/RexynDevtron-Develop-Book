---
id: devtron-inner-charts
title: devtron｜内置 Chart 与部署模板
sidebar_position: 5
---

# devtron｜内置 Chart 与部署模板

`devtron` 仓库里其实有**两套完全不同的 chart**，很容易混淆：

| 路径 | 用途 | 谁在用 |
| --- | --- | --- |
| `charts/devtron/` | 部署 **Devtron 自己** | 你 `helm install devtron ...` |
| `scripts/devtron-reference-helm-charts/` | 部署 **你的业务应用** | Devtron 运行时读取 |

## 一、`charts/devtron`：Devtron 的安装 chart

### 结构

```text
charts/devtron/
├── Chart.yaml            # 名字是 devtron-operator，注意别被名字骗了
├── values.yaml           # 全部可配置项
├── crds/                 # Installer CRD
├── charts/               # 依赖：argo-cd / security / redis（需 dependency build）
└── templates/
    ├── _helpers.tpl      # 镜像拼接、通用标签
    ├── dashboard.yaml    # 每个组件一个文件
    ├── devtron.yaml
    ├── kubelink.yaml
    ├── ...
    └── install.yaml      # inception 的 Deployment
```

### 镜像拼接逻辑（最重要的一个 helper）

```gotemplate
{{- define "common.image" -}}
{{- $registryName := .component.registry | default .global.containerRegistry -}}
{{- $imageName := .extraImage | default .component.image -}}
{{- $imageTag := .extraImageTag | default .component.tag -}}
{{- if $registryName }}
    {{- printf "%s/%s:%s" $registryName $imageName $imageTag -}}
{{- else }}
    {{- printf "%s:%s" $imageName $imageTag -}}
{{- end -}}
{{- end -}}
```

三个含义：

1. 组件级 `registry` 优先于全局 `global.containerRegistry`；
2. `image` 字段里**已经带了 tag**（如 `"devtron:local"`）；
3. 想换镜像，改 `registry` 或 `image` 其一即可。

这就是我们能用 8 行 values 把所有组件指向本地镜像的原因。

### values 的四层结构

```yaml
global:              # 全局默认：registry、nodeSelector、安全上下文
  containerRegistry: quay.io/devtron

installer:           # inception 相关
  image: inception
  tag: 473deaa4-185-21582

components:          # 每个组件一节
  devtron:
    registry: ""
    image: "hyperion:d12a1cfa-280-39869"
    cicdImage: "devtron:d12a1cfa-434-39870"

argo-cd:             # 子 chart
  enabled: false
```

:::tip 一个隐藏的行为
`components.devtron.image` 是 **hyperion 变体**（不启用 CI/CD 时用的精简版），`cicdImage` 才是完整版。很多人改了 `image` 却发现没生效，就是因为装了 `installer.modules={cicd}`，实际用的是 `cicdImage`。
:::

### 常用定制点

| 需求 | values 路径 |
| --- | --- |
| 换镜像仓库 | `global.containerRegistry` |
| 换某个组件镜像 | `components.<name>.registry` + `.image` |
| 加环境变量 | `components.<name>.customOverrides` |
| 指定 StorageClass | `global.storageClass` |
| 用外部数据库 | `global.externalPostgres.enabled` + `PG_ADDR` |
| 加额外 K8s 资源 | `extraManifests` |
| 资源限制 | `components.<name>.resources` |

## 二、`scripts/devtron-reference-helm-charts`：业务应用模板

这是 Devtron 用来部署**你的应用**的内置模板。Devtron 创建应用时会把它作为一个"参考 chart"。

```bash
ls $ROOT/devtron/scripts/devtron-reference-helm-charts
```

典型内容：

```text
devtron-charts/
├── deployment-chart/     # Deployment + Service + Ingress
├── job-chart/            # Job
├── cronjob-chart/        # CronJob
├── statefulset-chart/    # StatefulSet
└── rollouts-chart/       # Argo Rollouts（金丝雀/蓝绿）
```

### 它如何被使用

```text
用户创建应用 → 选择"Deployment"模板
   → Devtron 复制内置 chart 到应用的工作目录
   → 用户在 UI 上填 values（副本数、镜像、端口...）
   → 部署时 helm template 渲染 → Argo Application
```

所以**改这些 chart = 改所有新创建应用的默认部署形态**。这是很强大的一个扩展点。

### 想加自己的模板

1. 在 `scripts/devtron-reference-helm-charts/` 下新建目录（如 `my-chart/`）；
2. 写 `Chart.yaml` + `values.yaml` + `templates/`；
3. Devtron 启动时会扫描这个目录（`pkg/chart/ChartTemplateService.go`）；
4. 重新编译镜像后，UI 的模板列表里就会出现。

## 三、两套 chart 的边界

```text
┌─────────────────────────────────────────┐
│ charts/devtron      部署 Devtron 平台本身 │  ← 运维关心
├─────────────────────────────────────────┤
│ devtron-reference-helm-charts            │
│                     部署平台上的业务应用  │  ← 开发者关心
└─────────────────────────────────────────┘
```

改错地方是很常见的失误：

- "我想让所有应用默认带 livenessProbe" → 改 **reference chart**
- "我想让 Devtron 自己多挂一个卷" → 改 **charts/devtron**

## 四、Chart 与 CRD 的关系

`charts/devtron/crds/` 里定义了什么？

```bash
ls $ROOT/devtron/charts/devtron/crds
```

主要是 `Installer` CRD：

```yaml
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: installers.installer.devtron.ai
spec:
  group: installer.devtron.ai
  names: { kind: Installer, plural: installers }
  scope: Namespaced
```

Helm 的 `crds/` 目录会在安装时**先于模板**创建，这是 K8s 的约定。所以 inception 能一启动就 watch 到这个 CR。

## 动手验证

```bash
cd $ROOT/devtron

# 1) 看安装 chart 渲染出多少资源
helm template devtron charts/devtron -n devtroncd --set 'installer.modules={cicd}' | grep -c "^kind:"

# 2) 看镜像拼接结果
helm template devtron charts/devtron -n devtroncd | grep -oE "image: [^ ]+" | sort -u

# 3) 看内置模板有哪些
ls scripts/devtron-reference-helm-charts

# 4) 看某个模板的 values 结构
head -40 scripts/devtron-reference-helm-charts/deployment-chart/values.yaml
```
