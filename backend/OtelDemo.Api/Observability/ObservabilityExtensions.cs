using OpenTelemetry;
using OpenTelemetry.Logs;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;

namespace OtelDemo.Api.Observability;

public static class ObservabilityExtensions
{
    /// <summary>
    /// 注册 OpenTelemetry：traces + metrics + logs，统一通过 OTLP 导出。
    /// 端点/协议由环境变量决定：OTEL_EXPORTER_OTLP_ENDPOINT、OTEL_EXPORTER_OTLP_PROTOCOL。
    /// </summary>
    public static IHostApplicationBuilder AddAppObservability(
        this IHostApplicationBuilder builder, string serviceName)
    {
        var env = builder.Environment;
        var sampleRatio = builder.Configuration.GetValue("Observability:SamplerRatio", 1.0);

        builder.Services.AddOpenTelemetry()
            .ConfigureResource(resource => resource
                .AddService(serviceName, serviceVersion: "1.0.0")
                .AddAttributes(new Dictionary<string, object>
                {
                    ["deployment.environment.name"] = env.EnvironmentName,
                }))
            .WithTracing(tracing => tracing
                .SetSampler(new ParentBasedSampler(new TraceIdRatioBasedSampler(sampleRatio)))
                // 自定义 ActivitySource（例如 "otel-demo-api.*"）需要在这里登记
                .AddSource("otel-demo-api.*")
                .AddAspNetCoreInstrumentation(options =>
                {
                    options.RecordException = true;
                    options.Filter = context =>
                        !context.Request.Path.StartsWithSegments("/health") &&
                        !context.Request.Path.StartsWithSegments("/alive");
                })
                .AddHttpClientInstrumentation(options => options.RecordException = true)
                // 1.20+ 默认输出 db.query.text（@p0 占位符），不收集参数值；
                // 老版本的 SetDbStatementForText / SetDbStatementForStoredProcedure 已被移除
                .AddEntityFrameworkCoreInstrumentation())
            .WithMetrics(metrics => metrics
                .AddAspNetCoreInstrumentation()
                .AddHttpClientInstrumentation()
                .AddRuntimeInstrumentation()
                .AddMeter("otel-demo-api.*"))
            .UseOtlpExporter();

        builder.Logging.AddOpenTelemetry(logging =>
        {
            logging.IncludeFormattedMessage = true;
            logging.IncludeScopes = true;
            // 结构化属性 + TraceId/SpanId 一起上报，Dashboard 里能按 trace 过滤日志
            logging.ParseStateValues = true;
        });

        return builder;
    }
}
