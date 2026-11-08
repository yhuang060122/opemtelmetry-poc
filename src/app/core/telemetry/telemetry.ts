import { trace } from '@opentelemetry/api';
import { ZoneContextManager } from '@opentelemetry/context-zone';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { XMLHttpRequestInstrumentation } from '@opentelemetry/instrumentation-xml-http-request';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  ParentBasedSampler,
  SimpleSpanProcessor,
  TraceIdRatioBasedSampler,
  WebTracerProvider,
} from '@opentelemetry/sdk-trace-web';
import { OtelBrowserConfig, resolveOtelConfig } from './telemetry.config';

/**
 * 模块级单例：provider 只能注册一次。
 * 之所以放在模块作用域而不是 Angular DI 里，是因为 SDK 的 register() 是全局副作用，
 * 跟服务实例的生命周期无关；放在 DI 里会让人误以为可以随组件反复创建。
 */
let provider: WebTracerProvider | undefined;

/**
 * 初始化浏览器端追踪。必须在 bootstrapApplication 之前调用。
 *
 * 顺序很关键：instrumentation 会替换全局 fetch / XMLHttpRequest，
 * 如果晚于 Angular 启动，启动阶段发出的请求不会被埋点，
 * 而且 Angular 内部的 fetch 引用可能是替换前的旧引用。
 *
 * 重复调用是安全的（幂等），返回后 SDK 已就绪。
 */
export function initTelemetry(overrides: Partial<OtelBrowserConfig> = {}): void {
  if (provider) {
    return;
  }

  // 优先级：默认值 < window.__OTEL_CONFIG__（运行时注入） < 函数参数（编译期/测试）
  const config: OtelBrowserConfig = { ...resolveOtelConfig(), ...overrides };

  provider = new WebTracerProvider({
    // Resource 描述"这个服务是谁"，会显示在 Dashboard 的 resource 列表和每条 span 上。
    // 用 semconv 常量而不是裸字符串，避免拼错属性名导致面板里查不到。
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.serviceName,
      [ATTR_SERVICE_VERSION]: config.serviceVersion,
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: config.environment,
    }),

    // ParentBasedSampler：入口 span 按比例采样，子 span 跟随父 span 的决定。
    // 这样一条 trace 要么整条留下、要么整条丢弃，不会出现只有半条链路的情况。
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(config.sampleRatio) }),

    // spanProcessors 必须在构造函数里传（SDK 2.x 已移除 addSpanProcessor()）。
    // 多个处理器是并行独立的：同一条 span 会交给每一个，互不影响、也不会重复上报。
    // 两个开关都关掉时数组为空，span 会被直接丢弃——那是配置错误，不是合法用法。
    spanProcessors: [
      // OTLP 通道：BatchSpanProcessor 异步攒批上报，不阻塞业务代码；
      // 只有在页面即将关闭时才需要主动 flush（见下方 pagehide）。
      ...(config.otlpEnabled
        ? [
            new BatchSpanProcessor(
              new OTLPTraceExporter({ url: config.tracesUrl, headers: config.headers }),
              // 2 秒一批 / 32 条上限：面向开发环境"点了就能看到"的体感，
              // 生产环境可以放宽到 5000ms / 512 条，减少上报请求数。
              { scheduledDelayMillis: 2000, maxExportBatchSize: 32 },
            ),
          ]
        : []),
      // Console 通道：用 SimpleSpanProcessor 立即输出，故意不走攒批——
      // 调试时"点一下就得看到"，等 2 秒会让人以为没生效。
      // 代价是同步序列化，所以只用于本地排查，生产关掉（见 telemetry.config.ts）。
      ...(config.consoleExporter ? [new SimpleSpanProcessor(new ConsoleSpanExporter())] : []),
    ],
  });

  // ZoneContextManager 让上下文跟随 Angular 的 zone 传播。
  // 不传的话，await 之后拿不到父 span，嵌套会断成互不相关的平级 span。
  provider.register({ contextManager: new ZoneContextManager() });

  registerInstrumentations({
    tracerProvider: provider,
    instrumentations: [
      // Angular 20+ 的 HttpClient 底层走 fetch；老代码 / 第三方库可能仍是 XHR。
      // 两个都装才不会出现"有的请求有 span、有的没有"的诡异现象。
      new FetchInstrumentation({
        // 只有匹配的跨域地址才会注入 traceparent 头。
        // 别的域名不带，避免把追踪 ID 泄露给第三方服务。
        propagateTraceHeaderCorsUrls: config.propagateToOrigins,
        ignoreUrls: config.ignoreUrls,
      }),
      new XMLHttpRequestInstrumentation({
        propagateTraceHeaderCorsUrls: config.propagateToOrigins,
        ignoreUrls: config.ignoreUrls,
      }),
    ],
  });

  // 页面关闭/切换时把缓冲区里没发出去的 span 冲出去。
  // 用 pagehide 而不是 beforeunload：移动端 Safari 上 beforeunload 常常不触发。
  window.addEventListener('pagehide', () => {
    void provider?.forceFlush();
  });

  // 开发环境打一行确认日志：最常见的故障是端点写错/开关没生效，看一眼就知道
  if (config.environment === 'development') {
    const targets = [
      config.otlpEnabled ? `OTLP ${config.tracesUrl}` : null,
      config.consoleExporter ? 'console' : null,
    ].filter(Boolean);
    console.info(`[otel] tracing enabled → ${targets.length ? targets.join(' + ') : '(无，span 会被丢弃)'}`);
  }
}

/** 读取当前活跃 span 的 traceId；没有活跃 span 时返回 undefined */
export function currentTraceId(): string | undefined {
  return trace.getActiveSpan()?.spanContext().traceId;
}
