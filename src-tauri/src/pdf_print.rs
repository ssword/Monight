//! Print the prepared in-memory PDF, rather than the reader's filtered webview.
//! WKWebView's JavaScript iframe print call does not open a macOS print panel.

use objc2::{rc::Retained, AnyThread, MainThreadMarker};
use objc2_app_kit::NSPrintInfo;
use objc2_foundation::{NSData, NSString};
use objc2_pdf_kit::{PDFDocument, PDFPrintScalingMode};

/// Must run on the application main thread. No source or temporary file is written.
pub fn print(bytes: &[u8], title: &str) -> Result<(), String> {
    let main_thread = MainThreadMarker::new().ok_or("PDF printing requires the main thread")?;
    // SAFETY: called on Tauri's main thread; NSData copies the supplied bytes and
    // all retained PDFKit/AppKit objects outlive the synchronous print operation.
    unsafe {
        let document = prepare_document(bytes)?;
        let operation = document
            .printOperationForPrintInfo_scalingMode_autoRotate(
                Some(&NSPrintInfo::sharedPrintInfo()),
                PDFPrintScalingMode::PageScaleNone,
                false,
                main_thread,
            )
            .ok_or("Unable to create the native PDF print operation")?;
        operation.setJobTitle(Some(&NSString::from_str(title)));
        operation.setShowsPrintPanel(true);
        operation.setShowsProgressPanel(true);
        // A cancelled panel is a normal outcome. Neither completion nor cancellation
        // changes the source Document or acknowledges its unsaved edits.
        operation.runOperation();
        Ok(())
    }
}

fn prepare_document(bytes: &[u8]) -> Result<Retained<PDFDocument>, String> {
    // SAFETY: NSData owns its copy and each PDFKit object remains confined to
    // this thread. This separate document is never serialized over the source.
    unsafe {
        let data = NSData::with_bytes(bytes);
        let document = PDFDocument::initWithData(PDFDocument::alloc(), &data)
            .ok_or("Unable to open the prepared PDF for printing")?;
        if document.isLocked() || !document.allowsPrinting() {
            return Err("Document permissions prohibit printing".into());
        }
        if document.pageCount() == 0 {
            return Err("The prepared PDF has no pages to print".into());
        }
        for index in 0..document.pageCount() {
            let page = document
                .pageAtIndex(index)
                .ok_or("Unable to read a print page")?;
            for annotation in page.annotations() {
                // Include the live supported markup even when an imported
                // Highlight lacks the PDF Print flag. Keep hidden objects hidden
                // and leave unsupported annotation print behavior unchanged.
                let subtype = annotation.r#type().map(|value| value.to_string());
                if annotation.shouldDisplay()
                    && matches!(subtype.as_deref(), Some("Highlight" | "Text"))
                {
                    annotation.setShouldPrint(true);
                }
            }
        }
        Ok(document)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn visible_markup_prints_without_altering_input_or_exposing_hidden_markup() {
        // Exercise the actual PDFKit flag behavior, not a mock print operation.
        unsafe {
            let original = include_bytes!("../tests/fixtures/native-annotations/annotated.pdf");
            let document =
                PDFDocument::initWithData(PDFDocument::alloc(), &NSData::with_bytes(original))
                    .unwrap();
            let page = document.pageAtIndex(0).unwrap();
            let annotations = page.annotations();
            let highlight = annotations
                .iter()
                .find(|annotation| {
                    annotation
                        .r#type()
                        .is_some_and(|value| value.to_string() == "Highlight")
                })
                .unwrap();
            highlight.setShouldPrint(false);
            let bytes = document.dataRepresentation().unwrap().to_vec();
            let before = bytes.clone();
            let prepared = prepare_document(&bytes).unwrap();
            let prepared_page = prepared.pageAtIndex(0).unwrap();
            let prepared_annotations = prepared_page.annotations();
            let printed = prepared_annotations
                .iter()
                .find(|annotation| {
                    annotation
                        .r#type()
                        .is_some_and(|value| value.to_string() == "Highlight")
                })
                .unwrap();
            assert!(printed.shouldPrint());
            assert_eq!(bytes, before);
            assert!(!highlight.shouldPrint());
            highlight.setShouldDisplay(false);
            let hidden_bytes = document.dataRepresentation().unwrap().to_vec();
            let hidden = prepare_document(&hidden_bytes).unwrap();
            let hidden_page = hidden.pageAtIndex(0).unwrap();
            let hidden_annotations = hidden_page.annotations();
            let hidden_highlight = hidden_annotations
                .iter()
                .find(|annotation| {
                    annotation
                        .r#type()
                        .is_some_and(|value| value.to_string() == "Highlight")
                })
                .unwrap();
            assert!(!hidden_highlight.shouldDisplay());
            assert!(!hidden_highlight.shouldPrint());
        }
    }

    #[test]
    fn invalid_or_locked_pdf_is_rejected_without_opening_a_print_panel() {
        assert!(prepare_document(b"not a PDF").is_err());
        assert!(prepare_document(include_bytes!(
            "../tests/fixtures/protected-documents/password-encrypted.pdf"
        ))
        .is_err());
        assert!(prepare_document(include_bytes!(
            "../tests/fixtures/protected-documents/permission-restricted.pdf"
        ))
        .is_ok());
    }
}
