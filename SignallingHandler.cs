using System;
using System.Collections.Concurrent;
using System.IO;
using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using AeChat.Entities;
using MaxMind.GeoIP2;
using MaxMind.GeoIP2.Responses;
using Microsoft.Extensions.Logging;

namespace AeChat
{
    public sealed class SignallingHandler
    {
        private readonly ConcurrentDictionary<(Guid RoomId, Guid ClientId), ChatSession> sessions = new();
        private readonly ConcurrentDictionary<string, CityResponse> cityResponses = new();
        private readonly DatabaseReader geoIp;

        public SignallingHandler(ILogger<SignallingHandler> logger)
        {
            var geoIpDbPath = Environment.GetEnvironmentVariable("GEOIP_DB_PATH");
            if (!string.IsNullOrEmpty(geoIpDbPath) && File.Exists(geoIpDbPath))
            {
                geoIp = new DatabaseReader(geoIpDbPath);
            }
            else
            {
                logger.LogInformation("GEOIP_DB_PATH not set or file missing; location broadcasts are disabled");
            }
        }

        public async Task HandleConnectionAsync(WebSocket socket, IPAddress remoteIp, CancellationToken cancellationToken)
        {
            var buffer = new byte[8 * 1024];

            try
            {
                while (socket.State == WebSocketState.Open)
                {
                    using var messageStream = new MemoryStream();
                    WebSocketReceiveResult result;
                    do
                    {
                        result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), cancellationToken);
                        if (result.MessageType == WebSocketMessageType.Close)
                        {
                            await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, null, cancellationToken);
                            return;
                        }
                        messageStream.Write(buffer, 0, result.Count);
                    } while (!result.EndOfMessage);

                    var json = Encoding.UTF8.GetString(messageStream.ToArray());
                    var envelope = JsonSerializer.Deserialize<Envelope>(json);
                    if (envelope != null)
                    {
                        await ProcessMessage(envelope, socket, remoteIp);
                    }
                }
            }
            catch (WebSocketException)
            {
            }
            finally
            {
                RemoveConnection(socket);
            }
        }

        private CityResponse GetCity(IPAddress remoteIp)
        {
            if (geoIp == null || remoteIp == null)
            {
                return null;
            }

            var key = remoteIp.ToString();
            if (cityResponses.TryGetValue(key, out var cached))
            {
                return cached;
            }

            try
            {
                var city = geoIp.City(key);
                cityResponses[key] = city;
                return city;
            }
            catch
            {
                return null;
            }
        }

        private async Task ProcessMessage(Envelope envelope, WebSocket socket, IPAddress remoteIp)
        {
            switch (envelope.Type)
            {
                case "discover":
                    AddConnection(envelope.RoomId, envelope.FromId, socket, Guid.Parse(JsonSerializer.Deserialize<string>(envelope.Data)));
                    await Broadcast(envelope, socket);
                    await BroadcastLocation(envelope, socket, remoteIp);
                    break;
                case "acknowledge":
                    envelope.Data = null;
                    await SendTo(envelope);
                    await BroadcastLocation(envelope, socket, remoteIp);
                    break;
                case "ping":
                    await SendRaw(socket, "{\"type\":\"pong\"}");
                    break;
                case "disconnect":
                    await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, null, CancellationToken.None);
                    break;
                default:
                    await SendTo(envelope);
                    break;
            }
        }

        private async Task BroadcastLocation(Envelope envelope, WebSocket socket, IPAddress remoteIp)
        {
            var city = GetCity(remoteIp);
            if (city == null)
            {
                return;
            }

            var locationEnvelope = new Envelope
            {
                Data = JsonSerializer.Serialize(new Location(city)),
                FromId = envelope.FromId,
                RoomId = envelope.RoomId,
                ToId = envelope.RoomId,
                Type = "location"
            };

            await Broadcast(locationEnvelope, socket);
        }

        private void AddConnection(Guid roomId, Guid clientId, WebSocket socket, Guid sessionId)
        {
            var key = (roomId, clientId);

            if (!sessions.TryGetValue(key, out var existing) || existing.SessionId == sessionId)
            {
                sessions[key] = new ChatSession
                {
                    RoomId = roomId,
                    ClientId = clientId,
                    SessionId = sessionId,
                    Socket = socket
                };
            }
        }

        private async Task SendTo(Envelope envelope)
        {
            if (sessions.TryGetValue((envelope.RoomId, envelope.ToId), out var session))
            {
                await SendJson(session, envelope);
            }
        }

        private async Task Broadcast(Envelope envelope, WebSocket excludeSocket)
        {
            foreach (var session in sessions.Values)
            {
                if (session.RoomId == envelope.RoomId && session.Socket != excludeSocket)
                {
                    await SendJson(session, envelope);
                }
            }
        }

        private async Task SendJson(ChatSession session, object payload)
        {
            var json = JsonSerializer.Serialize(payload);
            try
            {
                await SendRaw(session.Socket, json);
            }
            catch (WebSocketException)
            {
                sessions.TryRemove((session.RoomId, session.ClientId), out _);
            }
        }

        private static Task SendRaw(WebSocket socket, string json)
        {
            if (socket.State != WebSocketState.Open)
            {
                throw new WebSocketException("Socket is not open");
            }

            var bytes = Encoding.UTF8.GetBytes(json);
            return socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None);
        }

        private void RemoveConnection(WebSocket socket)
        {
            foreach (var kvp in sessions)
            {
                if (kvp.Value.Socket == socket)
                {
                    sessions.TryRemove(kvp.Key, out _);
                }
            }
        }
    }
}
