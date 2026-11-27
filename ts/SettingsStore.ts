import { IUserMediaSettings, SettingChanges, UserMediaSettingType } from "./UserMedia.js";

// VideoEnabled, ScreenEnabled and AudioEnabled are deliberately not saved
const persistedKeys: string[] = [
    "AudioEchoCancellation",
    "AudioAutoGainControl",
    "AudioNoiseSuppression",
    "AudioStereo",
    "AudioCompressor",
    "AudioCompressorThreshold",
    "AudioCompressorKnee",
    "AudioCompressorRatio",
    "AudioCompressorAttack",
    "AudioCompressorRelease",
    "AudioGain",
    "AudioLocalListen",
    "AudioLocalMeter",
    "VideoResolution",
    "VideoFrameRate"
];

const storageKey: string = "ae.directchat.settings";

function validate(settings: IUserMediaSettings, key: string, value: unknown): unknown {
    const setting = settings[key];
    if (setting == null) {
        return undefined;
    }

    switch (setting.Type) {
        case UserMediaSettingType.Generic:
            return typeof value === "boolean" ? value : undefined;
        case UserMediaSettingType.Range:
            if (typeof value !== "number" || !Number.isFinite(value)) {
                return undefined;
            }
            return Math.min(setting.Max, Math.max(setting.Min, value));
        case UserMediaSettingType.Select:
            return (setting.Options as unknown[]).includes(value) ? value : undefined;
        default:
            return undefined;
    }
}

export function loadSettings(settings: IUserMediaSettings): SettingChanges {
    let stored: unknown;
    try {
        stored = JSON.parse(window.localStorage.getItem(storageKey));
    } catch {
        return {};
    }

    if (stored == null || typeof stored !== "object" || Array.isArray(stored)) {
        return {};
    }

    const changes: SettingChanges = {};
    for (const key of persistedKeys) {
        if (Object.prototype.hasOwnProperty.call(stored, key)) {
            const value = validate(settings, key, (stored as { [key: string]: unknown })[key]);
            if (value !== undefined) {
                changes[key] = value;
            }
        }
    }
    return changes;
}

export function saveSettings(settings: IUserMediaSettings, defaults: IUserMediaSettings): void {
    const changed: SettingChanges = {};
    for (const key of persistedKeys) {
        if (settings[key] != null && defaults[key] != null && settings[key].Value !== defaults[key].Value) {
            changed[key] = settings[key].Value;
        }
    }

    try {
        if (Object.keys(changed).length === 0) {
            window.localStorage.removeItem(storageKey);
        } else {
            window.localStorage.setItem(storageKey, JSON.stringify(changed));
        }
    } catch {
    }
}

export function defaultSettings(defaults: IUserMediaSettings): SettingChanges {
    const changes: SettingChanges = {};
    for (const key of persistedKeys) {
        if (defaults[key] != null) {
            changes[key] = defaults[key].Value;
        }
    }
    return changes;
}
