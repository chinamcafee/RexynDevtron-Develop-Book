# 《Devtron 源码剖析与二次开发》电子书

按仓库为单位拆解 Devtron 生态：每个仓库的作用、代码结构、与其他组件的边界，以及二次开发的切入点。

## 本地运行

```bash
npm install
npm start            # 开发模式，http://localhost:3000
npm run build        # 生产构建，产物在 build/
npm run serve        # 预览构建产物
```

> 本项目使用 **Docusaurus 3.10.2**（React 19 + Node ≥ 18）。

## 章节结构

```text
第一部分 · 全景
  overview               生态全景：11 个仓库各自的位置
  runtime-callchain      运行时调用链：一次部署经历了什么

第二部分 · devtron（核心）
  repo-devtron           核心仓库的骨架
  devtron-api            API 层与路由
  backend-error-codes    错误码、出口分档与前端多语言
  devtron-domain         业务域：pipeline / app / chart / argo
  devtron-wire           wire 依赖注入与扩展点
  devtron-inner-charts   内置 Chart 与部署模板

第三部分 · devtron-services（微服务）
  repo-services          monorepo 总览
  svc-git-sensor         Git 仓库索引
  svc-kubelink           与集群对话的 gRPC 服务
  svc-kubewatch-lens     事件监听与健康度
  svc-chart-sync         Chart 仓库同步器
  svc-ci-runner          流水线里的构建工人
  svc-image-scanner      镜像漏洞扫描
  svc-authenticator-commonlib  认证与公共库

第四部分 · 前端
  repo-dashboard         前端控制台
  repo-fe-common-lib     前端公共组件库
  dashboard-i18n         多语种架构（中英双语）

第五部分 · 周边仓库
  repo-inception         安装与升级的 Operator
  repo-migrator          数据库迁移的真相
  repo-notifier          通知服务
  repo-charts            集成模块的 Chart 仓库
  repo-kubectl           官方 kubectl 客户端（周边）
  repo-dex               SSO 门面（周边）
  repo-chart-versions-fix  一次性清洁工，新部署无需使用（周边）

第六部分 · 二次开发
  recipes                七个端到端配方
  dev-workflow           本地开发调试工作流
  reading-guide          源码阅读路线图

第七部分 · RexynOps 定制
  rexyn-positioning      Devtron 在 RexynOps 版图中的位置
  rexyn-cloud-layers     Devtron 之下：从"只有云账号"到"可部署的集群"
  rexyn-branch-strategy  rexyn-dev 分支模型与上游同步
```

## 每章的四段式

1. **它是什么** —— 在生态里的定位
2. **代码长什么样** —— 目录结构、关键包、核心类型
3. **它怎么跟别人协作** —— 上下游、协议、数据流
4. **我要改它，从哪下手** —— 常见二次开发场景的入口

## 相关

- 配套电子书：《Devtron 编译 + 本地部署》（`../Tutorial-CompileDeployDevtron`）
- 项目群约定：各代码仓库根目录的 `AGENTS.md`（仓库清单、`rexyn-dev` 基线、硬规则）+ 本仓库 `AGENTS.md`（文档同步契约）
- 内容基于 Devtron 2.2.1，运行环境为 k3s v1.37.2+k3s1（Kubernetes 1.37）
