import { IBroker, Envelope } from "./Broker";
import { IPeerConnector, PeerConnector } from "./PeerConnector";

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

    constructor(broker: IBroker) {
        this.broker = broker;
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

    private CreateConnector(fromId: string): void {
        if (this.connectors.hasOwnProperty(fromId)) {
            return;
        }

        this.OnClientConnect(fromId);
        const peerConnector: IPeerConnector = new PeerConnector();

        peerConnector.OnConnectionChanged = newState => {
            if (newState == "failed") {
                delete this.connectors[fromId];
                this.OnClientDisconnect(fromId);
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
        if (message.FromId == this.broker.GetLocalClientId()) {
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