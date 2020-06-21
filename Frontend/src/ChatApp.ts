import { IUserMedia } from "./UserMedia";
import { Broker, IBroker } from "./Broker";
import { ConnectionManager, ClientLocation } from "./ConnectionManager";
import { ISessionConfig } from "./SessionConfig"
import { PeerConnectorFactory } from "./PeerConnectorFactory";
import { ConnectionChange } from "./PeerConnector";

interface OnConnectionChangedDelegate {
    (connectionId: string, change: ConnectionChange): void;
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

interface OnClientLocation {
    (clientId: string, location: ClientLocation): void;
}

export class ChatApp {
    private readonly sessionConfig: ISessionConfig;

    constructor(userMedia: IUserMedia, sessionConfig: ISessionConfig) {
        this.userMedia = userMedia;
        this.sessionConfig = sessionConfig;
    }

    private readonly userMedia: IUserMedia;
    private localStream: MediaStream;
    private connectionManager: ConnectionManager;

    public OnLocalStream: OnLocalStreamDelegate;
    public OnRemoteStream: OnRemoteStreamDelegate;
    public OnConnectionChanged: OnConnectionChangedDelegate;
    public OnMessage: OnMessage;
    public OnLocation: OnClientLocation;

    public async Start(): Promise<void> {
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
        catch (err) {
            console.error(err);
            this.OnMessage("Access to your microphone and camera was denied. Please change the permissions, then refresh the page.", "fatal");
            return;
        }

        const broker: IBroker = new Broker(this.sessionConfig);

        let peerConnectorFactory = new PeerConnectorFactory();

        this.connectionManager = new ConnectionManager(broker, this.sessionConfig, peerConnectorFactory);
        this.connectionManager.OnLocation = (clientId, location) => this.OnLocation(clientId, location);
        this.connectionManager.OnConnectionChanged = (clientId, change) => this.OnConnectionChanged(clientId, change);
        this.connectionManager.OnNeedLocalStream = () => this.localStream;
        this.connectionManager.OnHasStreams = (clientId, streams) => {
            streams.forEach(stream => {
                this.OnRemoteStream(clientId, stream);
            });
        };

        await broker.Open();

        this.OnMessage("✔️ Connected! Share this link:<br/><a href='" + window.location + "'>" + window.location + "</a>", "success");
    }
}