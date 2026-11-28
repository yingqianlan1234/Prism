use crate::{err, Result};
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
};
use tauri::http::{header, Response, StatusCode};

#[cfg(target_os = "macos")]
mod macos;
#[cfg(windows)]
mod windows;

#[cfg(target_os = "macos")]
pub(crate) use self::macos::*;
#[cfg(windows)]
pub(crate) use self::windows::*;

pub(crate) fn stream_url(token: &str) -> String {
    #[cfg(windows)]
    let origin = "http://vesperlocal.localhost";
    #[cfg(target_os = "macos")]
    let origin = "vesperlocal://localhost";
    format!("{origin}/{token}")
}

pub(crate) const MAX_AUDIO_BYTES: u64 = 256 * 1024 * 1024;
pub(crate) const MAX_LYRIC_BYTES: u64 = 256 * 1024;
const CHUNK_BYTES: u64 = 4 * 1024 * 1024;

fn requested_range(range: &str, len: u64) -> Option<(u64, u64)> {
    let decimal = |value: &str| {
        (!value.is_empty() && value.bytes().all(|b| b.is_ascii_digit()))
            .then(|| value.parse::<u64>().ok())
            .flatten()
    };
    let (start, end) = range.strip_prefix("bytes=")?.split_once('-')?;
    if start.is_empty() {
        let size = decimal(end)?.min(len).min(CHUNK_BYTES);
        return (size != 0).then_some((len - size, len - 1));
    }
    let start = decimal(start)?;
    let end = if end.is_empty() {
        len - 1
    } else {
        decimal(end)?.min(len - 1)
    };
    (start <= end).then(|| (start, end.min(start + CHUNK_BYTES - 1)))
}

pub(crate) fn stream_file(
    mut file: File,
    len: u64,
    mime: &str,
    range: Option<&str>,
    head: bool,
) -> Result<Response<Vec<u8>>> {
    let range = if head { None } else { range };
    let mut response = Response::builder()
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff");
    let (start, end) = match range {
        Some(value) => match requested_range(value, len) {
            Some(pair) => pair,
            None => {
                return response
                    .status(StatusCode::RANGE_NOT_SATISFIABLE)
                    .header(header::CONTENT_RANGE, format!("bytes */{len}"))
                    .body(Vec::new())
                    .map_err(|_| err("unavailable", "无法构造本地音频响应"))
            }
        },
        None if head => (0, len - 1),
        // Tauri's custom-protocol body is buffered. WebView2 can request the next range.
        None => (0, len.min(CHUNK_BYTES) - 1),
    };
    let size = end - start + 1;
    response = if range.is_some() || size < len {
        response
            .status(StatusCode::PARTIAL_CONTENT)
            .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}"))
    } else {
        response.status(StatusCode::OK)
    };
    let mut body = Vec::new();
    if !head {
        body.resize(size as usize, 0);
        file.seek(SeekFrom::Start(start))
            .and_then(|_| file.read_exact(&mut body))
            .map_err(|_| err("unavailable", "无法读取本地音频"))?;
    }
    response
        .header(header::CONTENT_LENGTH, size.to_string())
        .body(body)
        .map_err(|_| err("unavailable", "无法构造本地音频响应"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn range_parser_bounds_open_ended_suffix_and_invalid_ranges() {
        assert_eq!(requested_range("bytes=2-4", 8), Some((2, 4)));
        assert_eq!(requested_range("bytes=5-", 8), Some((5, 7)));
        assert_eq!(requested_range("bytes=-2", 8), Some((6, 7)));
        assert_eq!(
            requested_range("bytes=0-", 10_000_000),
            Some((0, CHUNK_BYTES - 1))
        );
        for value in [
            "bytes=-0",
            "bytes=8-",
            "bytes=4-2",
            "bytes=-",
            "bytes=+2-",
            "bytes=2-3,5-6",
        ] {
            assert_eq!(requested_range(value, 8), None);
        }
    }
}
