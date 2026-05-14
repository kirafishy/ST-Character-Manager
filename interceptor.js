import { parentWin, getCurrentChatChar, doc } from './context.js';
import { notify } from './utils.js';
import { state } from './state.js';
import { galleryCountCache, saveGalleryCountCache } from './gallery.js';

export function initInterceptor() {
    const fetchFn = parentWin.fetch || window.fetch;
    if (!fetchFn) return;

    if (fetchFn._isSTCharManagerPatched) return;

    const patchedFetch = async function(...args) {
        const [url, config] = args;

        if (url && url.toString().includes('/api/images/upload') && config && config.method && config.method.toUpperCase() === 'POST') {
            try {
                let bodyObj = null;
                if (typeof config.body === 'string') {
                    bodyObj = JSON.parse(config.body);
                }

                // 检查设置是否开启同步，默认关闭
                if (state.settings.syncImageToChar) {
                    // 检查是否是发往 chatu8 的文生图请求，并且格式是 png
                    if (bodyObj && bodyObj.ch_name === 'chatu8' && bodyObj.image && bodyObj.format === 'png') {
                        const currentChar = getCurrentChatChar();
                        
                        if (currentChar && currentChar.name) {
                            console.log(`[CharManager] 拦截到文生图请求，准备同步上传至当前角色: ${currentChar.name}`);
                            
                            // 复制请求体，将文件夹改为当前角色的文件夹
                            const cloneBody = { ...bodyObj, ch_name: currentChar.name };
                            const cloneConfig = { ...config, body: JSON.stringify(cloneBody) };

                            // 异步发起一个新的上传请求到角色画廊，不阻塞原始请求
                            fetchFn.apply(this, [url, cloneConfig])
                                .then(async (res) => {
                                    if (res.ok) {
                                        notify(`文生图已同步保存至 ${currentChar.name} 画廊`, 'success');
                                        
                                        // 更新画廊数量缓存
                                        if (galleryCountCache[currentChar.name] !== undefined) {
                                            galleryCountCache[currentChar.name]++;
                                        } else {
                                            galleryCountCache[currentChar.name] = 1;
                                        }
                                        saveGalleryCountCache();

                                        // 更新卡片列表里的数量显示
                                        if (state.characters) {
                                            const char = state.characters.find(c => c.name === currentChar.name);
                                            if (char) {
                                                char.galleryCount = galleryCountCache[currentChar.name];
                                                
                                                // 尝试更新 DOM（如果卡片当前可见，且徽章已渲染）
                                                const badgeTextEl = doc.querySelector(`.cm-card[data-file="${CSS.escape(char.fileName)}"] .cm-gallery-badge-card .text-neon`);
                                                if (badgeTextEl) {
                                                    badgeTextEl.textContent = char.galleryCount;
                                                }
                                            }
                                        }
                                    } else {
                                        console.warn(`[CharManager] 同步文生图至 ${currentChar.name} 失败:`, res.status);
                                    }
                                })
                                .catch(e => console.error(`[CharManager] 同步文生图至 ${currentChar.name} 发生异常:`, e));
                        }
                    }
                }
            } catch (e) {
                console.warn('[CharManager] 拦截并解析 fetch body 失败:', e);
            }
        }

        // 放行原始请求
        return fetchFn.apply(this, args);
    };

    patchedFetch._isSTCharManagerPatched = true;
    
    if (parentWin.fetch) {
        parentWin.fetch = patchedFetch;
    } else {
        window.fetch = patchedFetch;
    }
    
    console.log('[CharManager] 网络请求拦截器已初始化');
}
