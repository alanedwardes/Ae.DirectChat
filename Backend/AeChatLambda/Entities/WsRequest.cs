using System.Collections.Generic;
using System.Runtime.Serialization;

namespace AeChatLambda.Entities
{
    [DataContract]
    public class WsRequest
    {
        [DataMember]
        public string Body { get; set; }

        [DataMember(Name = "headers")]
        public IDictionary<string, string> Headers { get; set; } = new Dictionary<string, string>();

        [DataMember]
        public WsRequestContext RequestContext { get; set; }
    }
}
