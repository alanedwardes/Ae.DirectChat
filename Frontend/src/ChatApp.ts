import { UserMedia } from "./UserMedia";
import { Broker, IBroker, Envelope } from "./Broker";
import { PeerConnector } from "./PeerConnector";
import { VolumeUI, AudioSample } from "./VolumeUI";
import { VideoWall } from "./VideoWallUI";

export class ChatApp {
    private static userMedia: UserMedia = new UserMedia();
    private static videoWall: VideoWall;
    private static localStream: MediaStream;

    public static SetGain(gain: number) {
        this.userMedia.SetGain(gain);
    }

    public static SetLocalListen(shouldListen: boolean) {
        this.userMedia.SetLocalListen(shouldListen);
    }

    public static async SetCameraEnabled(enabled: boolean): Promise<void> {
        this.localStream = await this.userMedia.RequestAccess(enabled);
        this.videoWall.SetLocalStream(this.localStream);
        for (let fromId in this.connectors) {
            if (this.connectors.hasOwnProperty(fromId)) {
                this.connectors[fromId].StartLocalStream(this.localStream);
            }
        }
    }

    private static connectors: { [fromId: string]: PeerConnector; } = {};

    public static async Start(roomId: string): Promise<void> {
        this.localStream = await this.userMedia.RequestAccess(false);

        this.videoWall = new VideoWall();
        const volumeUI = new VolumeUI();

        volumeUI.OnNeedSample = () => {
            return new AudioSample(this.userMedia.GetGain(), this.userMedia.SampleInput());
        }

        const broker = new Broker(roomId);
        await broker.Open();

        broker.OnMessage = async (message: Envelope) => {

            if (!this.connectors.hasOwnProperty(message.FromId)) {
                const peerConnector: PeerConnector = new PeerConnector();

                peerConnector.OnHasIceCandidates = candidates => {
                    broker.Send(candidates, "candidates", message.FromId);
                }

                peerConnector.OnHasStreams = streams => {
                    streams.forEach(stream => {
                        this.videoWall.AddRemoteStream(stream);
                    });
                };

                peerConnector.OnHasOffer = offer => {
                    broker.Send(offer, "offer", message.FromId);
                }

                peerConnector.OnAcceptedOffer = offer => {
                    broker.Send(offer, "accept", message.FromId);
                };

                peerConnector.StartLocalStream(this.localStream);
                this.connectors[message.FromId] = peerConnector;
            }

            if (message.Type == "offer") {
                this.connectors[message.FromId].AcceptOffer(message.Data);
            }
            if (message.Type == "accept") {
                this.connectors[message.FromId].AcceptAnswer(message.Data);
            }
            if (message.Type == "candidates") {
                this.connectors[message.FromId].AddRemoteCandidates(message.Data);
            }
        };

        broker.Send(null, "discover", null);
    }
}