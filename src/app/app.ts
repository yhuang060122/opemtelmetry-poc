import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from './core/api.config';
import { resolveOtelConfig } from './core/telemetry/telemetry.config';
import { TraceService } from './core/telemetry/trace.service';

/** 模拟业务耗时，用来看 span 时长在 Dashboard 里的横向占比 */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 演示页面。三个按钮分别验证三种链路：
 * 1. 浏览器 → 后端 → 返回（自动埋点 + 手动 span + traceparent 透传）
 * 2. 浏览器 → 后端 → EF Core SELECT（多一层数据库 span）
 * 3. 纯前端三层嵌套（验证父子关系与属性、事件）
 */
@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly http = inject(HttpClient);
  private readonly traceService = inject(TraceService);

  /** 页面底部展示当前配置，方便确认"到底连到哪个端点"——最常见的问题就出在这里 */
  protected readonly apiBase = API_BASE_URL;
  protected readonly tracesUrl = resolveOtelConfig().tracesUrl;
  protected readonly serviceName = resolveOtelConfig().serviceName;

  /** 最近一次操作的 traceId，直接贴到 Dashboard 搜索框就能定位 */
  protected readonly traceId = signal('—');
  /** 请求进行中，用于禁用按钮，避免连点产生一堆并行 trace 干扰观察 */
  protected readonly busy = signal(false);
  /** 页面上的滚动日志，同时充当"浏览器控制台之外的观察窗口" */
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
      // 这里包一层手动 span，是为了让 trace 的根节点是 demo.api-health 而不是裸的 fetch。
      // 自动埋点的 fetch span 会成为它的子节点，Dashboard 里层级更清楚。
      await this.traceService.run('demo.api-health', { 'demo.origin': 'angular' }, async (span) => {
        this.traceId.set(span.spanContext().traceId);
        // observe: 'response' 才能拿到状态码；responseType: 'text' 因为后端返回的是 JSON 字符串
        const res = await firstValueFrom(
          this.http.get(`${this.apiBase}/api/health`, { observe: 'response', responseType: 'text' }),
        );
        // 响应体截断后存进 span：排查时不用再翻浏览器网络面板
        span.setAttribute('http.response.body', String(res.body).slice(0, 120));
        this.push(`✓ ${res.status} — 后端应出现同 traceId 的 server span`);
      });
    } catch (error) {
      // 后端没起也照样上报 browser span，这本身就是有用的信号：
      // Dashboard 里能看到一条 ERROR 状态的 span，而不是"什么都没有"。
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
        // 业务属性：有了它就能在 Dashboard 里按"返回空结果"的 trace 筛出异常情况
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
      // 最外层：结算。子 span 不传父节点，靠 async context（ZoneContextManager）自动挂接
      await this.traceService.run('demo.checkout', { 'order.lines': 3, 'order.currency': 'CNY' }, async (checkout) => {
        this.traceId.set(checkout.spanContext().traceId);
        await sleep(60);

        // 第二层：定价。串行 await 而不是 Promise.all，
        // 并行的话两个 span 会时间重叠，看图时分不清先后
        await this.traceService.run('demo.pricing', { 'pricing.rules': 4 }, async (pricing) => {
          await sleep(120);
          // event 不带时长，适合记录"某个瞬间发生了什么"（命中规则、缓存失效等）
          pricing.addEvent('discount-applied', { 'discount.percent': 12 });
        });

        // 第二层：落库。真实项目里这层通常是自动埋点生成的，
        // 这里手写是为了演示"没有网络调用时如何表达数据库语义"
        await this.traceService.run('demo.persist', { 'db.system': 'postgresql' }, async () => {
          await sleep(80);
        });

        this.push('✓ 3 个嵌套 span 已生成，共享同一条 trace');
      });
    } finally {
      this.busy.set(false);
    }
  }

  /** 只保留最近 12 条，避免页面越跑越长 */
  private push(line: string): void {
    const stamp = new Date().toLocaleTimeString();
    this.log.update((lines) => [`${stamp}  ${line}`, ...lines].slice(0, 12));
  }
}

/** 与后端 Order 实体的字段保持一致（最小投影，够页面展示即可） */
export interface OrderRow {
  id: number;
  customer: string;
  amount: number;
  createdAt: string;
}
