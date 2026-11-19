// The wemock lab: a small real shop. Each endpoint is the target of one kind of mock, so a test
// can record the real answer, then make wemock answer instead and see the page take it.
using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSignalR();
builder.Services.AddSingleton<Shop>();
builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase);

var app = builder.Build();
app.UseDefaultFiles();
app.UseStaticFiles();
app.UseWebSockets();

app.MapGet("/health", () => "ok");

// Fixed reply: the catalogue.
app.MapGet("/api/products", (Shop shop) => new { items = shop.Products.Take(12), total = shop.Products.Count });

// Query: search, page and sort.
app.MapGet("/api/products/search", (Shop shop, string? q, int? page, string? sort) =>
{
    var found = shop.Products.Where(p => string.IsNullOrEmpty(q) || p.Name.Contains(q, StringComparison.OrdinalIgnoreCase));
    found = sort == "price" ? found.OrderBy(p => p.Price) : found.OrderBy(p => p.Id);
    var size = 5;
    var at = Math.Max(1, page ?? 1);
    return new { q, page = at, sort, items = found.Skip((at - 1) * size).Take(size), total = found.Count() };
});

// URL parameters: one, then two.
app.MapGet("/api/products/{id:int}", (Shop shop, int id) =>
    shop.Find(id) is { } p ? Results.Ok(p) : Results.NotFound(new { error = $"No product {id}" }));
app.MapGet("/api/categories/{category}/products/{id:int}", (Shop shop, string category, int id) =>
    shop.Find(id) is { } p && p.Category.Equals(category, StringComparison.OrdinalIgnoreCase)
        ? Results.Ok(p)
        : Results.NotFound(new { error = $"No product {id} in {category}" }));

// Code: a price worked out from the id and the quantity.
app.MapGet("/api/price/{id:int}", (Shop shop, int id, int? qty) =>
{
    var p = shop.Find(id);
    if (p is null) return Results.NotFound(new { error = $"No product {id}" });
    var n = Math.Max(1, qty ?? 1);
    return Results.Ok(new { id, qty = n, unit = p.Price, total = Math.Round(p.Price * n * (n >= 10 ? 0.9m : 1m), 2) });
});

// Sequence: the real status moves on with each call.
app.MapGet("/api/orders/{id:int}/status", (Shop shop, int id) =>
{
    var calls = shop.OrderCalls.AddOrUpdate(id, 1, (_, n) => n + 1);
    var status = calls switch { 1 => "pending", 2 => "packed", _ => "shipped" };
    return new { id, status, calls };
});

// Condition on the body: a coupon changes the answer.
app.MapPost("/api/cart", (Shop shop, CartLine line) =>
{
    var p = shop.Find(line.ProductId);
    if (p is null) return Results.NotFound(new { error = $"No product {line.ProductId}" });
    var discount = line.Coupon == "TEA10" ? 0.1m : 0m;
    shop.Cart.Add(line);
    return Results.Ok(new { added = p.Name, qty = line.Qty, discount, lines = shop.Cart.Count });
});
app.MapGet("/api/cart", (Shop shop) => new { lines = shop.Cart });

// Scenario: checkout works here; "Checkout down" is a mock.
app.MapPost("/api/checkout", (Shop shop) =>
{
    shop.Cart.Clear();
    return new { orderId = 1042, status = "placed" };
});

// Condition on a header.
app.MapGet("/api/me", (HttpRequest req) =>
    req.Headers.Authorization.Count > 0
        ? Results.Ok(new { id = "u1", name = "Anna", plan = "pro" })
        : Results.Json(new { error = "Sign in first" }, statusCode: 401));

// Change real: a real answer that a mock edits on its way to the page.
app.MapGet("/api/recommendations", (Shop shop) => new
{
    items = shop.Products.Take(4).Select(p => new { p.Id, p.Name, visible = true }),
    token = "real-token",
});

// Binary body: a PNG, a different colour for each product.
app.MapGet("/api/products/{id:int}/image", (int id) => Results.File(Png.Square(id), "image/png"));

