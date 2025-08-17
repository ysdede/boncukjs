// Settings Manager - Handles persistence of user settings
const SETTINGS_KEY = 'mavis-settings-solidjs';

class SettingsManager {
    constructor(storageKey) {
        this.storageKey = storageKey;
        this.version = '1.0';
        
        // Define which settings should NOT be stored (sensitive data)
        this.excludedSettings = new Set([
            'geminiApiKey', // Never store API keys
            'recording',    // Runtime state
            'audioDevices', // Device list changes
            // NOTE: selectedDeviceId is NOT excluded - it has special handling below
            'inputSampleRate', // Runtime value
            'stream',       // Runtime object
            'audioContext', // Runtime object
            'worker'        // Runtime object
        ]);
        
        // Settings that need special handling
        this.specialSettings = new Set([
            'selectedDeviceId' // Store device label instead
        ]);
    }

    /**
     * Save settings to localStorage
     * @param {Object} settings - Settings object to save
     * @param {Array} audioDevices - Current audio devices for device name resolution
     */
    saveSettings(settings, audioDevices = []) {
        try {
            const settingsToSave = {
                version: this.version,
                timestamp: Date.now(),
                settings: {}
            };

            // Process each setting
            for (const [key, value] of Object.entries(settings)) {
                if (this.excludedSettings.has(key)) {
                    continue; // Skip excluded settings
                }

                if (key === 'selectedDeviceId') {
                    // Special handling for audio device - store device label/name
                    const selectedDevice = audioDevices.find(device => device.deviceId === value);
                    if (selectedDevice) {
                        console.log(`Saving device: ${selectedDevice.label} (ID: ${value})`);
                        settingsToSave.settings.selectedDeviceLabel = selectedDevice.label;
                        settingsToSave.settings.selectedDeviceId = value; // Keep as fallback
                    } else {
                        console.log(`Warning: Device with ID ${value} not found in available devices list`);
                        // Still save the ID as fallback
                        settingsToSave.settings.selectedDeviceId = value;
                    }
                } else {
                    // Regular setting
                    settingsToSave.settings[key] = value;
                }
            }

            localStorage.setItem(this.storageKey, JSON.stringify(settingsToSave));
            console.log('Settings saved to localStorage');
            return true;
        } catch (error) {
            console.error('Failed to save settings:', error);
            return false;
        }
    }

    /**
     * Load settings from localStorage
     * @param {Array} availableDevices - Currently available audio devices
     * @returns {Object|null} Loaded settings or null if failed
     */
    loadSettings(availableDevices = []) {
        try {
            const stored = localStorage.getItem(this.storageKey);
            if (!stored) {
                console.log('No stored settings found');
                return null;
            }

            const data = JSON.parse(stored);
            
            // Version check (for future migrations)
            if (data.version !== this.version) {
                console.log(`Settings version mismatch. Stored: ${data.version}, Current: ${this.version}`);
                // Could add migration logic here in the future
            }

            const settings = { ...data.settings };

            // Special handling for audio device restoration
            if (settings.selectedDeviceLabel || settings.selectedDeviceId) {
                console.log(`Found saved device settings - Label: "${settings.selectedDeviceLabel}", ID: "${settings.selectedDeviceId}"`);
                const restoredDeviceId = this.restoreAudioDevice(
                    settings.selectedDeviceLabel,
                    settings.selectedDeviceId,
                    availableDevices
                );
                
                if (restoredDeviceId) {
                    console.log(`Device successfully restored to: ${restoredDeviceId}`);
                    settings.selectedDeviceId = restoredDeviceId;
                } else {
                    console.log('Device restoration failed, removing from settings');
                    // Remove if can't restore
                    delete settings.selectedDeviceId;
                }
                
                // Clean up the label from settings since it's not a real setting
                delete settings.selectedDeviceLabel;
            } else {
                console.log('No saved device settings found');
            }

            console.log('Settings loaded from localStorage');
            return settings;
        } catch (error) {
            console.error('Failed to load settings:', error);
            return null;
        }
    }

    /**
     * Restore audio device selection with fallback logic
     * @param {string} deviceLabel - Stored device label
     * @param {string} fallbackDeviceId - Fallback device ID
     * @param {Array} availableDevices - Currently available devices
     * @returns {string|null} Device ID to use or null if none found
     */
    restoreAudioDevice(deviceLabel, fallbackDeviceId, availableDevices) {
        if (!availableDevices || availableDevices.length === 0) {
            console.log('No audio devices available for restoration');
            return null;
        }

        console.log(`Attempting to restore device. Label: "${deviceLabel}", ID: "${fallbackDeviceId}"`);
        console.log(`Available devices:`, availableDevices.map(d => `"${d.label}" (${d.deviceId})`));

        // First try: exact label match
        if (deviceLabel) {
            const exactMatch = availableDevices.find(device => device.label === deviceLabel);
            if (exactMatch) {
                console.log(`Audio device restored by exact label match: ${deviceLabel}`);
                return exactMatch.deviceId;
            }

            // Second try: partial label match (in case of minor label changes)
            const partialMatch = availableDevices.find(device => 
                device.label && device.label.includes(deviceLabel.split(' ')[0])
            );
            if (partialMatch) {
                console.log(`Audio device restored by partial label match: ${partialMatch.label}`);
                return partialMatch.deviceId;
            }
            
            console.log(`No label match found for: "${deviceLabel}"`);
        }

        // Third try: exact device ID match (if device ID is stable)
        if (fallbackDeviceId) {
            const idMatch = availableDevices.find(device => device.deviceId === fallbackDeviceId);
            if (idMatch) {
                console.log(`Audio device restored by ID: ${fallbackDeviceId}`);
                return idMatch.deviceId;
            }
            console.log(`No ID match found for: "${fallbackDeviceId}"`);
        }

        // Fourth try: default device (usually first in list)
        if (availableDevices.length > 0) {
            console.log(`Using default audio device: ${availableDevices[0].label}`);
            return availableDevices[0].deviceId;
        }

        console.log('Could not restore audio device, none available');
        return null;
    }

    /**
     * Clear all stored settings
     */
    clearSettings() {
        try {
            localStorage.removeItem(this.storageKey);
            console.log('Settings cleared from localStorage');
            return true;
        } catch (error) {
            console.error('Failed to clear settings:', error);
            return false;
        }
    }

    /**
     * Get a list of all stored setting keys (for debugging)
     */
    getStoredKeys() {
        try {
            const stored = localStorage.getItem(this.storageKey);
            if (!stored) return [];
            
            const data = JSON.parse(stored);
            return Object.keys(data.settings || {});
        } catch (error) {
            console.error('Failed to get stored keys:', error);
            return [];
        }
    }
}

// Export singleton instance
export const settingsManager = new SettingsManager(SETTINGS_KEY); 