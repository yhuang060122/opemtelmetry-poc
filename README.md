# angular-otel-demo

Angular 浏览器端接入 OpenTelemetry，把 trace 直接送到 .NET Aspire Dashboard 的最小可运行示例。
配套后端（ASP.NET Core + EF Core）见文末「后端对接」。

## 目录

```
src/app/core/telemetry/telemetry.config.ts   配置（含运行时覆盖）
src/app/core/telemetry/telemetry.ts          SDK 初始化、exporter、自动埋点
src/app/core/telemetry/trace.service.ts      手写业务 span
src/app/core/api.config.ts                   后端地址
compose.yaml                                 Aspire Dashboard（独立模式）
```

## 快速开始

```bash
npm install --no-fund --no-audit   # npm 10 若报 edgesOut，改用 npx npm@11 install
npm run otel:up                    # 起 Dashboard：http://localhost:18888
npm start                          # http://localhost:4200
```

打开页面 → 点「调用后端 /api/health」或「生成嵌套 span」→ Dashboard 的 **Traces** 页签按 traceId 搜索。

端口约定（容易搞混，记一下）：

| 用途 | 宿主端口 | 容器内端口 | 协议 |
| --- | --- | --- | --- |
| Dashboard UI | 18888 | 18888 | HTTP |
| OTLP 接收 | 4317 | 18889 | gRPC（.NET 后端用） |
| OTLP 接收 | 4318 | 18890 | HTTP/protobuf（浏览器只能用这个） |

## 关键配置

1. **`tracesUrl`** 指向 `http://localhost:4318/v1/traces`。浏览器不支持 gRPC，填 4317 会直接失败。
2. **Dashboard 必须放行 CORS**：`DASHBOARD__OTLP__CORS__ALLOWEDORIGINS` 要包含页面地址（`compose.yaml` 已配 `http://localhost:4200`）。`ng serve` 换端口时要同步改。
3. **跨服务串联**：`propagateTraceHeaderCorsUrls` 决定往哪些后端地址注入 `traceparent`；同时后端 CORS 必须放行这个请求头，否则浏览器会丢掉它：

   ```csharp
   policy.WithHeaders("traceparent", "tracestate");
   ```

4. **运行时覆盖**：`index.html` 里注入 `window.__OTEL_CONFIG__`，不用重新构建就能改服务名 / 端点 / 环境（模板已注释，需要时打开）。

## 后端对接（ASP.NET Core）

```bash
OTEL_SERVICE_NAME=my-api
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
OTEL_EXPORTER_OTLP_PROTOCOL=grpc
```

后端 `AddOpenTelemetry()...UseOtlpExporter()` + `AddEntityFrameworkCoreInstrumentation()` 配好后，两侧能串成一条链路：

```
angular-otel-demo (browser fetch span)
  └─ my-api: GET /api/health (server span)
       └─ SELECT ... (EF Core span)
```

## 版本说明

浏览器 SDK 目前存在版本错位：`@opentelemetry/sdk-trace-web` 最新稳定仍是 `2.12.0`（要求 `@opentelemetry/api` < 1.10），而 `resources` / `context-zone` 已发到 `3.1.0`（要求 api ≥ 1.10）。直接装 latest 会 peer 冲突，所以这里锁定了一套互相兼容的组合：

```
@opentelemetry/api@1.9.0
@opentelemetry/sdk-trace-web@2.12.0
@opentelemetry/resources@2.12.0
@opentelemetry/context-zone@2.12.0
@opentelemetry/instrumentation@0.223.0
@opentelemetry/exporter-trace-otlp-proto@0.223.0
@opentelemetry/instrumentation-fetch@0.223.0
@opentelemetry/instrumentation-xml-http-request@0.223.0
@opentelemetry/semantic-conventions@1.45.0
```

等 `sdk-trace-web` 3.x 发布后可整体升级。**不要**用 `--legacy-peer-deps` 硬装跨大版本混搭，运行时容易炸。

## 已知限制

- 浏览器端只有 **traces**（可加 logs），没有 metrics。
- Dashboard 是内存存储，默认上限 1 万条 trace，重启即空；要留历史得接 Jaeger / Tempo。
- 独立模式 Dashboard 没有资源列表（那是 AppHost 编排才有的能力），只能看遥测。
- `ASPIRE_DASHBOARD_UNSECURED_ALLOW_ANONYMOUS=true` 仅限本地；上线请走 OTel Collector 中转，不要把 Dashboard 和采集端点暴露到公网。
- Angular 22 的 CLI 要求 Node ≥ 22.22.3，本仓库用 Angular 21 生成（Node 22.22.2 可用）。
