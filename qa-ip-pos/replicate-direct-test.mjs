// 绕过前端，直接对 爆款复刻(viral-video-replication) 后端方法做功能验证。
// 流程：dev-login(拿 token) -> 上传参考视频 -> 上传人物肖像 -> 上传授权依据 -> 登记素材授权 -> quote -> (可选)confirm
import fs from "node:fs";
import path from "node:path";

// 避免本机 http_proxy 把 127.0.0.1 请求劫持（undici 默认不读 proxy，但保险起见清空）
for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"]) delete process.env[k];
process.env.NO_PROXY = "*";

const BASE = "http://127.0.0.1:3011";
const ROOT = path.resolve(process.cwd());
const VIDEO = path.join(ROOT, "qa-ip-pos/ref-2.5s.mp4");
const PORTRAIT = path.join(ROOT, "apps/web/public/avatars/live-host.jpg");

function log(step, status, body) {
  const code = typeof status === "number" ? status : "—";
  console.log(`\n### ${step}  ->  HTTP ${code}`);
  console.log(typeof body === "string" ? body.slice(0, 1200) : JSON.stringify(body, null, 2).slice(0, 1200));
}

async function main() {
  // 1) dev-login（productCode=lanqi 自动种下出片权益）
  const dlRes = await fetch(`${BASE}/auth/dev-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productCode: "lanqi", tenantRole: "local_business" }),
  });
  const dl = await dlRes.json();
  log("1. dev-login(lanqi)", dlRes.status, dl);
  const token = dl.token;
  const auth = { Authorization: `Bearer ${token}` };
  if (!token) { console.log("!! 无 token，终止"); return; }

  // 2) 上传参考视频
  const vBuf = fs.readFileSync(VIDEO);
  const vForm = new FormData();
  vForm.append("file", new Blob([vBuf], { type: "video/mp4" }), "ref-2.5s.mp4");
  const vRes = await fetch(`${BASE}/files`, { method: "POST", headers: auth, body: vForm });
  const vBody = await vRes.json();
  log("2. upload 参考视频", vRes.status, vBody);
  const videoFileId = vBody?.file?.id;
  if (!videoFileId) { console.log("!! 视频上传失败，终止"); return; }

  // 3) 上传人物肖像
  const pBuf = fs.readFileSync(PORTRAIT);
  const pForm = new FormData();
  pForm.append("file", new Blob([pBuf], { type: "image/jpeg" }), "live-host.jpg");
  const pRes = await fetch(`${BASE}/files`, { method: "POST", headers: auth, body: pForm });
  const pBody = await pRes.json();
  log("3. upload 人物肖像", pRes.status, pBody);
  const portraitFileId = pBody?.file?.id;
  if (!portraitFileId) { console.log("!! 肖像上传失败，终止"); return; }

  // 4) 上传授权依据文本
  const basisText = [
    "兰琪 · 爆款复刻 素材与肖像授权在线声明",
    "1) 原视频画面与改编权：已确认拥有或已获授权",
    "2) 原视频音频：已确认拥有或已获授权",
    "3) 原视频主角同意被替换：已确认",
    "4) 替换照片本人或已获授权：已确认",
  ].join("\n");
  const bForm = new FormData();
  bForm.append("file", new Blob([basisText], { type: "text/plain" }), "basis.txt");
  const bRes = await fetch(`${BASE}/files`, { method: "POST", headers: auth, body: bForm });
  const bBody = await bRes.json();
  log("4. upload 授权依据", bRes.status, bBody);
  const basisFileId = bBody?.file?.id;

  const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
  const requestKey = () => `lqvd-test-${Date.now()}`;

  // 5) 登记素材授权（原片 + 人物）
  for (const [fileId, subjectRole] of [[videoFileId, "reference"], [portraitFileId, "owner"]]) {
    const maRes = await fetch(`${BASE}/viral-video-replication/material-authorizations`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ fileId, basisFileId, subjectRole, purpose: "video_replacement", expiresAt, requestKey: requestKey(), rightsDeclared: true }),
    });
    const maBody = await maRes.json().catch(() => null);
    log(`5. material-authorizations(${subjectRole})`, maRes.status, maBody);
  }

  // 6) quote（核心：看方法是否接受输入、返回结构化报价/缺口）
  const quotePayload = {
    referenceFileId: videoFileId,
    portraitFileId,
    requestKey: requestKey(),
    model: "aliyun_strict",
    visualRightsConfirmed: true,
    audioRightsConfirmed: true,
    performerConsentConfirmed: true,
    portraitConsentConfirmed: true,
  };
  const qRes = await fetch(`${BASE}/viral-video-replication/quote`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify(quotePayload),
  });
  const qBody = await qRes.json().catch(() => null);
  log("6. quote", qRes.status, qBody);

  // 7) 若 canConfirm，再试 confirm（看是否真能建任务；外部执行受 maxCostFen 闸门控制，预期不会真出片）
  if (qBody?.canConfirm) {
    const cRes = await fetch(`${BASE}/viral-video-replication/confirm`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify(quotePayload),
    });
    const cBody = await cRes.json().catch(() => null);
    log("7. confirm", cRes.status, cBody);
  } else {
    console.log("\n### 7. confirm 跳过：quote.canConfirm=false（见上方 gaps，方法未放行建任务）");
  }

  console.log("\n=== 测试素材 ===");
  console.log("video:", VIDEO, `(${(vBuf.length / 1024).toFixed(1)} KB)`);
  console.log("portrait:", PORTRAIT, `(${(pBuf.length / 1024).toFixed(1)} KB)`);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
