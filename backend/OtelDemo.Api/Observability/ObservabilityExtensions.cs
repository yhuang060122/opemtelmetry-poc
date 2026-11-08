using OpenTelemetry.Logs;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;

namespace OtelDemo.Api.Observability;

/// <summary>
/// OpenTelemetry 接线集中在这里，Program.cs 只留一行调用。
/// 换成真实项目时整个文件可以直接拷走，只需改 serviceName 和自定义 ActivitySource 前缀。
/// </summary>
public static class ObservabilityExtensions
{
    /// <summary>
    /// 注册 OpenTelemetry：traces + metrics + logs。
    ///
    /// 导出目标可组合（见 Observability 配置节）：
    /// - OTLP    → Aspire Dashboard / Collector，端点由 OTEL_EXPORTER_OTLP_ENDPOINT 等标准环境变量决定
    /// - Console → 直接打到 stdout，没有 Dashboard 时靠它自查
    /// 两个 exporter 是各自独立的 processor，可以只开一个，也可以同时开。
    /// </summary>
    public static IHostApplicationBuilder AddAppObservability(
        this IHostApplicationBuilder builder, string serviceName)
    {
        var env = builder.Environment;
        // 采样率默认 1.0（全采）。生产环境建议按流量调，例如 0.1 表示只留 10% 的 trace，
        // 配合 ParentBasedSampler 保证一条链路要么整体保留、要么整体丢弃。
        var sampleRatio = builder.Configuration.GetValue("Observability:SamplerRatio", 1.0);

        // 是否发到 OTLP 后端。Dashboard 没起时关掉，否则 SDK 会不断重试并刷
        // "Connection refused" 日志，把真正要看的 console 输出淹掉。
        var otlpEnabled = builder.Configuration.GetValue("Observability:OtlpEnabled", true);

        // 是否额外打到控制台。开发环境默认开（不需要任何基础设施就能看到 span），
        // 生产默认关：输出量大，且会带上完整的 SQL 文本和内部 URL。
        var consoleEnabled = builder.Configuration.GetValue(
            "Observability:ConsoleExporter", env.IsDevelopment());

        builder.Services.AddOpenTelemetry()
            // Resource 描述"这个服务是谁"，作为所有 span/metric/log 的公共属性上报。
            // 没有它，Dashboard 里所有服务都会堆在 unknown_service 下面。
            .ConfigureResource(resource => resource
                .AddService(serviceName, serviceVersion: "1.0.0")
                .AddAttributes(new Dictionary<string, object>
                {
                    // 用 semconv 规范名，Grafana/Jaeger 等后端对这个键有内置支持
                    ["deployment.environment.name"] = env.EnvironmentName,
                }))
            .WithTracing(tracing =>
            {
                tracing
                    .SetSampler(new ParentBasedSampler(new TraceIdRatioBasedSampler(sampleRatio)))
                    // 自定义 ActivitySource（例如 "otel-demo-api.*"）需要在这里登记，
                    // 否则业务代码里 new ActivitySource(...) 产生的 span 不会出现在结果里。
                    // 通配符只在 AddSource 这种匹配场景有效，创建时仍要写完整名字。
                    .AddSource("otel-demo-api.*")
                    .AddAspNetCoreInstrumentation(options =>
                    {
                        // 把未处理异常的堆栈挂到 server span 上，Dashboard 能直接展开看
                        options.RecordException = true;
                        // 健康检查/存活探针频率极高且没有诊断价值，过滤掉可以省下大量存储
                        options.Filter = context =>
                            !context.Request.Path.StartsWithSegments("/health") &&
                            !context.Request.Path.StartsWithSegments("/alive");
                    })
                    // 记录出站 HTTP 调用的状态码与耗时，跨服务链路靠它衔接
                    .AddHttpClientInstrumentation(options => options.RecordException = true)
                    // 1.20+ 默认输出 db.query.text（@p0 占位符），不收集参数值，这个默认值就是安全的，别去打开。
                    // 老版本的 SetDbStatementForText / SetDbStatementForStoredProcedure 已被移除，
                    // 升级时如果还留着旧属性名会编译失败。
                    .AddEntityFrameworkCoreInstrumentation();

                if (otlpEnabled)
                {
                    tracing.AddOtlpExporter();
                }

                if (consoleEnabled)
                {
                    // 每条 span 结束就同步打印一段 JSON，适合本地调试，不适合压测场景
                    tracing.AddConsoleExporter();
                }
            })
            .WithMetrics(metrics =>
            {
                metrics
                    // 请求量、响应时间、活跃连接数
                    .AddAspNetCoreInstrumentation()
                    // 出站调用耗时，用于定位下游变慢
                    .AddHttpClientInstrumentation()
                    // GC、堆内存、线程池、异常数——.NET 独有的运行时指标，排内存/线程饥饿必看
                    .AddRuntimeInstrumentation()
                    // 自定义 Meter 前缀，业务指标（如"每分钟下单数"）登记在这里
                    .AddMeter("otel-demo-api.*");

                if (otlpEnabled)
                {
                    metrics.AddOtlpExporter();
                }

                if (consoleEnabled)
                {
                    // 注意：metrics 是周期性导出的（默认约 60 秒一次），
                    // 打开后控制台每个周期会刷一大段，调试完记得关。
                    metrics.AddConsoleExporter();
                }
            });

        // 日志走独立的注册入口（OpenTelemetry 不在 AddOpenTelemetry 链上管日志）
        builder.Logging.AddOpenTelemetry(logging =>
        {
            // 保留格式化后的完整消息，否则 Dashboard 里只看到模板名和一堆属性
            logging.IncludeFormattedMessage = true;
            // 带上 ILogger 的 scope（如请求上下文），便于按业务维度过滤
            logging.IncludeScopes = true;
            // 把 {Placeholder} 解析成结构化字段。这是"按 TraceId 过滤日志"能生效的前提
            logging.ParseStateValues = true;

            if (otlpEnabled)
            {
                logging.AddOtlpExporter();
            }

            if (consoleEnabled)
            {
                // 会与默认的 console logging provider 各打一份，同样的日志出现两遍：
                // 一遍普通格式、一遍带 TraceId/SpanId。这是预期行为，不是 bug。
                logging.AddConsoleExporter();
            }
        });

        return builder;
    }
}
