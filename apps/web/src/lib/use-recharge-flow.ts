import { useEffect, useRef, useState } from "react";
import { apiPath } from "./api.js";
import { billingErrorCopy } from "./humanize-error.js";

/**
 * 充值流程共享逻辑（2026-09-29 从 RechargePage 抽出）。
 *
 * 「支付逻辑与现有 /recharge 完全一致，只换样式布局」的实现方式：页面与右侧抽屉
 * 都消费同一个 hook——档位/下单/native 二维码/jsapi 收银台/轮询/模拟支付只有这一份实现，
 * 任何一侧都不会漂移。
 */

export interface CreditPack {
  code: string;
  name: string;
  priceCny: number;
  baseCredits: number;
  bonusCredits: number;
}

export interface BillingCatalog {
  creditPacks: CreditPack[];
}

export interface WalletBalance {
  paidBalance: number;
  bonusBalance: number;
  balance: number;
}

export const PTS_PER_YUAN = 10;

/** 微信内置浏览器：必须走 JSAPI 收银台（WeixinJSBridge），不能只出二维码（用户 2026-09-13 真机实测口径）。 */
export function isWechatInAppBrowser(): boolean {
  return typeof navigator !== "undefined" && /MicroMessenger/i.test(navigator.userAgent);
}

interface WeixinJsBridgeLike {
  invoke: (api: string, params: Record<string, unknown>, callback: (res: { err_msg?: string }) => void) => void;
}

/** 拉起微信内支付。返回 ok / cancel / fail，失败时由上层给「重新支付」与备选路径。 */
export function invokeWechatJsapiPay(payParams: Record<string, unknown>): Promise<"ok" | "cancel" | "fail"> {
  return new Promise((resolve) => {
    const bridge = (window as unknown as { WeixinJSBridge?: WeixinJsBridgeLike }).WeixinJSBridge;
    const call = () => {
      const active = (window as unknown as { WeixinJSBridge?: WeixinJsBridgeLike }).WeixinJSBridge;
      if (!active) {
        resolve("fail");
        return;
      }
      active.invoke("getBrandWCPayRequest", payParams, (res) => {
        const message = res?.err_msg ?? "";
        if (message === "get_brand_wcpay_request:ok") resolve("ok");
        else if (message === "get_brand_wcpay_request:cancel") resolve("cancel");
        else resolve("fail");
      });
    };
    if (bridge) {
      call();
      return;
    }
    // 微信注入 JSBridge 有两个时机：已注入、或等 WeixinJSBridgeReady 事件。
    const onReady = () => {
      document.removeEventListener("WeixinJSBridgeReady", onReady);
      call();
    };
    document.addEventListener("WeixinJSBridgeReady", onReady);
    window.setTimeout(() => {
      document.removeEventListener("WeixinJSBridgeReady", onReady);
      if (!(window as unknown as { WeixinJSBridge?: WeixinJsBridgeLike }).WeixinJSBridge) resolve("fail");
    }, 2000);
  });
}

export function packPts(pack: CreditPack): number {
  return pack.baseCredits + pack.bonusCredits;
}

/**
 * 档位徽章「多 N%」= **多送 ÷ 实付**（用户 2026-09-30 口径）。
 *
 * 旧实现算的是「折扣率」= 1 − 实付/按 10 算力每元折出的面值，得到 17% / 23%，
 * 跟档位卡上的「3000 + 多送 600 = 3600」「10000 + 多送 3000 = 13000」对不上，
 * 用户看到的是「多 17%」但实际多送的是 20%，容易被当成算错。
 * 现在直接按多送比例算：300 档 600/3000 = 20%，1000 档 3000/10000 = 30%。
 */
export function packOff(pack: CreditPack): number {
  if (pack.baseCredits <= 0 || pack.bonusCredits <= 0) return 0;
  return Math.round((pack.bonusCredits / pack.baseCredits) * 100);
}

function authHeaders(json = false): Record<string, string> {
  const token = localStorage.getItem("store_os_token");
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(json ? { "Content-Type": "application/json" } : {})
  };
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.message ?? payload.error ?? "request_failed"), { status: response.status, payload });
  return payload as T;
}

