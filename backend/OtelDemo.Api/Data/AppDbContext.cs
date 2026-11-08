using Microsoft.EntityFrameworkCore;

namespace OtelDemo.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Order> Orders => Set<Order>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Order>(entity =>
        {
            entity.Property(o => o.Customer).HasMaxLength(100).IsRequired();
            entity.Property(o => o.Amount).HasPrecision(18, 2);

            // SQLite 不支持对 DateTimeOffset 做 ORDER BY，
            // 落库时转成 UTC DateTime，读回再包回 DateTimeOffset
            entity.Property(o => o.CreatedAt)
                .HasConversion(
                    value => value.UtcDateTime,
                    value => new DateTimeOffset(DateTime.SpecifyKind(value, DateTimeKind.Utc)));

            entity.HasIndex(o => o.CreatedAt);
        });
    }
}
