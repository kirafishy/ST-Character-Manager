import { getSTContext } from './context.js';
import { state } from './state.js';
import { createTag, addTagToChar, saveTags } from './data.js';
import { log, escapeHtml } from './utils.js';

const IMPORT_EXLCUDED_TAGS = ['ROOT', 'TAVERN'];
const ANTI_TROLL_MAX_TAGS = 50;

export const tag_import_setting = {
    ASK: 1,
    NONE: 2,
    ALL: 3,
    ONLY_EXISTING: 4,
};

/**
 * Gets a tag from the tags array based on the provided tag name (insensitive soft matching)
 * @param {string} tagName - The name of the tag to search for
 * @returns {object?} The tag object that matches the provided tag name
 */
function getTag(tagName) {
    if (!tagName) return undefined;
    const lowerName = tagName.toLowerCase();
    return state.tags.find(t => t.name.toLowerCase() === lowerName);
}

/**
 * Handles the import of tags for a given character
 * @param {object} character - The character object
 * @param {object} [options] - Options
 * @param {number} [options.importSetting=null] - Force a tag import setting
 */
export async function importTags(character, { importSetting = null, skipSave = false } = {}) {
    const ctx = getSTContext();
    if (!ctx) return;

    // Get tags from character metadata
    // Check both root level tags (V3/Internal) and data.tags (V2)
    let rawTags = character.tags || (character.data && character.data.tags) || [];
    
    // Ensure it's an array
    if (!Array.isArray(rawTags)) {
        // Try to parse string if it's a string
        if (typeof rawTags === 'string') {
            try {
                rawTags = JSON.parse(rawTags);
            } catch {
                rawTags = rawTags.split(',').map(t => t.trim());
            }
        } else {
            rawTags = [];
        }
    }

    if (!rawTags.length) {
        console.debug('[ST-Tags] No tags to import for', character.name);
        return;
    }

    // Filter and process tags
    const importTagsList = rawTags
        .map(t => String(t).trim())
        .filter(t => t)
        .filter(t => !IMPORT_EXLCUDED_TAGS.includes(t))
        .slice(0, ANTI_TROLL_MAX_TAGS);

    if (!importTagsList.length) return;

    // Separate into existing and new
    const existingTags = [];
    const newTags = [];

    importTagsList.forEach(tagName => {
        const existing = getTag(tagName);
        if (existing) {
            // Check if already assigned to char
            const charTags = state.tagMap[character.avatar] || [];
            if (!charTags.includes(existing.id)) {
                existingTags.push(existing);
            }
        } else {
            // New tag
            // Check if we already have it in newTags list to avoid duplicates
            if (!newTags.includes(tagName)) {
                newTags.push(tagName);
            }
        }
    });

    if (existingTags.length === 0 && newTags.length === 0) {
        return;
    }

    // Determine import setting
    let setting = importSetting;
    if (!setting) {
        // Try to get from power_user
        if (ctx.powerUserSettings && ctx.powerUserSettings.tag_import_setting !== undefined) {
            setting = ctx.powerUserSettings.tag_import_setting;
        } else {
            setting = tag_import_setting.ASK;
        }
    }

    let tagsToApply = [];

    switch (setting) {
        case tag_import_setting.ALL:
            tagsToApply = [...existingTags, ...newTags];
            break;
        case tag_import_setting.ONLY_EXISTING:
            tagsToApply = [...existingTags];
            break;
        case tag_import_setting.ASK:
            tagsToApply = await showTagImportPopup(character, existingTags, newTags);
            break;
        case tag_import_setting.NONE:
            return;
    }

    if (!tagsToApply || tagsToApply.length === 0) return;

    // Apply tags
    let addedCount = 0;
    for (const item of tagsToApply) {
        if (typeof item === 'object' && item.id) {
            // Existing tag object
            if (addTagToChar(character.avatar, item.id)) addedCount++;
        } else if (typeof item === 'string') {
            // New tag name -> Create then add
            const newTag = createTag(item);
            if (newTag) {
                if (addTagToChar(character.avatar, newTag.id)) addedCount++;
            }
        }
    }

    if (addedCount > 0) {
        if (!skipSave) saveTags(); // Persist changes
        log(`Imported ${addedCount} tags for ${character.name}`);
        // Refresh UI via callback or event if necessary, but caller (index.js) usually handles refresh
    }
}

async function showTagImportPopup(character, existingTags, newTags) {
    const ctx = getSTContext();
    // We'll use a custom HTML construction here to avoid depending on templates
    // But we reuse the logic of "Import All", "Import Existing", "Import None"

    const existingHtml = existingTags.length > 0 
        ? `<div>
            <div style="font-weight:bold;margin-bottom:5px">Existing Tags:</div>
            <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px">
                ${existingTags.map(t => `<span class="cm-card-tag" style="background:${t.color||'#666'}">${escapeHtml(t.name)}</span>`).join('')}
            </div>
           </div>`
        : '';

    const newHtml = newTags.length > 0
        ? `<div>
            <div style="font-weight:bold;margin-bottom:5px">New Tags:</div>
            <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px">
                ${newTags.map(t => `<span class="cm-card-tag" style="background:var(--cm-bg-ter);border:1px dashed var(--cm-border)">${escapeHtml(t)}</span>`).join('')}
            </div>
           </div>`
        : '';

    const html = `
        <div style="padding:10px">
            <div style="margin-bottom:15px">The character <b>${escapeHtml(character.name)}</b> has tags that can be imported.</div>
            ${existingHtml}
            ${newHtml}
            <div style="margin-top:10px;font-style:italic;font-size:0.9em;opacity:0.8">
                Select an action below. You can change the default behavior in User Settings.
            </div>
        </div>
    `;

    // We can use ctx.callGenericPopup if available, but it might be simpler to use our own dialog system
    // if we want to ensure it looks consistent with the extension.
    // However, the prompt says "copy native logic", so using native popup style is good.
    // But we are inside an extension which might be running in a different context.
    // Let's try to use the extension's createBaseDialog logic but exposed or implemented here.
    // Since createBaseDialog is not exported from index.js, we have to rely on what we have.
    
    // Let's assume we can use `ctx.callGenericPopup` which returns a promise resolving to result.
    if (ctx && ctx.callGenericPopup && ctx.POPUP_TYPE && ctx.POPUP_RESULT) {
        // Construct buttons
        // Result: 2=None, 3=All, 4=Existing (Custom results from tags.js)
        const buttons = [
            { result: 2, text: 'Import None' },
            { result: 4, text: 'Import Existing' },
            { result: 3, text: 'Import All' }
        ];

        // We can pass HTML string to callGenericPopup
        const result = await ctx.callGenericPopup(html, ctx.POPUP_TYPE.TEXT, null, {
            wider: true,
            okButton: 'Import All', // Default OK usually returns AFFIRMATIVE (1)
            cancelButton: 'Cancel', // Cancel returns negative
            customButtons: buttons
        });

        if (!result || result === 2) return []; // None or Cancel
        if (result === 3 || result === ctx.POPUP_RESULT.AFFIRMATIVE) return [...existingTags, ...newTags]; // All
        if (result === 4) return [...existingTags]; // Existing Only
        
        return [];
    } else {
        // Fallback: If we can't use native popup, we just import all existing to be safe, or none.
        // Or we could implement a simple confirm.
        console.warn('[ST-Tags] Native popup not available, defaulting to importing existing tags only.');
        return [...existingTags];
    }
}