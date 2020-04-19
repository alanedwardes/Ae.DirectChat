using System;
using System.Runtime.Serialization;

namespace AeChatLambda.Entities
{
    [DataContract]
    public class Envelope
    {
        [DataMember(Name = "roomId")]
        public string RoomId { get; set; }
        [DataMember(Name = "fromId")]
        public Guid FromId { get; set; }
        [DataMember(Name = "toId")]
        public Guid ToId { get; set; }
        [DataMember(Name = "type")]
        public string Type { get; set; }
        [DataMember(Name = "data")]
        public string Data { get; set; }
    }
}
