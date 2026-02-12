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
 * 写入 PNG tEXt 块
 * @param {ArrayBuffer} pngBuffer - 原始 PNG 数据
 * @param {string} key - 关键字 (如 "chara")
 * @param {string} value - Base64 编码的数据
 * @returns {Blob} 新的 PNG Blob
 */
export function writePngText(pngBuffer, key, value) {
    const uint8 = new Uint8Array(pngBuffer);
    
    // 验证 PNG 签名
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    for (let i = 0; i < 8; i++) {
        if (uint8[i] !== signature[i]) throw new Error('Not a valid PNG file');
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
        
        // 检查是否是需要替换的 tEXt 块
        let keep = true;
        if (type === 'tEXt') {
            const data = uint8.slice(pos + 8, pos + 8 + len);
            // tEXt 格式: Keyword + null + Text
            let nullIndex = -1;
            for(let i=0; i<data.length; i++) {
                if(data[i] === 0) { nullIndex = i; break; }
            }
            if (nullIndex > 0) {
                const keyword = bytesToStr(data.slice(0, nullIndex));
                if (keyword === key) {
                    keep = false; // 移除旧的 chara 数据
                }
            }
        }
        
        if (keep) {
            chunks.push(chunkData);
        }
        
        // 如果是 IEND，结束
        if (type === 'IEND') break;
        
        pos += chunkTotalLen;
    }
    
    // 构建新的 tEXt 块
    // 格式: Length (4) + Type (4) + Keyword + Null (1) + Text + CRC (4)
    const keyBytes = strToBytes(key);
    const valBytes = strToBytes(value); // value is already base64 string
    const dataLen = keyBytes.length + 1 + valBytes.length;
    
    const newChunk = new Uint8Array(12 + dataLen);
    
    // Length
    newChunk.set(int32ToBytes(dataLen), 0);
    // Type
    newChunk.set(strToBytes('tEXt'), 4);
    // Data: Key
    newChunk.set(keyBytes, 8);
    // Data: Null separator
    newChunk[8 + keyBytes.length] = 0;
    // Data: Value
    newChunk.set(valBytes, 8 + keyBytes.length + 1);
    
    // Calculate CRC (Type + Data)
    const crcData = newChunk.slice(4, 4 + 4 + dataLen); // Type + Data
    const crcVal = crc32(crcData);
    newChunk.set(int32ToBytes(crcVal), 8 + dataLen);
    
    // 插入新块：通常在 IHDR 之后 (chunks[0] is IHDR)
    // 或者在 IEND 之前 (chunks[last] is IEND)
    // 为了兼容性，插在 IEND 之前
    chunks.splice(chunks.length - 1, 0, newChunk);
    
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