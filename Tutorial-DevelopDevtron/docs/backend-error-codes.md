---
id: backend-error-codes
title: 后端错误码与前端多语言
sidebar_position: 3
---

# 后端错误码与前端多语言

dashboard 的界面文案已经全量接入 i18n，但**后端返回的错误消息仍然是英文**。这一章说明如何在不破坏 API 契约的前提下，让后端继续保持英文，由前端按业务码渲染中文。

## 一、设计目标与非目标

| 目标 | 说明 |
| --- | --- |
| 后端零 i18n | 不引入语言协商、不做消息目录、不感知请求语言 |
| 契约只增不减 | 老前端、老 CLI、老脚本全部无感 |
| 全面覆盖 | 凡是会展示给前端的错误都有业务码（含裸错误） |
| 可追溯 | 内部日志/审计始终英文，排障不受影响 |

非目标：

- 不翻译 K8s/DB/Helm 的**原始错误详情**（只翻译外壳）；
- 不做邮件/Slack 等异步通知的语言（那需要用户级偏好）；
- 不改 `code` 字段的既有语义。

## 二、真实约束（为什么不能"直接给 code 塞业务码"）

| 约束 | 数据 |
| --- | --- |
| `ApiError.Code` 现在是 HTTP 状态字符串 | 283 处 `ApiError`，绝大多数 `Code: "400"/"404"/"000"` |
| 前端有 10 处按**信封** `ServerErrors.code`（数字）做分支 | 403/404/409，与单条错误无关 |
| 单条错误的 `code` 前端几乎不消费 | 唯一一处 `_error.code === 0` 因后端发字符串，实际已失效 |
| 裸错误会直接展示给用户 | 2631 处 `WriteJsonResp`，其中 1359 处（约 52%）是 `WriteJsonResp(w, err, nil, ...)` 透传 |

结论：**不能复用 `code`**，否则外部脚本里 `code === "400"` 的分支会静默失效；必须新增字段。

## 三、字段设计

```go
type ApiError struct {
	HttpStatusCode    int                    `json:"-"`
	Code              string                 `json:"code,omitempty"`          // 不变：HTTP 状态字符串
	BusinessCode      string                 `json:"businessCode,omitempty"`  // 新增
	Params            map[string]interface{} `json:"params,omitempty"`        // 新增
	InternalMessage   string                 `json:"internalMessage,omitempty"`
	UserMessage       interface{}            `json:"userMessage,omitempty"`   // 保持英文
	UserDetailMessage string                 `json:"userDetailMessage,omitempty"`
}
```

响应示例：

```json
{
  "code": 404,
  "status": "Not Found",
  "errors": [{
    "code": "404",
    "businessCode": "APP_NOT_FOUND",
    "params": { "appName": "demo-app" },
    "userMessage": "application demo-app not found"
  }]
}
```

写入方式（三种，老代码不改也能编译）：

```go
// 1. 字段直写
&util.ApiError{HttpStatusCode: 404, Code: "404", BusinessCode: util.ErrCodeAppNotFound,
    Params: map[string]interface{}{"appName": name}, UserMessage: msg}

// 2. 链式
util.DefaultApiError().WithHttpStatusCode(404).WithBusinessCode(util.ErrCodeAppNotFound).
    WithParam("appName", name)

// 3. 构造器
util.NewBusinessApiError(404, util.ErrCodeAppNotFound, params, userMessage, internalMessage)
```

`Params` 在写入时统一脱敏：只保留标量、截断 200 字符、丢弃 `token/password/secret/kubeconfig` 等敏感 key。

## 四、两层码：L1 出口分档 + L2 高频业务码

### L1：出口分档（覆盖 100% 响应）

在唯一出口 `api/restHandler/common/apiError.go` 的 `WriteJsonResp` 里统一分配，业务代码零改动：

| 错误形态 | 业务码 |
| --- | --- |
| `pg.ErrNoRows` | `RESOURCE_NOT_FOUND` |
| 唯一键冲突 | `RESOURCE_CONFLICT` |
| `validator.ValidationErrors` | `VALIDATION_FAILED` |
| K8s `StatusError` | `K8S_FORBIDDEN` / `K8S_NOT_FOUND` / `K8S_CONFLICT` / `K8S_INVALID` |
| K8s 超时 / 服务不可用 | `UPSTREAM_TIMEOUT` / `UPSTREAM_UNAVAILABLE` |
| 其余裸错误、`multierror`、`UnexpectedObjectError` | `UNKNOWN` + `params.detail` |

