using System.Diagnostics;
using Microsoft.EntityFrameworkCore;
using OtelDemo.Api.Data;
using OtelDemo.Api.Observability;

var builder = WebApplication.CreateBuilder(args);

// 唯一需要加的遥测入口：traces / metrics / logs 都在这个扩展里
builder.AddAppObservability("otel-demo-api");

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlite(
        builder.Configuration.GetConnectionString("Default") ?? "Data Source=otel-demo.db"));

const string AngularDevPolicy = "angular-dev";
builder.Services.AddCors(options => options.AddPolicy(AngularDevPolicy, policy => policy
    .WithOrigins("http://localhost:4200")
    // traceparent / tracestate 必须能通过；用 WithHeaders 白名单时最容易漏这两个
    .AllowAnyHeader()
    .AllowAnyMethod()));

var app = builder.Build();

// 演示用建库 + 种子数据；真实项目走 EF Core Migrations
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

app.UseCors(AngularDevPolicy);

app.MapGet("/api/health", () => Results.Ok(new
{
    status = "ok",
    service = "otel-demo-api",
    // 回传 traceId，方便跟前端页面和 Dashboard 对照
    traceId = Activity.Current?.TraceId.ToString(),
    at = DateTimeOffset.UtcNow,
}));

app.MapGet("/api/orders", async (AppDbContext db) =>
    await db.Orders.AsNoTracking().OrderByDescending(o => o.CreatedAt).ToListAsync());

app.MapPost("/api/orders", async (CreateOrderRequest request, AppDbContext db) =>
{
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

// 人为慢请求：用来看 span 时长分布
app.MapGet("/api/slow", async (int? ms) =>
{
    var delay = Math.Clamp(ms ?? 300, 0, 5000);
    await Task.Delay(delay);
    return Results.Ok(new { delayedMs = delay });
});

app.Run();

public record CreateOrderRequest(string Customer, decimal Amount);
