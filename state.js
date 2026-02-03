import { COLORS } from './constants.js';

const savedTheme = localStorage.getItem('cm_theme_mode');
const initialDarkMode = savedTheme === null ? true : (savedTheme === 'dark');
const savedZoom = localStorage.getItem('cm_zoom_level');
const initialZoom = savedZoom ? parseInt(savedZoom) : 160;

let defaultSidebarWidth = 160;
try {
    if (window.innerWidth < 600) defaultSidebarWidth = 120;
} catch (e) { }
const savedSidebarWidth = parseInt(localStorage.getItem('cm_sidebar_width')) || defaultSidebarWidth;

export const state = {
    characters: (() => { try { return JSON.parse(localStorage.getItem('cm_char_cache') || '[]'); } catch (e) { return []; } })(),
    duplicateGroups: [],
    selectedCards: new Set(),
    isScanning: false,
    currentView: 'all',
    currentTag: null,
    tags: [],
    tagMap: {},
    currentDetailChar: null,
    searchQuery: '',
    tagSearchQuery: '',
    tagBatchMode: false,
    isSidebarVisible: true,
    sortBy: 'date',
    sortOrder: 'desc',
    isDarkMode: initialDarkMode,
    zoomLevel: initialZoom,
    lastSelectedIndex: -1,
    isTouchSelecting: false,
    tagSortMode: 'name',
    sidebarWidth: savedSidebarWidth,
    randomMode: localStorage.getItem('cm_random_mode') || 'all',

    // --- Infinite Scroll State ---
    filteredList: [],
    renderedCount: 0,
    BATCH_SIZE: 100,
    observer: null
};

export const DEFAULT_TAG_COLOR = COLORS.find(c => c.name === '灰色').value;

export function getInitialZoom() { return initialZoom; }
export function getSavedSidebarWidth() { return savedSidebarWidth; }
