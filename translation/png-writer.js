/**
 * 简单的 CRC32 实现
 */
const crcTable = [];
for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[i] = c;
}

function crc32(buf) {
    let crc = 0 ^ (-1);
    for (let i = 0; i < buf.length; i++) {
        crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xFF];
    }
    return (crc ^ (-1)) >>> 0;
}

/**
 * 将字符串编码为 Uint8Array (UTF-8)
 */
function strToBytes(str) {
    return new TextEncoder().encode(str);
}

/**
 * 将 Uint8Array 解码为字符串
 */
function bytesToStr(bytes) {
    return new TextDecoder().decode(bytes);
}

/**
 * 将 32 位整数转换为 4 字节数组 (Big Endian)
 */
function int32ToBytes(int) {
    return new Uint8Array([
        (int >>> 24) & 0xFF,
        (int >>> 16) & 0xFF,
        (int >>> 8) & 0xFF,
        int & 0xFF
    ]);
}

/**
 * 解析 PNG 文本块关键字
 * @param {Uint8Array} data - 块数据
 * @returns {string|null} 关键字
 */
function getTextChunkKeyword(data) {
    let nullIndex = -1;
    for (let i = 0; i < data.length; i++) {
        if (data[i] === 0) {
            nullIndex = i;
            break;
        }
    }

    if (nullIndex <= 0) {
        return null;
    }

    return bytesToStr(data.slice(0, nullIndex)).toLowerCase();
}

/**
 * 构建 PNG tEXt 块
 * @param {string} key - 关键字
 * @param {string} value - 文本内容
 * @returns {Uint8Array} PNG tEXt 块
 */
function buildTextChunk(key, value) {
    const keyBytes = strToBytes(key);
    const valBytes = strToBytes(value);
    const dataLen = keyBytes.length + 1 + valBytes.length;

    const newChunk = new Uint8Array(12 + dataLen);
    newChunk.set(int32ToBytes(dataLen), 0);
    newChunk.set(strToBytes('tEXt'), 4);
    newChunk.set(keyBytes, 8);
    newChunk[8 + keyBytes.length] = 0;
    newChunk.set(valBytes, 8 + keyBytes.length + 1);

    const crcData = newChunk.slice(4, 4 + 4 + dataLen);
    const crcVal = crc32(crcData);
    newChunk.set(int32ToBytes(crcVal), 8 + dataLen);

    return newChunk;
}

/**
 * 安全构造 V3 角色卡 JSON 字符串
 * @param {object} cardData - 导出角色卡对象
 * @returns {string|null} V3 JSON 字符串
 */
function buildV3CardJson(cardData) {
    if (!cardData || typeof cardData !== 'object' || !cardData.data || typeof cardData.data !== 'object') {
        return null;
    }

    try {
        const v3CardData = {
            ...cardData,
            spec: 'chara_card_v3',
            spec_version: '3.0'
        };

        return JSON.stringify(v3CardData);
    } catch (_error) {
        return null;
    }
}

/**
 * 将角色卡元数据写入 PNG
 * 始终写入 `chara`，当可安全构造 V3 时额外写入 `ccv3`
 * @param {ArrayBuffer} pngBuffer - 原始 PNG 数据
 * @param {object} cardData - 角色卡对象
 * @param {{debug?: boolean}} [options] - 写入选项
 * @returns {Blob} 新的 PNG Blob
 */
export function writeCharacterCardPng(pngBuffer, cardData, options = {}) {
    const debug = Boolean(options.debug);
    const uint8 = new Uint8Array(pngBuffer);

    // 验证 PNG 签名
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    for (let i = 0; i < 8; i++) {
        if (uint8[i] !== signature[i]) throw new Error('Not a valid PNG file');
    }

    const charaJson = JSON.stringify(cardData);
    const charaBase64 = btoa(unescape(encodeURIComponent(charaJson)));
    const v3Json = buildV3CardJson(cardData);
    const v3Base64 = v3Json ? btoa(unescape(encodeURIComponent(v3Json))) : null;

    if (debug) {
        console.log('[CharManager] [Translation] PNG 写入准备摘要', {
            hasCardData: Boolean(cardData && typeof cardData === 'object'),
            hasDataLayer: Boolean(cardData?.data && typeof cardData.data === 'object'),
            willWriteChara: true,
            willWriteCcv3: Boolean(v3Base64)
        });
    }

    // 寻找插入点：在 IHDR 之后，或直接替换现有的 tEXt
    // 这里简化逻辑：我们重新构建文件，移除所有旧的同名 tEXt 块，并插入新的

    const chunks = [];
    let pos = 8;

    while (pos < uint8.length) {
        // 读取长度
        const len = (uint8[pos] << 24) | (uint8[pos + 1] << 16) | (uint8[pos + 2] << 8) | uint8[pos + 3];
        // 读取类型
        const type = bytesToStr(uint8.slice(pos + 4, pos + 8));

        // 完整块数据 (包含 Length, Type, Data, CRC)
        const chunkTotalLen = len + 12;
        const chunkData = uint8.slice(pos, pos + chunkTotalLen);

        // 检查是否需要移除的元数据块
        let keep = true;

        // 需要移除的关键字列表（与参考项目一致）
        const removeKeywords = ['chara', 'ccv3', 'description', 'score', 'comment'];

        if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
            const data = uint8.slice(pos + 8, pos + 8 + len);
            const keyword = getTextChunkKeyword(data);
            if (keyword && removeKeywords.includes(keyword)) {
                keep = false;
            }
        }

        // 移除 EXIF 数据
        if (type === 'eXIf') {
            keep = false;
        }

        if (keep) {
            chunks.push(chunkData);
        }

        // 如果是 IEND，结束
        if (type === 'IEND') break;

        pos += chunkTotalLen;
    }

    // 插入新块：通常在 IHDR 之后 (chunks[0] is IHDR)
    // 或者在 IEND 之前 (chunks[last] is IEND)
    // 为了兼容性，插在 IEND 之前
    chunks.splice(chunks.length - 1, 0, buildTextChunk('chara', charaBase64));
    if (v3Base64) {
        chunks.splice(chunks.length - 1, 0, buildTextChunk('ccv3', v3Base64));
    }

    if (debug) {
        console.log('[CharManager] [Translation] PNG 写入结果', {
            wroteChara: true,
            wroteCcv3: Boolean(v3Base64)
        });

        if (!v3Base64) {
            console.warn('[CharManager] [Translation] PNG 写入未补写 ccv3，已降级为仅写入 chara');
        }
    }

    // 合并所有块
    const totalSize = chunks.reduce((acc, c) => acc + c.length, 0) + 8; // + signature
    const finalPng = new Uint8Array(totalSize);

    finalPng.set(signature, 0);
    let offset = 8;
    for (const chunk of chunks) {
        finalPng.set(chunk, offset);
        offset += chunk.length;
    }

    return new Blob([finalPng], { type: 'image/png' });
}

/**
 * 兼容旧接口，内部转为角色卡专用写入流程
 * @param {ArrayBuffer} pngBuffer - 原始 PNG 数据
 * @param {string} key - 元数据关键字
 * @param {string} value - Base64 编码的角色卡 JSON
 * @returns {Blob} 新的 PNG Blob
 */
export function writePngText(pngBuffer, key, value) {
    const jsonStr = decodeURIComponent(escape(atob(value)));
    const cardData = JSON.parse(jsonStr);

    if (key !== 'chara' && key !== 'ccv3') {
        throw new Error(`Unsupported character card metadata key: ${key}`);
    }

    return writeCharacterCardPng(pngBuffer, cardData);
}
