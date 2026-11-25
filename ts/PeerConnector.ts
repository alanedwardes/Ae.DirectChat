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
            const onStreamChanged = () => {
                if (this.isClosed) {
                    return;
                }
                this.OnHasStream(stream);
                this.OnConnectionChanged(PeerConnector.describeStream(stream), 'media');
            };
            // The remote keeps one stream and adds/removes tracks on it, which doesn't re-emit 'stream'
            stream.addEventListener('addtrack', onStreamChanged);
            stream.addEventListener('removetrack', onStreamChanged);
            onStreamChanged();
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

    // simple-peer keys its senders by the stream a track was first added with, so this stays the first stream sent
    private senderStream: MediaStream = null;
    private localTracks: MediaStreamTrack[] = [];

    public SendStream(stream: MediaStream): void {
        if (this.isClosed) {
            return;
        }

        if (this.senderStream == null) {
            this.senderStream = stream;
        }

        const unmatched = stream.getTracks();
        const nextTracks: MediaStreamTrack[] = [];

        for (const oldTrack of this.localTracks) {
            const index = unmatched.findIndex(track => track.kind === oldTrack.kind);
            if (index < 0) {
                this.connector.removeTrack(oldTrack, this.senderStream);
                continue;
            }

            const newTrack = unmatched.splice(index, 1)[0];
            if (newTrack !== oldTrack) {
                this.connector.replaceTrack(oldTrack, newTrack, this.senderStream);
            }
            nextTracks.push(newTrack);
        }

        for (const track of unmatched) {
            this.connector.addTrack(track, this.senderStream);
            nextTracks.push(track);
        }

        this.localTracks = nextTracks;
    }
}