use crate::{err, Result};
use serde::Serialize;
use std::{
    borrow::Cow,
    ffi::c_void,
    path::Path,
    ptr::{null, null_mut},
};
use tauri::WebviewWindow;

type HKey = isize;
// Win32 casts the signed 32-bit predefined key to a pointer-sized handle.
const HKEY_CURRENT_USER: HKey = 0x8000_0001_u32 as i32 as HKey;
const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const VALUE_NAME: &str = "Vesper";
const KEY_QUERY_VALUE: u32 = 0x0001;
const KEY_SET_VALUE: u32 = 0x0002;
const REG_SZ: u32 = 1;
const ERROR_FILE_NOT_FOUND: i32 = 2;
const ERROR_PATH_NOT_FOUND: i32 = 3;
const ERROR_MORE_DATA: i32 = 234;

#[link(name = "advapi32")]
extern "system" {
    fn RegOpenKeyExW(
        key: HKey,
        subkey: *const u16,
        options: u32,
        access: u32,
        out: *mut HKey,
    ) -> i32;
    fn RegCreateKeyExW(
        key: HKey,
        subkey: *const u16,
        reserved: u32,
        class: *mut u16,
        options: u32,
        access: u32,
        security: *const c_void,
        out: *mut HKey,
        disposition: *mut u32,
    ) -> i32;
    fn RegQueryValueExW(
        key: HKey,
        name: *const u16,
        reserved: *mut u32,
        value_type: *mut u32,
        data: *mut u8,
        size: *mut u32,
    ) -> i32;
    fn RegSetValueExW(
        key: HKey,
        name: *const u16,
        reserved: u32,
        value_type: u32,
        data: *const u8,
        size: u32,
    ) -> i32;
    fn RegDeleteValueW(key: HKey, name: *const u16) -> i32;
    fn RegCloseKey(key: HKey) -> i32;
}

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain([0]).collect()
}

fn missing(status: i32) -> bool {
    matches!(status, ERROR_FILE_NOT_FOUND | ERROR_PATH_NOT_FOUND)
}

struct RunKey(HKey);

impl RunKey {
    fn open(access: u32) -> Result<Option<Self>> {
        let mut key = 0;
        let subkey = wide(RUN_KEY);
        let status =
            unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, subkey.as_ptr(), 0, access, &mut key) };
        match status {
            0 => Ok(Some(Self(key))),
            status if missing(status) => Ok(None),
            _ => Err(err("storage", "无法打开开机启动设置")),
        }
    }

    fn create() -> Result<Self> {
        let mut key = 0;
        let subkey = wide(RUN_KEY);
        let status = unsafe {
            RegCreateKeyExW(
                HKEY_CURRENT_USER,
                subkey.as_ptr(),
                0,
                null_mut(),
                0,
                KEY_SET_VALUE,
                null(),
                &mut key,
                null_mut(),
            )
        };
        if status == 0 {
            Ok(Self(key))
        } else {
            Err(err("storage", "无法打开开机启动设置"))
        }
    }

    fn read(&self) -> Result<Option<String>> {
        let name = wide(VALUE_NAME);
        let mut value_type = 0;
        let mut data = vec![0_u16; 32_768];
        let mut size = (data.len() * 2) as u32;
        let status = unsafe {
            RegQueryValueExW(
                self.0,
                name.as_ptr(),
                null_mut(),
                &mut value_type,
                data.as_mut_ptr().cast(),
                &mut size,
            )
        };
        if missing(status) || status == ERROR_MORE_DATA {
            return Ok(None);
        }
        if status != 0 {
            return Err(err("storage", "无法读取开机启动设置"));
        }
        if value_type != REG_SZ || size % 2 != 0 {
            return Ok(None);
        }
        let raw = &data[..size as usize / 2];
        let raw = raw.strip_suffix(&[0]).unwrap_or(raw);
        if raw.contains(&0) {
            return Ok(None);
        }
        Ok(String::from_utf16(raw).ok())
    }

    fn write(&self, command: &str) -> Result<()> {
        let name = wide(VALUE_NAME);
        let data = wide(command);
        let status = unsafe {
            RegSetValueExW(
                self.0,
                name.as_ptr(),
                0,
                REG_SZ,
                data.as_ptr().cast(),
                (data.len() * 2) as u32,
            )
        };
        if status != 0 {
            return Err(err("storage", "无法开启开机启动"));
        }
        Ok(())
    }

    fn remove(&self) -> Result<()> {
        let name = wide(VALUE_NAME);
        let status = unsafe { RegDeleteValueW(self.0, name.as_ptr()) };
        if status != 0 && !missing(status) {
            return Err(err("storage", "无法关闭开机启动"));
        }
        Ok(())
    }
}

impl Drop for RunKey {
    fn drop(&mut self) {
        unsafe { RegCloseKey(self.0) };
    }
}

