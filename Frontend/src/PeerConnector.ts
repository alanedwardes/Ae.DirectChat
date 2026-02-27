import * as SimplePeer from "simple-peer";

export interface IPeerConnector {
    Signal(signalData: SimplePeer.SignalData): void;
    SendStream(stream: MediaStream): void;
    OnConnectionChanged: OnConnectionChangedDelegate;
    OnSendMessage: OnSendMessage;
    OnHasStream: OnHasStreamDelegate;
    OnClose: OnCloseDelegate;
}

interface OnCloseDelegate {
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

export class PeerConnector implements IPeerConnector {
    private connector: SimplePeer.Instance;
    private isClosed: boolean;
    private hasSignalled: boolean = false;

    public OnHasStream: OnHasStreamDelegate;
    public OnConnectionChanged: OnConnectionChangedDelegate;
    public OnClose: OnCloseDelegate;

    public OnSendMessage: OnSendMessage;

    public constructor(shouldOffer: boolean) {
        const options: SimplePeer.Options = {
            initiator: shouldOffer
        };

        this.connector = new SimplePeer(options);

        this.connector.on('signal', (data: SimplePeer.SignalData) => {
            this.OnSendMessage(data, data.type);
            if (!this.hasSignalled) {
                this.hasSignalled = true;
                this.OnConnectionChanged('connecting', 'connection');
            }
        });

        this.connector.on('connect', () => {
            this.OnConnectionChanged('connected', 'connection');
        });

        this.connector.on('stream', (stream: MediaStream) => {
            this.OnHasStream(stream);
            this.OnConnectionChanged(PeerConnector.describeStream(stream), 'media');
        });

        this.connector.on('error', (error: Error) => {
            this.OnConnectionChanged('error: ' + error.message, 'connection');
            this.Shutdown();
        });

        this.connector.on('close', () => {
            this.OnConnectionChanged('lost', 'connection');
            this.Shutdown();
        });
    }

    private static describeStream(stream: MediaStream): string {
        const audio = stream.getAudioTracks().length;
        const video = stream.getVideoTracks().length;
        const parts: string[] = [];
        if (audio > 0) parts.push(audio + ' audio');
        if (video > 0) parts.push(video + ' video');
        return parts.length > 0 ? parts.join(' + ') : 'no tracks';
    }

    public Signal(signalData: SimplePeer.SignalData): void {
        if (this.isClosed) {
            return;
        }

        this.connector.signal(signalData);
    }

    private Shutdown(): void {
        if (this.isClosed) {
            return;
        }

        this.isClosed = true;
        this.connector.removeAllListeners();
        this.connector.destroy();
        this.OnClose();
    }

    private localStream: MediaStream = null;
    private localTracks: MediaStreamTrack[] = [];

    public SendStream(stream: MediaStream): void {
        if (this.isClosed) {
            return;
        }

        this.StopStream();

        this.localStream = stream;
        this.localTracks = stream.getTracks();
        this.localTracks.forEach(track => this.connector.addTrack(track, this.localStream));
    }

    private StopStream(): void {
        this.localTracks.forEach(track => this.connector.removeTrack(track, this.localStream));
        this.localStream = null;
        this.localTracks = [];
    }
}