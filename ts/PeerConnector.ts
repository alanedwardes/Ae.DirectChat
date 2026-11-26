export interface IPeerConnector {
    Signal(signalData: SimplePeer.SignalData): void;
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

export class PeerConnector implements IPeerConnector {
    // A connector that never connects (e.g. the other side vanished) is torn down so it can be retried
    private static readonly connectTimeoutMs: number = 15_000;

    private connector: SimplePeer.Instance;
    private isClosed: boolean;
    private isConnected: boolean = false;
    private hasSignalled: boolean = false;
    private connectTimeoutHandle: number = 0;

    public OnHasStream: OnHasStreamDelegate;
    public OnConnectionChanged: OnConnectionChangedDelegate;
    public OnConnect: OnConnectDelegate;
    public OnClose: OnCloseDelegate;

    public OnSendMessage: OnSendMessage;

    public constructor(shouldOffer: boolean) {
        const options: SimplePeer.Options = {
            initiator: shouldOffer
        };

        this.connector = new SimplePeer(options);

        this.connectTimeoutHandle = window.setTimeout(() => {
            this.connectTimeoutHandle = 0;
            if (!this.isConnected) {
                this.OnConnectionChanged('timed out', 'connection');
                this.Shutdown();
            }
        }, PeerConnector.connectTimeoutMs);

        this.connector.on('signal', (data: SimplePeer.SignalData) => {
            this.OnSendMessage(data, data.type);
            if (!this.hasSignalled) {
                this.hasSignalled = true;
                this.OnConnectionChanged('connecting', 'connection');
            }
        });

        this.connector.on('connect', () => {
            this.isConnected = true;
            this.ClearConnectTimeout();
            this.OnConnectionChanged('connected', 'connection');
            if (this.OnConnect) {
                this.OnConnect();
            }
        });

        this.connector.on('stream', (stream: MediaStream) => {
            const onStreamChanged = () => {
                if (this.isClosed) {
                    return;
                }
                this.OnHasStream(stream);
                this.OnConnectionChanged(PeerConnector.describeStream(stream), 'media');
            };
            // A remote track that stops receiving media (e.g. the sender's screen share ended) is muted
            // rather than removed, so watch each track as well as the stream
            const watchTrack = (track: MediaStreamTrack) => {
                track.addEventListener('mute', onStreamChanged);
                track.addEventListener('unmute', onStreamChanged);
                track.addEventListener('ended', onStreamChanged);
            };
            stream.getTracks().forEach(watchTrack);
            // The remote keeps one stream and adds/removes tracks on it, which doesn't re-emit 'stream'
            stream.addEventListener('addtrack', (event: MediaStreamTrackEvent) => {
                watchTrack(event.track);
                onStreamChanged();
            });
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

    public get IsConnected(): boolean {
        return this.isConnected && !this.isClosed;
    }

    private static describeStream(stream: MediaStream): string {
        const audio = stream.getAudioTracks().length;
        const video = stream.getVideoTracks().filter(track => track.readyState === 'live' && !track.muted).length;
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

    public Destroy(): void {
        this.Shutdown();
    }

    private ClearConnectTimeout(): void {
        if (this.connectTimeoutHandle) {
            clearTimeout(this.connectTimeoutHandle);
            this.connectTimeoutHandle = 0;
        }
    }

    private Shutdown(): void {
        if (this.isClosed) {
            return;
        }

        this.isClosed = true;
        this.ClearConnectTimeout();
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
