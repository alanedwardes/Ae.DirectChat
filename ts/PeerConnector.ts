export interface SignalData {
    type: string;
    sdp?: string;
    candidate?: RTCIceCandidateInit | null;
    [key: string]: unknown;
}

export interface IPeerConnector {
    Signal(signalData: SignalData): void;
    SendStream(stream: MediaStream): void;
    Destroy(): void;
    readonly IsConnected: boolean;
    OnConnectionChanged: OnConnectionChangedDelegate;
    OnSendMessage: OnSendMessage;
    OnHasStream: OnHasStreamDelegate;
    OnConnect: OnConnectDelegate;
    OnClose: OnCloseDelegate;
}

interface OnCloseDelegate {
    (): void;
}

interface OnConnectDelegate {
    (): void;
}

interface OnHasStreamDelegate {
    (streams: MediaStream): void;
}

interface OnSendMessage {
    (payload: any, type: string): void;
}

export interface OnConnectionChangedDelegate {
    (change: string, category: string): void;
}

type Kind = 'audio' | 'video';

export class PeerConnector implements IPeerConnector {
    private static connectTimeoutMs: number = 15_000;
    private static disconnectedGraceMs: number = 5_000;
    private static readonly iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

    private readonly pc: RTCPeerConnection;
    private readonly shouldOffer: boolean;
    private readonly outStream: MediaStream = new MediaStream();
    private readonly remoteStream: MediaStream = new MediaStream();
    private channel: RTCDataChannel = null;
    private desired: Record<Kind, MediaStreamTrack> = { audio: null, video: null };
    private requested: Set<Kind> = new Set<Kind>();
    private pendingCandidates: RTCIceCandidateInit[] = [];
    private applying: Promise<void> = Promise.resolve();
    private makingOffer: boolean = false;
    private offerWanted: boolean = false;
    private isClosed: boolean = false;
    private isConnected: boolean = false;
    private hasSignalled: boolean = false;
    private connectTimeoutHandle: number = 0;
    private disconnectedHandle: number = 0;

    public OnHasStream: OnHasStreamDelegate;
    public OnConnectionChanged: OnConnectionChangedDelegate;
    public OnConnect: OnConnectDelegate;
    public OnClose: OnCloseDelegate;
    public OnSendMessage: OnSendMessage;

    public constructor(shouldOffer: boolean) {
        this.shouldOffer = shouldOffer;
        this.pc = new RTCPeerConnection({ iceServers: PeerConnector.iceServers });

        this.connectTimeoutHandle = window.setTimeout(() => {
            this.connectTimeoutHandle = 0;
            if (!this.isConnected) {
                this.OnConnectionChanged('timed out', 'connection');
                this.Shutdown();
            }
        }, PeerConnector.connectTimeoutMs);

        this.pc.onicecandidate = event => {
            if (event.candidate != null) {
                this.Send({ type: 'candidate', candidate: event.candidate.toJSON() });
            }
        };
        this.pc.onnegotiationneeded = () => this.Negotiate();
        this.pc.onconnectionstatechange = () => this.OnConnectionStateChange();
        this.pc.ontrack = () => this.SyncRemote();
        this.pc.ondatachannel = event => this.WatchChannel(event.channel);

        if (shouldOffer) {
            this.pc.addTransceiver('audio', { direction: 'recvonly', streams: [this.outStream] });
            this.pc.addTransceiver('video', { direction: 'recvonly', streams: [this.outStream] });
            this.WatchChannel(this.pc.createDataChannel('ae'));
        }
    }

    public get IsConnected(): boolean {
        return this.isConnected && !this.isClosed;
    }

    private static describeStream(stream: MediaStream): string {
        const audio = stream.getAudioTracks().filter(track => track.readyState === 'live' && !track.muted).length;
        const video = stream.getVideoTracks().filter(track => track.readyState === 'live' && !track.muted).length;
        const parts: string[] = [];
        if (audio > 0) parts.push(audio + ' audio');
        if (video > 0) parts.push(video + ' video');
        return parts.length > 0 ? parts.join(' + ') : 'no tracks';
    }

    private Send(signal: SignalData): void {
        if (this.isClosed) {
            return;
        }
        this.OnSendMessage(signal, signal.type);
        if (!this.hasSignalled) {
            this.hasSignalled = true;
            this.OnConnectionChanged('connecting', 'connection');
        }
    }

