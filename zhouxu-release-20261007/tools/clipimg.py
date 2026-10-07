import ctypes
import ctypes.wintypes as w
import struct
import sys

u = ctypes.windll.user32
k = ctypes.windll.kernel32

OUT = r"F:\baolu-skill-billing\tools\_clip.png"

if not u.OpenClipboard(None):
    print("OPEN_FAIL", k.GetLastError())
    sys.exit(1)

try:
    # 优先 CF_DIBV5 -> CF_DIB -> CF_BITMAP
    dib = u.GetClipboardData(8) or u.GetClipboardData(17)
    if dib:
        k.GlobalLock.restype = ctypes.c_void_p
        p = k.GlobalLock(dib)
        n = k.GlobalSize(dib)
        raw = ctypes.string_at(p, n) if p else b""
        k.GlobalUnlock(dib)
        print("DEBUG dib bytes:", len(raw), "head:", raw[:8].hex())
        if raw[:4] == b"BM":
            data = raw
        else:
            # BITMAPINFOHEADER
            (biSize, biWidth, biHeight, biPlanes, biBitCount, biCompression,
             biSizeImage, biXPelsPerMeter, biYPelsPerMeter, biClrUsed, biClrImportant) = struct.unpack("<IiiHHIIiiII", raw[:40])
            hdr_size = biSize
            off_clr = hdr_size + (biClrUsed * 4 if biClrUsed else 0)
            pixel_off = 14 + off_clr
            bmphdr = struct.pack("<2sIHHI", b"BM", 14 + len(raw) - 0, 0, 0, pixel_off)
            # BITMAPFILEHEADER: bfType, bfSize, bfReserved1, bfReserved2, bfOffBits
            bfSize = 14 + len(raw)
            bmphdr = b"BM" + struct.pack("<IHHI", bfSize, 0, 0, pixel_off)
            data = bmphdr + raw
        with open(OUT, "wb") as f:
            f.write(data)
        print("WROTE", OUT, len(data), "bytes")
        sys.exit(0)

    h = u.GetClipboardData(2)  # CF_BITMAP
    if h:
        print("CF_BITMAP only (HBITMAP) - need GDI save")
        sys.exit(2)
    print("NO_IMAGE")
finally:
    u.CloseClipboard()
