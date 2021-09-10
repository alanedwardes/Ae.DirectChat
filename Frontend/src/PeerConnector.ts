import * as SimplePeer from "simple-peer";

export interface IPeerConnector {
    Signal(signalData: SimplePeer.SignalData): void;
    Shutdown(): void;
    StartLocalStream(stream: MediaStream): void;
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
    (change: string): void;
}

export class PeerConnector implements IPeerConnector {
    private connector: SimplePeer.Instance;

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
        });

        this.connector.on('stream', (stream: MediaStream) => {
            this.OnHasStream(stream);
            this.OnConnectionChanged('got stream ' + stream.id);
        });

        this.connector.on('error', (error: Error) => {
            this.OnConnectionChanged('error: ' + error.name);
            this.OnClose();
        });

        this.connector.on('close', () => {
            this.OnConnectionChanged('lost');
            this.OnClose();
        });
    }

    public Signal(signalData: SimplePeer.SignalData): void {
        this.connector.signal(signalData);
    }

    public Shutdown(): void {
        this.connector.destroy();
    }

    private localStream: MediaStream = null;
    private localTracks: MediaStreamTrack[] = [];

    public StartLocalStream(stream: MediaStream): void {
        this.StopLocalStream();

        this.localStream = stream;
        this.localTracks = stream.getTracks();

        this.localTracks.forEach((track: MediaStreamTrack) => {
            this.connector.addTrack(track, this.localStream);
        });
    }

    private StopLocalStream(): void {
        this.localTracks.forEach(track => {
            this.connector.removeTrack(track, this.localStream);
        });

        this.localStream = null;
        this.localTracks = [];
    }
}