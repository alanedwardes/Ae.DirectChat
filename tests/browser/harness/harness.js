
const params = new URLSearchParams(location.search);
const implPath = params.get('impl') ?? '/js/PeerConnector.js';
const { PeerConnector } = await import(implPath);

const audioContext = new AudioContext();


const sources = [];

function makeVideoTrack(colour) {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 120;
    const ctx = canvas.getContext('2d');
    let tick = 0;
    const draw = () => {
        ctx.fillStyle = colour;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = colour;
        ctx.fillRect((tick++ * 4) % canvas.width, 0, 2, 2);
    };
    draw();
    const interval = setInterval(draw, 33);
    const track = canvas.captureStream(30).getVideoTracks()[0];
    sources.push(() => { clearInterval(interval); track.stop(); });
    return track;
}

function makeLocalStream({ tone = 440, video = null } = {}) {
    const oscillator = audioContext.createOscillator();
    oscillator.frequency.value = tone;
    const gain = audioContext.createGain();
    gain.gain.value = 0.5;
    const destination = audioContext.createMediaStreamDestination();
    oscillator.connect(gain).connect(destination);
    oscillator.start();
    sources.push(() => { oscillator.stop(); destination.stream.getTracks().forEach(t => t.stop()); });
    const stream = destination.stream;
    if (video != null) {
        stream.addTrack(typeof video === 'string' ? makeVideoTrack(video) : video);
    }
    return stream;
}


function liveVideoTracks(stream) {
    return stream ? stream.getVideoTracks().filter(t => t.readyState === 'live' && !t.muted) : [];
}

const videoElements = new WeakMap();
async function sampleColour(stream) {
    const track = liveVideoTracks(stream)[0];
    if (track == null) {
        return null;
    }
    let video = videoElements.get(track);
    if (video == null) {
        video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.srcObject = new MediaStream([track]);
        document.body.appendChild(video);
        videoElements.set(track, video);
        video.play().catch(() => { });
    }
    if (video.videoWidth === 0) {
        return null;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, 16, 16);
    const data = ctx.getImageData(0, 0, 16, 16).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < data.length; i += 4) {
        r += data[i]; g += data[i + 1]; b += data[i + 2];
    }
    const n = data.length / 4;
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

const analysers = new WeakMap();
function sampleTone(stream) {
    const track = stream?.getAudioTracks().find(t => t.readyState === 'live');
    if (track == null) {
        return null;
    }
    let analyser = analysers.get(track);
    if (analyser == null) {
        const audio = new Audio();
        audio.muted = true;
        audio.srcObject = new MediaStream([track]);
        audio.play().catch(() => { });
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 4096;
        audioContext.createMediaStreamSource(new MediaStream([track])).connect(analyser);
        analysers.set(track, analyser);
    }
    const bins = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatFrequencyData(bins);
    let peak = 0;
    for (let i = 1; i < bins.length; i++) {
        if (bins[i] > bins[peak]) peak = i;
    }
    if (!(bins[peak] > -70)) {
        return null;
    }
    return Math.round(peak * audioContext.sampleRate / analyser.fftSize);
}


class Endpoint {
    constructor(name, shouldOffer) {
        this.name = name;
        this.events = [];
        this.remoteStream = null;
        this.closeCount = 0;
        this.errors = [];
        this.connector = new PeerConnector(shouldOffer);
        this.connector.OnConnectionChanged = (change, category) => this.log('changed', category + ': ' + change);
        this.connector.OnConnect = () => this.log('connect');
        this.connector.OnClose = () => { this.closeCount++; this.log('close'); };
        this.connector.OnHasStream = stream => { this.remoteStream = stream; this.log('stream', stream.id); };
        this.connector.OnSendMessage = () => { };
    }

    log(kind, detail) {
        this.events.push({ t: Math.round(performance.now()), kind, detail });
    }

    snapshot() {
        return {
            name: this.name,
            isConnected: this.connector.IsConnected,
            closeCount: this.closeCount,
            errors: this.errors,
            events: this.events,
            remote: this.remoteStream && {
                audio: this.remoteStream.getAudioTracks().filter(t => t.readyState === 'live').length,
                video: liveVideoTracks(this.remoteStream).length,
            },
        };
    }
}

