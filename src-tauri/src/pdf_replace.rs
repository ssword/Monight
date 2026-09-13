//! Replace a complete file while retaining the displaced file for version verification.
//! Never fall back to truncation or an unchecked overwrite on unsupported filesystems.
use std::path::{Path, PathBuf};

#[cfg(unix)]
pub(crate) fn replace_preserving(staged: &Path, destination: &Path) -> Result<PathBuf, String> {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};
    let a = CString::new(staged.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
    let b = CString::new(destination.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
    // Both paths remain named throughout the atomic exchange. CString owns their
    // NUL-terminated storage for the duration of the syscall.
    #[cfg(target_os = "macos")]
    let result = unsafe {
        libc::renameatx_np(
            libc::AT_FDCWD,
            a.as_ptr(),
            libc::AT_FDCWD,
            b.as_ptr(),
            libc::RENAME_SWAP,
        )
    };
    #[cfg(target_os = "linux")]
    let result = unsafe {
        libc::renameat2(
            libc::AT_FDCWD,
            a.as_ptr(),
            libc::AT_FDCWD,
            b.as_ptr(),
            libc::RENAME_EXCHANGE,
        )
    };
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let result = -1;
    if result != 0 {
        return Err(format!(
            "Safe PDF replacement unavailable: {}. Staged file retained at {}",
            std::io::Error::last_os_error(),
            staged.display()
        ));
    }
    Ok(staged.to_path_buf())
}

#[cfg(windows)]
pub(crate) fn replace_preserving(staged: &Path, destination: &Path) -> Result<PathBuf, String> {
    use std::os::windows::ffi::OsStrExt;
    let parent = destination
        .parent()
        .ok_or("Missing destination directory")?;
    let backup = tempfile::NamedTempFile::new_in(parent)
        .map_err(|e| e.to_string())?
        .into_temp_path()
        .keep()
        .map_err(|e| e.to_string())?;
    let wide = |path: &Path| {
        path.as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<_>>()
    };
    let a = wide(destination);
    let b = wide(staged);
    let c = wide(&backup);
    // ReplaceFile retains the replaced file at backup, including Windows' partial
    // failure modes. Keep every involved path on failure for explicit recovery.
    let result = unsafe {
        windows_sys::Win32::Storage::FileSystem::ReplaceFileW(
            a.as_ptr(),
            b.as_ptr(),
            c.as_ptr(),
            0,
            std::ptr::null(),
            std::ptr::null(),
        )
    };
    if result == 0 {
        return Err(format!(
            "PDF replacement uncertain: {}. Edits retained; inspect {} and {}",
            std::io::Error::last_os_error(),
            backup.display(),
            staged.display()
        ));
    }
    Ok(backup)
}
