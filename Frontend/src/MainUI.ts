import { ChatApp } from "./ChatApp";
import { IUserMediaSettings, IUserMediaSetting, UserMediaSettingsRange, UserSettingsSelection, UserMediaSettingType, IUserMedia } from "./UserMedia";

class RemoteMedia {
    public Element: HTMLDivElement;
    public Stream: MediaStream;
}

export class MainUI {
    private readonly chatApp: ChatApp;
    private readonly userMedia: IUserMedia;
    private readonly joinSound: HTMLAudioElement;
    private readonly leaveSound: HTMLAudioElement;
    private remoteVideo: { [id: string]: RemoteMedia; } = {};
    private selfNode: HTMLLIElement;


    constructor(chatApp: ChatApp, userMedia: IUserMedia) {
        this.chatApp = chatApp;
        this.userMedia = userMedia;

        this.joinSound = document.createElement("audio");
        this.joinSound.src = "https://s.alanedwardes.com/633bc8cc-fc86-4ad1-a1fe-46d815dc4e29.mp3";

        this.leaveSound = document.createElement("audio");
        this.leaveSound.src = "https://s.alanedwardes.com/59e427ea-fd86-4642-80a0-6fe6eba887d4.mp3";
    }

    public initialise(): void {
        this.drawAudioVisualisations();

        function hideControls() {
            document.querySelectorAll(".controls").forEach(node => node.classList.add('faded'));
        }

        let timeout = setTimeout(hideControls, 10000);

        function ShowControls(): void {
            clearTimeout(timeout);
            timeout = setTimeout(hideControls, 10000);
            document.querySelectorAll(".controls").forEach(node => node.classList.remove('faded'));
        }

        window.addEventListener('beforeunload', (e) => {
            if (document.querySelectorAll('.remoteVideo').length > 0) {
                e.preventDefault();
                e.returnValue = 'There are others in the chat session.';
            }
        });

        window.onmousemove = () => ShowControls();
        window.ontouchstart = () => ShowControls();

        this.chatApp.OnMessage = (messageText, messageType) => this.logMessage(messageText, messageType);
        this.chatApp.OnLog = (line) => this.appendLog(line);

        if (window.location.search.startsWith('?')) {
            let settings: IUserMediaSettings = this.userMedia.GetSettings();

            let search = window.location.search.substring(1).split('&');
            for (let i = 0; i < search.length; i++) {
                let parts = search[i].split('=').filter(decodeURIComponent);
                let settingName = parts[0];
                let settingValue = parts[1];

                if (!settings.hasOwnProperty(settingName)) {
                    continue;
                }

                let settingTypedValue;
                try {
                    settingTypedValue = this.parseStringToType(settingValue, typeof (settings[settingName].Value))
                }
                catch (err) {
                    this.logMessage("Unable to parse value for setting " + settingName + ". Please ensure it is of the right type and try again.", "fatal");
                    return;
                }

                settings[settingName].Value = settingTypedValue;
            }

            this.applyNewSettings(settings);
        }

        this.chatApp.OnRemoteStream = (clientId, mediaStream) => {
            this.userMedia.AddRemoteStream(clientId, mediaStream);
            let remoteMedia;
            if (this.remoteVideo.hasOwnProperty(clientId)) {
                remoteMedia = this.remoteVideo[clientId];
            }
            else {
                let div = document.createElement("div");
                div.className = "remoteVideo";
                document.querySelector('#remoteVideo').appendChild(div);

                let video = document.createElement("video");
                div.appendChild(video);
                remoteMedia = new RemoteMedia();
                remoteMedia.Element = div;
                remoteMedia.Stream = mediaStream;
                this.remoteVideo[clientId] = remoteMedia;
            }

            let video: HTMLVideoElement = <HTMLVideoElement>remoteMedia.Element.children[0];
            video.srcObject = mediaStream;
            video.muted = true;
            video.play();

            this.flowRemoteVideo();
        }

        this.chatApp.OnLocalStream = (mediaStream) => {
            let video = document.querySelector<HTMLVideoElement>('#localVideo');
            video.srcObject = mediaStream;
            video.play();
            this.updateLocalStatus(mediaStream);
        }

        let selfNode = document.createElement("li");
        let selfLabel = document.createElement("span");
        selfLabel.className = "label";
        let selfName = document.createElement("span");
        selfName.className = "name";
        selfName.textContent = "You";
        selfLabel.appendChild(selfName);
        selfNode.appendChild(selfLabel);
        this.selfNode = selfNode;
        document.querySelector("#attendeeList").appendChild(selfNode);

        this.chatApp.OnLocation = (clientId, location) => {
            let clientNode = this.getClientNode(clientId);
            let labelNode = clientNode.querySelector('span.label');
            let locationNode: HTMLSpanElement = labelNode.querySelector('span.location');

            const shortLocation: string = location.CityName ? location.CityName + " " + location.CountryCode : location.CountryCode;

            if (locationNode === null) {
                locationNode = document.createElement("span");
                locationNode.title = location.SubdivisionName + ", " + location.CityName + ", " + location.CountryName + ", " + location.ContinentName;

                let flag = document.createElement("img");
                flag.src = "https://chat.alanedwardes.com/flags/" + location.CountryCode.toLowerCase() + ".png";
                flag.title = locationNode.title;
                flag.alt = flag.title;
                locationNode.appendChild(flag);

                locationNode.classList.add("location");
                labelNode.appendChild(locationNode);
            }

            let nameNode = labelNode.querySelector('span.name');
            nameNode.innerHTML = shortLocation;
        };

        this.chatApp.OnConnectionChanged = (clientId, change, category) => {
            let clientNode = this.getClientNode(clientId);

            let statusRow: HTMLDivElement = clientNode.querySelector('div.statusRow');
            if (statusRow === null) {
                statusRow = document.createElement('div');
                statusRow.className = 'statusRow';
                clientNode.appendChild(statusRow);
            }

            let badge: HTMLSpanElement = statusRow.querySelector('span.status.' + category);
            if (badge === null) {
                badge = document.createElement('span');
                badge.classList.add('status', category);
                statusRow.appendChild(badge);
            }

            badge.textContent = change;
            badge.dataset.state = change;
            this.appendLog('[' + category + '] ' + clientId.substring(0, 6) + ': ' + change);
        }

        this.chatApp.OnClose = clientId => {
            setTimeout(() => this.clientDisconnected(clientId), 15000);
        };

        this.chatApp.Start();

        let lastCategory;
        let settings: IUserMediaSettings = this.userMedia.GetSettings();
        for (let key in settings) {
            if (settings.hasOwnProperty(key)) {
                if (settings[key].Hidden) {
                    continue;
                }

                let parentElement: HTMLElement;
                if (key.startsWith("Audio")) {
                    parentElement = document.querySelector('#audioParameters');
                }
                if (key.startsWith("Video")) {
                    parentElement = document.querySelector('#videoParameters');
                }
                if (key.startsWith("Screen")) {
                    parentElement = document.querySelector('#screenParameters');
                }

                if (lastCategory != settings[key].Category) {
                    this.createCategoryTitle(settings[key].Category, parentElement);
                }

                lastCategory = settings[key].Category;
                this.createSetting(key, settings[key], parentElement);
            }
        }

        document.querySelector('#audioControlsButton').addEventListener('click', () => {
            document.querySelector('#audioControls').classList.remove("hidden");
        });

        document.querySelector('#videoControlsButton').addEventListener('click', () => {
            document.querySelector('#videoControls').classList.remove("hidden");
        });

        document.querySelector('#screenControlsButton').addEventListener('click', () => {
            document.querySelector('#screenControls').classList.remove("hidden");
        });

        document.querySelector('#attendeeWindowButton').addEventListener('click', () => {
            document.querySelector('#attendeeWindow').classList.remove("hidden");
        });

        document.querySelector('#logWindowButton').addEventListener('click', () => {
            document.querySelector('#logWindow').classList.remove("hidden");
        });

        document.querySelectorAll('.closeButton').forEach(element => {
            element.addEventListener('click', event => {
                let sourceElement = <HTMLButtonElement>event.srcElement;
                sourceElement.parentElement.classList.add("hidden");
            });
        });
    }

