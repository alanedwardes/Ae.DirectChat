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
    (change: string): void;
}

export class PeerConnector implements IPeerConnector {
    private connector: SimplePeer.Instance;
    private isClosed: boolean;

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
            this.Shutdown();
        });

        this.connector.on('close', () => {
            this.OnConnectionChanged('lost');
            this.Shutdown();
        });
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

        this.localTracks.forEach((track: MediaStreamTrack) => {
            this.connector.addTrack(track, this.localStream);
        });
    }

    private StopStream(): void {
        this.localTracks.forEach(track => {
            this.connector.removeTrack(track, this.localStream);
        });

        this.localStream = null;
        this.localTracks = [];
    }
}