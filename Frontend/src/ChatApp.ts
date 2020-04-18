import { UserMedia, UserMediaSettings } from "./UserMedia";
import { v4 as uuidv4 } from 'uuid';
import { Broker, IBroker, Envelope } from "./Broker";
import { PeerConnector } from "./PeerConnector";
import { VolumeUI, AudioSample } from "./VolumeUI";
import { VideoWall } from "./VideoWallUI";

interface OnConnectDelegate {
    (connectionId: string): void;
}

interface OnDisconnectDelegate {
    (connectionId: string): void;
}

export class ChatApp {
    public static NewGuid(): string { return uuidv4(); }

    public static GetMediaSettings(): UserMediaSettings { return ChatApp.userMedia.GetSettings(); }
    public static async SetMediaSettings(newSettings: UserMediaSettings): Promise<void> { await ChatApp.userMedia.SetSettings(newSettings); }

    private static sessionId: string = uuidv4();
    private static fromId: string = uuidv4();
    private static userMedia: UserMedia = new UserMedia();
    private static videoWall: VideoWall;
    private static localStream: MediaStream;

    public static OnConnect: OnConnectDelegate;
    public static OnDisconnect: OnDisconnectDelegate;

    public static GetAttendeeId(): string { return ChatApp.fromId; }

    public static async GetStatistics(connectionId: string): Promise<RTCStatsReport> {
        return await this.connectors[connectionId].GetStatistics();
    }

    private static connectors: { [fromId: string]: PeerConnector; } = {};

    public static SetLocalStream(localStream: MediaStream) {
        ChatApp.localStream = localStream;
        ChatApp.videoWall.SetLocalStream(ChatApp.localStream);
        for (let fromId in ChatApp.connectors) {
            if (ChatApp.connectors.hasOwnProperty(fromId)) {
                ChatApp.connectors[fromId].StartLocalStream(ChatApp.localStream);
            }
        }
    }

    public static async Start(roomId: string): Promise<void> {
        ChatApp.userMedia.OnMediaStreamAvailable = mediaStream => {
            this.SetLocalStream(mediaStream);
        };

        ChatApp.videoWall = new VideoWall();
        const volumeUI = new VolumeUI();

        this.SetLocalStream(await ChatApp.userMedia.GetMediaStream());

        volumeUI.OnNeedSample = () => {
            return new AudioSample(ChatApp.userMedia.SampleInput(), 0.5);
        }

        const broker = new Broker(roomId, this.fromId, this.sessionId);
        await broker.Open();

        ChatApp.OnConnect(ChatApp.fromId);

        broker.OnMessage = async (message: Envelope) => {

            if (message.FromId == ChatApp.fromId) {
                return;
            }

            if (!ChatApp.connectors.hasOwnProperty(message.FromId)) {
                ChatApp.OnConnect(message.FromId);
                const peerConnector: PeerConnector = new PeerConnector();

                peerConnector.OnConnectionChanged = newState => {
                    if (newState == "failed") {
                        delete ChatApp.connectors[message.FromId];
                        ChatApp.OnDisconnect(message.FromId);
                    }
                };

                peerConnector.OnHasIceCandidates = candidates => {
                    broker.Send(candidates, "candidates", message.FromId);
                }

                peerConnector.OnHasStreams = streams => {
                    streams.forEach(stream => {
                        ChatApp.videoWall.AddRemoteStream(stream);
                    });
                };

                peerConnector.OnHasOffer = offer => {
                    broker.Send(offer, "offer", message.FromId);
                }

                peerConnector.OnAcceptedOffer = offer => {
                    broker.Send(offer, "accept", message.FromId);
                };

                peerConnector.StartLocalStream(ChatApp.localStream);
                ChatApp.connectors[message.FromId] = peerConnector;
            }

            if (message.Type == "offer") {
                ChatApp.connectors[message.FromId].AcceptOffer(message.Data);
            }
            if (message.Type == "accept") {
                ChatApp.connectors[message.FromId].AcceptAnswer(message.Data);
            }
            if (message.Type == "candidates") {
                ChatApp.connectors[message.FromId].AddRemoteCandidates(message.Data);
            }
        };
    }
}