裸错误的英文原文不会被丢弃，而是放进 `params.detail`，前端默认只显示通用文案，需要排障时可以取用。

### L2：高频业务码（按频次补）

在抛错处显式设置，先覆盖出现频率最高的 20 余条（应用/流水线/GitOps/鉴权），后续按埋点数据增量补。

## 五、登记表：`contracts/error-codes.yaml`

唯一权威源在 `devtron/contracts/error-codes.yaml`，前端只消费生成的词典。

```yaml
version: 1
defaults:
  owner: platform
  httpStatus: 500

codes:
  - code: APP_NOT_FOUND
    httpStatus: 404
    owner: app-lifecycle
    since: 1.1.0
    summary: 应用不存在
    params:
      - name: appName
        type: string
        required: false
        example: demo-app
    messages:
      en: "Application not found."
      zh: "应用不存在。"
```

CI 校验规则（`internal/util/errorcodes_test.go`）：

1. 码格式 `^[A-Z][A-Z0-9_]{2,63}$` 且全局唯一；
2. 必须同时有 `en` 与 `zh`；
3. 文案里的 `{{param}}` 必须在 `params` 中声明；
4. 参数名不能命中敏感词表；
5. `deprecated` 必须指向存在的 `replacedBy`；
6. 代码里使用的常量必须在 YAML 中登记。

## 六、前端消费

```text
fetch 响应（非 2xx + JSON + errors[]）
   → localizeBusinessError：businessCode + params 命中词典
   → 命中则覆盖 userMessage，再交给 common-lib 构造 ServerErrors
   → 未命中保留英文原文
```

实现位置：`dashboard/src/i18n/errorLocalization.ts`，在 `src/index.tsx` 渲染前调用 `installErrorLocalization()` 包装 `window.fetch`。

这样做的原因：`ServerError` 的构造函数只复制 `code/userMessage/internalMessage/moreInfo` 四个字段，新增字段会在类实例化时丢失；在 fetch 层把 `userMessage` 替换掉，`showError` 和那些直接读 `errors[0].userMessage` 的组件都不用改。

词典由 `tools/i18n/gen-error-messages.mjs` 从 YAML 生成到 `src/i18n/errors/generated.ts`，禁止手改。

兜底顺序：

```text
businessCode 词典（带 params）→ 后端英文 userMessage → 组件自身通用提示
```

## 七、兼容性

| 项 | 变化 | 影响 |
| --- | --- | --- |
| JSON 结构 | 只增 `businessCode` / `params` | 老客户端忽略新字段 |
| `code` | 不变 | 现有 `code === "400"` 分支不受影响 |
| `userMessage` / `internalMessage` | 后端仍返回英文 | 老前端展示不变 |
| 函数签名 | `NewApiError` 等不变 | 现有调用点无需修改 |
| OpenAPI specs | 需补两个字段 | 否则契约文档落后 |

## 八、新增一个错误码

```text
1. contracts/error-codes.yaml 增加条目（code/httpStatus/owner/since/summary/params/messages）
2. internal/util/errorcodes.go 增加常量（如需在代码里引用）
3. 抛错处设置 BusinessCode（或用 NewBusinessApiError）
4. go test ./internal/util/ -run ErrorCodeRegistry
5. 同步 yaml 到 dashboard：cp contracts/error-codes.yaml ../dashboard/src/i18n/errors/
6. cd dashboard && yarn errors:gen
7. yarn i18n:check && yarn build
```

## 九、边界与后续

| 项 | 现状 | 后续 |
| --- | --- | --- |
| K8s/DB 原始错误详情 | 外壳中文，详情英文（`params.detail`） | 增加"查看详情"折叠展示 |
| 异步通知（邮件/Slack） | 未覆盖 | 用户级 language 偏好，发送时读取 |
| 未登记的裸错误 | 落到 `UNKNOWN` | 按埋点频次补 L2 码 |
| OpenAPI specs | 尚未补字段 | 下一批随契约测试一起补 |

## 十、验证记录

```text
[✓] go test ./internal/util/ -run 'ErrorCodeRegistry|UsedErrorCodes|SanitizeParams'
[✓] go test ./api/restHandler/common/ -run TestWriteJsonResp   （3 个契约用例）
[✓] go build ./api/... ./internal/... ./pkg/pipeline/           （mock 包为上游基线问题，未纳入）
[✓] dashboard: tsc --noEmit / eslint --max-warnings 0 / vite build
[✓] 生成 31 个码的前端词典（10 个 L1 + 21 个 L2）
```
