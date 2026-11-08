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
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  WebTracerProvider,
} from '@opentelemetry/sdk-trace-web';
import { OtelBrowserConfig, resolveOtelConfig } from './telemetry.config';

let provider: WebTracerProvider | undefined;

/**
 * 必须在 bootstrapApplication 之前调用一次。
 * 重复调用是安全的（幂等）。
 */
export function initTelemetry(overrides: Partial<OtelBrowserConfig> = {}): void {
  if (provider) {
    return;
  }

  const config: OtelBrowserConfig = { ...resolveOtelConfig(), ...overrides };

  provider = new WebTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.serviceName,
      [ATTR_SERVICE_VERSION]: config.serviceVersion,
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: config.environment,
    }),
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(config.sampleRatio) }),
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({ url: config.tracesUrl, headers: config.headers }),
        { scheduledDelayMillis: 2000, maxExportBatchSize: 32 },
      ),
    ],
  });

  provider.register({ contextManager: new ZoneContextManager() });

  registerInstrumentations({
    tracerProvider: provider,
    instrumentations: [
      // Angular 20+ 默认走 fetch；老代码 / 第三方库可能还是 XHR，两个都装上
      new FetchInstrumentation({
        propagateTraceHeaderCorsUrls: config.propagateToOrigins,
        ignoreUrls: config.ignoreUrls,
      }),
      new XMLHttpRequestInstrumentation({
        propagateTraceHeaderCorsUrls: config.propagateToOrigins,
        ignoreUrls: config.ignoreUrls,
      }),
    ],
  });

  // 页面关闭时把缓冲区里的 span 冲出去，否则短会话容易丢最后一批
  window.addEventListener('pagehide', () => {
    void provider?.forceFlush();
  });

  if (config.environment === 'development') {
    console.info('[otel] tracing enabled →', config.tracesUrl);
  }
}

export function currentTraceId(): string | undefined {
  return trace.getActiveSpan()?.spanContext().traceId;
}
