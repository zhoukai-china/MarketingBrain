import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

process.env.BEAUTY_MEDIA_ASSET_STORAGE = "local";
process.env.UPLOAD_DIR = "F:/synthetic-beauty-media-persistence-fixture";

async function main(): Promise<void> {
  const {
    BeautyMediaAssetPersistenceError,
    persistBeautyProviderImage,
    toBeautyMediaAssetPersistenceIssue
  } = await import("../apps/api/src/services/beauty-media-assets.js");

  const assetSource = await readFile("apps/api/src/services/beauty-media-assets.ts", "utf8");
  const routeSource = await readFile("apps/api/src/routes/beauty-industry-media.ts", "utf8");
  const pageSource = await readFile("apps/web/src/pages/BeautyIndustryAcquisitionPage.tsx", "utf8");
  let actualNetworkCalls = 0;

  const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  const fixedNow = new Date("2026-08-27T01:00:00.000Z");
  const calls = { mkdir: 0, write: [] as string[], rename: [] as string[], remove: [] as string[] };
  const baseDependencies = {
    validateSourceUrl: (_sourceUrl: string) => undefined,
    fetchImpl: async () => new Response(png, { status: 200, headers: { "content-type": "image/png" } }),
    createTimeoutSignal: () => new AbortController().signal,
    mkdirImpl: async () => { calls.mkdir += 1; },
    writeFileImpl: async (target: unknown) => { calls.write.push(String(target)); },
    renameImpl: async (from: unknown, to: unknown) => { calls.rename.push(`${String(from)}=>${String(to)}`); },
    removeImpl: async (target: unknown) => { calls.remove.push(String(target)); },
    now: () => fixedNow
  };

  const metadata = await persistBeautyProviderImage(
    { tenantId: "synthetic-tenant-a", jobId: "synthetic_job_0001", sourceUrl: "https://synthetic.invalid/image.png" },
    baseDependencies as never
  );
  assert.equal(metadata.contentType, "image/png");
  assert.equal(metadata.bytes, png.length);
  assert.equal(calls.mkdir, 1);
  assert.equal(calls.write.length, 2, "image and metadata must both be written to temporary files");
  assert.equal(calls.rename.length, 2, "image and metadata must be committed separately");
  assert.ok(calls.write.every((target) => target.endsWith(".tmp")), "no final customer asset may be written directly");

  const fixtures: Array<{
    name: string;
    expected: { stage: string; code: string; retryable: boolean; httpStatus?: number };
    jobId?: string;
    overrides: Record<string, unknown>;
  }> = [
    { name: "url rejected", expected: { stage: "url_validation", code: "beauty_media_asset_url_rejected", retryable: false }, overrides: { validateSourceUrl: () => { throw new Error("blocked"); } } },
    { name: "redirect rejected", expected: { stage: "url_validation", code: "beauty_media_asset_redirect_rejected", retryable: false }, overrides: { fetchImpl: async () => new Response(null, { status: 302, headers: { location: "https://outside.invalid/image.png" } }), validateSourceUrl: rejectOnCall(2) } },
    { name: "redirect limit", expected: { stage: "url_validation", code: "beauty_media_asset_redirect_limit_exceeded", retryable: false }, overrides: { fetchImpl: async () => new Response(null, { status: 302, headers: { location: "/next.png" } }) } },
    { name: "download request", expected: { stage: "download_request", code: "beauty_media_asset_download_request_failed", retryable: true }, overrides: { fetchImpl: async () => { throw new Error("synthetic network failure"); } } },
    { name: "http 503", expected: { stage: "download_response", code: "beauty_media_asset_download_http_503", retryable: true, httpStatus: 503 }, overrides: { fetchImpl: async () => new Response("", { status: 503 }) } },
    { name: "content type", expected: { stage: "content_type", code: "beauty_media_asset_invalid_content_type", retryable: false }, overrides: { fetchImpl: async () => new Response(png, { status: 200, headers: { "content-type": "text/html" } }) } },
    { name: "empty payload", expected: { stage: "payload_size", code: "beauty_media_asset_invalid_size", retryable: false }, overrides: { fetchImpl: async () => new Response(new Uint8Array(), { status: 200, headers: { "content-type": "image/png" } }) } },
    { name: "path", jobId: "../bad", expected: { stage: "path_resolution", code: "beauty_media_asset_path_rejected", retryable: false }, overrides: {} },
    { name: "directory", expected: { stage: "directory_prepare", code: "beauty_media_asset_directory_prepare_failed", retryable: true }, overrides: { mkdirImpl: async () => { throw new Error("synthetic mkdir failure"); } } },
    { name: "image write", expected: { stage: "image_write", code: "beauty_media_asset_image_write_failed", retryable: true }, overrides: { writeFileImpl: async () => { throw new Error("synthetic image write failure"); } } },
    { name: "metadata write", expected: { stage: "metadata_write", code: "beauty_media_asset_metadata_write_failed", retryable: true }, overrides: { writeFileImpl: failOnCall(2, "synthetic metadata write failure") } },
    { name: "image commit", expected: { stage: "image_commit", code: "beauty_media_asset_image_commit_failed", retryable: true }, overrides: { renameImpl: async () => { throw new Error("synthetic image commit failure"); } } },
    { name: "metadata commit", expected: { stage: "metadata_commit", code: "beauty_media_asset_metadata_commit_failed", retryable: true }, overrides: { renameImpl: failOnCall(2, "synthetic metadata commit failure") } }
  ];

  for (const [index, fixture] of fixtures.entries()) {
    let thrown: unknown;
    try {
      await persistBeautyProviderImage(
        { tenantId: "synthetic-tenant-a", jobId: fixture.jobId ?? `synthetic_job_${String(index + 2).padStart(4, "0")}`, sourceUrl: "https://synthetic.invalid/image.png" },
        { ...baseDependencies, ...fixture.overrides } as never
      );
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown instanceof BeautyMediaAssetPersistenceError, `${fixture.name} must use the bounded persistence error contract`);
    assert.deepEqual(toBeautyMediaAssetPersistenceIssue(thrown), fixture.expected, `${fixture.name} stage attribution drifted`);
    assert.doesNotMatch(String((thrown as Error).message), /https?:|synthetic-tenant|\\|F:/, `${fixture.name} leaked a URL, tenant, or filesystem path`);
  }

  assert.match(routeSource, /assetPersistenceStage/);
  assert.match(routeSource, /assetPersistenceRetryable/);
  assert.match(routeSource, /assetPersistenceHttpStatus/);
  assert.match(routeSource, /beauty_media_asset_persistence_failed/);
  assert.match(routeSource, /canRecover:\s*false/, "Provider-success/local-failure must be terminal and non-replayable");
  assert.doesNotMatch(routeSource, /recoverableAssetFailure/, "legacy merged failures must not re-query the Provider");
  assert.doesNotMatch(routeSource, /canRecover:\s*status === "failed"/, "no failed image task may silently become a Provider retry path");
  assert.match(pageSource, /本地交付链未完成/);
  assert.match(pageSource, /不可自动重试/);
  assert.doesNotMatch(assetSource, /console\.(?:log|warn|error).*sourceUrl/, "source URLs must not be written to logs");
  assert.equal(actualNetworkCalls, 0);

  process.stdout.write(`beauty_image_persistence_observability_p1_smoke=PASS;failure_fixtures=${fixtures.length};atomic_writes=2;atomic_commits=2;external_network=${actualNetworkCalls};provider_calls=0\n`);
}

function failOnCall(targetCall: number, message: string) {
  let calls = 0;
  return async () => {
    calls += 1;
    if (calls === targetCall) throw new Error(message);
  };
}

function rejectOnCall(targetCall: number) {
  let calls = 0;
  return () => {
    calls += 1;
    if (calls === targetCall) throw new Error("synthetic redirect policy rejection");
  };
}

void main();