    public appendLog(line: string) {
        let list = document.querySelector('#logList') as HTMLOListElement;
        let item = document.createElement('li');

        const timestamp = new Date().toLocaleTimeString();
        item.textContent = `[${timestamp}] ${line}`;

        list.appendChild(item);
        while (list.childElementCount > 500) {
            list.removeChild(list.firstElementChild);
        }

        const logWindow = document.querySelector('#logWindow') as HTMLElement;
        if (logWindow) {
            logWindow.scrollTop = logWindow.scrollHeight;
        }
    }

    public countryCodeEmoji(country: string): string {
        const offset = 127397;
        const f = country.codePointAt(0);
        const s = country.codePointAt(1);

        return String.fromCodePoint(f + offset) + String.fromCodePoint(s + offset);
    }

    public getClientNode(clientId: string): HTMLLIElement {
        const attendeeList = document.querySelector("#attendeeList");

        let clientNode: HTMLLIElement = attendeeList.querySelector('li[data-connection-id="' + clientId + '"]');
        if (clientNode === null) {
            clientNode = document.createElement("li");
            clientNode.setAttribute("data-connection-id", clientId);

            let labelNode = document.createElement("span");
            labelNode.className = "label";
            clientNode.appendChild(labelNode);

            let nameNode = document.createElement("span");
            nameNode.innerHTML = clientId.substring(0, 6);
            nameNode.className = "name";
            labelNode.appendChild(nameNode);

            attendeeList.appendChild(clientNode);

            this.joinSound.play();
            this.logMessage("Someone connected!", "info");
        }

        return clientNode;
    }

