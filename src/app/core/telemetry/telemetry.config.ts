/**
 * 浏览器端遥测配置。
 *
 * 设计目标：同一份构建产物能在不同环境复用。
 * 所以端点这类环境相关的值不写死在代码里，而是允许 index.html 通过
 * window.__OTEL_CONFIG__ 在运行时覆盖，运维改一个内联脚本即可，不用重新打包。
 */
export interface OtelBrowserConfig {
  /** 服务名，Dashboard 的 resource 列表里就按这个分组 */
  serviceName: string;
  /** 版本号，配合服务名定位"这个错误是哪个版本引入的" */
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
    /**
     * 运行时覆盖入口，在 index.html 里以 <script> 方式写在应用脚本之前。
     * 只开放标量字段：正则类字段无法从 JSON 安全还原，故意不放出来。
     */
    __OTEL_CONFIG__?: Partial<
      Pick<OtelBrowserConfig, 'serviceName' | 'tracesUrl' | 'environment' | 'sampleRatio' | 'headers'>
    >;
  }
}

/** 兜底默认值：全部指向本地开发环境，克隆仓库直接跑就能出数据 */
const DEFAULTS: OtelBrowserConfig = {
  serviceName: 'otel-demo-web',
  serviceVersion: '1.0.0',
  environment: 'development',
  tracesUrl: 'http://localhost:4318/v1/traces',
  // 本地后端端口（5000~5999 / 7000~7999）默认都注入 traceparent。
  // 换到测试/生产要在 __OTEL_CONFIG__ 里补，或者改这里。
  propagateToOrigins: [/^https?:\/\/localhost:(5\d{3}|7\d{3})\//],
  sampleRatio: 1,
  // 静态资源不产生 span，否则 Dashboard 会被一堆 assets 请求淹没
  ignoreUrls: [/\/assets\//, /\/favicon\.ico/],
};

/**
 * 合并三层配置，得到最终生效值。
 * 正则字段强制用默认值：字符串形式的正则没法安全还原语义，
 * 与其让运维踩坑，不如直接不开放覆盖。
 */
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