class Channel {
    constructor(to) {
        this.to = to;
        this.delayMs = 0;
        this.jitterMs = 0;
        this.held = false;
        this.queue = [];
        this.sent = [];
        this.filter = null;
        this.lastDue = 0;
    }

    blockRoute() {
        this.filter = ({ payload }) => {
            if (payload.type === 'candidate' || payload.candidate) {
                return 'drop';
            }
            if (typeof payload.sdp === 'string') {
                payload.sdp = payload.sdp
                    .replace(/a=candidate:[^\r\n]*\r?\n/g, '')
                    .replace(/a=ice-pwd:(\S+)/g, (_, pwd) => 'a=ice-pwd:' + [...pwd].reverse().join(''));
            }
            return { payload };
        };
    }

    send(payload, type) {
        const message = { type, json: JSON.stringify(payload) };
        this.sent.push(type);
        let verdict = this.filter ? this.filter({ type, payload: JSON.parse(message.json) }) : 'deliver';
        if (typeof verdict === 'object') {
            message.json = JSON.stringify(verdict.payload);
            verdict = 'deliver';
        }
        if (verdict === 'drop') {
            return;
        }
        const copies = verdict === 'duplicate' ? 2 : 1;
        for (let i = 0; i < copies; i++) {
            if (this.held) {
                this.queue.push(message);
            } else {
                this.schedule(message);
            }
        }
    }

    schedule(message) {
        const due = Math.max(this.lastDue, performance.now() + this.delayMs + Math.random() * this.jitterMs);
        this.lastDue = due;
        setTimeout(() => this.deliver(message), due - performance.now());
    }

    deliver(message) {
        try {
            this.to.connector.Signal(JSON.parse(message.json));
        } catch (err) {
            this.to.errors.push(String(err?.stack ?? err));
        }
    }

    release(order = null) {
        const queue = this.queue;
        this.queue = [];
        this.held = false;
        const messages = order ? order.map(i => queue[i]) : queue;
        messages.forEach(m => this.deliver(m));
    }
}

class Harness {
    constructor() {
        this.endpoints = {};
        this.channels = {};
    }

    pair(a = 'a', b = 'b') {
        const offerer = this.endpoint(a, true);
        const answerer = this.endpoint(b, false);
        this.link(offerer, answerer);
        return [a, b];
    }

    endpoint(name, shouldOffer) {
        const endpoint = new Endpoint(name, shouldOffer);
        this.endpoints[name] = endpoint;
        return endpoint;
    }

    link(x, y) {
        const xy = new Channel(y);
        const yx = new Channel(x);
        this.channels[x.name + '>' + y.name] = xy;
        this.channels[y.name + '>' + x.name] = yx;
        x.connector.OnSendMessage = (payload, type) => xy.send(payload, type);
        y.connector.OnSendMessage = (payload, type) => yx.send(payload, type);
    }

    remote(name, shouldOffer) {
        const endpoint = this.endpoint(name, shouldOffer);
        endpoint.connector.OnSendMessage = (payload, type) => window.relayOut(name, JSON.stringify(payload), type);
        return name;
    }

    deliver(name, json) {
        const endpoint = this.get(name);
        try {
            endpoint.connector.Signal(JSON.parse(json));
        } catch (err) {
            endpoint.errors.push(String(err?.stack ?? err));
        }
    }

    get(name) { return this.endpoints[name]; }
    channel(from, to) { return this.channels[from + '>' + to]; }

    send(name, media) {
        const stream = media instanceof MediaStream ? media : makeLocalStream(media);
        this.get(name).connector.SendStream(stream);
        return stream;
    }

    snapshot(name) { return this.get(name).snapshot(); }

    async received(name) {
        const stream = this.get(name).remoteStream;
        return { colour: await sampleColour(stream), tone: sampleTone(stream), video: liveVideoTracks(stream).length };
    }

    destroyAll() {
        Object.values(this.endpoints).forEach(e => { try { e.connector.Destroy(); } catch { } });
        sources.forEach(stop => stop());
    }
}

window.H = new Harness();
window.makeLocalStream = makeLocalStream;
window.makeVideoTrack = makeVideoTrack;
window.PeerConnector = PeerConnector;
await audioContext.resume();
window.harnessReady = true;
