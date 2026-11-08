import { provideHttpClient } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';

/**
 * 应用全局 provider。
 *
 * 注意这里没有放追踪初始化：SDK 的 register() 是全局副作用，
 * 必须早于 bootstrap 执行（见 main.ts），放进 providers 就晚了。
 */
export const appConfig: ApplicationConfig = {
  providers: [
    // 把未捕获的异常交给 Angular 的全局错误处理，避免静默失败
    provideBrowserGlobalErrorListeners(),
    // HttpClient 已启用，底层请求会被 fetch / XHR instrumentation 自动埋点
    provideHttpClient(),
  ],
};
