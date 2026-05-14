import { doc } from './context.js';
import { createBaseDialog } from './ui-utils.js';
import { notify } from './utils.js';
import { extractCharDataFromPNG } from './utils/png-metadata.js';
import { ICONS } from './constants.js';

export function openMetadataSeparatorDialog() {
    let currentFile = null;
    let currentJsonData = null;

    let html = `
    <div class="cm-metadata-separator">
        <style>
            .cm-metadata-separator { padding: 10px; display: flex; flex-direction: column; gap: 15px; }
            .cm-ms-upload-area {
                border: 2px dashed var(--SmartThemeBorderColor, #555);
                border-radius: 8px;
                padding: 40px 20px;
                text-align: center;
                cursor: pointer;
                transition: background-color 0.2s;
                background-color: var(--SmartThemeBlurTintColor, rgba(0,0,0,0.1));
            }
            .cm-ms-upload-area:hover, .cm-ms-upload-area.drag-over {
                background-color: var(--SmartThemeBlurTintColorHover, rgba(255,255,255,0.05));
                border-color: var(--SmartThemeQuoteColor, #888);
            }
            .cm-ms-upload-icon { font-size: 32px; margin-bottom: 10px; opacity: 0.8; }
            .cm-ms-upload-text { font-size: 14px; opacity: 0.8; }
            
            .cm-ms-result-area { display: none; flex-direction: column; gap: 10px; }
            .cm-ms-preview {
                display: flex;
                align-items: flex-start;
                gap: 15px;
                background: var(--SmartThemeBlurTintColor, rgba(0,0,0,0.2));
                padding: 10px;
                border-radius: 6px;
            }
            .cm-ms-preview img {
                max-height: 120px;
                max-width: 120px;
                object-fit: contain;
                border-radius: 4px;
                background: #000;
            }
            .cm-ms-file-info {
                flex: 1;
                display: flex;
                flex-direction: column;
                gap: 5px;
                overflow: hidden;
            }
            .cm-ms-filename { font-weight: bold; font-size: 14px; word-break: break-all; }
            .cm-ms-actions { display: flex; gap: 10px; margin-top: auto; }
            
            .cm-ms-json-container {
                position: relative;
                background: #1e1e1e;
                border-radius: 6px;
                border: 1px solid #333;
                display: flex;
                flex-direction: column;
            }
            .cm-ms-json-header {
                padding: 8px 12px;
                background: #2d2d2d;
                border-bottom: 1px solid #333;
                border-radius: 6px 6px 0 0;
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-size: 12px;
            }
            .cm-ms-json-body {
                margin: 0;
                padding: 12px;
                max-height: 300px;
                overflow-y: auto;
                font-family: monospace;
                font-size: 12px;
                color: #d4d4d4;
                white-space: pre-wrap;
                word-break: break-all;
            }
        </style>
        
        <div class="cm-ms-upload-area" id="cmMsUploadArea">
            <div class="cm-ms-upload-icon">${ICONS.UPLOAD || '📁'}</div>
            <div class="cm-ms-upload-text">点击或将 PNG 角色卡拖拽到此处解析</div>
            <input type="file" id="cmMsFileInput" accept="image/png" style="display:none">
        </div>

        <div class="cm-ms-result-area" id="cmMsResultArea">
            <div class="cm-ms-preview">
                <img id="cmMsImagePreview" src="" alt="preview" />
                <div class="cm-ms-file-info">
                    <div class="cm-ms-filename" id="cmMsFileName">filename.png</div>
                    <div class="cm-ms-actions">
                        <div class="cm-btn cm-btn-primary" id="cmMsBtnSaveJson">
                            ${ICONS.DOWNLOAD || '💾'} 保存 JSON
                        </div>
                        <div class="cm-btn cm-btn-primary" id="cmMsBtnSavePng">
                            ${ICONS.image || '🖼️'} 保存原图
                        </div>
                        <div class="cm-btn cm-btn-secondary" id="cmMsBtnClear">清空</div>
                    </div>
                </div>
            </div>
            
            <div class="cm-ms-json-container">
                <div class="cm-ms-json-header">
                    <span>元数据内容 (JSON)</span>
                </div>
                <pre class="cm-ms-json-body" id="cmMsJsonBody"></pre>
            </div>
        </div>
    </div>
    `;

    createBaseDialog('元数据分离器', html, [
        { text: '关闭', id: 'cmMsClose', cls: 'cm-btn-secondary', onClick: (ov, close) => close() }
    ], (ov) => {
        const uploadArea = ov.querySelector('#cmMsUploadArea');
        const fileInput = ov.querySelector('#cmMsFileInput');
        const resultArea = ov.querySelector('#cmMsResultArea');
        const imgPreview = ov.querySelector('#cmMsImagePreview');
        const fileNameEl = ov.querySelector('#cmMsFileName');
        const jsonBody = ov.querySelector('#cmMsJsonBody');
        const btnSaveJson = ov.querySelector('#cmMsBtnSaveJson');
        const btnSavePng = ov.querySelector('#cmMsBtnSavePng');
        const btnClear = ov.querySelector('#cmMsBtnClear');

        imgPreview.style.cursor = 'zoom-in';
        imgPreview.title = '点击查看大图';
        imgPreview.addEventListener('click', () => {
            if (!imgPreview.src) return;
            const lightbox = doc.createElement('div');
            lightbox.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.85);z-index:999999;display:flex;justify-content:center;align-items:center;cursor:zoom-out;backdrop-filter:blur(5px);';
            const img = doc.createElement('img');
            img.src = imgPreview.src;
            img.style.cssText = 'max-width:90vw;max-height:90vh;object-fit:contain;border-radius:4px;box-shadow:0 10px 30px rgba(0,0,0,0.5);';
            lightbox.appendChild(img);
            lightbox.onclick = () => lightbox.remove();
            doc.body.appendChild(lightbox);
        });

        const processFile = (file) => {
            if (!file || file.type !== 'image/png') {
                notify('请选择有效的 PNG 文件', 'error');
                return;
            }

            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const arrayBuffer = e.target.result;
                    const jsonStr = extractCharDataFromPNG(arrayBuffer);
                    
                    currentFile = file;
                    currentJsonData = jsonStr;

                    // Update UI
                    imgPreview.src = window.URL.createObjectURL(file);
                    fileNameEl.textContent = file.name;
                    jsonBody.textContent = jsonStr;

                    uploadArea.style.display = 'none';
                    resultArea.style.display = 'flex';
                    
                    notify('解析成功', 'success');
                } catch (err) {
                    notify('解析失败: ' + err.message, 'error');
                }
            };
            reader.onerror = () => notify('文件读取失败', 'error');
            reader.readAsArrayBuffer(file);
        };

        // Click to upload
        uploadArea.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                processFile(e.target.files[0]);
            }
            e.target.value = '';
        });

        // Drag and drop
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            uploadArea.classList.add('drag-over');
        });
        uploadArea.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            uploadArea.classList.remove('drag-over');
        });
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            uploadArea.classList.remove('drag-over');
            if (e.dataTransfer.files.length > 0) {
                processFile(e.dataTransfer.files[0]);
            }
        });

        // 屏蔽整个弹窗的全局拖拽事件，防止穿透触发底部酒馆原生或插件的导入
        ov.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
        ov.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); });

        // Actions
        btnClear.addEventListener('click', () => {
            if (imgPreview.src) window.URL.revokeObjectURL(imgPreview.src);
            currentFile = null;
            currentJsonData = null;
            
            uploadArea.style.display = 'block';
            resultArea.style.display = 'none';
        });

        btnSaveJson.addEventListener('click', () => {
            if (!currentJsonData || !currentFile) return;
            const blob = new Blob([currentJsonData], { type: 'application/json' });
            const url = window.URL.createObjectURL(blob);
            const a = doc.createElement('a');
            a.href = url;
            const safeName = currentFile.name.replace(/\.png$/i, '');
            a.download = `${safeName}.json`;
            doc.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
            notify('JSON文件已保存', 'success');
        });

        btnSavePng.addEventListener('click', () => {
            if (!currentFile) return;
            const url = window.URL.createObjectURL(currentFile);
            const a = doc.createElement('a');
            a.href = url;
            a.download = currentFile.name;
            doc.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
            notify('原图文件已保存', 'success');
        });
    }, { width: '85vw', maxWidth: '1000px', stack: true });
}