    private Fail(err: unknown): void {
        if (this.isClosed) {
            return;
        }
        this.OnConnectionChanged('error: ' + (err instanceof Error ? err.message : String(err)), 'connection');
        this.Shutdown();
    }

    public Signal(data: SignalData): void {
        if (this.isClosed || data == null || typeof data !== 'object') {
            return;
        }
        this.HandleSignal(data).catch(err => this.Fail(err));
    }

    private async HandleSignal(data: SignalData): Promise<void> {
        if (data.type === 'offer' && typeof data.sdp === 'string') {
            if (this.pc.signalingState !== 'stable') {
                return;
            }
            await this.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
            await this.FlushCandidates();
            await this.ApplyTracks();
            await this.pc.setLocalDescription();
            this.Send({ type: 'answer', sdp: this.pc.localDescription.sdp });
            this.SyncRemote();
        }
        else if (data.type === 'answer' && typeof data.sdp === 'string') {
            if (this.pc.signalingState !== 'have-local-offer') {
                return;
            }
            await this.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
            await this.FlushCandidates();
            this.SyncRemote();
            if (this.offerWanted) {
                this.Negotiate();
            }
        }
        else if (data.type === 'renegotiate' || data.renegotiate === true) {
            if (this.shouldOffer) {
                if (data.iceRestart === true) {
                    this.pc.restartIce();
                }
                this.Negotiate();
            }
        }
        else if (data.type === 'transceiverRequest' && this.shouldOffer) {
            const kind = (data.transceiverRequest as { kind?: string })?.kind;
            if ((kind === 'audio' || kind === 'video') && this.FindTransceiver(kind) == null) {
                this.pc.addTransceiver(kind, { direction: 'recvonly', streams: [this.outStream] });
            }
        }
        else if (data.candidate != null) {
            if (this.pc.remoteDescription == null) {
                this.pendingCandidates.push(data.candidate);
                return;
            }
            await this.pc.addIceCandidate(data.candidate).catch(() => { });
        }
    }

    private async FlushCandidates(): Promise<void> {
        const pending = this.pendingCandidates;
        this.pendingCandidates = [];
        for (const candidate of pending) {
            await this.pc.addIceCandidate(candidate).catch(() => { });
        }
    }

    private Negotiate(): void {
        if (this.isClosed) {
            return;
        }
        if (!this.shouldOffer) {
            if (this.pc.remoteDescription != null) {
                this.Send({ type: 'renegotiate', renegotiate: true });
            }
            return;
        }
        if (this.makingOffer || this.pc.signalingState !== 'stable') {
            this.offerWanted = true;
            return;
        }
        this.offerWanted = false;
        this.makingOffer = true;
        this.pc.setLocalDescription()
            .then(() => this.Send({ type: 'offer', sdp: this.pc.localDescription.sdp }))
            .catch(err => this.Fail(err))
            .finally(() => this.makingOffer = false);
    }

    private RestartIce(): void {
        if (this.shouldOffer) {
            this.pc.restartIce();
        }
        else {
            this.Send({ type: 'renegotiate', renegotiate: true, iceRestart: true });
        }
    }

    private OnConnectionStateChange(): void {
        if (this.isClosed) {
            return;
        }
        switch (this.pc.connectionState) {
            case 'connected':
                this.ClearDisconnected();
                if (!this.isConnected) {
                    this.isConnected = true;
                    this.ClearConnectTimeout();
                    this.OnConnectionChanged('connected', 'connection');
                    if (this.OnConnect) {
                        this.OnConnect();
                    }
                }
                else {
                    this.OnConnectionChanged('connected', 'connection');
                }
                break;
            case 'disconnected':
                if (this.isConnected && !this.disconnectedHandle) {
                    this.OnConnectionChanged('interrupted', 'connection');
                    this.disconnectedHandle = window.setTimeout(() => {
                        this.disconnectedHandle = 0;
                        this.OnConnectionChanged('lost', 'connection');
                        this.Shutdown();
                    }, PeerConnector.disconnectedGraceMs);
                    this.RestartIce();
                }
                break;
            case 'failed':
                this.OnConnectionChanged(this.isConnected ? 'lost' : 'failed', 'connection');
                this.Shutdown();
                break;
        }
    }

