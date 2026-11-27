using System;

namespace AeChat
{
    internal sealed class ChatSession
    {
        public Guid RoomId { get; init; }
        public Guid ClientId { get; init; }
        public Guid SessionId { get; init; }
        public ClientConnection Connection { get; init; }
    }
}
