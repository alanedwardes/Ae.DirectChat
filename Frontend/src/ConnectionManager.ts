import { IBroker, Envelope } from "./Broker";
import { IPeerConnector } from "./PeerConnector";
import { ISessionConfig } from "./SessionConfig";
import { IPeerConnectorFactory } from "./PeerConnectorFactory";

interface OnCloseDelegate {
    (clientId: string): void;
}

interface OnHasStreamDelegate {
    (fromId: string, stream: MediaStream): void;
}

interface OnNeedLocalStreamDelegate {
    (): MediaStream;
}

interface OnClientConnectionChangedDelegate {
    (clientId: string, change: string): void;
}

export class ClientLocation {
    CityName: string;
    CountryName: string;
    CountryCode: string;
    ContinentName: string;
    SubdivisionName: string;
}

interface OnClientLocationDelegate {
    (clientId: string, location: ClientLocation): void;
}

export class ConnectionManager {
    private readonly broker: IBroker;
    public OnHasStream: OnHasStreamDelegate;
    public OnNeedLocalStream: OnNeedLocalStreamDelegate;
    public OnConnectionChanged: OnClientConnectionChangedDelegate;
    public OnLocation: OnClientLocationDelegate;
    public OnClose: OnCloseDelegate;

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

    private CreateConnector(fromId: string): void {
        if (this.connectors.hasOwnProperty(fromId)) {
            return;
        }

        const shouldOffer: boolean = fromId < this.sessionConfig.AttendeeId;

        const peerConnector = this.peerConnectorFactory.CreatePeerConnector(shouldOffer);
        console.log("Creating peer connector for " + fromId + " (shouldOffer: " + shouldOffer + ")");

        peerConnector.OnConnectionChanged = change => {
            this.OnConnectionChanged(fromId, change);
        };

        peerConnector.OnClose = () => {
            console.warn("Deleting connector from " + fromId);
            this.connectors[fromId].Shutdown();
            delete this.connectors[fromId];
            this.OnClose(fromId);
        };

        peerConnector.OnHasStream = stream => {
            this.OnHasStream(fromId, stream);
        };

        peerConnector.OnSendMessage = (payload: any, type: string) => {
            this.broker.Send(payload, type, fromId);
        };

        peerConnector.StartLocalStream(this.OnNeedLocalStream());
        this.connectors[fromId] = peerConnector;
    }

    private OnMessage(message: Envelope) {
        if (message.FromId == this.sessionConfig.AttendeeId) {
            return;
        }

        this.CreateConnector(message.FromId);

        /*
        if (message.Type == "offer") {
            this.connectors[message.FromId].AcceptOffer(message.Data);
        }
        if (message.Type == "accept") {
            this.connectors[message.FromId].AcceptAnswer(message.Data);
        }
        if (message.Type == "candidates") {
            this.connectors[message.FromId].AddRemoteCandidates(message.Data);
        }*/
        if (message.Type == "location") {
            let location: ClientLocation = new ClientLocation();
            location.CityName = message.Data["cityName"];
            location.CountryName = message.Data["countryName"];
            location.CountryCode = message.Data["countryCode"];
            location.ContinentName = message.Data["continentName"];
            location.SubdivisionName = message.Data["subdivisionName"];
            this.OnLocation(message.FromId, location);
        }
        else if (message.Type == "discover") {
            this.broker.Send({}, "acknowledge", message.FromId);
        }
        else if (message.Type == 'acknowledge') {
            // 
        }
        else {
            this.connectors[message.FromId].Signal(message.Data);
        }
    }
}