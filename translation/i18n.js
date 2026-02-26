/**
 * 翻译模块国际化文本
 * 仅用于翻译模块的界面文本，插件其他模块不受影响
 */

export const i18n = {
    'zh-CN': {
        // 翻译界面标题和主按钮
        dialogTitle: '角色卡翻译',
        btnStartTranslation: '开始翻译',
        btnPauseTranslation: '暂停',
        btnResumeTranslation: '继续',
        btnStopTranslation: '停止',
        btnRetryFailed: '重试失败项',
        
        // 进度管理下拉菜单
        btnProgressMenu: '翻译进度',
        menuExportProgress: '📤 导出进度 (JSON)',
        menuImportProgress: '📥 导入进度 (JSON)',
        
        // 保存卡片下拉菜单
        btnSaveMenu: '保存卡片',
        menuOverwriteOriginal: '💾 覆盖原卡',
        menuImportAsNew: '📋 直接导入新卡',
        menuExportPNG: '🖼️ 导出 PNG',
        menuExportJSON: '📄 导出 JSON',

        // 设置
        btnSettings: '翻译设置',

        // 术语表扫描
        btnScanGlossary: '扫描专有名词',
        glossaryTitle: '专有名词术语表',
        glossaryDescription: '以下是从角色卡中提取的专有名词，翻译时将严格遵循这些译法。您可以手动编辑。',
        colOriginal: '原文',
        colTranslation: '译文',
        colType: '类型',
        typeName: '人名',
        typePlace: '地名',
        typeSkill: '技能/道具',
        typeOther: '其他',
        btnApplyGlossary: '应用术语表',
        btnClearGlossary: '清空',
        scanningGlossary: '正在扫描专有名词...',
        scanComplete: '扫描完成，发现 {count} 个专有名词',
        noProperNouns: '未发现需要统一翻译的专有名词',

        // 操作提示
        notifyOverwriting: '正在覆盖原卡，请稍候...',
        notifyImporting: '正在导入新卡，请稍候...',
        
        // 翻译状态
        statusIdle: '就绪',
        statusTranslating: '翻译中...',
        statusPaused: '已暂停',
        statusCompleted: '翻译完成',
        statusError: '翻译出错',
        
        // 进度信息
        progressLabel: '翻译进度',
        progressItems: '{done}/{total} 条',
        progressPercent: '{percent}%',
        progressETA: '预计剩余：{time}',
        
        // 翻译分类标签
        categoryBasic: '基本信息',
        categorySystem: '系统提示词',
        categoryGreetings: '问候语',
        categoryDialogue: '示例对话',
        categoryTags: '标签',
        categoryLorebook: '世界书',
        categoryRegex: '正则脚本',
        categoryScript: '酒馆助手脚本',
        
        // 翻译条目状态
        itemPending: '待翻译',
        itemTranslating: '翻译中',
        itemDone: '已完成',
        itemFailed: '失败',
        itemSkipped: '已跳过',
        
        // 通知消息
        notifyTranslationStarted: '翻译已开始',
        notifyTranslationPaused: '翻译已暂停',
        notifyTranslationResumed: '翻译已继续',
        notifyTranslationCompleted: '翻译完成！共翻译 {count} 条',
        notifyTranslationError: '翻译出错：{error}',
        notifySaveSuccess: '卡片保存成功',
        notifySaveFailed: '卡片保存失败：{error}',
        notifyProgressExported: '翻译进度已导出',
        notifyProgressImported: '翻译进度已导入，共恢复 {count} 条',
        notifyProgressImportFailed: '进度导入失败：{error}',
        notifyOverwriteSuccess: '已覆盖原角色卡',
        notifyImportNewSuccess: '已导入为新角色卡',
        notifyExportPNGSuccess: 'PNG 文件已导出',
        notifyExportJSONSuccess: 'JSON 文件已导出',
        
        // 确认对话框
        confirmOverwrite: '确定要覆盖原角色卡吗？\n此操作不可撤销。',
        confirmStop: '确定要停止翻译吗？\n已翻译的内容将保留。',
        confirmImportProgress: '导入进度将覆盖当前的翻译状态，确定继续吗？',
        confirmCloseUnsaved: '您有未保存的翻译进度。',
        confirmCloseTip: '建议先“保存进度”导出为JSON文件，以便稍后继续。',
        btnSaveProgressAndClose: '保存进度并关闭',
        btnDiscardAndClose: '放弃修改并关闭',
        confirmAntiTruncation: '警告：开启防截断模式会显著增加翻译耗时和 API 成本（约增加 2-3 倍）。\n\n仅建议在翻译超长文本（如世界书、长背景故事）且经常遇到截断问题时开启。\n\n确定要开启吗？',
        
        // 设置相关
        settingSourceLang: '源语言',
        settingTargetLang: '目标语言',
        settingUILang: '界面语言',
        settingSystemPrompt: '翻译 System Prompt',
        settingResetPrompt: '恢复默认',
        settingRetryCount: '失败重试次数',

        // 空状态
        emptyNoData: '没有可翻译的内容',
        emptySelectCard: '请先选择一个角色卡',

        // 其他
        close: '关闭',
        cancel: '取消',
        confirm: '确定',
        loading: '加载中...',
        unknown: '未知',
    },

    'en': {
        // 翻译界面标题和主按钮
        dialogTitle: 'Character Card Translation',
        btnStartTranslation: 'Start Translation',
        btnPauseTranslation: 'Pause',
        btnResumeTranslation: 'Resume',
        btnStopTranslation: 'Stop',
        btnRetryFailed: 'Retry Failed',
        
        // 进度管理下拉菜单
        btnProgressMenu: 'Progress',
        menuExportProgress: '📤 Export Progress (JSON)',
        menuImportProgress: '📥 Import Progress (JSON)',
        
        // 保存卡片下拉菜单
        btnSaveMenu: 'Save Card',
        menuOverwriteOriginal: '💾 Overwrite Original',
        menuImportAsNew: '📋 Import as New Card',
        menuExportPNG: '🖼️ Export PNG',
        menuExportJSON: '📄 Export JSON',

        // 设置
        btnSettings: 'Settings',

        // 术语表扫描
        btnScanGlossary: 'Scan Proper Nouns',
        glossaryTitle: 'Proper Noun Glossary',
        glossaryDescription: 'The following proper nouns were extracted from the character card. They will be strictly followed during translation. You can edit them manually.',
        colOriginal: 'Original',
        colTranslation: 'Translation',
        colType: 'Type',
        typeName: 'Name',
        typePlace: 'Place',
        typeSkill: 'Skill/Item',
        typeOther: 'Other',
        btnApplyGlossary: 'Apply Glossary',
        btnClearGlossary: 'Clear',
        scanningGlossary: 'Scanning proper nouns...',
        scanComplete: 'Scan complete, found {count} proper nouns',
        noProperNouns: 'No proper nouns requiring unified translation were found',

        // 操作提示
        notifyOverwriting: 'Overwriting original card, please wait...',
        notifyImporting: 'Importing new card, please wait...',
        
        // 翻译状态
        statusIdle: 'Ready',
        statusTranslating: 'Translating...',
        statusPaused: 'Paused',
        statusCompleted: 'Translation Complete',
        statusError: 'Translation Error',
        
        // 进度信息
        progressLabel: 'Progress',
        progressItems: '{done}/{total} items',
        progressPercent: '{percent}%',
        progressETA: 'ETA: {time}',
        
        // 翻译分类标签
        categoryBasic: 'Basic Info',
        categorySystem: 'System Prompt',
        categoryGreetings: 'Greetings',
        categoryDialogue: 'Example Dialogue',
        categoryTags: 'Tags',
        categoryLorebook: 'Lorebook',
        categoryRegex: 'Regex Scripts',
        categoryScript: 'Tavern Helper Scripts',
        
        // 翻译条目状态
        itemPending: 'Pending',
        itemTranslating: 'Translating',
        itemDone: 'Done',
        itemFailed: 'Failed',
        itemSkipped: 'Skipped',
        
        // 通知消息
        notifyTranslationStarted: 'Translation started',
        notifyTranslationPaused: 'Translation paused',
        notifyTranslationResumed: 'Translation resumed',
        notifyTranslationCompleted: 'Translation complete! {count} items translated',
        notifyTranslationError: 'Translation error: {error}',
        notifySaveSuccess: 'Card saved successfully',
        notifySaveFailed: 'Card save failed: {error}',
        notifyProgressExported: 'Translation progress exported',
        notifyProgressImported: 'Translation progress imported, {count} items restored',
        notifyProgressImportFailed: 'Progress import failed: {error}',
        notifyOverwriteSuccess: 'Original character card overwritten',
        notifyImportNewSuccess: 'Imported as new character card',
        notifyExportPNGSuccess: 'PNG file exported',
        notifyExportJSONSuccess: 'JSON file exported',
        
        // 确认对话框
        confirmOverwrite: 'Are you sure you want to overwrite the original character card?\nThis action cannot be undone.',
        confirmStop: 'Are you sure you want to stop translation?\nAlready translated content will be preserved.',
        confirmImportProgress: 'Importing progress will overwrite the current translation state. Continue?',
        confirmCloseUnsaved: 'You have unsaved translation progress.',
        confirmCloseTip: 'It is recommended to "Save Progress" to a JSON file first.',
        btnSaveProgressAndClose: 'Save Progress & Close',
        btnDiscardAndClose: 'Discard & Close',
        confirmAntiTruncation: 'Warning: Enabling Anti-truncation mode will significantly increase translation time and API costs (approx. 2-3x).\n\nIt is only recommended when translating very long texts (like Lorebooks, long backgrounds) and frequently encountering truncation issues.\n\nAre you sure you want to enable it?',
        
        // 设置相关
        settingSourceLang: 'Source Language',
        settingTargetLang: 'Target Language',
        settingUILang: 'UI Language',
        settingSystemPrompt: 'Translation System Prompt',
        settingResetPrompt: 'Reset to Default',
        settingRetryCount: 'Retry Count on Failure',

        // 空状态
        emptyNoData: 'No translatable content',
        emptySelectCard: 'Please select a character card first',

        // 其他
        close: 'Close',
        cancel: 'Cancel',
        confirm: 'Confirm',
        loading: 'Loading...',
        unknown: 'Unknown',
    }
};

/**
 * 获取当前界面语言的文本
 * @param {string} key - 文本键名
 * @param {object} [params] - 替换参数，如 {count: 5, error: 'xxx'}
 * @param {string} [lang] - 语言代码，默认从 settings 读取
 * @returns {string} 本地化文本
 */
export function t(key, params = {}, lang = null) {
    // 获取当前语言设置
    if (!lang) {
        try {
            const savedSettings = JSON.parse(localStorage.getItem('cm_settings') || '{}');
            lang = savedSettings.translationUILanguage || 'zh-CN';
        } catch (e) {
            lang = 'zh-CN';
        }
    }
    
    const texts = i18n[lang] || i18n['zh-CN'];
    let text = texts[key] || i18n['zh-CN'][key] || key;
    
    // 替换参数占位符
    for (const [pKey, pVal] of Object.entries(params)) {
        text = text.replace(new RegExp(`\\{${pKey}\\}`, 'g'), String(pVal));
    }
    
    return text;
}

/**
 * 创建一个绑定到特定语言的翻译函数
 * @param {string} lang - 语言代码
 * @returns {Function} 翻译函数
 */
export function createTranslator(lang) {
    return (key, params = {}) => t(key, params, lang);
}