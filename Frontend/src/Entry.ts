import { MainUI } from "./MainUI";
import { ChatApp } from "./ChatApp";
import { UserMedia } from "./UserMedia";
import { SessionConfig } from "./SessionConfig";

export class Entry {
    private static mainUI: MainUI;

    public static Start(): void {
        if (this.mainUI != null) {
            return;
        }

        let isLocal = !window.location.protocol.startsWith("http");

        let roomId;
        if (isLocal) {
            roomId = window.location.hash.replace('#', '');
        }
        else {
            roomId = window.location.pathname.replace('/', '');
        }

        let sessionConfig = new SessionConfig(roomId);

        if (roomId.length == 0) {
            if (isLocal) {
                window.history.replaceState(null, document.title, '#' + sessionConfig.RoomId);
            }
            else {
                window.history.replaceState(null, document.title, '/' + sessionConfig.RoomId);
            }
        }

        let userMedia = new UserMedia();
        let app = new ChatApp(userMedia, sessionConfig);

        this.mainUI = new MainUI(app, userMedia);
        this.mainUI.initialise();
    }
}