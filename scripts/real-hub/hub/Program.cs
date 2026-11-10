// A27: a real ASP.NET Core SignalR hub. wemock's real-hub check connects the official
// @microsoft/signalr client to it, records the traffic, and replays it as a socket mock.
using System.Runtime.CompilerServices;
using Microsoft.AspNetCore.SignalR;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSignalR();
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .SetIsOriginAllowed(_ => true)
    .AllowAnyHeader()
    .AllowAnyMethod()
    .AllowCredentials()));

var app = builder.Build();
app.UseCors();
app.MapGet("/health", () => "ok");
app.MapHub<ShopHub>("/hubs/shop");
app.Run();

public sealed class ShopHub : Hub
{
    public override async Task OnConnectedAsync()
    {
        await Clients.Caller.SendAsync("Notify", "Welcome back", 3);
        await base.OnConnectedAsync();
    }

    public object Double(int n) => new { n = n * 2 };

    public string Echo(string text) => $"echo:{text}";

    public async Task Join(string group)
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, group);
        await Clients.Group(group).SendAsync("GroupMsg", group, "joined");
    }

    public void Fail() => throw new HubException("nope");

    public async IAsyncEnumerable<int> Counter(int count, [EnumeratorCancellation] CancellationToken ct)
    {
        for (var i = 1; i <= count; i++)
        {
            yield return i;
            await Task.Delay(20, ct);
        }
    }
}
