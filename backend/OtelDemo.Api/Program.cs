using System.Diagnostics;
using Microsoft.EntityFrameworkCore;
using OtelDemo.Api.Data;
using OtelDemo.Api.Observability;

var builder = WebApplication.CreateBuilder(args);

// 唯一需要加的遥测入口：traces / metrics / logs 都在这个扩展里。
// serviceName 决定 Dashboard 里的服务分组名，建议和容器名/应用名保持一致。
builder.AddAppObservability("otel-demo-api");

// SQLite 只为演示免安装：真实项目换成 UseNpgsql / UseSqlServer 即可，
// EF Core 埋点与数据库无关，不需要改任何遥测代码。
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlite(
        builder.Configuration.GetConnectionString("Default") ?? "Data Source=otel-demo.db"));

const string AngularDevPolicy = "angular-dev";
builder.Services.AddCors(options => options.AddPolicy(AngularDevPolicy, policy => policy
    .WithOrigins("http://localhost:4200")
    // traceparent / tracestate 必须能通过。
    // 用 WithHeaders 白名单时最容易漏掉这两个——后果是前端 span 和后端 span
    // 各自成一条 trace，Dashboard 里永远拼不起来，而且浏览器只在控制台报 CORS 警告。
    .AllowAnyHeader()
    .AllowAnyMethod()));

var app = builder.Build();

// 演示用建库 + 种子数据；真实项目走 EF Core Migrations。
// 放在管道之前、进程启动时执行，确保首次请求就能查到数据。
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.EnsureCreated();

    if (!db.Orders.Any())
    {
        db.Orders.AddRange(
            new Order { Customer = "张三", Amount = 128.50m, CreatedAt = DateTimeOffset.UtcNow },
            new Order { Customer = "李四", Amount = 899.00m, CreatedAt = DateTimeOffset.UtcNow });
        db.SaveChanges();
    }
}

// 必须在端点映射之前：中间件顺序错了会导致预检请求 404
app.UseCors(AngularDevPolicy);

// 健康检查：回显 traceId，用它对照前端页面和 Dashboard 里的同一条 trace。
// 注意这里返回的是"处理本次请求的 server span"的 traceId，
// 如果和前端拿到的不一样，说明 traceparent 没传过来（八成是 CORS 头没放行）。
app.MapGet("/api/health", () => Results.Ok(new
{
    status = "ok",
    service = "otel-demo-api",
    // 回传 traceId，方便跟前端页面和 Dashboard 对照
    traceId = Activity.Current?.TraceId.ToString(),
    at = DateTimeOffset.UtcNow,
}));

// 一次普通查询：AsNoTracking 只影响 EF 行为，不影响埋点，
// 但能顺带演示"查询里有排序"时生成的 SQL span 长什么样。
app.MapGet("/api/orders", async (AppDbContext db) =>
    await db.Orders.AsNoTracking().OrderByDescending(o => o.CreatedAt).ToListAsync());

// 写入路径：验证 EF Core 的 INSERT span 以及 ValidationProblem 产生的 400 span
app.MapPost("/api/orders", async (CreateOrderRequest request, AppDbContext db) =>
{
    // 手写校验（示例项目不引 FluentValidation），错误按字段聚合返回
    var errors = new Dictionary<string, string[]>();
    if (string.IsNullOrWhiteSpace(request.Customer))
    {
        errors["customer"] = ["客户名不能为空"];
    }
    if (request.Amount <= 0)
    {
        errors["amount"] = ["金额必须大于 0"];
    }
    if (errors.Count > 0)
    {
        // 返回 400 会让 server span 标记为错误吗？不会——4xx 默认不算异常，
        // 这是有意的设计（客户端问题不该污染服务端错误率）
        return Results.ValidationProblem(errors);
    }

    var order = new Order
    {
        Customer = request.Customer.Trim(),
        Amount = request.Amount,
        CreatedAt = DateTimeOffset.UtcNow,
    };
    db.Orders.Add(order);
    await db.SaveChangesAsync();

    return Results.Created($"/api/orders/{order.Id}", order);
});

// 人为慢请求：用来看 span 时长分布、验证采样与 Dashboard 的瀑布图。
// 上限 5000ms，防止被当成压测工具。
app.MapGet("/api/slow", async (int? ms) =>
{
    var delay = Math.Clamp(ms ?? 300, 0, 5000);
    await Task.Delay(delay);
    return Results.Ok(new { delayedMs = delay });
});

app.Run();

/// <summary>下单请求体。用 record 让 Minimal API 自动完成 JSON 反序列化。</summary>
public record CreateOrderRequest(string Customer, decimal Amount);
