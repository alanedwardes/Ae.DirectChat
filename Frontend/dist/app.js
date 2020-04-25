function initialise() {
    let isLocal = !window.location.protocol.startsWith("http");

    let roomId;
    if (isLocal) {
        roomId = window.location.hash.replace('#', '');
    }
    else {
        roomId = window.location.pathname.replace('/', '');
    }

    if (roomId == "") {
        roomId = ChatApp.ChatApp.NewGuid();
        if (isLocal) {
            window.history.replaceState(null, document.title, '#' + roomId);
        }
        else {
            window.history.replaceState(null, document.title, '/' + roomId);
        }
    }

    ChatApp.ChatApp.OnMessage = (messageText, messageType) => logMessage(messageText, messageType);

    if (window.location.search.startsWith('?')) {
        let settings = ChatApp.ChatApp.GetMediaSettings();

        let search = window.location.search.substring(1).split('&');
        for (var i = 0; i < search.length; i++) {
            let parts = search[i].split('=').filter(decodeURIComponent);
            let settingName = parts[0];
            let settingValue = parts[1];

            if (!settings.hasOwnProperty(settingName)) {
                continue;
            }

            let settingTypedValue;
            try {
                settingTypedValue = parseStringToType(settingValue, typeof(settings[settingName].Value))
            }
            catch {
                logMessage("Unable to parse value for setting " + settingName + ". Please ensure it is of the right type and try again.", "fatal");
                return;
            }

            settings[settingName].Value = settingTypedValue;
        }

        ChatApp.ChatApp.SetMediaSettings(settings);
    }

    let joinSound = document.createElement("audio");
    joinSound.src = "https://s.edward.es/633bc8cc-fc86-4ad1-a1fe-46d815dc4e29.mp3";
    ChatApp.ChatApp.OnConnect = connectionId => {
        joinSound.play();

        let li = document.createElement("li");

        if (ChatApp.ChatApp.GetAttendeeId() == connectionId) {
            li.innerHTML = connectionId + " (you)";
        }
        else {
            li.innerHTML = connectionId;
            logMessage("Someone connected!", "info");
        }
        document.querySelector("#attendeeList").appendChild(li)
    };

    let remoteVideo = {};

    let leaveSound = document.createElement("audio");
    leaveSound.src = "https://s.edward.es/59e427ea-fd86-4642-80a0-6fe6eba887d4.mp3";
    ChatApp.ChatApp.OnDisconnect = connectionId => {
        leaveSound.play();

        logMessage("Someone disconnected!", "info");
        document.querySelector('#remoteVideo').removeChild(remoteVideo[connectionId]);
        delete remoteVideo[connectionId];

        flowRemoteVideo();

        let list = document.querySelector("#attendeeList");
        for (let i in list.children) {
            let item = list.children[i];
            if (item.innerHTML == connectionId) {
                list.removeChild(item);
            }
        }
    };

    ChatApp.ChatApp.OnRemoteStream = (clientId, mediaStream) => {
        let div;
        if (remoteVideo.hasOwnProperty(clientId)) {
            div = remoteVideo[clientId];
        }
        else {
            div = document.createElement("div");
            div.className = "remoteVideo";
            document.querySelector('#remoteVideo').appendChild(div);

            let video = document.createElement("video");
            div.appendChild(video);
            remoteVideo[clientId] = div;
        }

        let video = div.children[0];
        video.srcObject = mediaStream;
        video.play();

        flowRemoteVideo();
    }

    ChatApp.ChatApp.OnLocalStream = (mediaStream) => {
        let video = document.querySelector('#localVideo');
        video.srcObject = mediaStream;
        video.play();
    }

    ChatApp.ChatApp.Start(roomId);

    let lastCategory;
    let settings = ChatApp.ChatApp.GetMediaSettings();
    for (var key in settings) {
        if (settings.hasOwnProperty(key)) {
            if (settings[key].Hidden) {
                continue;
            }

            let parentElement;
            if (key.startsWith("Audio")) {
                parentElement = document.querySelector('#audioParameters');
            }
            if (key.startsWith("Video")) {
                parentElement = document.querySelector('#videoParameters');
            }

            if (lastCategory != settings[key].Category) {
                createCategoryTitle(settings[key].Category, parentElement);
            }

            lastCategory = settings[key].Category;
            createSetting(key, settings[key], parentElement);
        }
    }

    document.querySelector('#audioControlsButton').addEventListener('click', event => {
        document.querySelector('#audioControls').classList.remove("hidden");
        drawAudioMeter();
    });

    document.querySelector('#videoControlsButton').addEventListener('click', event => {
        document.querySelector('#videoControls').classList.remove("hidden");
    });

    document.querySelector('#attendeeWindowButton').addEventListener('click', event => {
        document.querySelector('#attendeeWindow').classList.remove("hidden");
    });

    document.querySelectorAll('.closeButton').forEach(element => {
        element.addEventListener('click', event => {
            event.srcElement.parentElement.classList.add("hidden");
        });
    });
}

