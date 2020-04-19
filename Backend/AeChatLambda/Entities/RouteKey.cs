using System.Runtime.Serialization;

namespace AeChatLambda.Entities
{
    [DataContract]
    public enum RouteKey
    {
        [EnumMember(Value = "$connect")]
        Connect,
        [EnumMember(Value = "$disconnect")]
        Disconnect,
        [EnumMember(Value = "$default")]
        Default
    }
}
