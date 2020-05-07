import { MainUI } from "./MainUI";
import { ChatApp } from "./ChatApp";
import { UserMedia } from "./UserMedia";

export class Entry {
    private static mainUI: MainUI;

    public static Start(): void {
        if (this.mainUI != null) {
            return;
        }

        let userMedia = new UserMedia();
        let app = new ChatApp(userMedia);

        this.mainUI = new MainUI(app, userMedia);
        this.mainUI.initialise();
    }
}