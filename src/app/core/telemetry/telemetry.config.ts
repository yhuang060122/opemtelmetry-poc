/**
 * 浏览器端遥测配置。
 * 所有值都可以在运行时通过 index.html 里的 window.__OTEL_CONFIG__ 覆盖，无需重新构建。
 */
export interface OtelBrowserConfig {
  serviceName: string;
  serviceVersion: string;
  /** 显示在 Aspire Dashboard 的 resource 属性上，例如 development / staging / production */
  environment: string;
  /** Dashboard 的 OTLP/HTTP 端点。注意是 4318（HTTP），不是 4317（gRPC，浏览器用不了） */
  tracesUrl: string;
  /** 需要注入 traceparent 的后端地址，不配的话跨域请求会被浏览器拦掉追踪头 */
  propagateToOrigins: (string | RegExp)[];
  /** 采样率 0~1，开发环境用 1 便于排查 */
  sampleRatio: number;
  /** 不产生 span 的请求 */
  ignoreUrls: RegExp[];
  /** Dashboard 开启 OTLP API Key 时才需要 */
  headers?: Record<string, string>;
}

declare global {
  interface Window {
    __OTEL_CONFIG__?: Partial<
      Pick<OtelBrowserConfig, 'serviceName' | 'tracesUrl' | 'environment' | 'sampleRatio' | 'headers'>
    >;
  }
}

const DEFAULTS: OtelBrowserConfig = {
  serviceName: 'otel-demo-web',
  serviceVersion: '1.0.0',
  environment: 'development',
  tracesUrl: 'http://localhost:4318/v1/traces',
  // 本地后端端口（5000~5999 / 7000~7999）默认都注入 traceparent
  propagateToOrigins: [/^https?:\/\/localhost:(5\d{3}|7\d{3})\//],
  sampleRatio: 1,
  ignoreUrls: [/\/assets\//, /\/favicon\.ico/],
};

export function resolveOtelConfig(): OtelBrowserConfig {
  const runtime = typeof window === 'undefined' ? undefined : window.__OTEL_CONFIG__;

  return {
    ...DEFAULTS,
    ...runtime,
    // 正则不从运行时覆盖，避免出现类型/语义都错的字符串
    propagateToOrigins: DEFAULTS.propagateToOrigins,
    ignoreUrls: DEFAULTS.ignoreUrls,
  };
}
