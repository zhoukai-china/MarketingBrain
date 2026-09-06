import { lookup } from "node:dns/promises";
import { request, type RequestOptions } from "node:https";
import { checkServerIdentity } from "node:tls";
import { isIP } from "node:net";
import { SEEDANCE_ENDPOINT } from "./beauty-seedance-adapter.js";

export const SEEDANCE_RESULT_ORIGIN = "https://ark-content-generation-cn-beijing.tos-cn-beijing.volces.com";
export function validateSeedanceResultUrl(raw: string) { approved(raw, "GET", true); }
function approved(raw: string, method: string, result = false) {
  let u: URL; try { u = new URL(raw); } catch { throw new Error("seedance_https_url_rejected"); }
  const api = new URL(SEEDANCE_ENDPOINT);
  if (raw.length > 4096 || u.protocol !== "https:" || u.username || u.password || u.hash || u.port || /%(?:0a|0d)/i.test(raw) ||
    (result ? u.origin !== SEEDANCE_RESULT_ORIGIN || method !== "GET" || !/\.mp4$/i.test(u.pathname) :
      u.origin !== api.origin || u.search || !(method === "POST" && u.pathname === api.pathname || method === "GET" && new RegExp(`^${api.pathname}/[A-Za-z0-9_-]{1,120}$`).test(u.pathname)))) throw new Error("seedance_https_url_rejected");
  return u;
}
export function isSeedancePublicAddress(ip: string) {
  if (isIP(ip) !== 4) return false;
  const [a, b, c] = ip.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 ||
    a === 192 && (b === 168 || b === 0 || b === 88 && c === 99) || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
}
type Wiring = { resolve: typeof lookup; request: typeof request };
/** Fixed-origin HTTPS, no proxy/env lookup, redirects or reused connection. DNS answer is pinned
 * into lookup and remoteAddress is checked; SNI + default CA + hostname check remain enabled.
 * Tests inject both primitives together, never a mixed real/injected network. */
export function createSeedanceHttpsTransport(kind: "api" | "result", fixture?: Wiring): typeof fetch {
  const dns = fixture?.resolve ?? lookup, send = fixture?.request ?? request;
  if (fixture && (!fixture.resolve || !fixture.request)) throw new Error("seedance_https_fixture_incomplete");
  return (async (raw: any, init: RequestInit = {}) => {
    const method = init.method ?? "GET", u = approved(String(raw), method, kind === "result");
    const limit = kind === "api" ? 64000 : 200 * 1024 ** 2;
    const headers = new Headers(init.headers);
    for (const name of headers.keys()) if (!["authorization", "content-type"].includes(name)) throw new Error("seedance_https_header_rejected");
    if (kind === "result" && headers.has("authorization")) throw new Error("seedance_https_header_rejected");
    if (init.body !== undefined && (method !== "POST" || typeof init.body !== "string" || Buffer.byteLength(init.body) > 64000)) throw new Error("seedance_https_body_rejected");
    if (init.signal?.aborted) throw new Error("seedance_https_aborted");
    return new Promise<Response>((resolve, reject) => {
      let done = false, req: ReturnType<typeof request> | undefined;
      const finish = (error?: string, response?: Response) => {
        if (done) return; done = true; clearTimeout(timer); init.signal?.removeEventListener("abort", cancelled);
        if (error) { req?.destroy(); reject(new Error(error)); } else resolve(response!);
      };
      const cancelled = () => finish("seedance_https_aborted");
      const timer = setTimeout(() => finish("seedance_https_timeout"), kind === "api" ? 30000 : 60000);
      init.signal?.addEventListener("abort", cancelled, { once: true });
      void (async () => {
        try {
          const addresses = await dns(u.hostname, { all: true, verbatim: true });
          if (done) return;
          if (!addresses.length || addresses.some(a => !isSeedancePublicAddress(a.address))) return finish("seedance_https_address_rejected");
          const pinned = addresses[0].address;
          const options: RequestOptions = { hostname: u.hostname, port: 443, path: u.pathname + u.search, method,
            headers: Object.fromEntries(headers), agent: false, servername: u.hostname, rejectUnauthorized: true, checkServerIdentity,
            lookup: ((_hostname: string, lookupOptions: any, cb: any) => {
              if (_hostname !== u.hostname) return cb(new Error("seedance_https_lookup_rejected"));
              return lookupOptions?.all ? cb(null, [{ address: pinned, family: 4 }]) : cb(null, pinned, 4);
            }) as any };
          req = send(options, response => {
            if (done) { response.destroy(); return; }
            const remote = response.socket.remoteAddress?.replace(/^::ffff:/, "");
            if (remote !== pinned) { response.destroy(); return finish("seedance_https_connection_rejected"); }
            const status = response.statusCode ?? 0;
            if (status < 200 || status > 599 || status >= 300 && status < 400) { response.destroy(); return finish("seedance_https_redirect_rejected"); }
            const outHeaders = new Headers();
            for (const key of ["content-type", "content-length", "retry-after"]) { const v = response.headers[key]; if (typeof v === "string") outHeaders.set(key, v); }
            if (Number(outHeaders.get("content-length") ?? 0) > limit) { response.destroy(); return finish("seedance_https_response_limit"); }
            let bytes = 0; const parts: Buffer[] = [];
            response.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > limit) { response.destroy(); finish("seedance_https_response_limit"); } else parts.push(Buffer.from(chunk)); });
            response.on("error", () => finish("seedance_https_response_unknown"));
            response.on("aborted", () => finish("seedance_https_response_unknown"));
            response.on("end", () => finish(undefined, new Response([204, 205, 304].includes(status) ? null : Buffer.concat(parts), { status, headers: outHeaders })));
          });
          req.on("error", () => finish("seedance_https_transport_unknown"));
          if (done) { req.destroy(); return; }
          req.end(init.body as string | undefined);
        } catch { finish("seedance_https_transport_unknown"); }
      })();
    });
  }) as typeof fetch;
}
