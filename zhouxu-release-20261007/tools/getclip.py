import ctypes
import ctypes.wintypes as w

u = ctypes.windll.user32
k = ctypes.windll.kernel32

# 关键：不声明 restype 时 ctypes 按 32 位 int 返回，HANDLE 被截断导致后续调用失败
u.GetClipboardData.argtypes = [w.UINT]
u.GetClipboardData.restype = w.HANDLE
k.GlobalLock.argtypes = [w.HANDLE]
k.GlobalLock.restype = ctypes.c_void_p
k.GlobalSize.argtypes = [w.HANDLE]
k.GlobalSize.restype = ctypes.c_size_t
k.GlobalUnlock.argtypes = [w.HANDLE]
k.GlobalUnlock.restype = w.BOOL

if not u.OpenClipboard(None):
    print("OPEN_FAIL", k.GetLastError())
    raise SystemExit(1)
try:
    for fmt in (13, 1, 7):
        h = u.GetClipboardData(fmt)
        if not h:
            continue
        size = k.GlobalSize(h)
        p = k.GlobalLock(h)
        if not p or not size:
            print(f"fmt{fmt}: empty (size={size}, ptr={p})")
            continue
        raw = ctypes.string_at(p, size)
        k.GlobalUnlock(h)
        s = (raw.decode("utf-16-le", errors="ignore") if fmt == 13
             else raw.decode("mbcs", errors="ignore")).strip("\x00").strip()
        print(f"fmt{fmt} LEN={len(s)}")
        if s:
            print("HEAD=%s" % s[:6])
            if s.startswith("skh_"):
                with open(r"C:\Users\book\AppData\Local\Temp\skh_token.txt", "w",
                          encoding="ascii", newline="") as f:
                    f.write(s)
                print("SAVED_TOKEN")
            else:
                print("NOT_A_TOKEN")
            break
finally:
    u.CloseClipboard()