    private WatchChannel(channel: RTCDataChannel): void {
        this.channel = channel;
        channel.onclose = () => {
            if (!this.isClosed && this.isConnected) {
                this.OnConnectionChanged('lost', 'connection');
                this.Shutdown();
            }
        };
    }

    private SyncRemote(): void {
        if (this.isClosed) {
            return;
        }
        let changed = false;
        for (const kind of ['audio', 'video'] as Kind[]) {
            const active = this.pc.getTransceivers()
                .filter(t => t.receiver.track.kind === kind && (t.currentDirection === 'sendrecv' || t.currentDirection === 'recvonly'))
                .map(t => t.receiver.track)[0] ?? null;
            for (const existing of this.remoteStream.getTracks().filter(t => t.kind === kind && t !== active)) {
                this.remoteStream.removeTrack(existing);
                changed = true;
            }
            if (active != null && !this.remoteStream.getTracks().includes(active)) {
                this.remoteStream.addTrack(active);
                active.onmute = active.onunmute = active.onended = () => this.ReportStream();
                changed = true;
            }
        }
        if (changed) {
            this.ReportStream();
        }
    }

    private ReportStream(): void {
        if (this.isClosed) {
            return;
        }
        this.OnHasStream(this.remoteStream);
        this.OnConnectionChanged(PeerConnector.describeStream(this.remoteStream), 'media');
    }

    public SendStream(stream: MediaStream): void {
        if (this.isClosed || stream == null) {
            return;
        }
        this.desired = {
            audio: stream.getAudioTracks()[0] ?? null,
            video: stream.getVideoTracks()[0] ?? null,
        };
        if (this.shouldOffer || this.pc.remoteDescription != null) {
            this.ApplyTracks().catch(err => this.Fail(err));
        }
    }

    private FindTransceiver(kind: Kind): RTCRtpTransceiver {
        return this.pc.getTransceivers().find(transceiver =>
            transceiver.receiver.track.kind === kind && !(transceiver as any).stopped && transceiver.currentDirection !== 'stopped') ?? null;
    }

    private ApplyTracks(): Promise<void> {
        this.applying = this.applying.catch(() => { }).then(async () => {
            for (const kind of ['audio', 'video'] as Kind[]) {
                if (this.isClosed) {
                    return;
                }
                const track = this.desired[kind];
                const transceiver = this.FindTransceiver(kind);
                if (transceiver == null) {
                    if (track != null && !this.requested.has(kind)) {
                        this.requested.add(kind);
                        this.Send({ type: 'transceiverRequest', transceiverRequest: { kind, init: { direction: 'sendrecv' } } });
                    }
                    continue;
                }
                if (transceiver.sender.track !== track) {
                    await transceiver.sender.replaceTrack(track);
                    if (track != null && !this.shouldOffer && typeof transceiver.sender.setStreams === 'function') {
                        transceiver.sender.setStreams(this.outStream);
                    }
                }
                const direction: RTCRtpTransceiverDirection = track != null ? 'sendrecv' : 'recvonly';
                if (transceiver.direction !== direction) {
                    transceiver.direction = direction;
                }
            }
        });
        return this.applying;
    }

    public Destroy(): void {
        this.Shutdown();
    }

    private ClearConnectTimeout(): void {
        if (this.connectTimeoutHandle) {
            clearTimeout(this.connectTimeoutHandle);
            this.connectTimeoutHandle = 0;
        }
    }

    private ClearDisconnected(): void {
        if (this.disconnectedHandle) {
            clearTimeout(this.disconnectedHandle);
            this.disconnectedHandle = 0;
        }
    }

    private Shutdown(): void {
        if (this.isClosed) {
            return;
        }

        this.isClosed = true;
        this.ClearConnectTimeout();
        this.ClearDisconnected();
        this.pc.onicecandidate = null;
        this.pc.onnegotiationneeded = null;
        this.pc.onconnectionstatechange = null;
        this.pc.ontrack = null;
        this.pc.ondatachannel = null;
        if (this.channel != null) {
            this.channel.onclose = null;
        }
        this.pc.close();
        this.OnClose();
    }
}
