import { useEffect, useRef, useState } from "react";

/**
 * 抽屉统一翻页（2026-09-30 用户：PC 做成翻页按钮，手机端做成翻页流）。
 *
 * - PC（>768px）：`← 上一页 / 第 x / y 页 · 共 n 条 / 下一页 →` 按钮组；
 * - 手机（≤768px）：翻页流——列表滚动到底自动加载下一页（IntersectionObserver 哨兵，
 *   root 取抽屉滚动容器 .eh-rd-body），并保留「加载更多」按钮兜底（ observer 失灵时仍可点）。
 *
 * 五个抽屉（算力明细 / 被邀请客户 / 全部订单 / 历史交付物 / 关联应用）共用，
 * 数据侧配合：手机端 onLoadMore 里做 append，PC 端 onPrev/onNext 里整页替换。
 */

export function useIsMobile(breakpoint = 768): boolean {
  const [mobile, setMobile] = useState(() =>
    typeof window !== "undefined" && window.matchMedia(`(max-width: ${breakpoint}px)`).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const onChange = () => setMobile(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [breakpoint]);
  return mobile;
}

export function DrawerPager(props: {
  isMobile: boolean;
  page: number;
  totalPages: number;
  total: number;
  unit?: string;
  busy?: boolean;
  onPrev: () => void;
  onNext: () => void;
  onLoadMore: () => void;
}) {
  const { isMobile, page, totalPages, total, unit = "条", busy = false, onPrev, onNext, onLoadMore } = props;
  const hasMore = page < totalPages;
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadRef = useRef(onLoadMore);
  loadRef.current = onLoadMore;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    if (!isMobile || !hasMore) return;
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const root = (el.closest(".eh-rd-body") as HTMLElement | null) ?? null;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !busyRef.current) loadRef.current();
      },
      { root, rootMargin: "120px 0px", threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [isMobile, hasMore]);

  if (total === 0) return null;

  if (!isMobile) {
    return (
      <div className="eh-dpg">
        <button type="button" className="eh-dpg-btn" disabled={page <= 1 || busy} onClick={onPrev}>← 上一页</button>
        <span className="eh-dpg-info">第 {page} / {totalPages} 页 · 共 {total} {unit}</span>
        <button type="button" className="eh-dpg-btn" disabled={page >= totalPages || busy} onClick={onNext}>下一页 →</button>
      </div>
    );
  }

  return (
    <div className="eh-dpg-m">
      <div ref={sentinelRef} className="eh-dpg-sentinel" aria-hidden="true" />
      {busy ? (
        <div className="eh-dpg-loading">加载中…</div>
      ) : hasMore ? (
        <button type="button" className="eh-dpg-more" onClick={onLoadMore}>加载更多</button>
      ) : (
        <div className="eh-dpg-end">已经到底了 · 共 {total} {unit}</div>
      )}
    </div>
  );
}