function logMessage(messageText, messageType) {
    let timeoutHandle;
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

function flowRemoteVideo() {
    let videos = Array.prototype.slice.call(document.querySelectorAll('.remoteVideo'));
    let videoCount = videos.length;
    let rowCount = Math.ceil(videoCount / 2);
    let columnCount = Math.ceil(videoCount / 2);

    let currentColumn = 0;
    let currentRow = 0;

    while (videos.length > 0) {
        let video = videos.pop();

        video.style['grid-area'] = (currentRow + 1) + " / " + (currentColumn + 1) + " / span 1 / span 1";

        currentColumn++;
        if (currentColumn > columnCount - 1)
        {
            currentColumn = 0;
            currentRow++;
        }
    }
}

function createCategoryTitle(category, parent) {
    let title = document.createElement('h2');
    title.innerHTML = category;
    parent.appendChild(title);
}

function createSetting(settingKey, settingValue, parent) {
    let paragraph = document.createElement("p");
    parent.appendChild(paragraph);
    if (settingValue.Description != null) {
        paragraph.setAttribute("title", settingValue.Description);
    }

    if (settingValue.Feature == null) {
        let input = document.createElement("input");
        paragraph.appendChild(input);

        input.type = "checkbox";
        input.id = "setting" + input.type + settingKey;
        input.checked = settingValue.Value;
        input.oninput = (event) => {
            let settings = ChatApp.ChatApp.GetMediaSettings();
            settings[settingKey].Value = event.srcElement.checked;
            ChatApp.ChatApp.SetMediaSettings(settings);
        };

        let label = document.createElement("label");
        label.innerHTML = settingValue.Name;
        if (settingValue.Description != null) {
            label.classList.add("helptext");
        }
        label.setAttribute("for", input.id);
        paragraph.append(label);
    }
    else if (settingValue.Feature == "range") {
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
        input.step = settingValue.Step;
        input.min = settingValue.Min;
        input.max = settingValue.Max;
        input.value = settingValue.Value;
        input.oninput = (event) => {
            let settings = ChatApp.ChatApp.GetMediaSettings();
            settings[settingKey].Value = event.srcElement.value;
            valueLabel.innerHTML = event.srcElement.value;
            ChatApp.ChatApp.SetMediaSettings(settings);
        };

        paragraph.appendChild(valueLabel);
    }
}

function drawAudioMeter() {
    if (document.querySelector('#audioControls').classList.contains("hidden")) {
        return;
    }

    let canvas = document.getElementById("volumeCanvas");
    let context = canvas.getContext("2d");
    let sample = ChatApp.ChatApp.GetAudioLevel();

    context.clearRect(0, 0, canvas.width, canvas.height)

    context.fillStyle = "green";

    if (sample > .80) {
        context.fillStyle = "orange";
    }

    if (sample > .95) {
        context.fillStyle = "red";
    }

    context.fillRect(0, 0, canvas.width * sample, 64);

    window.requestAnimationFrame(() => drawAudioMeter());
}

function parseStringToType(input, type) {
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