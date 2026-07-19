using System;
using System.Net.WebSockets;

namespace AeChat
{
    public sealed class ChatSession
    {
        public Guid RoomId { get; init; }
        public Guid ClientId { get; init; }
        public Guid SessionId { get; init; }
        public WebSocket Socket { get; init; }
    }
}
