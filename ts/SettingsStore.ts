import { IUserMediaSettings, SettingChanges, UserMediaSettingType } from "./UserMedia.js";

// Settings remembered between visits. Deliberately excludes VideoEnabled, ScreenEnabled and AudioEnabled,
// so a new session never starts sending camera/screen, or starts muted, without the user choosing to.
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

// Returns the value if it's valid for the setting, otherwise undefined
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

// Reads the saved settings, dropping anything unknown or invalid (storage is user-editable)
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

// Saves only the settings that differ from the defaults, so changing a default in code still reaches
// users who never touched that setting
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
        // Storage unavailable (e.g. disabled, or full); settings just won't be remembered
    }
}

// The default values of every persisted setting, for resetting
export function defaultSettings(defaults: IUserMediaSettings): SettingChanges {
    const changes: SettingChanges = {};
    for (const key of persistedKeys) {
        if (defaults[key] != null) {
            changes[key] = defaults[key].Value;
        }
    }
    return changes;
}
