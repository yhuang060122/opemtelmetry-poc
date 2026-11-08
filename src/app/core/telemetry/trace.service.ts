import { Injectable } from '@angular/core';
import { Attributes, Span, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';

/** tracer 的命名空间，通常与包名/模块名一致；在 Dashboard 里能看出 span 是哪个库产生的 */
const TRACER_NAME = 'otel-demo-web';
const TRACER_VERSION = '1.0.0';

/**
 * 手写业务 span 的入口。
 *
 * 自动埋点只能告诉你"发了个 GET /api/orders 用了 120ms"，
 * 但抓不到业务语义（结算、定价、库存扣减……）。
 * 凡是"用户能感知、但代码里没有网络调用"的步骤，都应该用这里补一个 span。
 */
@Injectable({ providedIn: 'root' })
export class TraceService {
  private readonly tracer = trace.getTracer(TRACER_NAME, TRACER_VERSION);

  /** 当前所在 span 的 traceId，用于页面上展示、方便去 Dashboard 搜索 */
  currentTraceId(): string | undefined {
    return trace.getActiveSpan()?.spanContext().traceId;
  }

  /**
   * 开一个 span 包住异步逻辑，结束后自动关闭（含异常路径）。
   *
   * @param name       span 名称，建议用 `域.动作` 形式，例如 demo.checkout
   * @param attributes 初始属性；span 是可变对象，之后还能用 span.setAttribute 追加
   * @param work       实际业务逻辑，接收 span 以便中途补充属性/事件
   *
   * 在 work 里再调用 run() 会自动挂成子 span，共享同一条 trace。
   * 异常会记录到 span 上并原样抛出，调用方的 try/catch 行为不变。
   */
  async run<T>(
    name: string,
    attributes: Attributes = {},
    work: (span: Span) => Promise<T>,
  ): Promise<T> {
    return this.tracer.startActiveSpan(
      name,
      // INTERNAL：纯应用内部逻辑。如果是消息队列/定时任务这类入口可用 PRODUCER/CONSUMER，
      // 对外 HTTP 调用则交给自动埋点，不要手写成 CLIENT，否则会出现重复 span。
      { kind: SpanKind.INTERNAL, attributes },
      async (span: Span) => {
        try {
          const result = await work(span);
          // 显式标记 OK：不设置时 Dashboard 会显示为 UNSET，跟"未完成"混在一起
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (error) {
          // recordException 记录完整堆栈（Dashboard 的 Exceptions 页签能展开）；
          // setStatus 只记录消息，用于在 trace 列表里标红。两者互补，缺一不可。
          span.recordException(error as Error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
          });
          throw error;
        } finally {
          // 必须 end()，否则 span 永远不会被导出，内存里越积越多
          span.end();
        }
      },
    );
  }
}
