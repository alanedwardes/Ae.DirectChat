using AeChat;
using Microsoft.AspNetCore.HttpOverrides;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSingleton<SignallingHandler>();
builder.Logging.AddSimpleConsole(o => o.SingleLine = true);
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.KnownNetworks.Clear();
    options.KnownProxies.Clear();
});

var app = builder.Build();
app.UseForwardedHeaders();
app.UseDefaultFiles();
app.UseStaticFiles();
app.UseWebSockets();

app.Map("/ws", async (HttpContext context, SignallingHandler handler) =>
{
    if (!context.WebSockets.IsWebSocketRequest)
    {
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        return;
    }

    using var socket = await context.WebSockets.AcceptWebSocketAsync();
    await handler.HandleConnectionAsync(socket, context.Connection.RemoteIpAddress, context.RequestAborted);
});

app.MapGet("/healthz", () => Results.Ok());

app.MapFallbackToFile("index.html");

app.Run();
