import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { initTelemetry } from './app/core/telemetry/telemetry';

// 必须在 bootstrap 之前：让 instrumentation 先接管 fetch / XHR
initTelemetry();

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
