export interface IPeerConnector {
    StartLocalStream(stream: MediaStream): void
    OnHasIceCandidates: OnHasIceCandidatesDelegate;
    OnHasStreams: OnHasStreamsDelegate;
    OnHasOffer: OnHasOffer;
    OnAcceptedOffer: OnAcceptedOffer;
}

interface OnHasStreamsDelegate {
    (streams: readonly MediaStream[]): void;
}

interface OnHasIceCandidatesDelegate {
    (candidates: readonly RTCIceCandidate[]): void;
}

interface OnHasOffer {
    (offer: RTCSessionDescription): void;
}

interface OnAcceptedOffer {
    (offer: RTCSessionDescription): void;
}

export class PeerConnector implements IPeerConnector {
    private connector: RTCPeerConnection;
    private localCandidates: RTCIceCandidate[] = new Array<RTCIceCandidate>();
    private remoteCandidates: RTCIceCandidate[] = new Array<RTCIceCandidate>();

    public OnHasIceCandidates: OnHasIceCandidatesDelegate;
    public OnHasStreams: OnHasStreamsDelegate;
    public OnHasOffer: OnHasOffer;
    public OnAcceptedOffer: OnAcceptedOffer;

    public constructor() {
        const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
        this.connector = new RTCPeerConnection(configuration);

        this.connector.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
            if (event.candidate == null) {
                this.OnHasIceCandidates(this.localCandidates);
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

    public SendLocalCandidates(): void {
        this.OnHasIceCandidates(this.localCandidates);
    }

    public async AddRemoteCandidates(candidates: RTCIceCandidate[]): Promise<void> {
        await candidates.forEach(async (candidate: RTCIceCandidate) => {
            if (this.connector.remoteDescription == null) {
                this.remoteCandidates.push(candidate);
            }
            else {
                await this.connector.addIceCandidate(candidate);
            }
        });
    }

    public async AcceptAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
        await this.connector.setRemoteDescription(answer);
    }

    public async AcceptOffer(offer: RTCSessionDescriptionInit): Promise<void> {
        await this.connector.setRemoteDescription(offer);

        await this.connector.setLocalDescription(await this.connector.createAnswer());

        await this.remoteCandidates.forEach(async (candidate: RTCIceCandidate) => {
            await this.connector.addIceCandidate(candidate);
        });
        this.remoteCandidates = new Array<RTCIceCandidate>();

        this.OnAcceptedOffer(this.connector.localDescription);
    }

    private readonly rtpSenders: RTCRtpSender[] = new Array<RTCRtpSender>();

    public StartLocalStream(stream: MediaStream): void {
        this.StopLocalStream();

        stream.getTracks().forEach((track: MediaStreamTrack) => {
            this.rtpSenders.push(this.connector.addTrack(track, stream));
        });
    }

    private StopLocalStream(): void {
        this.rtpSenders.forEach((sender: RTCRtpSender) => {
            this.connector.removeTrack(sender);
        });
        this.rtpSenders.slice(this.rtpSenders.length - 1);
    }
}