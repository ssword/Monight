import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { LogicalSize } from '@tauri-apps/api/window';
import { PRESETS, buildFilterCSS } from './scripts/filters';
import { SliderManager } from './scripts/sliders';
import { TabManager } from './scripts/tabs';
import { SettingsManager } from './scripts/settings';
import { KeybindManager } from './scripts/keybind-manager';
import './styles/main.css';
import './styles/pdf-viewer.css';
import './styles/configurator.css';
import './styles/tabs.css';
import 'nouislider/dist/nouislider.css';
// Global tab manager instance
let tabManager = null;
// Global slider manager instance
let sliderManager = null;
// Global settings manager instance
let settingsManager = null;
// Global keybind manager instance
let keybindManager = null;
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
            multiple: true, // Enable multi-select
            filters: [
                {
                    name: 'PDF',
                    extensions: ['pdf'],
                },
            ],
        });
        console.log('File dialog result:', selected);
        if (!selected) {
            console.log('No file selected');
            return;
        }
        // Handle single or multiple files
        const files = Array.isArray(selected) ? selected : [selected];
        for (const filePath of files) {
            // Check if already open
            if (tabManager?.isFileOpen(filePath)) {
                console.log(`File already open: ${filePath}`);
                continue;
            }
            // Load PDF data
            const pdfData = await invoke('read_pdf_file', { path: filePath });
            const fileName = await invoke('get_file_name', { path: filePath });
            // Create tab (TabManager handles viewer creation)
            await tabManager?.createTab(filePath, fileName, new Uint8Array(pdfData));
            console.log(`Opened PDF: ${fileName}`);
        }
        // Update tab bar visibility
        updateTabBarVisibility();
        // Update print menu state (enable after first PDF loaded)
        await updatePrintMenuState();
        // Ensure window is at minimum comfortable viewing size
        await ensureMinimumViewingSize();
    }
    catch (error) {
        console.error('Error opening file:', error);
        alert(`Failed to open file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
// Update tab bar visibility
function updateTabBarVisibility() {
    const tabBar = document.getElementById('tab-bar');
    if (!tabBar)
        return;
    const hasTab = (tabManager?.size ?? 0) > 0;
    if (hasTab) {
        tabBar.classList.remove('hidden');
    }
    else {
        tabBar.classList.add('hidden');
    }
}
// Update print menu state based on whether a PDF is loaded
async function updatePrintMenuState() {
    const hasPDF = (tabManager?.size ?? 0) > 0;
    try {
        await invoke('set_print_enabled', { enabled: hasPDF });
        console.log(`Print menu ${hasPDF ? 'enabled' : 'disabled'}`);
    }
    catch (error) {
        console.error('Failed to update print menu state:', error);
    }
}
// Ensure window is at minimum comfortable viewing size for PDFs
async function ensureMinimumViewingSize() {
    const currentWindow = getCurrentWebviewWindow();
    const size = await currentWindow.innerSize();
    const minWidth = 1000;
    const minHeight = 650;
    // Only resize if window is smaller than minimum
    if (size.width < minWidth || size.height < minHeight) {
        // Calculate new size, maintaining aspect ratio if needed
        const newWidth = Math.max(size.width, minWidth);
        const newHeight = Math.max(size.height, minHeight);
        await currentWindow.setSize(new LogicalSize(newWidth, newHeight));
        await currentWindow.center();
        console.log(`Window resized to ${newWidth}x${newHeight}`);
    }
}
// Restore tab state (filters, page, zoom)
async function restoreTabState(tab) {
    const viewer = tabManager?.getViewerForTab(tab.id);
    if (!viewer)
        return;
    // Apply saved filter
    viewer.applyFilter(buildFilterCSS(tab.filterSettings));
    // Restore page and zoom
    await viewer.goToPage(tab.currentPage);
    await viewer.setZoom(tab.zoom);
    // Update slider if initialized
    if (sliderManager?.isInitialized()) {
        sliderManager.setPreset(tab.filterSettings);
    }
    // Update preset button active state
    updateActivePresetButton(tab.filterSettings);
}
// Save current tab state
function saveCurrentTabState() {
    const activeTab = tabManager?.getActiveTab();
    if (!activeTab)
        return;
    const viewer = tabManager?.getViewerForTab(activeTab.id);
    if (!viewer)
        return;
    const state = viewer.getState();
    // Save state to tab
    activeTab.currentPage = state.currentPage;
    activeTab.zoom = state.zoom;
    // Save current filter if sliders initialized
    if (sliderManager?.isInitialized()) {
        activeTab.filterSettings = sliderManager.getCurrentSettings();
    }
}
// Update active preset button based on settings
function updateActivePresetButton(settings) {
    const buttons = document.querySelectorAll('.preset-btn');
    // Check if settings match any preset
    let matchedPreset = null;
    for (const [presetName, presetSettings] of Object.entries(PRESETS)) {
        if (JSON.stringify(presetSettings) === JSON.stringify(settings)) {
            matchedPreset = presetName;
            break;
        }
    }
    // Update button states
    buttons.forEach((btn) => {
        const presetName = btn.id.replace('preset-', '');
        if (presetName === matchedPreset) {
            btn.classList.add('active');
        }
        else {
            btn.classList.remove('active');
        }
    });
}
// Update UI based on viewer state
function updateUI() {
    const activeTab = tabManager?.getActiveTab();
    if (!activeTab)
        return;
    const viewer = tabManager?.getViewerForTab(activeTab.id);
    if (!viewer)
        return;
    const state = viewer.getState();
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
        fileName.textContent = activeTab.title || 'No file loaded';
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
// Toggle dark mode configurator panel
function toggleDarkConfigurator() {
    const panel = document.getElementById('darkConfigurator');
    if (!panel)
        return;
    const isHidden = panel.classList.contains('hidden');
    if (isHidden) {
        panel.classList.remove('hidden');
        // Initialize sliders on first open
        if (sliderManager && !sliderManager.isInitialized()) {
            sliderManager.initialize();
        }
    }
    else {
        panel.classList.add('hidden');
    }
}
// Setup preset button handlers
function setupPresetButtons() {
    const buttons = document.querySelectorAll('.preset-btn');
    buttons.forEach((btn) => {
        btn.addEventListener('click', () => {
            // Extract preset name from button ID (e.g., 'preset-default' -> 'default')
            const presetName = btn.id.replace('preset-', '');
            // Handle custom button - toggle panel
            if (presetName === 'custom') {
                toggleDarkConfigurator();
                // Update active button state
                buttons.forEach((b) => b.classList.remove('active'));
                btn.classList.add('active');
                return;
            }
            // Get preset settings
            const settings = PRESETS[presetName];
            if (!settings) {
                console.error(`Unknown preset: ${presetName}`);
                return;
            }
            // Build CSS filter string
            const filterCSS = buildFilterCSS(settings);
            // Apply to active tab's PDF viewer
            const activeTab = tabManager?.getActiveTab();
            if (activeTab) {
                const viewer = tabManager?.getViewerForTab(activeTab.id);
                if (viewer) {
                    viewer.applyFilter(filterCSS);
                    // Save filter to tab state
                    activeTab.filterSettings = settings;
                }
            }
            // Update slider positions if initialized
            if (sliderManager?.isInitialized()) {
                sliderManager.setPreset(settings);
            }
            // Update active button state
            buttons.forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
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
    // Print button
    const printBtn = document.getElementById('print-file');
    printBtn?.addEventListener('click', () => {
        console.log('Print button clicked');
        printCurrentPDF();
    });
    // Navigation buttons
    const prevBtn = document.getElementById('prev-page');
    const nextBtn = document.getElementById('next-page');
    prevBtn?.addEventListener('click', async () => {
        const activeTab = tabManager?.getActiveTab();
        if (activeTab) {
            const viewer = tabManager?.getViewerForTab(activeTab.id);
            if (viewer) {
                await viewer.previousPage();
                saveCurrentTabState();
                updateUI();
            }
        }
    });
    nextBtn?.addEventListener('click', async () => {
        const activeTab = tabManager?.getActiveTab();
        if (activeTab) {
            const viewer = tabManager?.getViewerForTab(activeTab.id);
            if (viewer) {
                await viewer.nextPage();
                saveCurrentTabState();
                updateUI();
            }
        }
    });
    // Page input
    const pageInput = document.getElementById('page-input');
    pageInput?.addEventListener('change', async () => {
        const activeTab = tabManager?.getActiveTab();
        if (activeTab) {
            const viewer = tabManager?.getViewerForTab(activeTab.id);
            if (viewer) {
                const pageNum = Number.parseInt(pageInput.value, 10);
                const state = viewer.getState();
                if (pageNum >= 1 && pageNum <= state.totalPages) {
                    await viewer.goToPage(pageNum);
                    saveCurrentTabState();
                    updateUI();
                }
                else {
                    pageInput.value = state.currentPage.toString();
                }
            }
        }
    });
    // Zoom buttons
    const zoomInBtn = document.getElementById('zoom-in');
    const zoomOutBtn = document.getElementById('zoom-out');
    const fitWidthBtn = document.getElementById('fit-width');
    const fitPageBtn = document.getElementById('fit-page');
    zoomInBtn?.addEventListener('click', async () => {
        const activeTab = tabManager?.getActiveTab();
        if (activeTab) {
            const viewer = tabManager?.getViewerForTab(activeTab.id);
            if (viewer) {
                await viewer.zoomIn();
                saveCurrentTabState();
                updateUI();
            }
        }
    });
    zoomOutBtn?.addEventListener('click', async () => {
        const activeTab = tabManager?.getActiveTab();
        if (activeTab) {
            const viewer = tabManager?.getViewerForTab(activeTab.id);
            if (viewer) {
                await viewer.zoomOut();
                saveCurrentTabState();
                updateUI();
            }
        }
    });
    fitWidthBtn?.addEventListener('click', async () => {
        const activeTab = tabManager?.getActiveTab();
        if (activeTab) {
            const viewer = tabManager?.getViewerForTab(activeTab.id);
            if (viewer) {
                await viewer.fitToWidth();
                saveCurrentTabState();
                updateUI();
            }
        }
    });
    fitPageBtn?.addEventListener('click', async () => {
        const activeTab = tabManager?.getActiveTab();
        if (activeTab) {
            const viewer = tabManager?.getViewerForTab(activeTab.id);
            if (viewer) {
                await viewer.fitToPage();
                saveCurrentTabState();
                updateUI();
            }
        }
    });
    // Setup preset buttons
    setupPresetButtons();
    // New tab button
    const newTabBtn = document.getElementById('new-tab-btn');
    newTabBtn?.addEventListener('click', () => {
        openPDFFile();
    });
    // Close configurator button
    const closeConfigBtn = document.getElementById('close-configurator');
    closeConfigBtn?.addEventListener('click', () => {
        toggleDarkConfigurator();
    });
    // Keyboard shortcuts - use KeybindManager for dynamic keybind handling
    const handleKeyDown = async (e) => {
        if (!keybindManager)
            return;
        const actionId = keybindManager.matchEvent(e);
        if (actionId) {
            console.log(`Keybind matched: ${actionId}`);
            e.preventDefault();
            e.stopPropagation();
            await keybindManager.handleEvent(e);
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
    const printBtn = document.getElementById('print-file');
    if (printBtn)
        printBtn.title = `Print (${modKey}+P)`;
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
// Print current PDF
async function printCurrentPDF() {
    const activeTab = tabManager?.getActiveTab();
    if (!activeTab) {
        alert('No PDF is currently open.');
        return;
    }
    const viewer = tabManager?.getViewerForTab(activeTab.id);
    if (!viewer) {
        alert('PDF viewer not available.');
        return;
    }
    try {
        await viewer.print();
    }
    catch (error) {
        console.error('Print error:', error);
        alert(`Failed to print: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
// Open settings window
async function openSettings() {
    try {
        await invoke('open_settings');
    }
    catch (error) {
        console.error('Error opening settings:', error);
        alert(`Failed to open settings: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
// Register all keybind actions with the KeybindManager
function registerKeybindActions() {
    if (!keybindManager) {
        console.error('KeybindManager not initialized');
        return;
    }
    // File operations
    keybindManager.registerAction('openFile', async (_e) => {
        await openPDFFile();
    });
    keybindManager.registerAction('print', async (_e) => {
        await printCurrentPDF();
    });
    keybindManager.registerAction('openSettings', async (_e) => {
        await openSettings();
    });
    // Tab management
    keybindManager.registerAction('closeTab', async (_e) => {
        const activeTab = tabManager?.getActiveTab();
        if (activeTab) {
            await tabManager?.closeTab(activeTab.id);
            updateTabBarVisibility();
        }
    });
    keybindManager.registerAction('reopenTab', async (_e) => {
        const filePath = await tabManager?.reopenLastClosed();
        if (filePath) {
            // Load and open the file
            try {
                const pdfData = await invoke('read_pdf_file', { path: filePath });
                const fileName = await invoke('get_file_name', { path: filePath });
                await tabManager?.createTab(filePath, fileName, new Uint8Array(pdfData));
                updateTabBarVisibility();
            }
            catch (error) {
                console.error('Error reopening tab:', error);
            }
        }
    });
    keybindManager.registerAction('nextTab', async (_e) => {
        await tabManager?.switchToNext();
    });
    keybindManager.registerAction('previousTab', async (_e) => {
        await tabManager?.switchToPrevious();
    });
    keybindManager.registerAction('switchToTab', async (_e, data) => {
        const position = data ? parseInt(data) : 1;
        await tabManager?.switchToPosition(position);
    });
    // PDF navigation (requires active tab)
    keybindManager.registerAction('nextPage', async (_e) => {
        const activeTab = tabManager?.getActiveTab();
        if (activeTab) {
            const viewer = tabManager?.getViewerForTab(activeTab.id);
            if (viewer) {
                await viewer.nextPage();
                saveCurrentTabState();
                updateUI();
            }
        }
    });
    keybindManager.registerAction('previousPage', async (_e) => {
        const activeTab = tabManager?.getActiveTab();
        if (activeTab) {
            const viewer = tabManager?.getViewerForTab(activeTab.id);
            if (viewer) {
                await viewer.previousPage();
                saveCurrentTabState();
                updateUI();
            }
        }
    });
    keybindManager.registerAction('firstPage', async (_e) => {
        const activeTab = tabManager?.getActiveTab();
        if (activeTab) {
            const viewer = tabManager?.getViewerForTab(activeTab.id);
            if (viewer) {
                await viewer.firstPage();
                saveCurrentTabState();
                updateUI();
            }
        }
    });
    keybindManager.registerAction('lastPage', async (_e) => {
        const activeTab = tabManager?.getActiveTab();
        if (activeTab) {
            const viewer = tabManager?.getViewerForTab(activeTab.id);
            if (viewer) {
                await viewer.lastPage();
                saveCurrentTabState();
                updateUI();
            }
        }
    });
    // Zoom
    keybindManager.registerAction('zoomIn', async (_e) => {
        const activeTab = tabManager?.getActiveTab();
        if (activeTab) {
            const viewer = tabManager?.getViewerForTab(activeTab.id);
            if (viewer) {
                await viewer.zoomIn();
                saveCurrentTabState();
                updateUI();
            }
        }
    });
    keybindManager.registerAction('zoomOut', async (_e) => {
        const activeTab = tabManager?.getActiveTab();
        if (activeTab) {
            const viewer = tabManager?.getViewerForTab(activeTab.id);
            if (viewer) {
                await viewer.zoomOut();
                saveCurrentTabState();
                updateUI();
            }
        }
    });
    keybindManager.registerAction('resetZoom', async (_e) => {
        const activeTab = tabManager?.getActiveTab();
        if (activeTab) {
            const viewer = tabManager?.getViewerForTab(activeTab.id);
            if (viewer) {
                await viewer.setZoom(1.0);
                saveCurrentTabState();
                updateUI();
            }
        }
    });
    // Fit modes
    keybindManager.registerAction('fitToWidth', async (_e) => {
        const activeTab = tabManager?.getActiveTab();
        if (activeTab) {
            const viewer = tabManager?.getViewerForTab(activeTab.id);
            if (viewer) {
                await viewer.fitToWidth();
                saveCurrentTabState();
                updateUI();
            }
        }
    });
    keybindManager.registerAction('fitToPage', async (_e) => {
        const activeTab = tabManager?.getActiveTab();
        if (activeTab) {
            const viewer = tabManager?.getViewerForTab(activeTab.id);
            if (viewer) {
                await viewer.fitToPage();
                saveCurrentTabState();
                updateUI();
            }
        }
    });
    // Rotation
    keybindManager.registerAction('rotateRight', async (_e) => {
        const activeTab = tabManager?.getActiveTab();
        if (activeTab) {
            const viewer = tabManager?.getViewerForTab(activeTab.id);
            if (viewer) {
                await viewer.rotateClockwise();
                saveCurrentTabState();
                updateUI();
            }
        }
    });
    keybindManager.registerAction('rotateLeft', async (_e) => {
        const activeTab = tabManager?.getActiveTab();
        if (activeTab) {
            const viewer = tabManager?.getViewerForTab(activeTab.id);
            if (viewer) {
                await viewer.rotateCounterClockwise();
                saveCurrentTabState();
                updateUI();
            }
        }
    });
    // Fullscreen
    keybindManager.registerAction('toggleFullscreen', async (_e) => {
        const currentWindow = getCurrentWebviewWindow();
        const isFullscreen = await currentWindow.isFullscreen();
        await currentWindow.setFullscreen(!isFullscreen);
    });
    console.log('All keybind actions registered');
}
async function initializeApp() {
    try {
        console.log('Initializing app...');
        // Initialize settings manager
        settingsManager = new SettingsManager();
        const settings = await settingsManager.load();
        console.log('Settings loaded:', settings);
        // Initialize keybind manager
        keybindManager = new KeybindManager(isMac);
        // Register all action handlers
        registerKeybindActions();
        // Load keybinds from settings
        // Override Settings keybind for macOS with Cmd+,
        if (isMac && settings.keybinds.Settings) {
            settings.keybinds.Settings.binds = ['Cmd+,'];
        }
        keybindManager.loadFromSettings(settings);
        console.log('KeybindManager initialized with settings keybinds');
        // Get app information
        const info = await getAppInfo();
        // Update version display
        const versionElement = document.getElementById('version-info');
        if (versionElement) {
            versionElement.textContent = `v${info.version} • Tauri ${info.tauriVersion}`;
        }
        // Initialize tab manager
        tabManager = new TabManager(async (tab) => {
            if (tab) {
                // Tab activated - restore its state
                await restoreTabState(tab);
                updateUI();
                showViewer();
            }
            else {
                // No tabs - show splash
                showSplash();
            }
            updateTabBarVisibility();
            // Update print menu state
            await updatePrintMenuState();
        });
        // Initialize slider manager
        sliderManager = new SliderManager((settings) => {
            const activeTab = tabManager?.getActiveTab();
            if (activeTab) {
                const viewer = tabManager?.getViewerForTab(activeTab.id);
                if (viewer) {
                    const filterCSS = buildFilterCSS(settings);
                    viewer.applyFilter(filterCSS);
                    // Save filter to tab state
                    activeTab.filterSettings = settings;
                }
            }
        });
        // Setup event listeners
        setupEventListeners();
        // Update keyboard hints for platform
        updateKeyboardHints();
        // Listen for file drop events
        await listen('tauri://file-drop', async (event) => {
            console.log('File drop detected:', event.payload);
            const pdfFiles = event.payload.filter((f) => f.toLowerCase().endsWith('.pdf'));
            if (pdfFiles.length === 0) {
                alert('Please drop PDF files only.');
                return;
            }
            // Process each PDF file
            for (const filePath of pdfFiles) {
                try {
                    // Check if already open
                    if (tabManager?.isFileOpen(filePath)) {
                        console.log(`File already open: ${filePath}`);
                        continue;
                    }
                    // Load PDF data using existing backend commands
                    const pdfData = await invoke('read_pdf_file', {
                        path: filePath,
                    });
                    const fileName = await invoke('get_file_name', {
                        path: filePath,
                    });
                    // Create tab using existing TabManager
                    await tabManager?.createTab(filePath, fileName, new Uint8Array(pdfData));
                    console.log(`Opened dropped PDF: ${fileName}`);
                }
                catch (error) {
                    console.error(`Error opening dropped file ${filePath}:`, error);
                    alert(`Failed to open ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }
            // Update UI
            updateTabBarVisibility();
            // Update print menu state
            await updatePrintMenuState();
            // Ensure window is at minimum comfortable viewing size
            await ensureMinimumViewingSize();
        });
        // Visual feedback for drag operations
        await listen('tauri://file-drop-hover', async () => {
            document.body.classList.add('drag-over');
        });
        await listen('tauri://file-drop-cancelled', async () => {
            document.body.classList.remove('drag-over');
        });
        // Listen for CLI file open events
        await listen('cli-open-files', async (event) => {
            console.log('CLI open files event:', event.payload);
            const { files, page } = event.payload;
            try {
                // Open each file
                for (const filePath of files) {
                    // Check if already open
                    if (tabManager?.isFileOpen(filePath)) {
                        console.log(`File already open: ${filePath}`);
                        continue;
                    }
                    // Load PDF data
                    const pdfData = await invoke('read_pdf_file', {
                        path: filePath,
                    });
                    const fileName = await invoke('get_file_name', {
                        path: filePath,
                    });
                    // Create tab
                    await tabManager?.createTab(filePath, fileName, new Uint8Array(pdfData));
                    console.log(`Opened CLI PDF: ${fileName}`);
                }
                // Navigate to specific page if provided (applies to first/active tab)
                if (page && page > 0) {
                    const activeTab = tabManager?.getActiveTab();
                    if (activeTab) {
                        const viewer = tabManager?.getViewerForTab(activeTab.id);
                        if (viewer) {
                            await viewer.goToPage(page);
                            updateUI();
                            console.log(`Navigated to page ${page}`);
                        }
                    }
                }
                // Update UI
                updateTabBarVisibility();
                // Update print menu state
                await updatePrintMenuState();
                // Ensure window is at minimum comfortable viewing size
                await ensureMinimumViewingSize();
            }
            catch (error) {
                console.error('Error opening CLI files:', error);
                alert(`Failed to open files: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        });
        // Listen for menu events
        await listen('menu-open', async () => {
            console.log('Menu open event received');
            await openPDFFile();
        });
        await listen('menu-print', async () => {
            console.log('Menu print event received');
            await printCurrentPDF();
        });
        await listen('menu-zoom-in', async () => {
            const activeTab = tabManager?.getActiveTab();
            if (activeTab) {
                const viewer = tabManager?.getViewerForTab(activeTab.id);
                if (viewer) {
                    await viewer.zoomIn();
                    saveCurrentTabState();
                    updateUI();
                }
            }
        });
        await listen('menu-zoom-out', async () => {
            const activeTab = tabManager?.getActiveTab();
            if (activeTab) {
                const viewer = tabManager?.getViewerForTab(activeTab.id);
                if (viewer) {
                    await viewer.zoomOut();
                    saveCurrentTabState();
                    updateUI();
                }
            }
        });
        await listen('menu-reset-zoom', async () => {
            const activeTab = tabManager?.getActiveTab();
            if (activeTab) {
                const viewer = tabManager?.getViewerForTab(activeTab.id);
                if (viewer) {
                    await viewer.setZoom(1.0);
                    saveCurrentTabState();
                    updateUI();
                }
            }
        });
        await listen('menu-toggle-fullscreen', async () => {
            console.log('Menu toggle fullscreen event received');
            const currentWindow = getCurrentWebviewWindow();
            const isFullscreen = await currentWindow.isFullscreen();
            await currentWindow.setFullscreen(!isFullscreen);
            console.log(`Fullscreen ${!isFullscreen ? 'enabled' : 'disabled'}`);
        });
        await listen('menu-close-tab', async () => {
            console.log('Menu close tab event received');
            const activeTab = tabManager?.getActiveTab();
            if (activeTab) {
                await tabManager?.closeTab(activeTab.id);
                updateTabBarVisibility();
            }
        });
        // Listen for keybinds changed event from settings window
        await listen('keybinds-changed', async () => {
            console.log('Keybinds changed event received, reloading keybinds...');
            if (settingsManager && keybindManager) {
                const settings = await settingsManager.load();
                // Override Settings keybind for macOS with Cmd+,
                if (isMac && settings.keybinds.Settings) {
                    settings.keybinds.Settings.binds = ['Cmd+,'];
                }
                keybindManager.loadFromSettings(settings);
                console.log('Keybinds reloaded successfully');
            }
        });
        // Show splash screen initially
        showSplash();
        // Get current window
        const currentWindow = getCurrentWebviewWindow();
        // Maximize on open if setting is enabled
        if (settingsManager) {
            const settings = await settingsManager.load();
            if (settings.general.maximizeOnOpen) {
                await currentWindow.maximize();
                console.log('Window maximized on startup');
            }
        }
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
