import { UserMedia, UserMediaSettings } from "./UserMedia";
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
    public static NewGuid(): string { return uuidv4(); }

    public static GetAudioLevel(): number { return ChatApp.userMedia.SampleInput(); }

    public static GetMediaSettings(): UserMediaSettings { return ChatApp.userMedia.GetSettings(); }
    public static async SetMediaSettings(newSettings: UserMediaSettings): Promise<void> { await ChatApp.userMedia.SetSettings(newSettings); }

    private static userMedia: UserMedia = new UserMedia();
    private static localStream: MediaStream;
    private static connectionManager: ConnectionManager;

    public static OnConnect: OnConnectDelegate;
    public static OnDisconnect: OnDisconnectDelegate;
    public static OnLocalStream: OnLocalStreamDelegate;
    public static OnRemoteStream: OnRemoteStreamDelegate;
    public static OnMessage: OnMessage;

    private static sessionId: string = uuidv4();
    private static GetSessionId(): string { return ChatApp.sessionId; }

    private static attendeeId: string = uuidv4();
    public static GetAttendeeId(): string { return ChatApp.attendeeId; }

    public static async Start(roomId: string): Promise<void> {
        ChatApp.userMedia.OnMediaStreamAvailable = mediaStream => {
            ChatApp.localStream = mediaStream;
            ChatApp.OnLocalStream(mediaStream);

            if (ChatApp.connectionManager != null) {
                ChatApp.connectionManager.RefreshLocalStream();
            }
        };

        try {
            await ChatApp.userMedia.GetMediaStream();
        }
        catch {
            ChatApp.OnMessage("Access to your microphone and camera was denied. Please change the permissions, then refresh the page.", "fatal");
            return;
        }

        const broker: IBroker = new Broker(roomId, ChatApp.GetAttendeeId(), ChatApp.GetSessionId());

        this.connectionManager = new ConnectionManager(broker);
        this.connectionManager.OnClientConnect = (clientId) => ChatApp.OnConnect(clientId);
        this.connectionManager.OnClientDisconnect = (clientId) => ChatApp.OnDisconnect(clientId);
        this.connectionManager.OnNeedLocalStream = () => ChatApp.localStream;
        this.connectionManager.OnHasStreams = (clientId, streams) => {
            streams.forEach(stream => {
                ChatApp.OnRemoteStream(clientId, stream);
            });
        };

        await broker.Open();

        ChatApp.OnConnect(ChatApp.GetAttendeeId());
        ChatApp.OnMessage("✔️ Connected! Share this link:<br/><a href='" + window.location + "'>" + window.location + "</a>", "success");
    }
}