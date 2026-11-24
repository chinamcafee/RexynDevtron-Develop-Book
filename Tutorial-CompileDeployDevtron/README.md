# 《Devtron 编译 + 本地部署》电子书

从 8 个 fork 仓库出发，编译 Devtron OSS 的全部组件，在本机 OrbStack 的 k3s 集群上部署一个功能完整的 Devtron。

## 本地运行

```bash
npm install
npm start            # 开发模式，http://localhost:3000
npm run build        # 生产构建，产物在 build/
npm run serve        # 预览构建产物
```

> 本项目使用 **Docusaurus 3.10.2**（React 19 + Node ≥ 18）。

## 目录结构

```text
docs/
├── intro.md                  写在前面
├── repos.md                  11 个 fork：8 个核心 + 3 个周边
├── architecture.md           运行时架构与镜像地图
├── prereq.md                 准备本机环境
├── clone.md                  Fork 并克隆到本地
├── branch-strategy.md        切到 rexyn-dev 分支并建立同步基线
├── build-overview.md         编译总览与策略
├── build-services.md         编译 devtron-services 微服务
├── build-devtron.md          编译 devtron 主程序
├── build-dashboard.md        编译 dashboard 前端
├── build-misc.md             inception / migrator / notifier 与镜像搬运
├── cluster.md                用 OrbStack 搭三节点 k3s 1.37
├── import-images.md          把本地镜像送进集群
├── deploy.md                 Helm 部署本地版
├── verify.md                 验证清单
├── troubleshooting.md        踩坑手册
├── workflow.md               日常迭代工作流
├── appendix.md               附录：命令全集
└── compat-matrix.md          兼容性扩展：k8s 1.31 / 其他版本
```

## 内容特点

- 每条命令都实际执行过，给出**预期输出**与**失败症状**；
- 官方脚本在当前版本失效的地方（`fholzer/nginx-brotli:v1.26.2` 已被删除、`migrator` 镜像内容与仓库源码不一致）都给出替代方案与原因；
- 所有组件统一构建为 `rexyn-devtron/*:local`，`helm install` 时只需一份 20 行的 values 覆盖；
- 基准环境是 **k3s 1.37**，另有一章说明同一套产物在 **k8s 1.31** 上的差异（唯一必改项是 flannel 后端）。

## 相关

- 配套电子书：《Devtron 源码剖析与二次开发》（`../Tutorial-DevelopDevtron`）
- 项目群共用记忆：`../../PROJECT-GROUP-MEMORY.md`（11 个仓库清单、`rexyn-dev` 基线、文档同步契约）
- 实测环境：OrbStack 2.2.5 / k3s v1.37.2+k3s1 / Devtron 2.2.1 / Ubuntu 24.04 arm64
