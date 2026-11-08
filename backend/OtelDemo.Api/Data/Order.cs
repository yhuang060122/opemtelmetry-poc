namespace OtelDemo.Api.Data;

/// <summary>
/// 订单实体。字段刻意保持最小，避免示例代码把注意力从遥测上引开。
/// </summary>
public class Order
{
    /// <summary>自增主键，SQLite 下由 EF Core 生成</summary>
    public int Id { get; set; }

    /// <summary>客户名，最长 100 字符（见 AppDbContext 的配置）</summary>
    public string Customer { get; set; } = string.Empty;

    /// <summary>金额，精度 18,2；用 decimal 而不是 double，避免浮点误差</summary>
    public decimal Amount { get; set; }

    /// <summary>
    /// 创建时间。注意：落库时会被值转换器存成 UTC DateTime（SQLite 限制），
    /// 所以读出来的 Kind 一定是 Utc，展示时要按用户时区转换。
    /// </summary>
    public DateTimeOffset CreatedAt { get; set; }
}
