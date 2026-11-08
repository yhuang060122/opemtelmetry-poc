import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from './core/api.config';
import { resolveOtelConfig } from './core/telemetry/telemetry.config';
import { TraceService } from './core/telemetry/trace.service';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly http = inject(HttpClient);
  private readonly traceService = inject(TraceService);

  protected readonly apiBase = API_BASE_URL;
  protected readonly tracesUrl = resolveOtelConfig().tracesUrl;
  protected readonly serviceName = resolveOtelConfig().serviceName;

  protected readonly traceId = signal('—');
  protected readonly busy = signal(false);
  protected readonly log = signal<string[]>([]);
  protected readonly orders = signal<OrderRow[]>([]);

  /** 走真实 HTTP 请求：验证 traceparent 是否注入了后端调用 */
  protected async callApi(): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    this.push(`GET ${this.apiBase}/api/health`);

    try {
      await this.traceService.run('demo.api-health', { 'demo.origin': 'angular' }, async (span) => {
        this.traceId.set(span.spanContext().traceId);
        const res = await firstValueFrom(
          this.http.get(`${this.apiBase}/api/health`, { observe: 'response', responseType: 'text' }),
        );
        span.setAttribute('http.response.body', String(res.body).slice(0, 120));
        this.push(`✓ ${res.status} — 后端应出现同 traceId 的 server span`);
      });
    } catch (error) {
      // 后端没起也照样上报 browser span，这本身就是有用的信号
      this.push(`✗ ${error instanceof Error ? error.message : String(error)}`);
      this.push('（span 已上报，可在 Dashboard 看到失败状态）');
    } finally {
      this.busy.set(false);
    }
  }

  /** 触发一次 EF Core 查询：后端会多出 SELECT span，整条链路完整 */
  protected async loadOrders(): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    this.push(`GET ${this.apiBase}/api/orders`);

    try {
      await this.traceService.run('demo.orders-list', { 'demo.origin': 'angular' }, async (span) => {
        this.traceId.set(span.spanContext().traceId);
        const rows = await firstValueFrom(this.http.get<OrderRow[]>(`${this.apiBase}/api/orders`));
        this.orders.set(rows);
        span.setAttribute('orders.count', rows.length);
        this.push(`✓ ${rows.length} 条订单 — 后端应有 EF Core 的 SELECT span`);
      });
    } catch (error) {
      this.push(`✗ ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.busy.set(false);
    }
  }

  /** 纯前端业务链路：演示嵌套 span 与属性 */
  protected async runWorkload(): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);

    try {
      await this.traceService.run('demo.checkout', { 'order.lines': 3, 'order.currency': 'CNY' }, async (checkout) => {
        this.traceId.set(checkout.spanContext().traceId);
        await sleep(60);

        await this.traceService.run('demo.pricing', { 'pricing.rules': 4 }, async (pricing) => {
          await sleep(120);
          pricing.addEvent('discount-applied', { 'discount.percent': 12 });
        });

        await this.traceService.run('demo.persist', { 'db.system': 'postgresql' }, async () => {
          await sleep(80);
        });

        this.push('✓ 3 个嵌套 span 已生成，共享同一条 trace');
      });
    } finally {
      this.busy.set(false);
    }
  }

  private push(line: string): void {
    const stamp = new Date().toLocaleTimeString();
    this.log.update((lines) => [`${stamp}  ${line}`, ...lines].slice(0, 12));
  }
}

export interface OrderRow {
  id: number;
  customer: string;
  amount: number;
  createdAt: string;
}
