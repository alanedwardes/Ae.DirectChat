import { UserMedia } from "./UserMedia";
import { Broker, IBroker, Envelope } from "./Broker";
import { PeerConnector } from "./PeerConnector";
import { VolumeUI, AudioSample } from "./VolumeUI";
import { VideoWall } from "./VideoWallUI";

export class ChatApp {
    private static userMedia: UserMedia = new UserMedia();

    public static SetGain(gain: number) {
        this.userMedia.SetGain(gain);
    }

    public static SetLocalListen(shouldListen: boolean) {
        this.userMedia.SetLocalListen(shouldListen);
    }

    public static async Start(roomId: string): Promise<void> {
        const peerConnector: PeerConnector = new PeerConnector();

        const stream: MediaStream = await this.userMedia.RequestAccess();

        var videoWall = new VideoWall();
        videoWall.SetLocalStream(stream);

        const volumeUI = new VolumeUI();

        volumeUI.OnNeedSample = () => {
            return new AudioSample(this.userMedia.GetGain(), this.userMedia.SampleInput());
        }

        const broker = new Broker(roomId);
        await broker.Open();

        peerConnector.OnHasIceCandidates = candidates => {
            broker.Broadcast(candidates, "candidates");
        }

        peerConnector.OnHasStreams = streams => {
            streams.forEach(stream => {
                videoWall.AddRemoteStream(stream);
            });
        };

        peerConnector.OnHasOffer = offer => {
            broker.Broadcast(offer, "offer");
        }

        peerConnector.OnAcceptedOffer = offer => {
            broker.Broadcast(offer, "accept");
        };

        stream.getTracks().forEach((track: MediaStreamTrack) => {
            peerConnector.AddTrack(track, stream);
        });

        broker.OnMessage = async (message: Envelope) => {
            if (message.Type == "offer") {
                await peerConnector.AcceptOffer(message.Data);
            }
            if (message.Type == "accept") {
                await peerConnector.AcceptAnswer(message.Data);
            }
            if (message.Type == "candidates") {
                await peerConnector.AddRemoteCandidates(message.Data);
            }
            if (message.Type == "discover") {
                peerConnector.SendLocalCandidates();
            }
        };

        broker.Broadcast(null, "discover");
    }
}