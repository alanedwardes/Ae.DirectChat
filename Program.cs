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
    options.ForwardLimit = 2;
});

var app = builder.Build();

var forwardingLogger = app.Logger;
app.Use(async (context, next) =>
{
    forwardingLogger.LogInformation(
        "Forwarding debug (raw): X-Forwarded-For={XForwardedFor} X-Real-IP={XRealIp} TcpPeer={RemoteIp}",
        context.Request.Headers["X-Forwarded-For"].ToString(),
        context.Request.Headers["X-Real-IP"].ToString(),
        context.Connection.RemoteIpAddress);
    await next();
});

app.UseForwardedHeaders();

app.Use(async (context, next) =>
{
    forwardingLogger.LogInformation(
        "Forwarding debug (resolved): RemoteIpAddress={RemoteIp}",
        context.Connection.RemoteIpAddress);
    await next();
});

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
