---
id: repo-notifier
title: notifier｜通知服务
sidebar_position: 3
---

# notifier｜通知服务

## 它是什么

Devtron 的"消息出口"：把流水线/部署事件发到邮件、Slack、Webhook、Microsoft Teams 等。

```text
devtron 产生事件 ──NATS/HTTP──► notifier ──► SMTP / Slack API / Webhook
```

默认 **不部署**（chart 里 `notifier.enabled: false`），需要显式开启。

## 代码结构

```text
notifier/src/
├── app.ts              # Express 应用
├── server.ts           # 启动入口
├── routes/             # HTTP 路由
├── notification/       # 通知发送核心
├── destination/        # 各渠道实现（邮件/Slack/Webhook...）
├── pubSub/             # NATS 订阅
├── entities/           # 数据模型
├── repository/         # DB 访问
├── templates/          # 通知模板
├── services/
├── config/
└── tests/
```

## 关键概念

| 概念 | 说明 |
| --- | --- |
| **Destination** | 一个通知出口（比如"运维 Slack 频道"） |
| **Channel** | 渠道类型（email/slack/webhook/ses/smtp） |
| **Template** | 消息模板（不同事件用不同模板） |
| **Rule** | 什么事件发到哪个 destination |

配置在 Devtron UI 的 **Global Configuration → Notifications** 里。

## 为什么默认关闭

1. 需要 SMTP/Slack token 等外部凭证，本地环境通常没有；
2. 发通知是"锦上添花"，不影响核心部署链路；
3. 多一个常驻服务就多一份资源占用。

## 我要改它

| 需求 | 位置 |
| --- | --- |
| 加一个新渠道（如钉钉/飞书） | `src/destination/` 新增实现 + 注册 |
| 改消息模板 | `src/templates/` |
| 改触发规则 | `src/notification/` |
| 加一个 API | `src/routes/` |

### 加渠道的最小改动

```ts
// src/destination/dingtalk.ts（示意）
export const sendDingTalk = async (config, payload) => {
  await axios.post(config.webhookUrl, {
    msgtype: 'markdown',
    markdown: { title: payload.title, text: payload.body },
  });
};
```

然后在渠道注册表里加一项，并在 `src/config` 里补上类型定义。

## 如何启用

```yaml
notifier:
  enabled: true
  image: "notifier:local"
```

`values.yaml` 里 `notifier` 是顶层字段（不在 `components` 下），注意别改错位置。

启用后：

```bash
kubectl -n devtroncd get pods | grep notifier
kubectl -n devtroncd logs deploy/notifier
```

## 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 收不到邮件 | SMTP 配置错 / 被反垃圾 | 用 `swaks` 或 telnet 先验证 SMTP |
| Slack 401 | token 过期 | 重新生成 Bot Token |
| 通知重复 | 重试机制 + 未做幂等 | 检查 `pubSub` 的 ack 逻辑 |
| Pod CrashLoop | 缺环境变量 | 看日志里的 config validation 报错 |

## 动手验证

```bash
# 1) 是否部署
kubectl -n devtroncd get deploy notifier

# 2) 健康检查
kubectl -n devtroncd exec deploy/notifier -- wget -qO- http://localhost:8080/health

# 3) 看它订阅了什么
kubectl -n devtroncd logs deploy/notifier --tail=50 | grep -i "subscribe\|nats"
```

:::tip 先测通再上线
配好 destination 后，Devtron UI 里有一个 "Send test notification" 按钮。先点它，比等真实流水线失败再排查高效得多。
:::
