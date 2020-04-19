export interface IPeerConnector {
    StartLocalStream(stream: MediaStream): void;
    GetStatistics(): Promise<RTCStatsReport>;
    AcceptAnswer(answer: RTCSessionDescriptionInit): Promise<void>;
    AcceptOffer(offer: RTCSessionDescriptionInit): Promise<void>;
    AddRemoteCandidates(candidates: RTCIceCandidate[]): Promise<void>;
    OnHasIceCandidates: OnHasIceCandidatesDelegate;
    OnHasStreams: OnHasStreamsDelegate;
    OnHasOffer: OnHasOfferDelegate;
    OnAcceptedOffer: OnAcceptedOfferDelegate;
    OnConnectionChanged: OnConnectionChangedDelegate;
}

interface OnHasStreamsDelegate {
    (streams: readonly MediaStream[]): void;
}

interface OnHasIceCandidatesDelegate {
    (candidates: readonly RTCIceCandidate[]): void;
}

interface OnHasOfferDelegate {
    (offer: RTCSessionDescription): void;
}

interface OnAcceptedOfferDelegate {
    (offer: RTCSessionDescription): void;
}

interface OnConnectionChangedDelegate {
    (newState: RTCPeerConnectionState): void;
}

export class PeerConnector implements IPeerConnector {
    private connector: RTCPeerConnection;
    private localCandidates: RTCIceCandidate[] = new Array<RTCIceCandidate>();
    private remoteCandidates: RTCIceCandidate[] = new Array<RTCIceCandidate>();

    public OnHasIceCandidates: OnHasIceCandidatesDelegate;
    public OnHasStreams: OnHasStreamsDelegate;
    public OnHasOffer: OnHasOfferDelegate;
    public OnAcceptedOffer: OnAcceptedOfferDelegate;
    public OnConnectionChanged: OnConnectionChangedDelegate;

    public constructor() {
        const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
        this.connector = new RTCPeerConnection(configuration);

        this.connector.onconnectionstatechange = () => {
            this.OnConnectionChanged(this.connector.connectionState);
        }

        this.connector.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
            if (event.candidate == null) {
                this.OnHasIceCandidates(this.localCandidates);
                this.localCandidates = new Array<RTCIceCandidate>();
            }
            else {
                this.localCandidates.push(event.candidate);
            }
        }

        this.connector.onnegotiationneeded = async () => {
            try {
                await this.connector.setLocalDescription(await this.connector.createOffer());
                this.OnHasOffer(this.connector.localDescription);
            } catch (err) {
                console.error(err);
            }
        };

        this.connector.ontrack = (ev: RTCTrackEvent) => {
            this.OnHasStreams(ev.streams);
        };
    }

    public async GetStatistics(): Promise<RTCStatsReport> {
        return await this.connector.getStats();
    }

    public async AddRemoteCandidates(candidates: RTCIceCandidate[]): Promise<void> {
        candidates.forEach(async (candidate: RTCIceCandidate) => {
            try {
                await this.connector.addIceCandidate(candidate);
            }
            catch (err) {
                this.remoteCandidates.push(candidate);
            }
        });
    }

    public async AcceptAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
        await this.connector.setRemoteDescription(answer);
    }

    public async AcceptOffer(offer: RTCSessionDescriptionInit): Promise<void> {
        await this.connector.setRemoteDescription(offer);

        await this.connector.setLocalDescription(await this.connector.createAnswer());

        this.remoteCandidates.forEach(async (candidate: RTCIceCandidate) => {
            await this.connector.addIceCandidate(candidate);
        });
        this.remoteCandidates = new Array<RTCIceCandidate>();

        this.OnAcceptedOffer(this.connector.localDescription);
    }

    private readonly rtpSenders: RTCRtpSender[] = new Array<RTCRtpSender>();

    public StartLocalStream(stream: MediaStream): void {
        this.StopLocalStream();

        stream.getTracks().forEach((track: MediaStreamTrack) => {
            console.log("adding track");
            this.rtpSenders.push(this.connector.addTrack(track, stream));
        });
    }

    private StopLocalStream(): void {
        this.rtpSenders.forEach((sender: RTCRtpSender) => {
            console.log("removing track");
            this.connector.removeTrack(sender);
        });
        this.rtpSenders.slice(this.rtpSenders.length - 1);
    }
}