    public clientDisconnected(clientId: string): void {
        let clientNode = this.getClientNode(clientId);
        clientNode.parentElement.removeChild(clientNode);

        if (this.remoteVideo.hasOwnProperty(clientId)) {
            let remoteMedia = this.remoteVideo[clientId];
            remoteMedia.Element.parentElement.removeChild(remoteMedia.Element);
        }

        this.userMedia.RemoveRemoteStream(clientId);

        this.leaveSound.play();
    }

    public updateLocalStatus(mediaStream: MediaStream): void {
        if (!this.selfNode) {
            return;
        }
        let statusRow: HTMLDivElement = this.selfNode.querySelector('div.statusRow');
        if (statusRow === null) {
            statusRow = document.createElement('div');
            statusRow.className = 'statusRow';
            this.selfNode.appendChild(statusRow);
        }
        statusRow.innerHTML = '';
        mediaStream.getTracks().forEach(track => {
            const badge = document.createElement('span');
            badge.classList.add('status', 'track');
            badge.textContent = track.kind + ' ' + track.readyState;
            badge.dataset.state = track.readyState;
            statusRow.appendChild(badge);
        });
    }

    public logMessage(messageText: string, messageType: string) {
        let timeoutHandle: NodeJS.Timeout;
        if (messageType != "fatal") {
            timeoutHandle = setTimeout(() => {
                list.removeChild(container);
            }, 10000);
        }

        let list = document.querySelector(".messages");

        let container = document.createElement("div");
        container.className = messageType + "Message message";

        let closeButton = document.createElement("button");
        closeButton.className = "closeButton";
        closeButton.innerHTML = "✕";
        closeButton.onclick = () => {
            clearTimeout(timeoutHandle);
            list.removeChild(container);
        }
        container.appendChild(closeButton);

        let message = document.createElement("span");
        message.innerHTML = messageText;
        container.appendChild(message);

        list.appendChild(container);
    }

    public flowRemoteVideo() {
        let videos = Array.prototype.slice.call(document.querySelectorAll('.remoteVideo'));
        let videoCount = videos.length;
        //let rowCount = Math.ceil(videoCount / 2);
        let columnCount = Math.ceil(videoCount / 2);

        let currentColumn = 0;
        let currentRow = 0;

        while (videos.length > 0) {
            let video = videos.pop();

            video.style['grid-area'] = (currentRow + 1) + " / " + (currentColumn + 1) + " / span 1 / span 1";

            currentColumn++;
            if (currentColumn > columnCount - 1) {
                currentColumn = 0;
                currentRow++;
            }
        }
    }

