using System;
using System.Text.Json.Serialization;

namespace AeChat.Entities
{
    public sealed class Envelope
    {
        [JsonPropertyName("roomId")]
        public Guid RoomId { get; set; }
        [JsonPropertyName("fromId")]
        public Guid FromId { get; set; }
        [JsonPropertyName("toId")]
        public Guid ToId { get; set; }
        [JsonPropertyName("type")]
        public string Type { get; set; }
        [JsonPropertyName("data")]
        public string Data { get; set; }
    }
}
