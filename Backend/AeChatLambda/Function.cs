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
            [DataMember(Name = "fromId")]
            public Guid FromId { get; set; }
            [DataMember(Name = "toId")]
            public Guid ToId { get; set; }
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

            if(request.RequestContext.RouteKey == RouteKey.Default)
            {
                var envelope = JsonConvert.DeserializeObject<Envelope>(request.Body);
                ProcessMessage(envelope, request.RequestContext.ConnectionId).GetAwaiter().GetResult();
            }

            Console.WriteLine(JsonConvert.SerializeObject(request, serializerSettings));

            return new MemoryStream(Encoding.UTF8.GetBytes("{}"));
        }

        private async Task ProcessMessage(Envelope envelope, string connectionId)
        {
            switch (envelope.Type)
            {
                case "discover":
                    await AddConnection(envelope.RoomId, envelope.FromId, connectionId, Guid.Parse(JsonConvert.DeserializeObject<string>(envelope.Data)));
                    envelope.Data = null; // Remove the session token
                    await Broadcast(envelope, connectionId);
                    break;
                default:
                    await SendTo(envelope);
                    break;
            }
        }

        private Dictionary<string, AttributeValue> GetKey(string roomId, Guid clientId)
        {
            return new Dictionary<string, AttributeValue>
            {
                { "Room", new AttributeValue(roomId) },
                { "Client", new AttributeValue(clientId.ToString()) }
            };
        }

        public Dictionary<string, AttributeValue> GetRow(string roomId, Guid clientId, string connectionId, Guid sessionId)
        {
            return new Dictionary<string, AttributeValue>
            {
                { "Room", new AttributeValue(roomId) },
                { "Client", new AttributeValue(clientId.ToString()) },
                { "Connection", new AttributeValue(connectionId) },
                { "Session", new AttributeValue(sessionId.ToString()) }
            };
        }

        private async Task AddConnection(string roomId, Guid clientId, string connectionId, Guid sessionId)
        {
            var result = await dynamodb.GetItemAsync("AeChat", GetKey(roomId, clientId));
            if (result.Item.Count > 0 && Guid.Parse(result.Item["Session"].S) != sessionId)
            {
                // Don't do anything, the connection doesn't have the right session ID
                return;
            }

            // Update the connection ID for this client
            await dynamodb.PutItemAsync("AeChat", GetRow(roomId, clientId, connectionId, sessionId));
        }

        private async Task SendTo(Envelope envelope)
        {
            var result = await dynamodb.GetItemAsync("AeChat", GetKey(envelope.RoomId, envelope.ToId));
            if (result.Item.Count == 0)
            {
                // The user isn't in this room
                return;
            }

            await SendJson(result.Item["Connection"].S, envelope);
        }

        private async Task Broadcast(Envelope envelope, string thisConnectionId)
        {
            var result = await dynamodb.QueryAsync(new QueryRequest
            {
                TableName = "AeChat",
                KeyConditionExpression = "Room = :room",
                ExpressionAttributeValues = new Dictionary<string, AttributeValue>
                {
                    { ":room", new AttributeValue(envelope.RoomId) }
                }
            });

            foreach (var connection in result.Items)
            {
                string remoteConnectionId = connection["Connection"].S;
                if (remoteConnectionId == thisConnectionId)
                {
                    continue;
                }

                await SendJson(remoteConnectionId, envelope);
            }
        }

        private async Task SendJson(string connectionId, object json)
        {
            var request = new PostToConnectionRequest
            {
                ConnectionId = connectionId,
                Data = new MemoryStream(Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(json)))
            };

            try
            {
                await gateway.PostToConnectionAsync(request);
            }
            catch (GoneException)
            {
                // Do nothing
            }
        }
    }
}
