use std::path::{Path, PathBuf};

pub(crate) fn fixture_path(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join(name)
}

pub(crate) fn protected_pdf_fixtures() -> [(&'static str, &'static [u8]); 3] {
    [
        (
            "restricted",
            include_bytes!("../tests/fixtures/protected-documents/permission-restricted.pdf"),
        ),
        (
            "encrypted",
            include_bytes!("../tests/fixtures/protected-documents/password-encrypted.pdf"),
        ),
        (
            "signed",
            include_bytes!("../tests/fixtures/protected-documents/digitally-signed.pdf"),
        ),
    ]
}
