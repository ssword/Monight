import * as pdfjsLib from 'pdfjs-dist';
// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
export class PDFViewer {
    constructor(containerId, canvasId = 'pdf-canvas') {
        this.canvas = null;
        this.pdfDoc = null;
        this.state = {
            currentPage: 1,
            totalPages: 0,
            zoom: 1.0,
            rotation: 0,
            fileName: '',
            filePath: '',
        };
        this.renderTask = null;
        const container = document.getElementById(containerId);
        if (!container) {
            throw new Error(`Container element '${containerId}' not found`);
        }
        this.container = container;
        this.canvasId = canvasId;
        this.initializeCanvas();
    }
    initializeCanvas() {
        // Create canvas element for PDF rendering
        this.canvas = document.createElement('canvas');
        this.canvas.id = this.canvasId;
        this.container.appendChild(this.canvas);
    }
    async loadPDF(pdfData, fileName, filePath) {
        try {
            // Cancel any pending render
            if (this.renderTask) {
                this.renderTask.cancel();
            }
            // Load PDF document
            const loadingTask = pdfjsLib.getDocument({ data: pdfData });
            this.pdfDoc = await loadingTask.promise;
            // Update state
            this.state.totalPages = this.pdfDoc.numPages;
            this.state.currentPage = 1;
            this.state.fileName = fileName;
            this.state.filePath = filePath;
            // Render first page
            await this.renderPage(1);
            console.log(`Loaded PDF: ${fileName} (${this.state.totalPages} pages)`);
        }
        catch (error) {
            console.error('Error loading PDF:', error);
            throw new Error(`Failed to load PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    async renderPage(pageNum) {
        if (!this.pdfDoc || !this.canvas) {
            throw new Error('PDF not loaded');
        }
        if (pageNum < 1 || pageNum > this.state.totalPages) {
            throw new Error(`Invalid page number: ${pageNum}`);
        }
        try {
            // Cancel previous render task
            if (this.renderTask) {
                this.renderTask.cancel();
                this.renderTask = null;
            }
            // Get page
            const page = await this.pdfDoc.getPage(pageNum);
            // Calculate viewport with zoom and rotation
            const viewport = page.getViewport({
                scale: this.state.zoom,
                rotation: this.state.rotation,
            });
            // Set canvas dimensions
            const context = this.canvas.getContext('2d');
            if (!context) {
                throw new Error('Could not get canvas context');
            }
            this.canvas.width = viewport.width;
            this.canvas.height = viewport.height;
            // Render page
            this.renderTask = page.render({
                canvasContext: context,
                viewport: viewport,
            });
            await this.renderTask.promise;
            this.renderTask = null;
            // Update state
            this.state.currentPage = pageNum;
            console.log(`Rendered page ${pageNum}/${this.state.totalPages}`);
        }
        catch (error) {
            if (error &&
                typeof error === 'object' &&
                'name' in error &&
                error.name === 'RenderingCancelledException') {
                console.log('Rendering cancelled');
                return;
            }
            console.error('Error rendering page:', error);
            throw error;
        }
    }
    async nextPage() {
        if (this.state.currentPage < this.state.totalPages) {
            await this.renderPage(this.state.currentPage + 1);
        }
    }
    async previousPage() {
        if (this.state.currentPage > 1) {
            await this.renderPage(this.state.currentPage - 1);
        }
    }
    async goToPage(pageNum) {
        await this.renderPage(pageNum);
    }
    async firstPage() {
        await this.renderPage(1);
    }
    async lastPage() {
        if (this.pdfDoc) {
            await this.renderPage(this.state.totalPages);
        }
    }
    async rotateClockwise() {
        this.state.rotation = (this.state.rotation + 90) % 360;
        await this.renderPage(this.state.currentPage);
    }
    async rotateCounterClockwise() {
        this.state.rotation = (this.state.rotation - 90 + 360) % 360;
        await this.renderPage(this.state.currentPage);
    }
    async zoomIn() {
        this.state.zoom = Math.min(this.state.zoom + 0.25, 5.0);
        await this.renderPage(this.state.currentPage);
    }
    async zoomOut() {
        this.state.zoom = Math.max(this.state.zoom - 0.25, 0.25);
        await this.renderPage(this.state.currentPage);
    }
    async setZoom(zoom) {
        this.state.zoom = Math.max(0.25, Math.min(zoom, 5.0));
        await this.renderPage(this.state.currentPage);
    }
    async fitToWidth() {
        if (!this.pdfDoc || !this.canvas)
            return;
        const page = await this.pdfDoc.getPage(this.state.currentPage);
        const viewport = page.getViewport({ scale: 1.0 });
        const containerWidth = this.container.clientWidth - 40; // 20px padding each side
        this.state.zoom = containerWidth / viewport.width;
        await this.renderPage(this.state.currentPage);
    }
    async fitToPage() {
        if (!this.pdfDoc || !this.canvas)
            return;
        const page = await this.pdfDoc.getPage(this.state.currentPage);
        const viewport = page.getViewport({ scale: 1.0 });
        const containerWidth = this.container.clientWidth - 40;
        const containerHeight = this.container.clientHeight - 40;
        const widthScale = containerWidth / viewport.width;
        const heightScale = containerHeight / viewport.height;
        this.state.zoom = Math.min(widthScale, heightScale);
        await this.renderPage(this.state.currentPage);
    }
    applyFilter(filterCSS) {
        if (!this.canvas)
            return;
        this.canvas.style.filter = filterCSS;
    }
    getState() {
        return { ...this.state };
    }
    getCanvas() {
        return this.canvas;
    }
    getPdfDocument() {
        return this.pdfDoc;
    }
    async print() {
        if (!this.pdfDoc) {
            throw new Error('No PDF document loaded');
        }
        try {
            // Get the raw PDF data
            const pdfData = await this.pdfDoc.getData();
            // Create a Blob from the PDF data (convert to regular Uint8Array)
            const blob = new Blob([new Uint8Array(pdfData)], { type: 'application/pdf' });
            // Create a blob URL
            const blobUrl = URL.createObjectURL(blob);
            // Create a hidden iframe to load the PDF
            const iframe = document.createElement('iframe');
            iframe.style.position = 'fixed';
            iframe.style.top = '0';
            iframe.style.left = '0';
            iframe.style.width = '100%';
            iframe.style.height = '100%';
            iframe.style.border = 'none';
            iframe.style.visibility = 'hidden';
            iframe.src = blobUrl;
            document.body.appendChild(iframe);
            // Wait for iframe to load, then print
            iframe.onload = () => {
                try {
                    // Focus the iframe and trigger print
                    iframe.contentWindow?.focus();
                    iframe.contentWindow?.print();
                    // Clean up after a delay
                    setTimeout(() => {
                        document.body.removeChild(iframe);
                        URL.revokeObjectURL(blobUrl);
                    }, 1000);
                }
                catch (error) {
                    console.error('Error triggering print:', error);
                    document.body.removeChild(iframe);
                    URL.revokeObjectURL(blobUrl);
                    throw error;
                }
            };
            // Handle iframe load errors
            iframe.onerror = () => {
                document.body.removeChild(iframe);
                URL.revokeObjectURL(blobUrl);
                throw new Error('Failed to load PDF for printing');
            };
        }
        catch (error) {
            console.error('Error printing PDF:', error);
            throw error;
        }
    }
    destroy() {
        if (this.renderTask) {
            this.renderTask.cancel();
        }
        if (this.pdfDoc) {
            this.pdfDoc.destroy();
        }
        this.pdfDoc = null;
        this.canvas = null;
    }
}