// Stream, as Server-Sent Events.
app.MapGet("/api/assistant", async (HttpContext ctx) =>
{
    ctx.Response.ContentType = "text/event-stream";
    foreach (var part in new[] { "Hello", "from", "the", "real", "assistant" })
    {
        await ctx.Response.WriteAsync($"data: {part}\n\n");
        await ctx.Response.Body.FlushAsync();
        await Task.Delay(120);
    }
});

// GraphQL: one URL, told apart by the operation name.
app.MapPost("/graphql", (Shop shop, GraphQlRequest req) => req.OperationName switch
{
    "GetProducts" => Results.Ok(new { data = new { products = shop.Products.Take(3) } }),
    "GetOrder" => Results.Ok(new { data = new { order = new { id = 1042, status = "placed" } } }),
    _ => Results.Ok(new { errors = new[] { new { message = $"Unknown operation {req.OperationName}" } } }),
});

// A plain WebSocket that echoes, and says hello first.
app.Map("/ws/echo", async (HttpContext ctx) =>
{
    if (!ctx.WebSockets.IsWebSocketRequest) { ctx.Response.StatusCode = 400; return; }
    using var ws = await ctx.WebSockets.AcceptWebSocketAsync();
    await ws.SendAsync(Encoding.UTF8.GetBytes("hello from the lab"), WebSocketMessageType.Text, true, ctx.RequestAborted);
    var buffer = new byte[4096];
    while (ws.State == WebSocketState.Open)
    {
        var got = await ws.ReceiveAsync(buffer, ctx.RequestAborted);
        if (got.MessageType == WebSocketMessageType.Close) break;
        var text = Encoding.UTF8.GetString(buffer, 0, got.Count);
        await ws.SendAsync(Encoding.UTF8.GetBytes($"echo:{text}"), WebSocketMessageType.Text, true, ctx.RequestAborted);
    }
});

// Many mocks: 1000 small endpoints, and an OpenAPI file listing the first 900 of them.
app.MapGet("/api/items/{n:int}", (int n) =>
    n is >= 1 and <= 1000 ? Results.Ok(Items.One(n)) : Results.NotFound(new { error = $"No item {n}" }));
app.MapGet("/openapi.json", (int? count) => Results.Text(Items.OpenApi(Math.Clamp(count ?? 900, 1, 1000)), "application/json"));

app.MapHub<OrdersHub>("/hubs/orders");
app.Run();

public sealed record Product(int Id, string Name, string Category, decimal Price, int Stock);
public sealed record CartLine(int ProductId, int Qty, string? Coupon);
public sealed record GraphQlRequest(string? OperationName, string? Query, JsonElement? Variables);

public sealed class Shop
{
    private static readonly string[] Kinds = ["tea", "teapot", "cup", "kettle"];
    private static readonly string[] Words = ["Green", "Oolong", "Black", "White", "Jasmine", "Earl", "Smoky", "Mint"];

    public List<Product> Products { get; } = Enumerable.Range(1, 60)
        .Select(i => new Product(
            i,
            $"{Words[i % Words.Length]} {Kinds[i % Kinds.Length]} {i}",
            Kinds[i % Kinds.Length],
            Math.Round(2.5m + (i * 37 % 200) / 10m, 2),
            i % 5 == 0 ? 0 : i * 3 % 40))
        .ToList();

    public ConcurrentDictionary<int, int> OrderCalls { get; } = new();
    public ConcurrentBag<CartLine> Cart { get; } = [];

    public Product? Find(int id) => Products.FirstOrDefault(p => p.Id == id);
}

public static class Items
{
    public static object One(int n) => new { n, name = $"Item {n}", price = Math.Round(1m + n % 97 / 4m, 2) };

