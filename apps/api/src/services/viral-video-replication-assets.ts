import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, writeFile, unlink, readdir } from "node:fs/promises";
import path from "node:path";
import { probeClip } from "./clip-renderer.js";
import { validateBeautyProviderAssetUrl } from "./beauty-provider-asset-policy.js";
import { ReplicationError, type ReplicationArtifact, type ReplicationJob } from "./viral-video-replication-runtime.js";

const sha = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
const MAX_BYTES = 200 * 1024 * 1024;
/** Local output only. No public bucket, signed URL or third-party media in API responses. */
export function createReplicationAssetStore(options: { root: string; allowedResultHosts: readonly string[]; fetch?: typeof fetch; probe?: typeof probeClip;
  validateUrl?: (url: string) => void; recoveryReceipt?: boolean }) {
  const root = path.resolve(options.root);
  const key = (job: ReplicationJob) => sha(`${job.tenantId}:${job.authorizationSnapshot.storeId}:${job.id}`);
  async function directory(job: ReplicationJob) {
    const dir = path.join(root, key(job));
    await mkdir(dir, { recursive: true });
    // Reject symlinks/junctions escaping the configured storage root, including linked root ancestors.
    if ((await realpath(root)).toLowerCase() !== root.toLowerCase() || (await realpath(dir)).toLowerCase() !== dir.toLowerCase()) throw new ReplicationError("artifact_path_rejected");
    return dir;
  }
  return {
    async persist(job: ReplicationJob, url: string): Promise<ReplicationArtifact> {
      let u: URL;
      try { u = new URL(url); } catch { throw new ReplicationError("artifact_url_rejected"); }
      if (!options.allowedResultHosts.includes(u.hostname)) throw new ReplicationError("artifact_host_not_approved");
      try { if (options.validateUrl) options.validateUrl(url); else validateBeautyProviderAssetUrl(url, options.allowedResultHosts); } catch { throw new ReplicationError("artifact_url_rejected"); }
      const response = await (options.fetch ?? fetch)(url, { redirect: "error", signal: AbortSignal.timeout(60_000) });
      if (!response.ok || !response.body) throw new ReplicationError("artifact_download_failed");
      if (!/^video\/mp4(?:;|$)/i.test(response.headers.get("content-type") ?? "")) throw new ReplicationError("artifact_type_invalid");
      if (Number(response.headers.get("content-length") ?? 0) > MAX_BYTES) throw new ReplicationError("artifact_size_invalid");
      const reader = response.body.getReader(), parts: Buffer[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.byteLength;
          if (size > MAX_BYTES) throw new ReplicationError("artifact_size_invalid");
          parts.push(Buffer.from(value));
        }
      } finally { await reader.cancel().catch(() => undefined); }
      const bytes = Buffer.concat(parts);
      if (bytes.length < 12 || bytes.toString("ascii", 4, 8) !== "ftyp") throw new ReplicationError("artifact_container_invalid");
      const dir = await directory(job), temp = path.join(dir, `${randomUUID()}.partial.mp4`);
      try {
      await writeFile(temp, bytes, { flag: "wx" });
      // Existing local ffprobe capability, not a mock string/mimetype assertion.
      const probe = await (options.probe ?? probeClip)(temp);
      if (probe.videoCodec !== "h264" || !Number.isFinite(probe.durationSeconds) || probe.durationSeconds < 2 || probe.durationSeconds > job.authorizationSnapshot.maxOutputSeconds || probe.width < 200 || probe.height < 200 || probe.width > 2048 || probe.height > 2048) throw new ReplicationError("artifact_media_invalid");
      const hash = sha(bytes), destination = path.join(dir, `${hash}.mp4`);
      await rename(temp, destination);
      if (sha(await readFile(destination)) !== hash) throw new ReplicationError("artifact_commit_invalid");
      const artifact: ReplicationArtifact = { sha256: hash, bytes: size, width: probe.width, height: probe.height, durationSeconds: probe.durationSeconds, storageKey: key(job), codec: "h264" };
      if (options.recoveryReceipt) {
        const receipt = path.join(dir, `${randomUUID()}.partial.json`);
        try { await writeFile(receipt, JSON.stringify(artifact), { flag: "wx" }); await rename(receipt, path.join(dir, "result.json")); }
        finally { await unlink(receipt).catch(e => { if (e.code !== "ENOENT") throw e; }); }
      }
      return artifact;
      } finally { await unlink(temp).catch(e => { if (e.code !== "ENOENT") throw e; }); }
    },
    async cleanupPartials(job: ReplicationJob) {
      if (!options.recoveryReceipt) return;
      const dir = await directory(job);
      for (const name of await readdir(dir)) if (/^[a-f0-9-]{36}\.partial\.(mp4|json)$/.test(name)) {
        const file = path.join(dir, name);
        if ((await realpath(file)).toLowerCase() !== file.toLowerCase()) throw new ReplicationError("artifact_path_rejected");
        await unlink(file);
      }
    },
    async recover(job: ReplicationJob): Promise<ReplicationArtifact | null> {
      if (!options.recoveryReceipt) return null;
      const dir = await directory(job), receipt = path.join(dir, "result.json");
      try {
        if ((await realpath(receipt)).toLowerCase() !== receipt.toLowerCase()) throw new ReplicationError("artifact_path_rejected");
        const a = JSON.parse(await readFile(receipt, "utf8"));
        if (!a || a.storageKey !== key(job) || !/^[a-f0-9]{64}$/.test(a.sha256) || a.codec !== "h264" || !Number.isInteger(a.bytes) || a.bytes <= 0 || a.bytes > MAX_BYTES) throw new ReplicationError("artifact_commit_invalid");
        const file = path.join(dir, `${a.sha256}.mp4`);
        if ((await realpath(file)).toLowerCase() !== file.toLowerCase()) throw new ReplicationError("artifact_path_rejected");
        const b = await readFile(file), p = await (options.probe ?? probeClip)(file);
        if (b.length !== a.bytes || sha(b) !== a.sha256 || p.videoCodec !== "h264" || p.width !== a.width || p.height !== a.height || p.durationSeconds !== a.durationSeconds) throw new ReplicationError("artifact_commit_invalid");
        return a;
      } catch (e: any) { if (e.code === "ENOENT") return null; throw e; }
    },
    async read(artifact: ReplicationArtifact, job: ReplicationJob): Promise<Buffer> {
      if (artifact.storageKey !== key(job) || !/^[a-f0-9]{64}$/.test(artifact.sha256)) throw new ReplicationError("asset_not_found", 404);
      const dir = await directory(job), file = path.join(dir, `${artifact.sha256}.mp4`);
      if ((await realpath(file)).toLowerCase() !== file.toLowerCase()) throw new ReplicationError("asset_not_found", 404);
      const bytes = await readFile(file);
      if (bytes.length !== artifact.bytes || sha(bytes) !== artifact.sha256) throw new ReplicationError("asset_not_found", 404);
      return bytes;
    }
  };
}
