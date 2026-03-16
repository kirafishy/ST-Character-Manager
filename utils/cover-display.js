/**
 * 封面显示模式统一判定模块
 * 
 * 为列表页与详情页提供共用的封面显示判定逻辑，确保两个页面的封面展示策略一致。
 * 
 * @module utils/cover-display
 */

import { state } from '../state.js';

/**
 * 页面类型枚举
 * @typedef {'list' | 'detail'} PageType
 */

/**
 * 封面显示模式枚举
 * @typedef {'normal' | 'sfw' | 'no-image'} CoverMode
 */

/**
 * 封面显示结果类型
 * @typedef {'normal' | 'blur' | 'no-image'} DisplayResult
 */

/**
 * 封面判定结果对象
 * @typedef {Object} CoverDisplayResult
 * @property {boolean} isPolicyEnabled - 当前页面是否启用封面策略
 * @property {DisplayResult} displayMode - 最终显示模式（normal / blur / no-image）
 * @property {boolean} isNsfwHit - 是否命中 NSFW 标签
 * @property {Array<Object>} hitTags - 命中的 NSFW 标签对象列表
 */

/**
 * 合法的封面模式值
 * @constant {Array<CoverMode>}
 */
const VALID_MODES = ['normal', 'sfw', 'no-image'];

/**
 * 获取当前封面显示配置
 * 
 * @returns {Object} 封面显示配置对象
 */
export function getCoverDisplayConfig() {
    const config = state.settings?.coverDisplay;
    
    // 若配置不存在，返回默认配置
    if (!config || typeof config !== 'object') {
        return {
            mode: 'normal',
            nsfwTagIds: [],
            applyToListPage: false,
            applyToDetailPage: false,
        };
    }
    
    // 确保各字段存在且合法
    const mode = VALID_MODES.includes(config.mode) ? config.mode : 'normal';
    const nsfwTagIds = Array.isArray(config.nsfwTagIds) ? config.nsfwTagIds : [];
    const applyToListPage = typeof config.applyToListPage === 'boolean' ? config.applyToListPage : false;
    const applyToDetailPage = typeof config.applyToDetailPage === 'boolean' ? config.applyToDetailPage : false;
    
    return {
        mode,
        nsfwTagIds,
        applyToListPage,
        applyToDetailPage,
    };
}

/**
 * 检查当前页面是否启用封面策略
 * 
 * @param {PageType} pageType - 页面类型（'list' 或 'detail'）
 * @param {Object} [config] - 封面显示配置（可选，不传时自动读取）
 * @returns {boolean} 是否启用封面策略
 */
export function isCoverPolicyEnabled(pageType, config = null) {
    const cfg = config || getCoverDisplayConfig();
    
    if (pageType === 'list') {
        return cfg.applyToListPage === true;
    } else if (pageType === 'detail') {
        return cfg.applyToDetailPage === true;
    }
    
    // 未知页面类型，默认不启用
    return false;
}

/**
 * 检查角色是否命中 NSFW 标签
 * 
 * @param {Array<Object>} charTags - 角色的标签对象列表
 * @param {Array<string>} nsfwTagIds - NSFW 标签 ID 列表
 * @returns {{ isHit: boolean, hitTags: Array<Object> }} 命中结果与命中标签列表
 */
export function checkNsfwTagHit(charTags, nsfwTagIds) {
    if (!Array.isArray(charTags) || charTags.length === 0) {
        return { isHit: false, hitTags: [] };
    }
    
    if (!Array.isArray(nsfwTagIds) || nsfwTagIds.length === 0) {
        return { isHit: false, hitTags: [] };
    }
    
    // 找出角色标签中属于 NSFW 标签的标签
    const hitTags = charTags.filter(tag => 
        tag && tag.id && nsfwTagIds.includes(tag.id)
    );
    
    return {
        isHit: hitTags.length > 0,
        hitTags,
    };
}

