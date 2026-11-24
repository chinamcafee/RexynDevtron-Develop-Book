---
id: repo-inception
title: inception｜安装与升级的 Operator
sidebar_position: 1
---

# inception｜安装与升级的 Operator

## 它是什么

`inception` 是 Devtron 的 Operator，监听一个自定义资源 `Installer`，然后执行"安装脚本"。

```text
Helm chart 创建 Installer CR
   → inception watch 到
   → 下载脚本（GitHub/Gitee）
   → 用自己的解释器执行
   → 更新 CR 的 status
```

在 `kubectl get pods` 里它是 `inception-xxx`；在 `kubectl get installers` 里能看到它的工作成果。

## 代码结构

```text
inception/
├── main.go                        # manager 启动
├── api/v1alpha1/                  # Installer CRD 的 Go 类型
├── controllers/
│   └── installer_controller.go    # Reconcile 逻辑（核心）
├── pkg/
│   ├── language/                  # 脚本解释器（支持 shellScript 等）
│   └── providerIdentifier/        # 云厂商探测
├── config/                        # manager 配置
└── hack/                          # 代码生成脚本
```

## Installer CR 长什么样

```yaml
apiVersion: installer.devtron.ai/v1alpha1
kind: Installer
metadata:
  name: installer-devtron
  namespace: devtroncd
spec:
  url: https://raw.githubusercontent.com/devtron-labs/devtron/v2.2.1/manifests/installation-script
status:
  sync:
    status: Applied
    data: |
      LTAG="v2.2.1";
      ...
```

关键字段只有一个：`spec.url`。inception 把它拉下来执行。

```bash
kubectl -n devtroncd get installer installer-devtron -o yaml
```

## Reconcile 做了什么

```text
1. 读 CR 的 spec.url
2. HTTP GET 下载脚本
3. 解析脚本（pkg/language 的简易 DSL）
4. 按顺序执行语句（shellScript / log / ignore）
5. 把执行结果写进 status.sync.status
   - Downloaded  → 已下载，执行中
   - Applied     → 成功
   - Failed      → 失败（看 status 里的错误）
```

## 为什么它"看起来什么都没做"

在 OSS 2.2.1 里，`installation-script` 的内容几乎是空的：

```text
LTAG="v2.2.1";
shebang = `#!/bin/bash`;
sleep50 = shebang + `sleep 50`;
ignore = shellScript sleep50;
log("executed devtron setup installation");
```

它只是睡 50 秒然后打个日志。**真正创建资源的是 Helm chart**，inception 在这个版本里更像是"占位/兼容层"。

这也解释了为什么我们用自己的镜像覆盖后，状态照样能到 `Applied`。

:::info 历史原因
早期 Devtron 用 inception 来"安装企业版模块"（从远端拉 chart 再 apply）。后来 chart 本身包含了全部资源，脚本就退化成空转。但在企业版里它仍然承担模块安装职责。
:::

## 日志里那堆超时是干什么的

```text
Get "http://169.254.169.254/latest/dynamic/instance-identity/document": i/o timeout
Get "http://100.100.100.200/latest/meta-data/instance/instance-type": i/o timeout
```

`pkg/providerIdentifier` 在探测云厂商（AWS / 阿里云 / GCP / DigitalOcean），用来决定某些默认配置。本地环境当然连不上，**直接忽略**。

## 我要改它

| 需求 | 位置 |
| --- | --- |
| 加一个新的 CR 字段 | `api/v1alpha1/` + `controllers/installer_controller.go` |
| 支持新的脚本语言/指令 | `pkg/language/` |
| 改下载源（内网镜像） | `spec.url` 的来源（chart 里的 `installer.repo`） |
| 加安装前检查 | Reconcile 的前置步骤 |

## 动手验证

```bash
# 1) 看 CR 状态
kubectl -n devtroncd get installers installer-devtron -o jsonpath='{.status.sync.status}{"\n"}'

# 2) 看它在执行什么脚本
kubectl -n devtroncd get installer installer-devtron -o jsonpath='{.spec.url}{"\n"}'

# 3) 看日志（忽略 provider 探测的报错）
kubectl -n devtroncd logs deploy/inception --tail=50 | grep -v "169.254\|100.100"

# 4) 手动触发重跑（删掉 status 或改个 annotation）
kubectl -n devtroncd annotate installer installer-devtron force-sync="$(date +%s)" --overwrite
```

## 一个实用的调试技巧

如果 inception 卡在 `Downloaded` 很久：

```bash
# 看它能不能拉到那个 URL
kubectl -n devtroncd exec deploy/inception -- wget -qO- --timeout=10 <spec.url>
```

拉不到就是网络问题（GitHub 被墙/限流），可以换 `installer.source: gitee`，或者干脆把 `installer.modules` 置空（不创建 Installer CR）。
