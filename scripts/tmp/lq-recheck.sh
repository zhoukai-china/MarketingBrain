set -u
PC=/opt/baolu-os-v2/node_modules/.pnpm/@prisma+client@5.17.0_prisma@5.17.0/node_modules/.prisma/client
echo "=== client dir mtime ==="
stat -c '%y %n' $PC $PC/index.js $PC/schema.prisma
echo "=== grep counts (lines) ==="
printf 'upgrade=%s goal=%s asset=%s draft=%s\n' "$(grep -c lanqiMomentUpgrade $PC/index.js)" "$(grep -c lanqiStoreGoal $PC/index.js)" "$(grep -c lanqiMomentAsset $PC/index.js)" "$(grep -c lanqiMomentDraft $PC/index.js)"
echo "=== service start time ==="
systemctl show baolu-os-v2 -p ActiveEnterTimestamp -p ExecMainStartTimestamp
echo "=== any prisma generate running? ==="
ps -ef | grep -c "[p]risma generate"
echo "=== endpoint re-test ==="
cat > /tmp/lq-repro2.mjs <<'JS'
import { createHmac } from "node:crypto";
import fs from "node:fs";
const envText = fs.readFileSync("/etc/baolu-secrets/baolu-os-v2.env", "utf8");
const read = (k) => { const m = envText.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim().replace(/^["']|["']$/g, "") : ""; };
const secret = read("JWT_SECRET");
const b64 = (s) => Buffer.from(s).toString("base64url");
const sign = (d) => createHmac("sha256", secret).update(d).digest("base64url");
const token = (t, u) => { const now = Math.floor(Date.now()/1000); const h = b64(JSON.stringify({alg:"HS256",typ:"JWT"})); const b = b64(JSON.stringify({tenantId:t,userId:u,iat:now,exp:now+1800})); return `${h}.${b}.${sign(h+"."+b)}`; };
const T = "cmt6idd1c04v62hgb86gvh7pz", U = "cmt6idd1g04v72hgbue4moh86";
const H = { authorization: `Bearer ${token(T,U)}`, "content-type": "application/json" };
const r = await fetch("http://127.0.0.1:3002/lanqi/dashboard?month=2026-09", { headers: H });
console.log("dashboard", r.status, (await r.text()).slice(0,120));
JS
node /tmp/lq-repro2.mjs