    public createCategoryTitle(category: string, parent: HTMLElement) {
        let title = document.createElement('h2');
        title.innerHTML = category;
        parent.appendChild(title);
    }

    public applyNewSettings(newSettings: IUserMediaSettings) {
        this.userMedia.SetSettings(newSettings);

        const oldShouldDrawVolumeHistogram: boolean = this.shouldDrawVolumeHistogram;

        this.shouldDrawVolumeHistogram = newSettings.AudioLocalMeter.Value;

        if (!oldShouldDrawVolumeHistogram && this.shouldDrawVolumeHistogram) {
            this.drawAudioVisualisations();
        }
    }

    public createSetting(settingKey: string, settingValue: IUserMediaSetting, parent: HTMLElement) {
        let paragraph = document.createElement("p");
        parent.appendChild(paragraph);
        if (settingValue.Description != null) {
            paragraph.setAttribute("title", settingValue.Description);
        }

        if (settingValue.Type == UserMediaSettingType.Generic) {
            let input = document.createElement("input");
            paragraph.appendChild(input);

            input.type = "checkbox";
            input.id = "setting" + input.type + settingKey;
            input.checked = settingValue.Value;
            input.oninput = (event) => {
                let settings: IUserMediaSettings = this.userMedia.GetSettings();
                let sourceElement: HTMLInputElement = <HTMLInputElement>event.srcElement;
                settings[settingKey].Value = sourceElement.checked;
                this.applyNewSettings(settings);
            };

            let label = document.createElement("label");
            label.innerHTML = settingValue.Name;
            if (settingValue.Description != null) {
                label.classList.add("helptext");
            }
            label.setAttribute("for", input.id);
            paragraph.append(label);
        }
        else if (settingValue.Type == UserMediaSettingType.Range) {
            let settingValueRange = <UserMediaSettingsRange>settingValue;

            let label = document.createElement("span");
            label.innerHTML = settingValue.Name;
            if (settingValue.Description != null) {
                label.classList.add("helptext");
            }
            paragraph.appendChild(label);

            let valueLabel = document.createElement("span");
            valueLabel.innerHTML = settingValue.Value;

            let br = document.createElement("br");
            paragraph.appendChild(br);

            let input = document.createElement("input");
            paragraph.appendChild(input);

            input.type = "range";
            input.step = settingValueRange.Step.toString();
            input.min = settingValueRange.Min.toString();
            input.max = settingValueRange.Max.toString();
            input.value = settingValue.Value;
            input.oninput = (event) => {
                let sourceElement = <HTMLInputElement>event.srcElement;
                valueLabel.innerHTML = sourceElement.value;
            };

            input.onchange = (event) => {
                let settings: IUserMediaSettings = this.userMedia.GetSettings();
                let sourceElement = <HTMLInputElement>event.srcElement;
                settings[settingKey].Value = sourceElement.value;
                this.applyNewSettings(settings);
            };

            paragraph.appendChild(valueLabel);
        }
        else if (settingValue.Type == UserMediaSettingType.Select) {
            let settingValueOptions = <UserSettingsSelection<any>>settingValue;

            let label = document.createElement("label");
            label.innerHTML = settingValue.Name;
            if (settingValue.Description != null) {
                label.classList.add("helptext");
            }
            paragraph.append(label);

            let select = document.createElement("select");
            paragraph.appendChild(select);

            for (let i = 0; i < settingValueOptions.Options.length; i++) {
                let option = document.createElement("option");
                option.value = settingValueOptions.Options[i];
                option.innerHTML = option.value;
                select.appendChild(option);
            }

            select.selectedIndex = settingValueOptions.Options.indexOf(settingValue.Value);

            select.id = "setting" + select.type + settingKey;
            select.oninput = (event) => {
                let settings: IUserMediaSettings = this.userMedia.GetSettings();
                let sourceElement = <HTMLSelectElement>event.srcElement;
                settings[settingKey].Value = settings[settingKey].Options[sourceElement.selectedIndex];
                this.applyNewSettings(settings);
            };

            label.setAttribute("for", select.id);
        }
    }

