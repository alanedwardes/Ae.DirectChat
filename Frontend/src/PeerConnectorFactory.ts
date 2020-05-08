import { IPeerConnector, PeerConnector } from "./PeerConnector";

export interface IPeerConnectorFactory {
    CreatePeerConnector() : IPeerConnector;
}

export class PeerConnectorFactory implements IPeerConnectorFactory {
    public CreatePeerConnector() : IPeerConnector {
        return new PeerConnector();
    }
}