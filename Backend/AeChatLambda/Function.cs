using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using AeChatLambda.Entities;
using AeChatLambda.Store;
using Amazon.ApiGatewayManagementApi;
using Amazon.ApiGatewayManagementApi.Model;
using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Amazon.Lambda.Core;
using Amazon.SimpleSystemsManagement;
using Amazon.SimpleSystemsManagement.Model;
using MaxMind.GeoIP2;
using MaxMind.GeoIP2.Responses;
using Newtonsoft.Json;
using Newtonsoft.Json.Converters;

namespace AeChatLambda
{
    public sealed class Function
    {
        private IAmazonDynamoDB dynamo = new AmazonDynamoDBClient();

        private IAmazonApiGatewayManagementApi gateway = new AmazonApiGatewayManagementApiClient(new AmazonApiGatewayManagementApiConfig()
        {
            ServiceURL = Environment.GetEnvironmentVariable("GATEWAY_URL")
        });

        private IAmazonSimpleSystemsManagement ssm = new AmazonSimpleSystemsManagementClient();

        private IGeoIP2WebServicesClient geoIp;

        private JsonSerializerSettings serialiserSettings = new JsonSerializerSettings
        {
            Converters = new[]
            {
                new StringEnumConverter()
            }
        };

        private bool bIsInitialised;

        private IDictionary<string, CityResponse> cityResponses = new Dictionary<string, CityResponse>();

        private string SessionTable = Environment.GetEnvironmentVariable("SESSION_TABLE");

        public Stream FunctionHandler(Stream inputStream, ILambdaContext context)
        {
            string input;
            using (var sr = new StreamReader(inputStream))
            {
                input = sr.ReadToEnd();
            }

            Console.WriteLine(input);
            var request = JsonConvert.DeserializeObject<WsRequest>(input, serialiserSettings);

            if(request?.RequestContext?.RouteKey == RouteKey.Default)
            {
                var envelope = JsonConvert.DeserializeObject<Envelope>(request.Body);
                ProcessMessage(envelope, request).GetAwaiter().GetResult();
            }

            Console.WriteLine(JsonConvert.SerializeObject(request, serialiserSettings));

            return new MemoryStream(Encoding.UTF8.GetBytes("{}"));
        }

        private async Task<CityResponse> GetCity(WsRequestIdentity requestIdentity)
        {
            if (cityResponses.ContainsKey(requestIdentity.SourceIp))
            {
                return cityResponses[requestIdentity.SourceIp];
            }

            var location = await geoIp.CityAsync(requestIdentity.SourceIp);
            cityResponses[requestIdentity.SourceIp] = location;
            return location;
        }

        private async Task ProcessMessage(Envelope envelope, WsRequest request)
        {
            if (!bIsInitialised)
            {
                var parameters = ssm.GetParametersAsync(new GetParametersRequest { Names = new List<string> { "MaxMindLicense" } }).GetAwaiter().GetResult();

                var maxMindLicense = parameters.Parameters.Single(x => x.Name == "MaxMindLicense").Value.Split(",");

                geoIp = new WebServiceClient(int.Parse(maxMindLicense[0]), maxMindLicense[1]);

                bIsInitialised = true;
            }

            switch (envelope.Type)
            {
                case "discover":
                    await AddConnection(envelope.RoomId, envelope.FromId, request.RequestContext.ConnectionId, Guid.Parse(JsonConvert.DeserializeObject<string>(envelope.Data)));
                    await Broadcast(envelope, request.RequestContext.ConnectionId);
                    await BroadcastLocation(envelope, request);
                    break;
                case "acknowledge":
                    envelope.Data = null;
                    await SendTo(envelope);
                    await BroadcastLocation(envelope, request);
                    break;
                case "ping":
                    await gateway.PostToConnectionAsync(new PostToConnectionRequest
                    {
                        ConnectionId = request.RequestContext.ConnectionId,
                        Data = new MemoryStream(Encoding.UTF8.GetBytes("{\"type\":\"pong\"}"))
                    });
                    break;
                default:
                    await SendTo(envelope);
                    break;
            }
        }

        private async Task BroadcastLocation(Envelope envelope, WsRequest request)
        {
            var locationEnvelope = new Envelope
            {
                Data = JsonConvert.SerializeObject(new Location(await GetCity(request.RequestContext.Identity))),
                FromId = envelope.FromId,
                RoomId = envelope.RoomId,
                ToId = envelope.RoomId,
                Type = "location"
            };

            await Broadcast(locationEnvelope, request.RequestContext.ConnectionId);
        }

        private async Task AddConnection(Guid roomId, Guid clientId, string connectionId, Guid sessionId)
        {
            var result = await dynamo.GetItemAsync(SessionTable, ChatSession.ToKey(roomId, clientId));
            var session = ChatSession.FromAttributes(result.Item);

            // Don't do anything if the connection doesn't have the right session ID
            if (session == null || session.SessionId == sessionId)
            {
                var newSession = new ChatSession
                {
                    ClientId = clientId,
                    ConnectionId = connectionId,
                    SessionId = sessionId,
                    RoomId = roomId,
                    Expiry = DateTimeOffset.UtcNow.AddHours(2) // API Gateway WebSocket timeout
                };

                // Upsert the connection ID for this client
                await dynamo.PutItemAsync(SessionTable, ChatSession.ToAttributes(newSession));
            }
        }

        private async Task SendTo(Envelope envelope)
        {
            var result = await dynamo.GetItemAsync(SessionTable, ChatSession.ToKey(envelope.RoomId, envelope.ToId));
            var session = ChatSession.FromAttributes(result.Item);
            if (session != null)
            {
                await SendJson(session, envelope);
            }
        }

        private async Task Broadcast(Envelope envelope, string thisConnectionId)
        {
            var result = await dynamo.QueryAsync(new QueryRequest
            {
                TableName = SessionTable,
                KeyConditionExpression = "Room = :room",
                ExpressionAttributeValues = new Dictionary<string, AttributeValue>
                {
                    { ":room", new AttributeValue(envelope.RoomId.ToString()) }
                }
            });

            foreach (var attributes in result.Items)
            {
                var session = ChatSession.FromAttributes(attributes);
                if (session.ConnectionId != thisConnectionId)
                {
                    await SendJson(session, envelope);
                }
            }
        }

        private async Task SendJson(ChatSession session, object json)
        {
            var request = new PostToConnectionRequest
            {
                ConnectionId = session.ConnectionId,
                Data = new MemoryStream(Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(json)))
            };

            try
            {
                await gateway.PostToConnectionAsync(request);
            }
            catch (GoneException)
            {
                // Delete this connection if it wasn't updated
                var deleteRequest = new DeleteItemRequest
                {
                    Key = ChatSession.ToKey(session),
                    TableName = SessionTable,
                    ConditionExpression = "#Connection = :connectionId",
                    ExpressionAttributeNames = new Dictionary<string, string>
                    {
                        { "#Connection", ChatSession.ConnectionAttribute }
                    },
                    ExpressionAttributeValues = new Dictionary<string, AttributeValue>
                    {
                        { ":connectionId", new AttributeValue(session.ConnectionId) }
                    }
                };

                try
                {
                    await dynamo.DeleteItemAsync(deleteRequest);
                }
                catch (ConditionalCheckFailedException)
                {
                    // Do nothing, the connection was since updated
                }
            }
        }
    }

}
