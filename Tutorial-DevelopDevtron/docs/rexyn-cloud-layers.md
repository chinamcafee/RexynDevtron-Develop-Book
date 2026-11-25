---
id: rexyn-cloud-layers
title: Devtron 之下：从"只有云账号"到"可部署的集群"
sidebar_position: 2
---

# Devtron 之下：从"只有云账号"到"可部署的集群"

[上一章](./rexyn-positioning)讲的是 Devtron 在 RexynOps 里扮演执行层。执行层不是悬空的：它至少需要两台东西——

1. 一台能 SSH 登录的 Linux（或一组）；
2. 一个装好的 Kubernetes。

这一章讲这两个前置由谁提供。它是 Devtron 的**下方边界**，也是 RexynOps 的另一半。结论先给：

> **Devtron 不买机器，也不装 K8s。** 机器与集群由 RexynOps 的四层能力从"只有云控制台账号密码"推到"可部署"，Devtron 只出现在第 4 层的一个 recipe 里。

## 一、四层与 Devtron 的位置

```text
┌────────────────────────────────────────────────────────────┐
│ 第 4 层 · 应用部署    recipe 只渲染脚本，由第 3 层执行        │
│   kkrepo · k3s · devtron · shell                            │  ← Devtron 在这里
├────────────────────────────────────────────────────────────┤
│ 第 3 层 · SSH 执行    只认 host/user/auth，不知道是哪家云      │
├────────────────────────────────────────────────────────────┤
│ 第 2 层 · 操作权限    API + 浏览器 + 桌面操控；报价/购买/接管   │
├────────────────────────────────────────────────────────────┤
│ 第 1 层 · 厂商适配    控制台地图、计费词汇、身份模型、playbook   │
└────────────────────────────────────────────────────────────┘
```

| 层 | 回答的问题 | 与 Devtron 的关系 |
| --- | --- | --- |
| 1 厂商适配 | 这家云的控制台怎么走、计费怎么叫、子账号怎么开 | 无关；Devtron 不持有云凭据 |
| 2 操作权限 | 现在能买什么、能接管什么、缺什么权限 | 无关；采购与网络不经过 Devtron |
| 3 SSH 执行 | 这台机器能不能跑脚本 | 无关；Devtron 只看到 K8s API |
| 4 应用部署 | 在已有机器上装什么、按什么顺序 | **Devtron 是其中一个 recipe** |

这张图和上一章的三层结构（决策/控制/执行）不冲突：三层讲"谁做决定"，四层讲"决定之前资源从哪来"。两条轴正交。

## 二、机器从哪来（第 1–3 层）

RexynOps 支持三种起点，对 Devtron 来说没有区别——最终都是一个 SSH 目标。

| 起点 | 用户已有 | 走哪条通道 |
| --- | --- | --- |
| **新购** | 只有账号密码 | 先 `api-access` 剧本拿 API 密钥，再 `quote → approve → buy` |
| **接管** | 已买好的 CVM/ECS | `DescribeInstances` 读取，登记成机器目标，不重复购买 |
| **手工** | 任意 Linux（跳板机、本地 VM） | 直接填 host/user/key |

"只有账号密码"这一步值得单独说。RexynDesktop 会打开一个受控控制台窗口，由**你**完成登录（扫码/短信不自动化），然后 Agent 按剧本创建最小权限子账号、授予 CVM/VPC 策略、签发 SecretId/SecretKey。密钥当场写入本地 0600 凭据文件，不落在页面或日志里。

拿到密钥后，API 能做的走 API；API 做不到的（控制台独有的操作）继续用浏览器通道；两者都不行的（Canvas 控件、系统弹窗）由桌面操控兜底。这三条通道是**互补**的，不是三套并行实现：只要 API 可用，同一能力就不允许再走浏览器。

## 三、K8s 从哪来（第 4 层）

`k3s` recipe 是 Devtron 的直接前置：

```text
第 1 台 → server（写 node-token，输出 API 地址）
其余   → agent（用 server 输出的 token 与 URL 加入）
最后   → 把 /etc/rancher/k3s/k3s.yaml 的 127.0.0.1 改写为节点 IP
```

它输出两个值：`kubeconfig_path` 与 `k3s_api_server`。`devtron` recipe 的第一个输入就是 `kubeconfig_path`（默认 `/root/k3s-remote.yaml`），第二个是 Helm 仓库与命名空间。

