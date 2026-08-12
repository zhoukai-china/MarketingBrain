import { useMemo } from "react";
import { getAppPath } from "../lib/api.js";

type Guide = { name: string; intro: string; consoleUrl: string; consoleLabel: string; fields: string[]; steps: string[]; permissions: string; docsUrl: string };

const guides: Guide[] = [
  { name: "得到大脑（Get 笔记）", intro: "仅同步你已转写完成的笔记和录音文字，不上传音频。", consoleUrl: "https://www.biji.com/openapi", consoleLabel: "打开 Get 笔记开放平台", fields: ["API Key", "Client ID"], steps: ["登录得到大脑/ Get 笔记开放平台。", "创建或打开你的应用。", "在应用凭证中复制 API Key 和 Client ID。", "回到思潼，粘贴后点击“连接并同步”。"], permissions: "确认应用拥有笔记内容读取权限；不要把 API Key 发给他人或粘贴到聊天中。", docsUrl: "https://doc.biji.com/docs/WOxgwObNNiyMHWk1dl0cJqSxnEd" },
  { name: "飞书", intro: "适用于企业自建应用；可一键读取该应用已被授权的知识空间或指定文档。", consoleUrl: "https://open.feishu.cn/app", consoleLabel: "打开飞书开发者后台", fields: ["App ID（cli_ 开头）", "App Secret"], steps: ["登录飞书开放平台，创建或打开企业自建应用。", "进入“基础信息 → 凭证与基础信息”。", "复制 App ID 和 App Secret。", "在“权限管理”申请云文档/知识库读取权限，并由管理员发布或审批。", "回到思潼粘贴凭证；可选填某个知识库或文档链接缩小范围。"], permissions: "只申请读取权限；未授权给应用的知识空间，系统不会读取。", docsUrl: "https://open.feishu.cn/document/develop-an-echo-bot/faq?lang=zh-CN" },
  { name: "企业微信", intro: "目前一键同步企业微信应用被授权可见的通讯录；不会读取聊天存档或微盘。", consoleUrl: "https://work.weixin.qq.com/wework_admin/frame#apps", consoleLabel: "打开企业微信管理后台", fields: ["Corp ID", "应用 Secret", "AgentId（可选）"], steps: ["使用企业微信管理员身份进入管理后台。", "在“我的企业”中复制 Corp ID。", "在“应用管理”创建或打开自建应用。", "在应用详情复制 Secret；如页面要求，再填写 AgentId。", "为应用配置必要的通讯录只读范围后，回到思潼粘贴并校验。"], permissions: "只读取已授权通讯录范围；聊天存档和微盘需要企业微信另行开通，本页面不会默认请求。", docsUrl: "https://developer.work.weixin.qq.com/document/path/91039" }
];

export function KnowledgeConnectionHelpPage() {
  const query = useMemo(() => new URLSearchParams(window.location.search), []);
  const candidate = query.get("returnTo") ?? "";
  const returnTo = candidate.startsWith("/enterprise-knowledge-base") || candidate.startsWith("/agents/acquisition/enterprise-knowledge-base") ? candidate : "/agents/acquisition/enterprise-knowledge-base";
  return <div className="enterpriseKnowledgePage connectionHelpPage">
    <header className="enterpriseKnowledgeTopbar"><button className="enterpriseKnowledgeBrand" onClick={() => window.location.href = getAppPath(returnTo)}><span className="tenantBrandLogo" style={{ background: "#1f6a57" }}>思潼</span><strong>平台连接帮助</strong></button><button onClick={() => window.location.href = getAppPath(returnTo)}>← 返回连接页面</button></header>
    <main><section className="connectionHelpHero"><span>CONNECTION GUIDE</span><h1>3 分钟找到平台凭证</h1><p>密钥必须由企业管理员或应用管理员在官方后台生成。思潼不会替你登录平台、不会显示已保存的密钥，也不会读取未授权范围。</p></section><section className="connectionHelpSecurity"><strong>先确认身份</strong><p>如果你看不到“创建应用”“凭证”或“通讯录权限”，请让企业管理员完成创建、授权或将你加入应用管理员；不要向任何人发送 App Secret、API Key 或 Corp Secret。</p></section><section className="connectionHelpGrid">{guides.map((guide, index) => <article key={guide.name}><span>{String(index + 1).padStart(2, "0")}</span><h2>{guide.name}</h2><p>{guide.intro}</p><a className="connectionHelpPrimary" href={guide.consoleUrl} target="_blank" rel="noreferrer">{guide.consoleLabel} ↗</a><h3>本页需要填写</h3><ul>{guide.fields.map((field) => <li key={field}>{field}</li>)}</ul><h3>操作步骤</h3><ol>{guide.steps.map((step) => <li key={step}>{step}</li>)}</ol><p className="connectionHelpPermission"><strong>权限提醒：</strong>{guide.permissions}</p><a className="connectionHelpDocs" href={guide.docsUrl} target="_blank" rel="noreferrer">查看官方说明 ↗</a></article>)}</section></main>
  </div>;
}
