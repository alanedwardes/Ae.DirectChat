using System.Runtime.Serialization;

namespace AeChatLambda.Entities
{
    [DataContract]
    public class WsRequestIdentity
    {
        [DataMember]
        public string SourceIp { get; set; }
    }
}
