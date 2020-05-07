import { IUserMedia } from "./UserMedia";
import { v4 as uuidv4 } from 'uuid';
import { Broker, IBroker } from "./Broker";
import { ConnectionManager } from "./ConnectionManager";

interface OnConnectDelegate {
    (connectionId: string): void;
}

interface OnDisconnectDelegate {
    (connectionId: string): void;
}

interface OnLocalStreamDelegate {
    (mediaStream: MediaStream): void;
}

interface OnRemoteStreamDelegate {
    (clientId: string, mediaStream: MediaStream): void;
}

interface OnMessage {
    (message: string, type: string): void;
}

export class ChatApp {
    public NewGuid(): string { return uuidv4(); }

    constructor(userMedia: IUserMedia) {
        this.userMedia = userMedia;
    }

    private readonly userMedia: IUserMedia;
    private localStream: MediaStream;
    private connectionManager: ConnectionManager;

    public OnConnect: OnConnectDelegate;
    public OnDisconnect: OnDisconnectDelegate;
    public OnLocalStream: OnLocalStreamDelegate;
    public OnRemoteStream: OnRemoteStreamDelegate;
    public OnMessage: OnMessage;

    private sessionId: string = uuidv4();
    private GetSessionId(): string { return this.sessionId; }

    private attendeeId: string = uuidv4();
    public GetAttendeeId(): string { return this.attendeeId; }

    public async Start(roomId: string): Promise<void> {
        this.userMedia.OnMediaStreamAvailable = mediaStream => {
            this.localStream = mediaStream;
            this.OnLocalStream(mediaStream);

            if (this.connectionManager != null) {
                this.connectionManager.RefreshLocalStream();
            }
        };

        try {
            await this.userMedia.GetMediaStream();
        }
        catch {
            this.OnMessage("Access to your microphone and camera was denied. Please change the permissions, then refresh the page.", "fatal");
            return;
        }

        const broker: IBroker = new Broker(roomId, this.GetAttendeeId(), this.GetSessionId());

        this.connectionManager = new ConnectionManager(broker);
        this.connectionManager.OnClientConnect = (clientId) => this.OnConnect(clientId);
        this.connectionManager.OnClientDisconnect = (clientId) => this.OnDisconnect(clientId);
        this.connectionManager.OnNeedLocalStream = () => this.localStream;
        this.connectionManager.OnHasStreams = (clientId, streams) => {
            streams.forEach(stream => {
                this.OnRemoteStream(clientId, stream);
            });
        };

        await broker.Open();

        this.OnConnect(this.GetAttendeeId());
        this.OnMessage("✔️ Connected! Share this link:<br/><a href='" + window.location + "'>" + window.location + "</a>", "success");
    }
}