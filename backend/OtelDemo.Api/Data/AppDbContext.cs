using Microsoft.EntityFrameworkCore;

namespace OtelDemo.Api.Data;

/// <summary>
/// 演示用 DbContext（SQLite）。
///
/// 关于埋点：EF Core 的 span 由 OpenTelemetry.Instrumentation.EntityFrameworkCore 自动产出，
/// 不需要在这里写任何代码。但前提是 DbContext 必须通过 DI 正常解析——
/// 如果某处直接 new AppDbContext(...) 绕过了 DI，那条查询就永远不会有 span。
/// </summary>
public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Order> Orders => Set<Order>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Order>(entity =>
        {
            entity.Property(o => o.Customer).HasMaxLength(100).IsRequired();
            // decimal 必须显式声明精度，否则部分数据库会给告警或静默截断
            entity.Property(o => o.Amount).HasPrecision(18, 2);

            // SQLite 不支持对 DateTimeOffset 做 ORDER BY（会抛 NotSupportedException），
            // 落库时转成 UTC DateTime，读回再包回 DateTimeOffset。
            // 换成 PostgreSQL / SQL Server 就不需要这段，可以直接删掉。
            entity.Property(o => o.CreatedAt)
                .HasConversion(
                    value => value.UtcDateTime,
                    value => new DateTimeOffset(DateTime.SpecifyKind(value, DateTimeKind.Utc)));

            // CreatedAt 是列表查询的排序键，加索引避免全表扫描
            entity.HasIndex(o => o.CreatedAt);
        });
    }
}
