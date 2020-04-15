import { UserMedia } from "./UserMedia";
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
    private static userMedia: UserMedia = new UserMedia();
    private static videoWall: VideoWall;
    private static localStream: MediaStream;

    public static OnConnect: OnConnectDelegate;
    public static OnDisconnect: OnDisconnectDelegate;

    public static SetGain(gain: number) {
        ChatApp.userMedia.SetGain(gain);
    }

    public static SetLocalListen(shouldListen: boolean) {
        ChatApp.userMedia.SetLocalListen(shouldListen);
    }

    public static async SetCameraEnabled(enabled: boolean): Promise<void> {
        ChatApp.localStream = await ChatApp.userMedia.RequestAccess(enabled);
        ChatApp.videoWall.SetLocalStream(ChatApp.localStream);
        for (let fromId in ChatApp.connectors) {
            if (ChatApp.connectors.hasOwnProperty(fromId)) {
                ChatApp.connectors[fromId].StartLocalStream(ChatApp.localStream);
            }
        }
    }

    public static async GetStatistics(connectionId : string) : Promise<RTCStatsReport> {
        return await this.connectors[connectionId].GetStatistics();
    }

    private static connectors: { [fromId: string]: PeerConnector; } = {};

    public static async Start(roomId: string): Promise<void> {
        ChatApp.localStream = await ChatApp.userMedia.RequestAccess(false);

        ChatApp.videoWall = new VideoWall();
        const volumeUI = new VolumeUI();

        volumeUI.OnNeedSample = () => {
            return new AudioSample(ChatApp.userMedia.GetGain(), ChatApp.userMedia.SampleInput());
        }

        const broker = new Broker(roomId);
        await broker.Open();

        broker.OnMessage = async (message: Envelope) => {

            if (!ChatApp.connectors.hasOwnProperty(message.FromId)) {
                ChatApp.OnConnect(message.FromId);
                const peerConnector: PeerConnector = new PeerConnector();

                peerConnector.OnConnectionChanged = newState => {
                    if (newState == "failed") {
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

        broker.Send(null, "discover", null);
    }
}