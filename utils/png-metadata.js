/**
 * PNG 元数据处理工具库
 * 独立实现 PNG Chunk 的解析、提取和剥离
 */

// 初始化 CRC32 表
const crcTable = (function () {
    let c;
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        c = n;
        for (let k = 0; k < 8; k++) {
            c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
        }
        table[n] = c;
    }
    return table;
})();

function crc32(typeBytes, dataBytes) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < typeBytes.length; i++) {
        crc = (crc >>> 8) ^ crcTable[(crc ^ typeBytes[i]) & 0xFF];
    }
    for (let i = 0; i < dataBytes.length; i++) {
        crc = (crc >>> 8) ^ crcTable[(crc ^ dataBytes[i]) & 0xFF];
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

// 检查是否为有效 PNG 文件
function isPNG(buffer) {
    const signature = new Uint8Array(buffer, 0, 8);
    const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
    for (let i = 0; i < 8; i++) {
        if (signature[i] !== pngSignature[i]) return false;
    }
    return true;
}

// 解析所有 PNG 块
function parseChunks(buffer) {
    if (!isPNG(buffer)) {
        throw new Error('无效的 PNG 文件');
    }

    const chunks = [];
    let offset = 8;
    const dataView = new DataView(buffer);
    const decoder = new TextDecoder('latin1');

    while (offset < buffer.byteLength) {
        const length = dataView.getUint32(offset);
        offset += 4;
        
        const typeBytes = new Uint8Array(buffer, offset, 4);
        const type = decoder.decode(typeBytes);
        offset += 4;
        
        const data = new Uint8Array(buffer, offset, length);
        offset += length;
        
        const crc = dataView.getUint32(offset);
        offset += 4;

        chunks.push({ length, type, typeBytes, data, crc });

        if (type === 'IEND') break;
    }

    return chunks;
}

// 将 chunks 重组为 PNG ArrayBuffer
function buildPNG(chunks) {
    let totalLength = 8; // Signature
    for (const chunk of chunks) {
        totalLength += 4 + 4 + chunk.length + 4;
    }

    const buffer = new ArrayBuffer(totalLength);
    const view = new DataView(buffer);
    const uint8View = new Uint8Array(buffer);

    // 写入 Signature
    uint8View.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
    let offset = 8;

    for (const chunk of chunks) {
        view.setUint32(offset, chunk.length);
        offset += 4;

        uint8View.set(chunk.typeBytes, offset);
        offset += 4;

        uint8View.set(chunk.data, offset);
        offset += chunk.length;

        const calculatedCrc = crc32(chunk.typeBytes, chunk.data);
        view.setUint32(offset, calculatedCrc);
        offset += 4;
    }

    return buffer;
}

function decodeBase64UTF8(b64) {
    try {
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return new TextDecoder('utf-8').decode(bytes);
    } catch (e) {
        throw new Error('Base64 解码失败');
    }
}

/**
 * 提取 PNG 中的角色数据 (JSON字符串)
 * @param {ArrayBuffer} buffer
 * @returns {string} 格式化后的 JSON 字符串
 */
export function extractCharDataFromPNG(buffer) {
    const chunks = parseChunks(buffer);
    const decoder = new TextDecoder('latin1');
    let v2Data = null;
    let v3Data = null;

    for (const chunk of chunks) {
        if (chunk.type === 'tEXt') {
            const nullIndex = chunk.data.indexOf(0);
            if (nullIndex !== -1) {
                const keyword = decoder.decode(chunk.data.slice(0, nullIndex));
                const textBase64 = decoder.decode(chunk.data.slice(nullIndex + 1));
                
                if (keyword === 'ccv3') {
                    v3Data = textBase64;
                } else if (keyword === 'chara') {
                    v2Data = textBase64;
                }
            }
        }
    }

    const targetB64 = v3Data || v2Data;
    if (!targetB64) {
        throw new Error('未找到角色数据 (ccv3/chara)');
    }

    const jsonStr = decodeBase64UTF8(targetB64);
    try {
        // 尝试格式化
        const parsed = JSON.parse(jsonStr);
        return JSON.stringify(parsed, null, 2);
    } catch (e) {
        // 如果 JSON 格式破损，直接返回解析到的文本
        return jsonStr;
    }
}

/**
 * 剥离 PNG 中的角色设定元数据，返回纯净图片
 * @param {ArrayBuffer} buffer 原始图片的 Buffer
 * @returns {Uint8Array} 剥离后的图片数据
 */
export function stripCharMetadataFromPNG(buffer) {
    const chunks = parseChunks(buffer);
    const decoder = new TextDecoder('latin1');

    const cleanChunks = chunks.filter(chunk => {
        if (chunk.type === 'tEXt') {
            const nullIndex = chunk.data.indexOf(0);
            if (nullIndex !== -1) {
                const keyword = decoder.decode(chunk.data.slice(0, nullIndex));
                if (keyword === 'ccv3' || keyword === 'chara') {
                    return false; // 丢弃这些块
                }
            }
        }
        return true;
    });

    const newBuffer = buildPNG(cleanChunks);
    return new Uint8Array(newBuffer);
}
