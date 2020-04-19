using System.Runtime.Serialization;

namespace AeChatLambda.Entities
{
    [DataContract]
    public class WsRequestContext
    {
        [DataMember]
        public RouteKey RouteKey { get; set; }
        [DataMember]
        public string ConnectionId { get; set; }
    }
}
