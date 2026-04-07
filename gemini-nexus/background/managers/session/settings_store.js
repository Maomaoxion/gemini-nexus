
// background/managers/session/settings_store.js

export async function getConnectionSettings() {
    const stored = await chrome.storage.local.get([
        'geminiProvider',
        'geminiUseOfficialApi', 
        'geminiApiKey', 
        'geminiThinkingLevel', 
        'geminiOfficialWebSearch',
        'geminiApiKeyPointer',
        'geminiOpenaiBaseUrl',
        'geminiOpenaiApiKey',
        'geminiOpenaiModel'
    ]);

    // Legacy Migration Logic
    let provider = stored.geminiProvider;
    if (!provider) {
        provider = stored.geminiUseOfficialApi === true ? 'official' : 'web';
    }

    let activeApiKey = stored.geminiApiKey || "";

    // Handle API Key Rotation (Comma separated) for Official Gemini
    if (provider === 'official' && activeApiKey.includes(',')) {
        const keys = activeApiKey.split(',').map(k => k.trim()).filter(k => k);
        
        if (keys.length > 0) {
            let pointer = stored.geminiApiKeyPointer || 0;
            
            // Reset pointer if out of bounds (e.g. keys removed)
            if (typeof pointer !== 'number' || pointer >= keys.length || pointer < 0) {
                pointer = 0;
            }
            
            activeApiKey = keys[pointer];
            
            // Advance pointer for next call
            const nextPointer = (pointer + 1) % keys.length;
            await chrome.storage.local.set({ geminiApiKeyPointer: nextPointer });
            
            console.log(`[Gemini Nexus] Rotating Official API Key (Index: ${pointer})`);
        }
    } else {
        // Trim single key just in case
        activeApiKey = activeApiKey.trim();
    }

    return {
        provider: provider,
        // Official
        apiKey: activeApiKey,
        thinkingLevel: stored.geminiThinkingLevel || "low",
        officialWebSearch: stored.geminiOfficialWebSearch === true,
        // OpenAI
        openaiBaseUrl: stored.geminiOpenaiBaseUrl,
        openaiApiKey: stored.geminiOpenaiApiKey,
        openaiModel: stored.geminiOpenaiModel
    };
}
