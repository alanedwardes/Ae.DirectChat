using System;
using System.Collections.Generic;
using Amazon.DynamoDBv2.Model;

namespace AeChatLambda.Store
{
    public sealed class ChatSession
    {
        public string ConnectionId { get; set; }
        public Guid ClientId { get; set; }
        public string RoomId { get; set; }
        public Guid SessionId { get; set; }

        public const string RoomAttribute = "Room";
        public const string ConnectionAttribute = "Connection";
        public const string ClientAttribute = "Client";
        public const string SessionAttribute = "Session";

        public static ChatSession FromAttributes(Dictionary<string, AttributeValue> attributes)
        {
            if (attributes.Count == 0)
            {
                return null;
            }

            return new ChatSession
            {
                RoomId = attributes[RoomAttribute].S,
                ConnectionId = attributes[ConnectionAttribute].S,
                ClientId = Guid.Parse(attributes[ClientAttribute].S),
                SessionId = Guid.Parse(attributes[SessionAttribute].S),
            };
        }

        public static Dictionary<string, AttributeValue> ToKey(ChatSession session) => ToKey(session.RoomId, session.ClientId);

        public static Dictionary<string, AttributeValue> ToKey(string roomId, Guid clientId)
        {
            return new Dictionary<string, AttributeValue>
            {
                { RoomAttribute, new AttributeValue(roomId) },
                { ClientAttribute, new AttributeValue(clientId.ToString()) }
            };
        }

        public static Dictionary<string, AttributeValue> ToAttributes(ChatSession chatSession)
        {
            var attributes = ToKey(chatSession);
            attributes.Add(ConnectionAttribute, new AttributeValue(chatSession.ConnectionId.ToString()));
            attributes.Add(SessionAttribute, new AttributeValue(chatSession.SessionId.ToString()));
            return attributes;
        }
    }

}
