/**
 * 兰琪工作台「门店可用性」读取 hook（LQ-20，修 WorkBuddy 2026-09-10 报告 Bug7/8/9）。
 *
 * 之前每个兰琪页面各自 fetch `/lanqi/stores`，失败时把后端原始 message 直接甩到页面，
 * 门店为空时按钮静默 disabled——老板既不知道「为什么不能生成」，也没有任何出口。
 *
 * 这里把三件事收到一处：
 * ① 读取门店并保留后端细分错误码（`error.code`），不吞掉真实原因；
 * ② 用 `describeLanqiStoreGate` 得到唯一判定（loading / error / empty / ready）；
 * ③ 暴露 `reload()` 给「重试」按钮，网络类失败可恢复，不用刷新整页。
 *
 * 口径铁律：本 hook 只决定「能不能生成 + 为什么不能」，不产生任何业务数字。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiPath, getAppPath } from "./api.js";
import {
  describeLanqiStoreGate,
  storeErrorCodeOf,
  type LanqiStoreGate,
  type LanqiStoreRef
} from "./lanqi-store-gate.js";

export interface LanqiStoreGateState {
  /** 唯一判定结果：页面按 kind 渲染引导，按 blockedReason 说明按钮为什么不能点。 */
  gate: LanqiStoreGate;
  /** 已读到的门店（读取中或失败时为空数组，不代表「没有门店」）。 */
  stores: LanqiStoreRef[];
  /** 可用于生成的门店 id；不可生成时为空字符串。 */
  storeId: string;
  /** 网络类失败时的重试动作。 */
  reload: () => void;
}

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("store_os_token");
  return token
    ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}

export function useLanqiStoreGate(featureLabel: string): LanqiStoreGateState {
  const [loading, setLoading] = useState(true);
  const [stores, setStores] = useState<LanqiStoreRef[] | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    inFlight.current = true;
    setLoading(true);
    setErrorCode(null);
    setErrorMessage(null);

    void (async () => {
      try {
        const response = await fetch(apiPath("/lanqi/stores"), { headers: authHeaders() });
        const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        if (cancelled) return;
        if (response.status === 401) {
          localStorage.removeItem("store_os_token");
          window.location.replace(getAppPath("/login/lanqi"));
          return;
        }
        if (!response.ok) {
          setStores(null);
          setErrorCode(storeErrorCodeOf(body));
          setErrorMessage(typeof body.message === "string" ? body.message : "门店读取失败");
          return;
        }
        setStores(Array.isArray(body.stores) ? (body.stores as LanqiStoreRef[]) : []);
      } catch (cause) {
        if (cancelled) return;
        setStores(null);
        setErrorMessage(cause instanceof Error ? cause.message : "网络异常");
      } finally {
        inFlight.current = false;
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const gate = useMemo(
    () => describeLanqiStoreGate({ loading, stores, errorCode, errorMessage, featureLabel }),
    [loading, stores, errorCode, errorMessage, featureLabel]
  );

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return {
    gate,
    stores: stores ?? [],
    storeId: gate.kind === "ready" ? gate.storeId : "",
    reload
  };
}
