# dotnet10-angular-otel-demo

.NET 10 + EF Core 后端、Angular 前端，统一接入 OpenTelemetry，用 .NET Aspire Dashboard 查看 traces / metrics / logs 的最小可运行示例。

一次前端点击，应该能看到这样一条完整链路：

```
otel-demo-web  POST /api/orders        (browser fetch span)
  └─ otel-demo-api  POST /api/orders   (ASP.NET Core server span)
       └─ INSERT INTO "Orders" ...      (EF Core span)
```

## 目录

```
src/app/core/telemetry/telemetry.ts          前端 SDK 初始化、OTLP exporter、fetch/XHR 自动埋点
src/app/core/telemetry/telemetry.config.ts   前端配置（支持 window.__OTEL_CONFIG__ 运行时覆盖）
src/app/core/telemetry/trace.service.ts      前端手写业务 span
backend/OtelDemo.Api/Observability/          后端 OTel 注册（traces + metrics + logs 一次配好）
backend/OtelDemo.Api/Data/                   EF Core DbContext 与实体
backend/OtelDemo.Api/Program.cs              Minimal API：health / orders / slow
compose.yaml                                 Aspire Dashboard（独立模式）
```

## 快速开始

三个终端，按顺序起：

```bash
# 1. Dashboard
npm run otel:up          # http://localhost:18888

# 2. 后端 http://localhost:5080
cd backend/OtelDemo.Api
dotnet run               # 首次会自动建 SQLite 库并写入 2 条种子数据

# 3. 前端 http://localhost:4200
npm install --no-fund --no-audit   # npm 10 若报 edgesOut，改用 npx npm@11 install
npm start
```

打开页面点「加载订单」→ Dashboard 的 **Traces** 页签按页面上的 traceId 搜索。

端口约定（独立模式最容易搞混的地方）：

| 用途 | 宿主端口 | 容器内端口 | 协议 |
| --- | --- | --- | --- |
| Dashboard UI | 18888 | 18888 | HTTP |
| OTLP 接收 | 4317 | 18889 | gRPC（.NET 后端用） |
| OTLP 接收 | 4318 | 18890 | HTTP/protobuf（浏览器只能用这个） |

## 后端配置

端点与协议全部走环境变量，`Properties/launchSettings.json` 里已经配好：

```json
"OTEL_SERVICE_NAME": "otel-demo-api",
"OTEL_EXPORTER_OTLP_ENDPOINT": "http://localhost:4317",
"OTEL_EXPORTER_OTLP_PROTOCOL": "grpc"
```

`Program.cs` 里只有一行接线：

```csharp
builder.AddAppObservability("otel-demo-api");
```

其余（资源属性、采样率、ASP.NET Core / HttpClient / EF Core 埋点、Runtime 指标、日志的 TraceId 关联）都在 `Observability/ObservabilityExtensions.cs`。

几个容易踩的点：

- **EF Core 埋点包是 beta**：`OpenTelemetry.Instrumentation.EntityFrameworkCore`。1.20 起 `SetDbStatementForText`、`SetDbStatementForStoredProcedure` **已被移除**，默认就输出 `db.query.text`（`@p0` 占位符），参数值默认不收集——这个默认值是对的，别把业务数据打到 trace 上。
- **SQLite 不支持 `DateTimeOffset` 排序**：`AppDbContext` 里用值转换器把 `CreatedAt` 存成 UTC `DateTime`，否则 `ORDER BY` 会抛 `NotSupportedException`（本项目已修）。
- **CORS 必须放行 `traceparent` / `tracestate`**：用 `WithHeaders(...)` 白名单时最容易漏，本项目直接 `AllowAnyHeader()`。
- 演示用的是 `EnsureCreated()` + 种子数据，真实项目换 Migrations。

## 前端配置

- `tracesUrl` 必须指 `http://localhost:4318/v1/traces`，浏览器不支持 gRPC（填 4317 会静默失败）。
- Dashboard 要配 `DASHBOARD__OTLP__CORS__ALLOWEDORIGINS` 放行页面来源（`compose.yaml` 已配 `http://localhost:4200`），换端口要同步改。
- `propagateTraceHeaderCorsUrls` 决定往哪些后端地址注入 `traceparent`，默认匹配 `localhost:5000-5999 / 7000-7999`。
- 想在运行时改服务名/端点（比如打到测试环境 collector），在 `index.html` 注入 `window.__OTEL_CONFIG__`，不用重新构建。

## 版本

后端：

```
net10.0 / EF Core 10.0.14
OpenTelemetry.Extensions.Hosting 1.20.1
OpenTelemetry.Exporter.OpenTelemetryProtocol 1.20.1
OpenTelemetry.Instrumentation.AspNetCore 1.20.2
OpenTelemetry.Instrumentation.Http 1.20.2
OpenTelemetry.Instrumentation.Runtime 1.20.1
OpenTelemetry.Instrumentation.EntityFrameworkCore 1.20.2-beta.1
```

前端（浏览器 SDK 版本错位，锁定一套互相兼容的）：

```
@opentelemetry/api 1.9.0
@opentelemetry/sdk-trace-web 2.12.0
@opentelemetry/resources 2.12.0
@opentelemetry/context-zone 2.12.0
@opentelemetry/instrumentation 0.223.0
@opentelemetry/exporter-trace-otlp-proto 0.223.0
@opentelemetry/instrumentation-fetch 0.223.0
@opentelemetry/instrumentation-xml-http-request 0.223.0
@opentelemetry/semantic-conventions 1.45.0
```

`sdk-trace-web` 稳定版还停在 2.12（要求 api < 1.10），而 `resources` / `context-zone` 已到 3.1（要求 api ≥ 1.10），装 latest 必然 peer 冲突。**不要**用 `--legacy-peer-deps` 硬装跨大版本。等 3.x 齐了可整体升。

## 排错

| 现象 | 原因 |
| --- | --- |
| Dashboard 一条 trace 都没有 | Dashboard 没起 / 端口写成 18889 而不是 4317 / 前端写了 4317 而不是 4318 |
| 只有前端 span，没有后端 span | 后端 CORS 没放行 `traceparent`，或 `propagateTraceHeaderCorsUrls` 没匹配到后端地址 |
| 有后端 span，没有 EF Core span | 漏了 `AddEntityFrameworkCoreInstrumentation()`，或查询走的是非 EF 路径 |
| 浏览器控制台报 CORS | `DASHBOARD__OTLP__CORS__ALLOWEDORIGINS` 没包含当前页面 origin |
| 数据过一会儿消失 | Dashboard 是内存存储，默认上限 1 万条 trace，重启即空 |

## 已知限制

- 浏览器端只有 **traces**（可加 logs），没有 metrics。
- 独立模式 Dashboard 没有资源列表和容器控制台（那是 AppHost 编排的能力）。
- `ASPIRE_DASHBOARD_UNSECURED_ALLOW_ANONYMOUS=true` 仅限本地；上线请走 OTel Collector 中转，不要把 Dashboard 和采集端点暴露到公网。
- Angular 22 CLI 要求 Node ≥ 22.22.3，本仓库用 Angular 21 生成（当前 Node 22.22.2 可用）。
