import { IBroker, Envelope } from "./Broker";
import { IPeerConnector } from "./PeerConnector";
import { ISessionConfig } from "./SessionConfig";
import { IPeerConnectorFactory } from "./PeerConnectorFactory";

interface OnHasStreamsDelegate {
    (fromId: string, streams: readonly MediaStream[]): void;
}

interface OnNeedLocalStreamDelegate {
    (): MediaStream;
}

interface OnClientConnectDelegate {
    (clientId: string): void;
}

interface OnClientDisconnectDelegate {
    (clientId: string): void;
}

export class ConnectionManager {
    private readonly broker: IBroker;
    public OnHasStreams: OnHasStreamsDelegate;
    public OnNeedLocalStream: OnNeedLocalStreamDelegate;
    public OnClientConnect: OnClientConnectDelegate;
    public OnClientDisconnect: OnClientDisconnectDelegate;

    private connectors: { [fromId: string]: IPeerConnector; } = {};
    private readonly sessionConfig: ISessionConfig;
    private readonly peerConnectorFactory: IPeerConnectorFactory;

    constructor(broker: IBroker, sessionConfig: ISessionConfig, peerConnectorFactory: IPeerConnectorFactory) {
        this.broker = broker;
        this.sessionConfig = sessionConfig;
        this.peerConnectorFactory = peerConnectorFactory;
        this.broker.OnMessage = (message: Envelope) => this.OnMessage(message);
    }

    public RefreshLocalStream() {
        const localStream: MediaStream = this.OnNeedLocalStream();

        for (let clientId in this.connectors) {
            if (this.connectors.hasOwnProperty(clientId)) {
                this.connectors[clientId].StartLocalStream(localStream);
            }
        }
    }

    private DisconnectClient(connectionId: string): void {
        delete this.connectors[connectionId];
        this.OnClientDisconnect(connectionId);
    }

    private CreateConnector(fromId: string): void {
        if (this.connectors.hasOwnProperty(fromId)) {
            return;
        }

        this.OnClientConnect(fromId);
        const peerConnector = this.peerConnectorFactory.CreatePeerConnector();

        peerConnector.OnConnectionChanged = newState => {
            if (newState == "failed") {
                this.DisconnectClient(fromId);
            }
        };

        peerConnector.OnHasIceCandidates = candidates => {
            this.broker.Send(candidates, "candidates", fromId);
        }

        peerConnector.OnHasStreams = streams => {
            this.OnHasStreams(fromId, streams);
        };

        peerConnector.OnHasOffer = offer => {
            this.broker.Send(offer, "offer", fromId);
        }

        peerConnector.OnAcceptedOffer = offer => {
            this.broker.Send(offer, "accept", fromId);
        };

        peerConnector.StartLocalStream(this.OnNeedLocalStream());
        this.connectors[fromId] = peerConnector;
    }

    private OnMessage(message: Envelope) {
        if (message.FromId == this.sessionConfig.AttendeeId) {
            return;
        }

        this.CreateConnector(message.FromId);

        if (message.Type == "offer") {
            this.connectors[message.FromId].AcceptOffer(message.Data);
        }
        if (message.Type == "accept") {
            this.connectors[message.FromId].AcceptAnswer(message.Data);
        }
        if (message.Type == "candidates") {
            this.connectors[message.FromId].AddRemoteCandidates(message.Data);
        }
    }
}