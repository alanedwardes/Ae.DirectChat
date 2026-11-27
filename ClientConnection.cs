using System;
using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;

namespace AeChat
{
    internal sealed class ClientConnection
    {
        private const int MaxQueuedBytes = 1024 * 1024;
        private static readonly TimeSpan SendTimeout = TimeSpan.FromSeconds(10);

        private readonly Channel<byte[]> outbox = Channel.CreateUnbounded<byte[]>(new UnboundedChannelOptions { SingleReader = true });
        private readonly Task writer;
        private long queuedBytes;

        public ClientConnection(WebSocket socket, IPAddress remoteIp)
        {
            Socket = socket;
            RemoteIp = remoteIp;
            writer = Task.Run(WriteLoop);
        }

        public WebSocket Socket { get; }
        public IPAddress RemoteIp { get; }

        public ChatSession Session { get; set; }

        public void Send(string json)
        {
            if (Socket.State != WebSocketState.Open)
            {
                return;
            }

            var bytes = Encoding.UTF8.GetBytes(json);
            if (Interlocked.Add(ref queuedBytes, bytes.Length) > MaxQueuedBytes || !outbox.Writer.TryWrite(bytes))
            {
                Socket.Abort();
            }
        }

        private async Task WriteLoop()
        {
            try
            {
                await foreach (var bytes in outbox.Reader.ReadAllAsync())
                {
                    using var timeout = new CancellationTokenSource(SendTimeout);
                    await Socket.SendAsync(bytes, WebSocketMessageType.Text, true, timeout.Token);
                    Interlocked.Add(ref queuedBytes, -bytes.Length);
                }
            }
            catch (Exception ex) when (ex is WebSocketException or OperationCanceledException or ObjectDisposedException or InvalidOperationException)
            {
                Socket.Abort();
            }
        }

        public Task CompleteAsync()
        {
            outbox.Writer.TryComplete();
            return writer;
        }
    }
}