/**
 * 统一封面显示模式判定函数
 * 
 * 这是核心判定入口，供列表页与详情页共同调用。
 * 根据页面类型、配置模式、角色标签等综合判定最终封面展示方式。
 * 
 * @param {Object} options - 判定参数
 * @param {PageType} options.pageType - 页面类型（'list' 为列表页，'detail' 为详情页）
 * @param {Array<Object>} [options.charTags] - 角色的标签对象列表（可选，SFW 模式需要）
 * @param {Object} [options.config] - 封面显示配置（可选，不传时自动读取 state.settings.coverDisplay）
 * @returns {CoverDisplayResult} 封面判定结果对象
 * 
 * @example
 * // 列表页调用
 * const result = resolveCoverDisplay({
 *     pageType: 'list',
 *     charTags: [{ id: 'tag-1', name: '成人' }],
 * });
 * 
 * if (result.displayMode === 'blur') {
 *     // 渲染模糊封面
 * }
 * 
 * @example
 * // 详情页调用
 * const result = resolveCoverDisplay({
 *     pageType: 'detail',
 *     charTags: getCharTags(fileName),
 * });
 */
export function resolveCoverDisplay({ pageType, charTags = [], config = null }) {
    // 获取配置
    const cfg = config || getCoverDisplayConfig();
    
    // 默认结果：未启用策略，正常显示
    const defaultResult = {
        isPolicyEnabled: false,
        displayMode: 'normal',
        isNsfwHit: false,
        hitTags: [],
    };
    
    // Step 1: 检查当前页面是否启用封面策略
    const isPolicyEnabled = isCoverPolicyEnabled(pageType, cfg);
    
    if (!isPolicyEnabled) {
        // 页面未启用策略，直接返回正常模式
        return defaultResult;
    }
    
    // Step 2: 根据模式值判定（非法值已在 getCoverDisplayConfig 中回退为 normal）
    const mode = cfg.mode;
    
    // 正常模式：直接返回正常显示
    if (mode === 'normal') {
        return {
            isPolicyEnabled: true,
            displayMode: 'normal',
            isNsfwHit: false,
            hitTags: [],
        };
    }
    
    // 无图模式：返回无图占位
    if (mode === 'no-image') {
        return {
            isPolicyEnabled: true,
            displayMode: 'no-image',
            isNsfwHit: false,
            hitTags: [],
        };
    }
    
    // SFW 模式：需要检查标签命中
    if (mode === 'sfw') {
        const { isHit, hitTags } = checkNsfwTagHit(charTags, cfg.nsfwTagIds);
        
        if (isHit) {
            // 命中 NSFW 标签，返回模糊模式
            return {
                isPolicyEnabled: true,
                displayMode: 'blur',
                isNsfwHit: true,
                hitTags,
            };
        } else {
            // 未命中 NSFW 标签，正常显示
            return {
                isPolicyEnabled: true,
                displayMode: 'normal',
                isNsfwHit: false,
                hitTags: [],
            };
        }
    }
    
    // 兜底：所有未匹配的情况返回正常模式
    return {
        isPolicyEnabled: true,
        displayMode: 'normal',
        isNsfwHit: false,
        hitTags: [],
    };
}

/**
 * 便捷方法：判定列表页封面显示
 * 
 * @param {Array<Object>} charTags - 角色的标签对象列表
 * @param {Object} [config] - 封面显示配置（可选）
 * @returns {CoverDisplayResult} 封面判定结果对象
 */
export function resolveListPageCoverDisplay(charTags, config = null) {
    return resolveCoverDisplay({
        pageType: 'list',
        charTags,
        config,
    });
}

/**
 * 便捷方法：判定详情页封面显示
 * 
 * @param {Array<Object>} charTags - 角色的标签对象列表
 * @param {Object} [config] - 封面显示配置（可选）
 * @returns {CoverDisplayResult} 封面判定结果对象
 */
export function resolveDetailPageCoverDisplay(charTags, config = null) {
    return resolveCoverDisplay({
        pageType: 'detail',
        charTags,
        config,
    });
}