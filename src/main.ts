import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { initTelemetry } from './app/core/telemetry/telemetry';

// 必须在 bootstrap 之前：让 instrumentation 先接管 fetch / XHR。
// 反过来写的话，Angular 启动阶段发出的请求（懒加载 chunk、首屏配置接口）
// 会带着到旧引用直接发出去，永远不会有 span。
// 这里不做 await：追踪初始化是同步的，而且不能因为上报失败拖慢首屏。
initTelemetry();

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
