export class AudioSample {
    public constructor(gain: number, sample: number) {
        this.Gain = gain;
        this.Sample = sample;
    }

    public readonly Gain: number
    public readonly Sample: number
}

interface OnNeedSample {
    (): AudioSample;
}

export class VolumeUI {
    private readonly canvas: HTMLCanvasElement;
    private readonly context: CanvasRenderingContext2D;
    public OnNeedSample: OnNeedSample;

    constructor() {
        this.canvas = document.getElementById("volumeCanvas") as HTMLCanvasElement;
        this.context = this.canvas.getContext("2d");
        this.Animate();
    }

    private Animate() {
        if (this.OnNeedSample != null) {
            const sample: AudioSample = this.OnNeedSample();
            this.context.clearRect(0, 0, this.canvas.width, this.canvas.height)

            this.context.fillStyle = "green";

            if (sample.Sample > .80) {
                this.context.fillStyle = "orange";
            }

            if (sample.Sample > .95) {
                this.context.fillStyle = "red";
            }

            this.context.fillRect(0, 0, this.canvas.width * sample.Sample, 64);
        }

        window.requestAnimationFrame(() => this.Animate());
    }
}