using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.Serialization;
using System.Text;
using System.Threading.Tasks;
using Amazon.ApiGatewayManagementApi;
using Amazon.ApiGatewayManagementApi.Model;
using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Amazon.Lambda.Core;
using Newtonsoft.Json;
using Newtonsoft.Json.Converters;

namespace AeChatLambda
{
    public class Function
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

        [DataContract]
        public class Envelope
        {
            [DataMember(Name = "roomId")]
            public string RoomId { get; set; }
            [DataMember(Name = "type")]
            public string Type { get; set; }
            [DataMember(Name = "data")]
            public string Data { get; set; }
        }

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

        [DataContract]
        public class WsRequestContext
        {
            [DataMember]
            public RouteKey RouteKey { get; set; }
            [DataMember]
            public string ConnectionId { get; set; }
        }

        private IAmazonDynamoDB dynamodb = new AmazonDynamoDBClient();

        private IAmazonApiGatewayManagementApi gateway = new AmazonApiGatewayManagementApiClient(new AmazonApiGatewayManagementApiConfig()
        {
            ServiceURL = Environment.GetEnvironmentVariable("GATEWAY_URL")
        });

        /// <summary>
        /// A simple function that takes a string and does a ToUpper
        /// </summary>
        /// <param name="input"></param>
        /// <param name="context"></param>
        /// <returns></returns>
        public Stream FunctionHandler(Stream inputStream, ILambdaContext context)
        {
            string input;
            using (var sr = new StreamReader(inputStream))
            {
                input = sr.ReadToEnd();
            }

            var serializerSettings = new JsonSerializerSettings
            {
                Converters = new[]
                {
                    new StringEnumConverter()
                }
            };

            Console.WriteLine(input);
            var request = JsonConvert.DeserializeObject<WsRequest>(input, serializerSettings);

            var envelope = JsonConvert.DeserializeObject<Envelope>(request.Body ?? "{}");

            var roomId = envelope?.RoomId;

            switch (request.RequestContext.RouteKey)
            {
                case RouteKey.Connect:
                    //AddConnection(roomId, request.RequestContext.ConnectionId).GetAwaiter().GetResult();
                    break;
                case RouteKey.Disconnect:
                    RemoveConnection(roomId, request.RequestContext.ConnectionId).GetAwaiter().GetResult();
                    break;
                case RouteKey.Default:
                    AddConnection(roomId, request.RequestContext.ConnectionId).GetAwaiter().GetResult();
                    Broadcast(roomId, request.RequestContext.ConnectionId, envelope).GetAwaiter().GetResult();
                    break;
            }

            Console.WriteLine(JsonConvert.SerializeObject(request, serializerSettings));

            return new MemoryStream(Encoding.UTF8.GetBytes("{}"));
        }

        private async Task AddConnection(string roomId, string connectionId)
        {
            await dynamodb.PutItemAsync("AeChat", new Dictionary<string, AttributeValue>
            {
                { "Room", new AttributeValue(roomId) },
                { "Connection", new AttributeValue(connectionId) }
            });
        }

        private async Task RemoveConnection(string roomId, string connectionId)
        {
            await dynamodb.DeleteItemAsync("AeChat", new Dictionary<string, AttributeValue>
            {
                { "Room", new AttributeValue(roomId) },
                { "Connection", new AttributeValue(connectionId) }
            });
        }

        private async Task Broadcast(string roomId, string connectionId, Envelope envelope)
        {
            var dynamodb = new AmazonDynamoDBClient();

            var result = await dynamodb.QueryAsync(new QueryRequest
            {
                TableName = "AeChat",
                KeyConditionExpression = "Room = :room",
                ExpressionAttributeValues = new Dictionary<string, AttributeValue>
                {
                    { ":room", new AttributeValue(roomId) }
                }
            });

            foreach (var connection in result.Items)
            {
                string remoteConnectionId = connection["Connection"].S;
                if (remoteConnectionId == connectionId)
                {
                    continue;
                }

                try
                {
                    await gateway.PostToConnectionAsync(new PostToConnectionRequest
                    {
                        ConnectionId = remoteConnectionId,
                        Data = new MemoryStream(Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(envelope)))
                    });
                }
                catch (GoneException)
                {
                    await RemoveConnection(roomId, remoteConnectionId);
                }
            }
        }
    }
}
