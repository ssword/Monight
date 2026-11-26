// AppKit printing must run on the process main thread, which the standard Rust
// test harness reserves for itself.
#[cfg(target_os = "macos")]
#[allow(dead_code, unused_imports)]
#[path = "../src/pdf_print.rs"]
mod pdf_print;

#[cfg(not(target_os = "macos"))]
fn main() {}

#[cfg(target_os = "macos")]
fn main() {
    use objc2::{runtime::ProtocolObject, AnyThread, MainThreadMarker};
    use objc2_app_kit::{
        NSApplication, NSPaperOrientation, NSPrintInfo, NSPrintJobSavingURL, NSPrintSaveJob,
    };
    use objc2_foundation::{NSData, NSSize, NSString, NSStringCompareOptions, NSURL};
    use objc2_pdf_kit::{PDFDisplayBox, PDFDocument};

    let main_thread = MainThreadMarker::new().unwrap();
    let _app = NSApplication::sharedApplication(main_thread);
    let directory = tempfile::tempdir().unwrap();
    let output_path = directory.path().join("print.pdf");
    let output_url = NSURL::fileURLWithPath(&NSString::from_str(output_path.to_str().unwrap()));

    // SAFETY: This standalone test runs on the main thread and retains its
    // AppKit and PDFKit objects throughout the synchronous print operation.
    unsafe {
        let source = include_bytes!("fixtures/native-annotations/annotated.pdf");
        let document =
            PDFDocument::initWithData(PDFDocument::alloc(), &NSData::with_bytes(source)).unwrap();
        document.pageAtIndex(0).unwrap().setRotation(270);
        let bytes = document.dataRepresentation().unwrap().to_vec();

        let info = NSPrintInfo::new();
        info.setPaperSize(NSSize::new(595.28, 841.89));
        info.setOrientation(NSPaperOrientation::Portrait);
        info.setJobDisposition(NSPrintSaveJob);
        info.dictionary()
            .setObject_forKey(&output_url, ProtocolObject::from_ref(NSPrintJobSavingURL));
        pdf_print::run_print(&bytes, "Rotated page regression", &info, false, main_thread).unwrap();

        let printed = PDFDocument::initWithURL(PDFDocument::alloc(), &output_url)
            .expect("native PDF export failed");
        assert_eq!(printed.pageCount(), document.pageCount());
        let first_page = printed.pageAtIndex(0).unwrap();
        let paper = first_page.boundsForBox(PDFDisplayBox::CropBox);
        assert!(
            paper.size.height > paper.size.width,
            "expected portrait output"
        );
        for line in ["moon lower match", "moon first page"] {
            let bounds = printed
                .findString_withOptions(&NSString::from_str(line), NSStringCompareOptions::empty())
                .firstObject()
                .map(|selection| selection.boundsForPage(&first_page))
                .unwrap_or_default();
            assert!(
                bounds.size.height > bounds.size.width
                    && bounds.origin.x >= paper.origin.x
                    && bounds.origin.y >= paper.origin.y
                    && bounds.origin.x + bounds.size.width <= paper.origin.x + paper.size.width
                    && bounds.origin.y + bounds.size.height <= paper.origin.y + paper.size.height,
                "expected rotated line {line:?} inside the printed page, got {bounds:?}"
            );
        }
    }
}
