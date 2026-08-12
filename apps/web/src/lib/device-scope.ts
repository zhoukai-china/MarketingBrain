import type { DeviceScope } from "@baolu/shared";

export function resolveDeviceScope(input: {
  userAgent?: string;
  maxTouchPoints?: number;
  viewportWidth?: number;
}): DeviceScope {
  const userAgent = input.userAgent ?? "";
  if (/Android|iPhone|iPod|IEMobile|Opera Mini|Mobile/i.test(userAgent)) return "mobile";
  if (/iPad/i.test(userAgent) || (/Macintosh/i.test(userAgent) && (input.maxTouchPoints ?? 0) > 1)) return "mobile";
  if ((input.maxTouchPoints ?? 0) > 0 && (input.viewportWidth ?? Number.POSITIVE_INFINITY) <= 768) return "mobile";
  return "desktop";
}

export function currentDeviceScope(): DeviceScope {
  if (typeof window === "undefined" || typeof navigator === "undefined") return "desktop";
  return resolveDeviceScope({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    viewportWidth: window.innerWidth
  });
}
