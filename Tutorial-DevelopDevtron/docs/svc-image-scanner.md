---
id: svc-image-scanner
title: image-scanner｜镜像漏洞扫描
sidebar_position: 7
---

# image-scanner｜镜像漏洞扫描

## 它是什么

在 CI 流水线里，构建完镜像之后、部署之前，可以插入一个"安全扫描"阶段。`image-scanner` 就是执行这个阶段的服务：

```text
ci-runner 构建出镜像
   → image-scanner 扫描
        → 调用 Clair / Trivy
        → 读结果、按严重级别过滤
        → 回写扫描结果（可阻断部署）
```

## 代码结构

```text
image-scanner/
├── App.go
├── pkg/
│   ├── clairService/     # 与 Clair 对接
│   ├── grafeasService/   # 与 Grafeas（漏洞元数据）对接
│   ├── klarService/      # Klar（Clair 的 CLI 封装）
│   ├── security/         # 严重级别策略
│   ├── asyncProvider/    # NATS
│   ├── sql/              # 结果落库
│   └── user/             # 鉴权
├── grafeas/              # Grafeas 相关
├── api/                  # REST 接口
└── internals/
```

## 三个扫描后端

| 后端 | 特点 | 何时用 |
| --- | --- | --- |
| **Clair** | Devtron 自带 chart，部署在集群里 | 想完全自托管 |
| **Trivy** | 更轻量、更新快 | 推荐，Devtron 也支持 |
| **Grafeas** | 存漏洞元数据的标准 API | 大规模场景 |

默认 chart 里 `security.enabled: false`，所以**不部署**。要启用：

```yaml
security:
  enabled: true
  imageScanner:
    registry: rexyn-devtron
    image: "image-scanner:local"
  clair:
    enabled: true     # 或改用 trivy
```

## 扫描结果怎么影响流水线

```text
扫描完成
  ├── 漏洞数 ≤ 阈值 → 流水线继续
  └── 超过阈值     → 流水线失败（可配置为仅告警）
```

阈值策略在 `pkg/security/`，可按严重级别（Critical/High/Medium）分别设置。

## 我要改它

| 需求 | 位置 |
| --- | --- |
| 支持新的扫描器 | `pkg/` 下新增一个 `xxxService`，在 `App.go` 里注册 |
| 改阻断策略 | `pkg/security/` |
| 改结果存储 | `pkg/sql/` |
| 改 API 返回结构 | `api/` + bean |

## 为什么默认不开启

三个现实原因：

1. Clair 需要自己的数据库（postgres/Cassandra）和定期更新漏洞库，资源开销大；
2. 漏洞库更新需要访问外网（或离线包），本地环境经常配不好；
3. 大多数团队把扫描放在自己的 CI 里（Trivy 一条命令），不需要 Devtron 内置。

所以本书的部署**编译了镜像但不启用**——这跟官方安装的默认行为一致。

## 动手验证（如果你启用了）

```bash
# 1) 看 Pod
kubectl -n devtroncd get pods | grep -E "image-scanner|clair"

# 2) 手动触发一次扫描
TOKEN=...
curl -s -X POST -H "token: $TOKEN" \
  http://192.168.139.95:30080/orchestrator/security/image/scan \
  -d '{"image":"nginx:1.25"}'

# 3) 看结果
curl -s -H "token: $TOKEN" http://192.168.139.95:30080/orchestrator/security/image/scan/result/... 
```

## 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 扫描一直 pending | Clair 没就绪 / 漏洞库未更新 | 看 clair 日志，等 `updater` 完成 |
| `no such image` | 镜像在私有 registry，scanner 无凭证 | 配置 registry 凭证 |
| 扫描超时 | 镜像太大 / Clair 资源不足 | 调大 timeout 与资源限制 |