    private inputVolumeHistogram: Array<number> = [];
    private ouputVolumeHistogram: Array<number> = [];

    private shouldDrawVolumeHistogram: boolean = true;

    public sampleVolume(sampleBuffer: Float32Array): number {
        let peak = 0;
        sampleBuffer.forEach(function (value) {
            peak = Math.max(peak, Math.abs(value));
        });
        return peak;
    }

    public drawAudioVisualisations() {
        if (!this.shouldDrawVolumeHistogram) {
            return;
        }

        window.requestAnimationFrame(() => this.drawAudioVisualisations());

        let canvas = <HTMLCanvasElement>document.getElementById("volumeHistogramCanvas");
        let context = canvas.getContext("2d");
        context.clearRect(0, 0, canvas.width, canvas.height);

        this.drawAudioHistogram(canvas, context);
        this.drawAudioOscilloscope(canvas, context);
    }

    public drawAudioOscilloscope(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D) {
        let inputSampleBuffer = this.userMedia.SampleInputFrequency();

        context.fillStyle = "rgba(0, 0, 255, 0.5)";

        const barWidth = (canvas.width / inputSampleBuffer.length);
        let posX = 0;
        for (let i = 0; i < inputSampleBuffer.length; i++) {
            const frequencyAmplitude = inputSampleBuffer[i] / 255;
            const barHeight = frequencyAmplitude * canvas.height;
            context.fillRect(posX, canvas.height - barHeight, barWidth, barHeight);
            posX += barWidth;
        }
    }

    public drawAudioHistogram(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D) {

        let inputSampleBuffer = this.userMedia.SampleInputTimeDomain();
        let outputSampleBuffer = this.userMedia.SampleOutputTimeDomain();



        this.inputVolumeHistogram.unshift(this.sampleVolume(inputSampleBuffer));
        if (this.inputVolumeHistogram.length > canvas.width) {
            this.inputVolumeHistogram.pop();
        }

        this.ouputVolumeHistogram.unshift(this.sampleVolume(outputSampleBuffer));
        if (this.ouputVolumeHistogram.length > canvas.width) {
            this.ouputVolumeHistogram.pop();
        }

        var audioControls = document.getElementById("audioControls");
        if (audioControls.classList.contains("hidden")) {
            return;
        }

        context.clearRect(0, 0, canvas.width, canvas.height);

        for (let i = 0; i < this.ouputVolumeHistogram.length; i++) {
            const sample: number = this.ouputVolumeHistogram[i];
            context.fillStyle = "rgba(255, 255, 255, 0.5)";
            context.fillRect(canvas.width - i, canvas.height, 1, -canvas.height * sample);
        }

        for (let i = 0; i < this.inputVolumeHistogram.length; i++) {
            const sample: number = this.inputVolumeHistogram[i];
            context.fillStyle = sample >= .99 ? "red" : "green";
            context.fillRect(canvas.width - i, canvas.height, 1, -canvas.height * sample);
        }

        const rowTicks: number = 10;
        const rowHeight: number = Math.round(canvas.height / rowTicks);
        context.fillStyle = "rgba(255, 255, 255, 0.1)";
        for (let i = 1; i < rowTicks; i++) {
            context.fillRect(0, rowHeight * i, canvas.width, 1);
        }

        const columnTicks: number = 40;
        const columnWidth: number = Math.round(canvas.width / columnTicks);
        context.fillStyle = "rgba(255, 255, 255, 0.1)";
        for (let i = 1; i < columnTicks; i++) {
            context.fillRect(columnWidth * i, 0, 1, canvas.height);
        }
    }

    public parseStringToType(input: string, type: string) {
        if (type === "boolean") {
            if (input.toLowerCase() === "true") {
                return true;
            }

            if (input.toLowerCase() === "false") {
                return false;
            }
        }

        if (type === "number") {
            let value = parseFloat(input);
            if (!isNaN(value)) {
                return value;
            }
        }

        throw "Error parsing " + input + " to " + type;
    }
}