    /// <summary>An OpenAPI 3 document with one GET per item, each with an example, so an import makes one mock each.</summary>
    public static string OpenApi(int count)
    {
        var paths = new Dictionary<string, object>();
        for (var n = 1; n <= count; n++)
        {
            paths[$"/api/items/{n}"] = new Dictionary<string, object>
            {
                ["get"] = new
                {
                    operationId = $"getItem{n}",
                    summary = $"Item {n}",
                    responses = new Dictionary<string, object>
                    {
                        ["200"] = new
                        {
                            description = "OK",
                            content = new Dictionary<string, object> { ["application/json"] = new { example = One(n) } },
                        },
                    },
                },
            };
        }
        var doc = new Dictionary<string, object>
        {
            ["openapi"] = "3.0.3",
            ["info"] = new { title = "wemock lab items", version = "1.0" },
            ["paths"] = paths,
        };
        return JsonSerializer.Serialize(doc);
    }
}

public static class Png
{
    /// <summary>A 16 x 16 PNG of one colour, worked out from the id, built without any image library.</summary>
    public static byte[] Square(int id)
    {
        byte r = (byte)(id * 53 % 256), g = (byte)(id * 97 % 256), b = (byte)(id * 151 % 256);
        const int size = 16;
        var raw = new List<byte>();
        for (var y = 0; y < size; y++)
        {
            raw.Add(0);
            for (var x = 0; x < size; x++) { raw.Add(r); raw.Add(g); raw.Add(b); }
        }
        using var png = new MemoryStream();
        png.Write([137, 80, 78, 71, 13, 10, 26, 10]);
        Chunk(png, "IHDR", [0, 0, 0, size, 0, 0, 0, size, 8, 2, 0, 0, 0]);
        using (var z = new MemoryStream())
        {
            using (var zlib = new System.IO.Compression.ZLibStream(z, System.IO.Compression.CompressionLevel.Optimal, true))
                zlib.Write(raw.ToArray());
            Chunk(png, "IDAT", z.ToArray());
        }
        Chunk(png, "IEND", []);
        return png.ToArray();
    }

    private static void Chunk(Stream s, string type, byte[] data)
    {
        var len = BitConverter.GetBytes(data.Length); if (BitConverter.IsLittleEndian) Array.Reverse(len);
        s.Write(len);
        var typeBytes = Encoding.ASCII.GetBytes(type);
        s.Write(typeBytes);
        s.Write(data);
        var crc = BitConverter.GetBytes(Crc32([.. typeBytes, .. data])); if (BitConverter.IsLittleEndian) Array.Reverse(crc);
        s.Write(crc);
    }

    private static uint Crc32(byte[] bytes)
    {
        var c = 0xFFFFFFFFu;
        foreach (var b in bytes)
        {
            c ^= b;
            for (var k = 0; k < 8; k++) c = (c & 1) != 0 ? 0xEDB88320u ^ (c >> 1) : c >> 1;
        }
        return c ^ 0xFFFFFFFFu;
    }
}

/// <summary>Order updates over SignalR: a push on connect, an invoke with a result and later pushes, a stream, an error.</summary>
public sealed class OrdersHub : Hub
{
    public override async Task OnConnectedAsync()
    {
        await Clients.Caller.SendAsync("Notify", "Welcome to the lab", 3);
        await base.OnConnectedAsync();
    }

    public async Task<object> Subscribe(int orderId)
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, $"order-{orderId}");
        var caller = Clients.Caller;
        _ = Task.Run(async () =>
        {
            await Task.Delay(300);
            await caller.SendAsync("StatusChanged", orderId, "packed");
            await Task.Delay(300);
            await caller.SendAsync("StatusChanged", orderId, "shipped");
        });
        return new { orderId, status = "pending" };
    }

    public object GetPrice(int id) => new { id, price = Math.Round(2.5m + (id * 37 % 200) / 10m, 2) };

    public void Fail() => throw new HubException("The lab says no");

    public async IAsyncEnumerable<object> StreamPrices(int count, [EnumeratorCancellation] CancellationToken ct)
    {
        for (var i = 1; i <= count; i++)
        {
            yield return new { id = i, price = Math.Round(2.5m + i / 10m, 2) };
            await Task.Delay(40, ct);
        }
    }
}