export function useRechargeFlow(options: { onPaid?: () => void } = {}) {
  const [token, setToken] = useState(() => localStorage.getItem("store_os_token") ?? "");
  const [wallet, setWallet] = useState<WalletBalance | null>(null);
  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [planIdx, setPlanIdx] = useState<number | null>(null);
  const [method, setMethod] = useState("wx");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyCode, setBusyCode] = useState("");
  const [qrSrc, setQrSrc] = useState("");
  /** 当前这一单用的是哪种支付方式：jsapi（微信内收银台）/ native（二维码）。 */
  const [payMode, setPayMode] = useState<"none" | "jsapi" | "native">("none");
  const [orderId, setOrderId] = useState("");
  const pollRef = useRef<number | null>(null);
  const onPaidRef = useRef(options.onPaid);
  onPaidRef.current = options.onPaid;
  const isLocal = typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const catalog = await fetch(apiPath("/billing/catalog")).then(readJson<BillingCatalog>);
        setPacks(catalog.creditPacks ?? []);
        setPlanIdx((current) => {
          if (current !== null) return current;
          const hot = (catalog.creditPacks ?? []).findIndex((pack) => pack.code === "pack_100");
          return hot >= 0 ? hot : 0;
        });
      } catch (reason) {
        setError(billingErrorCopy(reason, "充值档位加载失败，请刷新重试。"));
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      if (pollRef.current) window.clearTimeout(pollRef.current);
    };
  }, []);

  useEffect(() => {
    if (!token) return;
    void (async () => {
      try {
        const walletData = await fetch(apiPath("/wallet"), { headers: authHeaders(), cache: "no-store" }).then(readJson<WalletBalance>);
        setWallet(walletData);
      } catch (reason) {
        const status = (reason as { status?: number })?.status;
        if (status === 401 || status === 403) {
          localStorage.removeItem("store_os_token");
          setToken("");
        } else {
          setWallet(null);
        }
      }
    })();
  }, [token]);

  async function refreshBalance() {
    try {
      const data = await fetch(apiPath("/wallet"), { headers: authHeaders(), cache: "no-store" }).then(readJson<WalletBalance>);
      setWallet(data);
    } catch {
      // 支付已成功，余额刷新失败会在下次刷新时恢复。
    }
  }

  async function createOrder(pack: CreditPack) {
    setError("");
    setNotice("");
    setQrSrc("");
    setPayMode("none");
    setBusyCode(pack.code);
    try {
      const created = await fetch(apiPath("/billing/orders"), {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ type: "credit_pack", creditPackCode: pack.code })
      }).then(readJson<{ order: { id: string } }>);

      if (isLocal) {
        setNotice("本机验收：订单已创建，点击「模拟支付到账」入账双桶。");
      } else if (isWechatInAppBrowser()) {
        // 微信内：直接拉起收银台，用户不需要（也没法）扫自己屏幕上的二维码。
        setPayMode("jsapi");
        let payParams: Record<string, unknown> | undefined;
        try {
          const prepay = await fetch(apiPath(`/billing/orders/${created.order.id}/wechat-prepay`), {
            method: "POST",
            headers: { ...authHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({ tradeType: "jsapi" })
          }).then(readJson<{ payParams?: Record<string, unknown>; order?: { payParams?: Record<string, unknown> } }>);
          // 接口把收银台参数放在顶层 payParams；同时兼容早期嵌在 order 里的结构。
          payParams = prepay.payParams ?? prepay.order?.payParams;
        } catch {
          // 例如账号没有微信 openid（非微信注册的老账号）：下面回落二维码，不让流程卡死。
          payParams = undefined;
        }
        setOrderId(created.order.id);
        void pollOrder(created.order.id);
        if (!payParams) {
          try {
            await fetch(apiPath(`/billing/orders/${created.order.id}/wechat-prepay`), {
              method: "POST",
              headers: { ...authHeaders(), "Content-Type": "application/json" },
              body: JSON.stringify({ tradeType: "native" })
            }).then(readJson);
            setPayMode("native");
            setQrSrc(apiPath(`/billing/orders/${created.order.id}/wechat-qr.svg`));
            setNotice("已在页面生成收款二维码：用另一台设备的微信扫码支付；也可以点上面的按钮重试微信内支付。");
          } catch {
            setNotice("微信支付暂时拉不起来，请点上面的按钮重试，或稍后换电脑打开本页扫码支付。");
          }
          return;
        }
        const result = await invokeWechatJsapiPay(payParams);
        if (result === "ok") setNotice("支付完成，正在到账…（到账后算力立即可用）");
        else if (result === "cancel") setNotice("你取消了支付，点上面的按钮可以重新支付。");
        else setNotice("微信收银台没有正常拉起：请点上面的按钮重试；仍然不行就用电脑打开本页扫码支付。");
        return;
      } else {
        await fetch(apiPath(`/billing/orders/${created.order.id}/wechat-prepay`), {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ tradeType: "native" })
        }).then(readJson);
        setPayMode("native");
        setQrSrc(apiPath(`/billing/orders/${created.order.id}/wechat-qr.svg`));
      }
      setOrderId(created.order.id);
      void pollOrder(created.order.id);
    } catch (reason) {
      const status = (reason as { status?: number })?.status;
      if (status === 401 || status === 403) {
        localStorage.removeItem("store_os_token");
        setToken("");
        return;
      }
      setError(billingErrorCopy(reason, "下单失败，请稍后重试。"));
    } finally {
      setBusyCode("");
    }
  }

  function pollOrder(id: string) {
    if (pollRef.current) window.clearTimeout(pollRef.current);
    void (async () => {
      try {
        const order = await fetch(apiPath(`/billing/orders/${id}`), { headers: authHeaders() }).then(readJson<{ order?: { status: string } }>);
        if (order.order?.status === "paid") {
          setNotice("支付成功，算力已到账。");
          setQrSrc("");
          await refreshBalance();
          onPaidRef.current?.();
          return;
        }
      } catch {
        // 网络抖动时继续轮询，不让用户错过支付成功状态。
      }
      pollRef.current = window.setTimeout(() => pollOrder(id), 2500);
    })();
  }

  async function mockPayOrder() {
    if (!orderId) return;
    setBusyCode("mock");
    setError("");
    setNotice("");
    try {
      await fetch(apiPath(`/billing/orders/${orderId}/mock-pay`), {
        method: "POST",
        headers: authHeaders()
      }).then(readJson);
      setNotice("模拟支付成功，算力已入双桶。");
      setOrderId("");
      await refreshBalance();
      onPaidRef.current?.();
    } catch (reason) {
      setError(billingErrorCopy(reason, "模拟支付失败。"));
    } finally {
      setBusyCode("");
    }
  }

  return {
    token, wallet, packs, planIdx, setPlanIdx, method, setMethod,
    loading, error, notice, busyCode, qrSrc, payMode, orderId, isLocal,
    setError, setNotice, createOrder, mockPayOrder, refreshBalance
  };
}
