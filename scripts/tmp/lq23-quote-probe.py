"""Read-only probe for the Lanqi video (image_to_video) quote endpoint.

Confirms: entitlement + routing reach the media route, the video subject is
quoted at the agreed 30 credits/second, and paid image generation stays closed.
Creates no task and spends no credits.
"""
import json
import base64
import sys
import urllib.error
import urllib.request

BASE = sys.argv[1]
TOKEN = sys.argv[2]
FIRST_FRAME_PATH = sys.argv[3]
with open(FIRST_FRAME_PATH, "rb") as handle:
    FIRST_FRAME_B64 = base64.b64encode(handle.read()).decode()


def post(path, payload):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + TOKEN},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode())


print("--- quote image_to_video 720P 3s ---")
status, body = post(
    "/lanqi/media/quote",
    {
        "kind": "image_to_video",
        "prompt": "门店前台，老板本人微笑看向镜头，缓慢推近",
        "resolution": "720P",
        "durationSeconds": 3,
        "firstFrame": {"contentType": "image/jpeg", "dataBase64": FIRST_FRAME_B64},
    },
)
print(status, json.dumps(body, ensure_ascii=False, indent=2))

print("--- quote image (must stay blocked) ---")
print(
    json.dumps(
        post("/lanqi/media/quote", {"kind": "image", "prompt": "测试图片", "promptVersion": "v1"}),
        ensure_ascii=False,
        indent=2,
    )
)
