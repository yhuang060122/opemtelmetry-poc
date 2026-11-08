import { Injectable } from '@angular/core';
import { Attributes, Span, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';

const TRACER_NAME = 'angular-otel-demo';
const TRACER_VERSION = '1.0.0';

/**
 * 手写业务 span 的入口。HTTP 请求有自动埋点，业务语义靠这里补。
 */
@Injectable({ providedIn: 'root' })
export class TraceService {
  private readonly tracer = trace.getTracer(TRACER_NAME, TRACER_VERSION);

  /** 当前所在 span 的 traceId，用于页面上展示、方便去 Dashboard 搜索 */
  currentTraceId(): string | undefined {
    return trace.getActiveSpan()?.spanContext().traceId;
  }

  /**
   * 开一个 span 包住异步逻辑；异常会记录到 span 上并继续抛出。
   * 在 work 里再调用 run() 会自动挂成子 span，共享同一条 trace。
   */
  async run<T>(
    name: string,
    attributes: Attributes = {},
    work: (span: Span) => Promise<T>,
  ): Promise<T> {
    return this.tracer.startActiveSpan(
      name,
      { kind: SpanKind.INTERNAL, attributes },
      async (span: Span) => {
        try {
          const result = await work(span);
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (error) {
          span.recordException(error as Error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
          });
          throw error;
        } finally {
          span.end();
        }
      },
    );
  }
}
