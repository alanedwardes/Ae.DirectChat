import { UserMedia } from "./UserMedia";
import { Broker, IBroker, Envelope } from "./Broker";
import { PeerConnector } from "./PeerConnector";
import { VolumeUI, AudioSample } from "./VolumeUI";
import { VideoWall } from "./VideoWallUI";

export class ChatApp {
    private static userMedia: UserMedia = new UserMedia();
    private static videoWall: VideoWall;
    private static peerConnector: PeerConnector;

    public static SetGain(gain: number) {
        this.userMedia.SetGain(gain);
    }

    public static SetLocalListen(shouldListen: boolean) {
        this.userMedia.SetLocalListen(shouldListen);
    }

    public static async SetCameraEnabled(enabled: boolean) : Promise<void> {
        const stream: MediaStream = await this.userMedia.RequestAccess(enabled);
        this.videoWall.SetLocalStream(stream);
        this.peerConnector.StartLocalStream(stream);
    }

    public static async Start(roomId: string): Promise<void> {
        this.peerConnector = new PeerConnector();

        const stream: MediaStream = await this.userMedia.RequestAccess(false);

        this.videoWall = new VideoWall();
        const volumeUI = new VolumeUI();

        volumeUI.OnNeedSample = () => {
            return new AudioSample(this.userMedia.GetGain(), this.userMedia.SampleInput());
        }

        const broker = new Broker(roomId);
        await broker.Open();

        this.peerConnector.OnHasIceCandidates = candidates => {
            broker.Broadcast(candidates, "candidates");
        }

        this.peerConnector.OnHasStreams = streams => {
            streams.forEach(stream => {
                this.videoWall.AddRemoteStream(stream);
            });
        };

        this.peerConnector.OnHasOffer = offer => {
            broker.Broadcast(offer, "offer");
        }

        this.peerConnector.OnAcceptedOffer = offer => {
            broker.Broadcast(offer, "accept");
        };

        this.peerConnector.StartLocalStream(stream);

        broker.OnMessage = async (message: Envelope) => {
            if (message.Type == "offer") {
                await this.peerConnector.AcceptOffer(message.Data);
            }
            if (message.Type == "accept") {
                await this.peerConnector.AcceptAnswer(message.Data);
            }
            if (message.Type == "candidates") {
                await this.peerConnector.AddRemoteCandidates(message.Data);
            }
            if (message.Type == "discover") {
                this.peerConnector.SendLocalCandidates();
            }
        };

        broker.Broadcast(null, "discover");
    }
}