fn unprefix_drive(path: &str) -> &str {
    path.strip_prefix(r"\\?\")
        .filter(|rest| {
            rest.as_bytes().first().is_some_and(u8::is_ascii_alphabetic)
                && rest.as_bytes().get(1..3) == Some(b":\\")
        })
        .unwrap_or(path)
}

fn comparable_path(path: &str) -> Cow<'_, str> {
    if let Some(rest) = path.strip_prefix(r"\\?\") {
        if rest
            .get(..4)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("UNC\\"))
        {
            return Cow::Owned(format!(r"\\{}", &rest[4..]));
        }
    }
    Cow::Borrowed(unprefix_drive(path))
}

fn format_run_command(exe: &Path) -> Result<String> {
    let invalid = || err("validation", "程序路径无法用于开机启动");
    let path = exe.to_str().ok_or_else(invalid)?;
    if !exe.is_absolute()
        || path.is_empty()
        || path.chars().count() > 2048
        || path.contains(['"', '\0', '\r', '\n'])
    {
        return Err(invalid());
    }
    Ok(format!("\"{}\"", unprefix_drive(path)))
}

fn matches_run_command(stored: &str, exe: &Path) -> bool {
    let stored = stored.trim();
    let path = if let Some(quoted) = stored.strip_prefix('"') {
        quoted.split_once('"').map(|(path, _)| path)
    } else {
        stored.split_whitespace().next()
    };
    path.zip(exe.to_str()).is_some_and(|(path, exe)| {
        !path.is_empty() && comparable_path(path).eq_ignore_ascii_case(&comparable_path(exe))
    })
}

fn authorize(window: &WebviewWindow) -> Result<()> {
    if window.label() != "main" {
        return Err(err("permission", "仅主窗口可以管理开机启动"));
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AutostartState {
    enabled: bool,
}

fn read_state(exe: &Path) -> Result<AutostartState> {
    let enabled = match RunKey::open(KEY_QUERY_VALUE)? {
        Some(key) => key
            .read()?
            .is_some_and(|value| matches_run_command(&value, exe)),
        None => false,
    };
    Ok(AutostartState { enabled })
}

#[tauri::command]
pub(crate) fn autostart_get(window: WebviewWindow) -> Result<AutostartState> {
    authorize(&window)?;
    let exe = std::env::current_exe().map_err(|_| err("unavailable", "无法确定程序路径"))?;
    read_state(&exe)
}

#[tauri::command]
pub(crate) fn autostart_set(window: WebviewWindow, enabled: bool) -> Result<AutostartState> {
    authorize(&window)?;
    let exe = std::env::current_exe().map_err(|_| err("unavailable", "无法确定程序路径"))?;
    if enabled {
        let command = format_run_command(&exe)?;
        RunKey::create()?.write(&command)?;
    } else if let Some(key) = RunKey::open(KEY_SET_VALUE)? {
        key.remove()?;
    }
    read_state(&exe)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{ffi::OsString, os::windows::ffi::OsStringExt};

    #[test]
    fn formats_quoted_absolute_paths() {
        for path in [
            r"C:\Vesper\vesper.exe",
            r"C:\Program Files\Vesper\vesper.exe",
            r"\\?\UNC\host\share\vesper.exe",
        ] {
            let exe = Path::new(path);
            assert_eq!(format_run_command(exe).unwrap(), format!("\"{path}\""));
        }
        assert_eq!(
            format_run_command(Path::new(r"\\?\C:\Vesper\vesper.exe")).unwrap(),
            "\"C:\\Vesper\\vesper.exe\"",
        );
    }

    #[test]
    fn rejects_invalid_paths() {
        for path in [
            "",
            "vesper.exe",
            r"C:vesper.exe",
            "C:\\x\".exe",
            "C:\\x\n.exe",
            "C:\\x\r.exe",
            "C:\\x\0.exe",
        ] {
            assert!(format_run_command(Path::new(path)).is_err());
        }
        let long = format!("C:\\{}.exe", "x".repeat(2048));
        assert!(format_run_command(Path::new(&long)).is_err());
        let invalid_utf16 = OsString::from_wide(&[67, 58, 92, 0xd800]);
        assert!(format_run_command(Path::new(&invalid_utf16)).is_err());
    }

    #[test]
    fn matches_quoted_and_unquoted_commands() {
        let exe = Path::new(r"C:\Vesper\vesper.exe");
        assert!(matches_run_command(r"c:\VESPER\vesper.exe --flag", exe));
        assert!(matches_run_command(
            r#"  "\\?\c:\VESPER\vesper.exe" --flag  "#,
            exe
        ));
        assert!(matches_run_command(
            r"C:\Vesper\vesper.exe",
            Path::new(r"\\?\C:\Vesper\vesper.exe")
        ));
        let spaced = Path::new(r"C:\Program Files\Vesper\vesper.exe");
        assert!(matches_run_command(
            r#""C:\Program Files\Vesper\vesper.exe" --flag"#,
            spaced
        ));
        assert!(!matches_run_command(
            r"C:\Program Files\Vesper\vesper.exe",
            spaced
        ));
        assert!(matches_run_command(
            r"\\?\UNC\host\share\vesper.exe",
            Path::new(r"\\host\share\vesper.exe")
        ));
        assert!(!matches_run_command(r#""C:\Vesper\vesper.exe"#, exe));
        assert!(!matches_run_command(r"C:\Vesper\vesper.exe.bak", exe));
        assert!(!matches_run_command("  ", exe));
    }
}
