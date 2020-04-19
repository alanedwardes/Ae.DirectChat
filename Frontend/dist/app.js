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
        }
        document.querySelector("#attendeeList").appendChild(li)
    };

    let remoteVideo = {};

    let leaveSound = document.createElement("audio");
    leaveSound.src = "https://s.edward.es/59e427ea-fd86-4642-80a0-6fe6eba887d4.mp3";
    ChatApp.ChatApp.OnDisconnect = connectionId => {
        leaveSound.play();

        document.querySelector('#remoteVideo').removeChild(remoteVideo[connectionId]);
        delete remoteVideo[connectionId];

        let list = document.querySelector("#attendeeList");
        for (let i in list.children) {
            let item = list.children[i];
            if (item.innerHTML == connectionId) {
                list.removeChild(item);
            }
        }
    };

    ChatApp.ChatApp.OnRemoteStream = (clientId, mediaStream) => {
        let video;
        if (remoteVideo.hasOwnProperty(clientId)) {
            video = remoteVideo[clientId];
        }
        else {
            video = document.createElement("video");
            video.className = "remoteVideo";
            document.querySelector('#remoteVideo').appendChild(video);
            remoteVideo[clientId] = video;
        }

        video.srcObject = mediaStream;
        video.play();
    }

    ChatApp.ChatApp.OnLocalStream = (mediaStream) => {
        let video = document.querySelector('#localVideo');
        video.srcObject = mediaStream;
        video.play();
    }

    ChatApp.ChatApp.Start(roomId);

    let settings = ChatApp.ChatApp.GetMediaSettings();
    for (var key in settings) {
        if (settings.hasOwnProperty(key)) {
            if (key.startsWith("Audio")) {
                createSetting(key, settings[key], document.querySelector('#audioParameters'));
            }
            if (key.startsWith("Video")) {
                createSetting(key, settings[key], document.querySelector('#videoParameters'));
            }
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