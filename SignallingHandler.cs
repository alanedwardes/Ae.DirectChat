using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.WebSockets;
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

        private const int MaxClientsPerRoom = 16;

        public const int RoomFullCloseStatus = 4000;

        private static readonly TimeSpan JoinTimeout = TimeSpan.FromSeconds(10);

        private static readonly TimeSpan ReleasedIdHold = TimeSpan.FromMinutes(5);

        // Peer-to-peer messages clients may relay to each other. Everything else (notably "location",
        // which only the server may originate) is dropped.
        private static readonly HashSet<string> RelayableTypes = new(StringComparer.Ordinal)
        {
            "offer", "answer", "candidate", "renegotiate", "transceiverRequest", "reconnect", "leave"
        };

        private enum JoinResult { Joined, RoomFull, IdTaken }

        // Written only under joinLock
        private readonly ConcurrentDictionary<(Guid RoomId, Guid ClientId), ChatSession> sessions = new();
        private readonly Dictionary<Guid, int> roomSizes = new();
        private readonly Dictionary<(Guid RoomId, Guid ClientId), (Guid SessionId, DateTime Expires)> releasedIds = new();
        private readonly object joinLock = new();
        private DateTime lastReleasedIdSweep = DateTime.UtcNow;

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
            var connection = new ClientConnection(socket, remoteIp);
            var buffer = new byte[8 * 1024];

            using var receiveCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            receiveCancellation.CancelAfter(JoinTimeout);
            var token = receiveCancellation.Token;

            try
            {
                while (socket.State == WebSocketState.Open)
                {
                    using var messageStream = new MemoryStream();
                    WebSocketReceiveResult result;
                    do
                    {
                        result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), token);
                        if (result.MessageType == WebSocketMessageType.Close)
                        {
                            await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, null, token);
                            return;
                        }
                        if (messageStream.Length + result.Count > MaxMessageBytes)
                        {
                            await socket.CloseAsync(WebSocketCloseStatus.MessageTooBig, null, token);
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

                    if (envelope == null)
                    {
                        continue;
                    }

                    var wasJoined = connection.Session != null;
                    await ProcessMessage(envelope, connection, token);
                    if (!wasJoined && connection.Session != null)
                    {
                        receiveCancellation.CancelAfter(Timeout.InfiniteTimeSpan);
                    }
                }
            }
            catch (Exception ex) when (ex is WebSocketException or OperationCanceledException or ObjectDisposedException)
            {
            }
            finally
            {
                RemoveConnection(connection);
                await connection.CompleteAsync();
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

        private async Task ProcessMessage(Envelope envelope, ClientConnection connection, CancellationToken token)
        {
            if (envelope.Type == "ping")
            {
                connection.Send("{\"type\":\"pong\"}");
                return;
            }

            if (envelope.Type == "disconnect")
            {
                await connection.Socket.CloseAsync(WebSocketCloseStatus.NormalClosure, null, token);
                return;
            }

            if (envelope.Type == "discover")
            {
                await ProcessDiscover(envelope, connection, token);
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
                SendTo(envelope);
                BroadcastLocation(session);
            }
            else if (envelope.Type != null && RelayableTypes.Contains(envelope.Type))
            {
                SendTo(envelope);
            }
        }

        private async Task ProcessDiscover(Envelope envelope, ClientConnection connection, CancellationToken token)
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
                switch (AddConnection(envelope.RoomId, envelope.FromId, connection, sessionId, out var replaced))
                {
                    case JoinResult.RoomFull:
                        await connection.Socket.CloseAsync((WebSocketCloseStatus)RoomFullCloseStatus, "Room is full", token);
                        return;
                    case JoinResult.IdTaken:
                        return;
                }

                replaced?.Connection.Socket.Abort();
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

            Broadcast(announcement, connection);
            BroadcastLocation(connection.Session);
        }

        private void BroadcastLocation(ChatSession session)
        {
            var city = GetCity(session.Connection.RemoteIp);
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

            Broadcast(locationEnvelope, session.Connection);
        }

        private JoinResult AddConnection(Guid roomId, Guid clientId, ClientConnection connection, Guid sessionId, out ChatSession replaced)
        {
            var key = (roomId, clientId);
            var now = DateTime.UtcNow;
            replaced = null;

            lock (joinLock)
            {
                SweepReleasedIds(now);

                if (sessions.TryGetValue(key, out var current))
                {
                    if (current.SessionId != sessionId)
                    {
                        return JoinResult.IdTaken;
                    }
                    replaced = current;
                }
                else
                {
                    if (releasedIds.TryGetValue(key, out var released) && released.Expires > now && released.SessionId != sessionId)
                    {
                        return JoinResult.IdTaken;
                    }

                    roomSizes.TryGetValue(roomId, out var size);
                    if (size >= MaxClientsPerRoom)
                    {
                        return JoinResult.RoomFull;
                    }
                    roomSizes[roomId] = size + 1;
                }

                releasedIds.Remove(key);
                var session = new ChatSession
                {
                    RoomId = roomId,
                    ClientId = clientId,
                    SessionId = sessionId,
                    Connection = connection
                };
                sessions[key] = session;
                connection.Session = session;
                return JoinResult.Joined;
            }
        }

        private void SweepReleasedIds(DateTime now)
        {
            if (now - lastReleasedIdSweep < TimeSpan.FromMinutes(1))
            {
                return;
            }

            lastReleasedIdSweep = now;
            foreach (var key in releasedIds.Where(entry => entry.Value.Expires <= now).Select(entry => entry.Key).ToList())
            {
                releasedIds.Remove(key);
            }
        }

        private void SendTo(Envelope envelope)
        {
            if (sessions.TryGetValue((envelope.RoomId, envelope.ToId), out var session))
            {
                session.Connection.Send(JsonSerializer.Serialize(envelope));
            }
        }

        private void Broadcast(Envelope envelope, ClientConnection exclude)
        {
            var json = JsonSerializer.Serialize(envelope);
            foreach (var session in sessions.Values)
            {
                if (session.RoomId == envelope.RoomId && session.Connection != exclude)
                {
                    session.Connection.Send(json);
                }
            }
        }

        // Only if still current, so an old socket closing doesn't evict the client's new one
        private void RemoveConnection(ClientConnection connection)
        {
            var session = connection.Session;
            if (session == null)
            {
                return;
            }

            var key = (session.RoomId, session.ClientId);
            lock (joinLock)
            {
                if (!sessions.TryRemove(new KeyValuePair<(Guid, Guid), ChatSession>(key, session)))
                {
                    return;
                }

                releasedIds[key] = (session.SessionId, DateTime.UtcNow + ReleasedIdHold);
                if (roomSizes.TryGetValue(session.RoomId, out var size) && size > 1)
                {
                    roomSizes[session.RoomId] = size - 1;
                }
                else
                {
                    roomSizes.Remove(session.RoomId);
                }
            }
        }
    }
}
