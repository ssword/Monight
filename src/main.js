import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { open } from '@tauri-apps/plugin-dialog';
import { PDFViewer } from './scripts/pdf-viewer';
import { PRESETS, buildFilterCSS } from './scripts/filters';
import './styles/main.css';
import './styles/pdf-viewer.css';
// Global PDF viewer instance
let pdfViewer = null;
// Active filter preset
let activePreset = 'default';
// Detect if we're on macOS
const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
console.log('Platform:', navigator.platform, 'isMac:', isMac);
async function getAppInfo() {
    try {
        const name = 'Monight (墨页)';
        const version = '1.0.0';
        const tauriVersion = '2.0';
        return { name, version, tauriVersion };
    }
    catch (error) {
        console.error('Failed to get app info:', error);
        return { name: 'Monight', version: '1.0.0', tauriVersion: 'Unknown' };
    }
}
// Show splash screen
function showSplash() {
    const splash = document.getElementById('splash-container');
    const viewer = document.getElementById('viewer-container');
    if (splash)
        splash.classList.remove('hidden');
    if (viewer)
        viewer.classList.add('hidden');
}
// Show PDF viewer
function showViewer() {
    const splash = document.getElementById('splash-container');
    const viewer = document.getElementById('viewer-container');
    if (splash)
        splash.classList.add('hidden');
    if (viewer)
        viewer.classList.remove('hidden');
}
// Open PDF file dialog
async function openPDFFile() {
    console.log('openPDFFile() called');
    try {
        console.log('Opening file dialog...');
        const selected = await open({
            multiple: false,
            filters: [
                {
                    name: 'PDF',
                    extensions: ['pdf'],
                },
            ],
        });
        console.log('File dialog result:', selected);
        if (selected && typeof selected === 'string') {
            console.log('Selected file:', selected);
            await loadPDF(selected);
        }
        else {
            console.log('No file selected or invalid selection');
        }
    }
    catch (error) {
        console.error('Error opening file:', error);
        alert(`Failed to open file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
// Load PDF file
async function loadPDF(filePath) {
    try {
        // Read PDF file from Rust backend
        const pdfData = await invoke('read_pdf_file', { path: filePath });
        const fileName = await invoke('get_file_name', { path: filePath });
        // Convert to Uint8Array
        const uint8Array = new Uint8Array(pdfData);
        // Initialize viewer if needed
        if (!pdfViewer) {
            pdfViewer = new PDFViewer('pdf-container');
        }
        // Load PDF
        await pdfViewer.loadPDF(uint8Array, fileName, filePath);
        // Show viewer
        showViewer();
        // Apply default dark mode filter
        pdfViewer.applyFilter(buildFilterCSS(PRESETS.default));
        // Update UI
        updateUI();
    }
    catch (error) {
        console.error('Error loading PDF:', error);
        alert(`Failed to load PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
// Update UI based on viewer state
function updateUI() {
    if (!pdfViewer)
        return;
    const state = pdfViewer.getState();
    // Update page info
    const pageInput = document.getElementById('page-input');
    const pageCount = document.getElementById('page-count');
    if (pageInput) {
        pageInput.value = state.currentPage.toString();
        pageInput.max = state.totalPages.toString();
    }
    if (pageCount) {
        pageCount.textContent = state.totalPages.toString();
    }
    // Update zoom info
    const zoomInfo = document.getElementById('zoom-info');
    if (zoomInfo) {
        zoomInfo.textContent = `${Math.round(state.zoom * 100)}%`;
    }
    // Update file name
    const fileName = document.getElementById('file-name');
    if (fileName) {
        fileName.textContent = state.fileName || 'No file loaded';
    }
    // Update button states
    const prevBtn = document.getElementById('prev-page');
    const nextBtn = document.getElementById('next-page');
    if (prevBtn) {
        prevBtn.disabled = state.currentPage <= 1;
    }
    if (nextBtn) {
        nextBtn.disabled = state.currentPage >= state.totalPages;
    }
}
// Setup preset button handlers
function setupPresetButtons() {
    const buttons = document.querySelectorAll('.preset-btn');
    buttons.forEach((btn) => {
        btn.addEventListener('click', () => {
            // Extract preset name from button ID (e.g., 'preset-default' -> 'default')
            const presetName = btn.id.replace('preset-', '');
            // Get preset settings
            const settings = PRESETS[presetName];
            if (!settings) {
                console.error(`Unknown preset: ${presetName}`);
                return;
            }
            // Build CSS filter string
            const filterCSS = buildFilterCSS(settings);
            // Apply to PDF viewer
            if (pdfViewer) {
                pdfViewer.applyFilter(filterCSS);
            }
            // Update active button state
            buttons.forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            // Store active preset
            activePreset = presetName;
            console.log(`Applied preset: ${presetName}`);
        });
    });
}
// Setup event listeners
function setupEventListeners() {
    console.log('Setting up event listeners...');
    // Splash screen open button
    const splashOpenBtn = document.getElementById('splash-open-btn');
    if (splashOpenBtn) {
        splashOpenBtn.addEventListener('click', () => {
            console.log('Splash open button clicked');
            openPDFFile();
        });
        console.log('Splash open button listener attached');
    }
    else {
        console.error('Splash open button not found!');
    }
    // Open file button (in toolbar)
    const openBtn = document.getElementById('open-file');
    openBtn?.addEventListener('click', () => {
        console.log('Open button clicked');
        openPDFFile();
    });
    // Navigation buttons
    const prevBtn = document.getElementById('prev-page');
    const nextBtn = document.getElementById('next-page');
    prevBtn?.addEventListener('click', async () => {
        if (pdfViewer) {
            await pdfViewer.previousPage();
            updateUI();
        }
    });
    nextBtn?.addEventListener('click', async () => {
        if (pdfViewer) {
            await pdfViewer.nextPage();
            updateUI();
        }
    });
    // Page input
    const pageInput = document.getElementById('page-input');
    pageInput?.addEventListener('change', async () => {
        if (pdfViewer) {
            const pageNum = Number.parseInt(pageInput.value, 10);
            const state = pdfViewer.getState();
            if (pageNum >= 1 && pageNum <= state.totalPages) {
                await pdfViewer.goToPage(pageNum);
                updateUI();
            }
            else {
                pageInput.value = state.currentPage.toString();
            }
        }
    });
    // Zoom buttons
    const zoomInBtn = document.getElementById('zoom-in');
    const zoomOutBtn = document.getElementById('zoom-out');
    const fitWidthBtn = document.getElementById('fit-width');
    const fitPageBtn = document.getElementById('fit-page');
    zoomInBtn?.addEventListener('click', async () => {
        if (pdfViewer) {
            await pdfViewer.zoomIn();
            updateUI();
        }
    });
    zoomOutBtn?.addEventListener('click', async () => {
        if (pdfViewer) {
            await pdfViewer.zoomOut();
            updateUI();
        }
    });
    fitWidthBtn?.addEventListener('click', async () => {
        if (pdfViewer) {
            await pdfViewer.fitToWidth();
            updateUI();
        }
    });
    fitPageBtn?.addEventListener('click', async () => {
        if (pdfViewer) {
            await pdfViewer.fitToPage();
            updateUI();
        }
    });
    // Setup preset buttons
    setupPresetButtons();
    // Keyboard shortcuts - use both document and window to ensure capture
    const handleKeyDown = async (e) => {
        console.log('Key pressed:', e.key, 'Meta:', e.metaKey, 'Ctrl:', e.ctrlKey);
        // Use metaKey (Cmd) on Mac, ctrlKey on other platforms
        const modifierKey = isMac ? e.metaKey : e.ctrlKey;
        // Cmd/Ctrl+O: Open file
        if (modifierKey && e.key === 'o') {
            console.log('Cmd/Ctrl+O detected, opening file dialog...');
            e.preventDefault();
            e.stopPropagation();
            await openPDFFile();
            return;
        }
        // Only handle other shortcuts if PDF is loaded
        if (!pdfViewer)
            return;
        // Arrow keys: Navigate pages
        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            await pdfViewer.previousPage();
            updateUI();
        }
        else if (e.key === 'ArrowRight') {
            e.preventDefault();
            await pdfViewer.nextPage();
            updateUI();
        }
        // Cmd/Ctrl+Plus: Zoom in
        else if (modifierKey && (e.key === '+' || e.key === '=')) {
            e.preventDefault();
            await pdfViewer.zoomIn();
            updateUI();
        }
        // Cmd/Ctrl+Minus: Zoom out
        else if (modifierKey && e.key === '-') {
            e.preventDefault();
            await pdfViewer.zoomOut();
            updateUI();
        }
        // Cmd/Ctrl+0: Reset zoom
        else if (modifierKey && e.key === '0') {
            e.preventDefault();
            await pdfViewer.setZoom(1.0);
            updateUI();
        }
    };
    // Add to both document and window for maximum compatibility
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keydown', handleKeyDown);
    console.log('Keyboard event listeners attached');
}
// Update keyboard shortcut hints based on platform
function updateKeyboardHints() {
    const modKey = isMac ? 'Cmd' : 'Ctrl';
    // Update tooltips
    const openBtn = document.getElementById('open-file');
    if (openBtn)
        openBtn.title = `Open PDF (${modKey}+O)`;
    const zoomInBtn = document.getElementById('zoom-in');
    if (zoomInBtn)
        zoomInBtn.title = `Zoom In (${modKey}++)`;
    const zoomOutBtn = document.getElementById('zoom-out');
    if (zoomOutBtn)
        zoomOutBtn.title = `Zoom Out (${modKey}+-)`;
    // Update hint text
    const hintText = document.querySelector('.hint-text');
    if (hintText)
        hintText.textContent = `Press ${modKey}+O to open a PDF file`;
}
async function initializeApp() {
    try {
        console.log('Initializing app...');
        // Get app information
        const info = await getAppInfo();
        // Update version display
        const versionElement = document.getElementById('version-info');
        if (versionElement) {
            versionElement.textContent = `v${info.version} • Tauri ${info.tauriVersion}`;
        }
        // Setup event listeners
        setupEventListeners();
        // Update keyboard hints for platform
        updateKeyboardHints();
        // Show splash screen initially
        showSplash();
        // Get current window
        const currentWindow = getCurrentWebviewWindow();
        // Show window after initialization
        await currentWindow.show();
        await currentWindow.setFocus();
        console.log(`${info.name} initialized successfully!`);
    }
    catch (error) {
        console.error('Initialization error:', error);
    }
}
// Wait for DOM to be ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
}
else {
    initializeApp();
}
