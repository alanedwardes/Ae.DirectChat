using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
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
        // SDP offers are typically a few KB; anything this large is not legitimate signalling
        private const int MaxMessageBytes = 64 * 1024;

        // Peer-to-peer messages clients may relay to each other. Everything else (notably "location",
        // which only the server may originate) is dropped.
        private static readonly HashSet<string> RelayableTypes = new(StringComparer.Ordinal)
        {
            "offer", "answer", "candidate", "renegotiate", "transceiverRequest", "reconnect", "leave"
        };

        private readonly ConcurrentDictionary<(Guid RoomId, Guid ClientId), ChatSession> sessions = new();
        private readonly ConcurrentDictionary<string, CityResponse> cityResponses = new();
        private readonly DatabaseReader geoIp;

        // The identity a socket registered with its first "discover". Every later message from the socket is
        // stamped with this identity, so a client can't speak as anyone else or into another room.
        private sealed class Connection
        {
            public WebSocket Socket { get; init; }
            public IPAddress RemoteIp { get; init; }
            public ChatSession Session { get; set; }
        }

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
            var connection = new Connection { Socket = socket, RemoteIp = remoteIp };
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
                        if (messageStream.Length + result.Count > MaxMessageBytes)
                        {
                            await socket.CloseAsync(WebSocketCloseStatus.MessageTooBig, null, cancellationToken);
                            return;
                        }
                        messageStream.Write(buffer, 0, result.Count);
                    } while (!result.EndOfMessage);

                    Envelope envelope;
                    try
                    {
                        envelope = JsonSerializer.Deserialize<Envelope>(messageStream.GetBuffer().AsSpan(0, (int)messageStream.Length));
                    }
                    catch (JsonException)
                    {
                        continue;
                    }

                    if (envelope != null)
                    {
                        await ProcessMessage(envelope, connection);
                    }
                }
            }
            catch (WebSocketException)
            {
            }
            catch (OperationCanceledException)
            {
            }
            finally
            {
                RemoveConnection(connection);
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

        private async Task ProcessMessage(Envelope envelope, Connection connection)
        {
            if (envelope.Type == "ping")
            {
                await SendRaw(connection.Socket, "{\"type\":\"pong\"}");
                return;
            }

            if (envelope.Type == "disconnect")
            {
                await connection.Socket.CloseAsync(WebSocketCloseStatus.NormalClosure, null, CancellationToken.None);
                return;
            }

            if (envelope.Type == "discover")
            {
                await ProcessDiscover(envelope, connection);
                return;
            }

            var session = connection.Session;
            if (session == null)
            {
                // Must discover (join a room) before sending anything else
                return;
            }

            // Never trust the sender's claimed identity
            envelope.RoomId = session.RoomId;
            envelope.FromId = session.ClientId;

            if (envelope.Type == "acknowledge")
            {
                envelope.Data = null;
                await SendTo(envelope);
                await BroadcastLocation(session, connection);
            }
            else if (envelope.Type != null && RelayableTypes.Contains(envelope.Type))
            {
                await SendTo(envelope);
            }
        }

        private async Task ProcessDiscover(Envelope envelope, Connection connection)
        {
            string sessionData;
            try
            {
                sessionData = envelope.Data == null ? null : JsonSerializer.Deserialize<string>(envelope.Data);
            }
            catch (JsonException)
            {
                return;
            }

            if (!Guid.TryParse(sessionData, out var sessionId))
            {
                return;
            }

            var existing = connection.Session;
            if (existing != null && (existing.RoomId != envelope.RoomId || existing.ClientId != envelope.FromId || existing.SessionId != sessionId))
            {
                // One identity per socket
                return;
            }

            if (existing == null)
            {
                var session = AddConnection(envelope.RoomId, envelope.FromId, connection.Socket, sessionId);
                if (session == null)
                {
                    // That client ID is held by a different session
                    return;
                }
                connection.Session = session;
            }

            // The session ID is the secret that lets a reconnecting client reclaim its slot, so never pass it on
            var announcement = new Envelope
            {
                RoomId = connection.Session.RoomId,
                FromId = connection.Session.ClientId,
                ToId = connection.Session.RoomId,
                Type = "discover",
                Data = null
            };

            await Broadcast(announcement, connection.Socket);
            await BroadcastLocation(connection.Session, connection);
        }

        private async Task BroadcastLocation(ChatSession session, Connection connection)
        {
            var city = GetCity(connection.RemoteIp);
            if (city == null)
            {
                return;
            }

            var locationEnvelope = new Envelope
            {
                Data = JsonSerializer.Serialize(new Location(city)),
                FromId = session.ClientId,
                RoomId = session.RoomId,
                ToId = session.RoomId,
                Type = "location"
            };

            await Broadcast(locationEnvelope, connection.Socket);
        }

        // Returns the registered session, or null if the slot belongs to a different session
        private ChatSession AddConnection(Guid roomId, Guid clientId, WebSocket socket, Guid sessionId)
        {
            var key = (roomId, clientId);
            var session = new ChatSession
            {
                RoomId = roomId,
                ClientId = clientId,
                SessionId = sessionId,
                Socket = socket
            };

            var result = sessions.AddOrUpdate(key, session, (_, existing) => existing.SessionId == sessionId ? session : existing);
            return ReferenceEquals(result, session) ? session : null;
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
                RemoveSession(session);
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

        private void RemoveConnection(Connection connection)
        {
            if (connection.Session != null)
            {
                RemoveSession(connection.Session);
            }
        }

        // Only removes the entry if it still belongs to this session, so a client that has already
        // reconnected on a new socket doesn't get evicted by its old one closing
        private void RemoveSession(ChatSession session)
        {
            sessions.TryRemove(new KeyValuePair<(Guid, Guid), ChatSession>((session.RoomId, session.ClientId), session));
        }
    }
}
