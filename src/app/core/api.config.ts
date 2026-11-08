/**
 * 后端 API 地址，改成你实际 ASP.NET Core 的地址/端口。
 *
 * 换地址时记得同步检查 telemetry.config.ts 里的 propagateToOrigins，
 * 新地址不在那个正则范围内的话，traceparent 不会被注入，前后端 trace 就断开了。
 */
export const API_BASE_URL = 'http://localhost:5080';
