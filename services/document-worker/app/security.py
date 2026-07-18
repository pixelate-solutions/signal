from __future__ import annotations

import io
import zipfile
from pathlib import PurePosixPath

MAX_ARCHIVE_FILES = 1_000
MAX_ARCHIVE_EXPANDED_BYTES = 500 * 1024 * 1024
MAX_ARCHIVE_RATIO = 100


class UnsafeArchiveError(ValueError):
    """Raised when an archive violates traversal or expansion boundaries."""


def inspect_zip(data: bytes) -> list[zipfile.ZipInfo]:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        if len(entries) > MAX_ARCHIVE_FILES:
            raise UnsafeArchiveError("Archive contains too many files.")
        expanded = sum(entry.file_size for entry in entries)
        compressed = max(1, sum(entry.compress_size for entry in entries))
        if expanded > MAX_ARCHIVE_EXPANDED_BYTES or expanded / compressed > MAX_ARCHIVE_RATIO:
            raise UnsafeArchiveError("Archive expansion limit exceeded.")
        for entry in entries:
            normalized = PurePosixPath(entry.filename.replace("\\", "/"))
            if normalized.is_absolute() or ".." in normalized.parts:
                raise UnsafeArchiveError("Archive path traversal was blocked.")
            if entry.flag_bits & 0x1:
                raise UnsafeArchiveError("Encrypted archives require explicit secure review.")
        return entries
