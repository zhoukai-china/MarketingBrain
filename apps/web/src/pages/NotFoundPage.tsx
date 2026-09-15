import { useEffect } from "react";
import { getAppPath } from "../lib/api.js";
import "../styles/not-found.css";

/**
 * 统一兜底页（PLAT-18）。
 *
 * 以前路由表最后一行直接 `return <AgentHomePage />`：任何输错的、已经下线的、
 * 或者本来就不存在的网址，都会显示「外卖增长智能体」的首页——用户以为
 * 自己打开了另一个产品，也分不清「链接错了」和「服务坏了」。
 *
 * 现在未知路径统一落到这里：说清楚「这个地址不存在或已经下线」，并把
 * 用户带回平台首页，绝不显示任何具体产品的页面。已清理的历史地址
 * （`/legacy-diagnosis`、`/v4-preview`、`/industry-prototype`、`/clip-lab`）
 * 同样落在这里，符合 PLAT-18 验收条件 2。
 */
export default function NotFoundPage() {
  const typedPath =
    typeof window === "undefined" ? "" : String(window.location.pathname ?? "").slice(0, 160);

  useEffect(() => {
    document.title = "页面不存在 - 思潼AI 行业智能体平台";
  }, []);

  return (
    <main className="notFoundPage">
      <section className="notFoundCard">
        <span className="notFoundBadge">404</span>
        <h1>这个页面不存在，或者已经下线</h1>
        <p className="notFoundLead">
          你打开的是<code className="notFoundPath">{typedPath || "/"}</code>
          ，它可能是已经清理掉的旧版开发页面，也可能是链接写错了。
        </p>
        <div className="notFoundActions">
          <a className="notFoundPrimary" href={getAppPath("/agents")}>
            回到智能体平台首页
          </a>
          <a className="notFoundSecondary" href={getAppPath("/mine")}>
            去常用智能体
          </a>
        </div>
        <p className="notFoundHint">
          如果你是从微信里点开的旧链接，请联系为你开通账号的思潼AI 服务人员，重新获取最新地址。
        </p>
      </section>
    </main>
  );
}
