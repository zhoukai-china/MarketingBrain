import { useEffect } from "react";

/**
 * 弹窗背景滚动锁（2026-09-29 用户要求：任何弹窗打开后，背景固定、不能滚动）。
 *
 * 实现要点：
 * - 给 <body> 打 `overflow: hidden`，同时用「滚动条宽度」补 padding-right，
 *   避免锁定时页面横向跳动（桌面端有滚动条的场景）。
 * - 用模块级计数器支持嵌套/叠加弹窗（多个弹窗同时打开时，最后一个关闭才解锁）。
 * - 只在 active 为 true 时生效；组件卸载/关闭自动还原，不会污染其它页面。
 */
let lockCount = 0;
let prevOverflow = "";
let prevPaddingRight = "";

export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (typeof document === "undefined") return;

    lockCount += 1;
    if (lockCount === 1) {
      const body = document.body;
      prevOverflow = body.style.overflow;
      prevPaddingRight = body.style.paddingRight;
      const gap = window.innerWidth - document.documentElement.clientWidth;
      body.style.overflow = "hidden";
      if (gap > 0) body.style.paddingRight = `${gap}px`;
    }

    return () => {
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount === 0) {
        const body = document.body;
        body.style.overflow = prevOverflow;
        body.style.paddingRight = prevPaddingRight;
      }
    };
  }, [active]);
}