所以「从零到 Devtron」在 RexynOps 里是三次部署，不是一次：

```text
接管云（买 1–N 台机器）
  → 机器页探活（SSH + sudo + 容量）
  → 部署 k3s（1 台也能跑）
  → 部署 devtron（helm upgrade --install）
```

每一步都可单独重跑；`k3s` 的 server 步骤脚本本身幂等，已运行则只回显 token，不会重装。

## 四、三条边界

| 边界 | 含义 | 违反后的后果 |
| --- | --- | --- |
| Devtron 不做采购与网络 | 不在 `devtron` 里加"买 CVM""开安全组"的代码 | 云厂商差异渗进 13 个镜像，上游同步彻底失守 |
| Devtron 不做 SSH 装机 | 不在 `devtron` 里跑 ansible/shell 装依赖 | 与 inception/chart 的安装语义打架 |
| RexynOps 不重复交付逻辑 | 不在 RexynOps 里重写 CI/CD、GitOps、RBAC | 两套部署引擎，状态无法对账 |

第三条尤其重要。RexynOps 的 `devtron` recipe 只做一件事：`helm upgrade --install`，然后把 rollout 状态读回来。应用怎么发版、怎么回滚、怎么审批，仍然由 Devtron 自己负责。

## 五、对本仓库定制的含义

1. **不要为了"顺滑部署"往 devtron 里塞环境准备逻辑。** 需要预装的依赖（比如 MySQL、制品源）属于 recipe 的其它步骤，不是 Devtron 的启动逻辑。
2. **chart values 的默认值要考虑"机器是新的"。** 新机器没有 StorageClass、没有 Ingress Controller、没有镜像加速；`devtron` recipe 的 values 覆盖点应该留给这些，而不是改 Devtron 源码。
3. **镜像前缀是部署参数，不是编译参数。** `rexyn-devtron/*` 由 `devtron` recipe 的 values 注入；同一份代码应该能装出标准前缀的实例。
4. **kubeconfig 是一种输入，不是全局状态。** recipe 从机器上的文件路径读，不做"默认集群"假设——同一台控制机可以先后给两个集群装 Devtron。

## 六、事实源与已知边界

四层的实现细节、接口清单、每个 playbook 的步骤、以及未验证项，事实源在 RexynOps 侧：

```text
$ROOT/RexynOpsProjects/docs/RexynOps-DevDocs/29-cloud-capability-base/README.md
```

本章只保留与 Devtron 相关的结论，避免两处各写一份、慢慢漂移。

已知边界（与 29 章一致）：

- 真实云采购未跑：包年包月的询价解析、`RunInstances` 的 `InstanceChargePrepaid` 字段需真实账号验价；
- 控制台剧本未在真实 CAM 页面点测：选择器以文本匹配为主，改版会失效，但会停在具体步骤并给出原因；
- 多节点 K3s 的真实网络（安全组 6443、内网互通）未验证；
- `devtron` recipe 的默认 values 还未针对本仓库的 fork 调整。

## 七、照做一遍（顺序）

```text
1. 接管云 → 填 SecretId/SecretKey（或先接管控制台走剧本）
2. 购买 1 台 4C8G（或接管已有实例）→ 自动登记为机器
3. 机器 → 探活（SSH 通、sudo 可用、磁盘 ≥ 20GB）
4. 部署应用 → k3s → 检查（ready）→ 审批 → 执行
5. 部署应用 → devtron → 填 kubeconfig_path → 检查 → 审批 → 执行
6. 等 rollout，浏览器打开 http://<节点IP>:30080/dashboard
```

第 4 步的 leader 是勾选顺序的第一台；单机也能跑，只是没有多节点调度可看。

## 八、和另外两处文档的分工

| 文档 | 回答 | 何时看 |
| --- | --- | --- |
| 本章 | Devtron 的上下边界在哪，集群与机器从哪来 | 设计定制方案、判断某段代码该放哪一层时 |
| `RexynOps-DevDocs/29` | 四层怎么实现、接口是什么、哪些没验证 | 改 RexynOps 代码时 |
| 本书其余章节 | Devtron 自己怎么改、怎么编、怎么装 | 改 Devtron 代码时 |
