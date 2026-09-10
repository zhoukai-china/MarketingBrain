import { useEffect } from "react";
import { getAppPath } from "../lib/api.js";

type LegalPageKind = "terms" | "privacy";

interface LegalPageProps {
  kind: LegalPageKind;
}

const updatedAt = "2026年8月1日";

const termsSections = [
  ["1. 服务范围", "思潼AI 行业智能体平台为内测中的企业经营辅助工具，提供诊断、内容生成、智能体协作、资料管理等功能。具体开放能力以页面和双方约定为准。"],
  ["2. 账号与企业工作区", "你应提供真实、合法且有权使用的企业信息，并妥善保管邀请码和登录凭证。因自行泄露凭证造成的风险，由账号使用方承担。"],
  ["3. AI 生成内容", "AI 输出用于经营参考和提高工作效率，不构成对流量、订单、收入、招商结果或其他经营成果的保证。发布或执行前，你需要自行核对事实、数据、版权、平台规则和行业合规要求。"],
  ["4. 用户提交内容", "你保留对合法提交的企业资料、文案、图片和数据的相应权利，并授权平台在提供、改进和保障本次服务所必要的范围内处理这些内容。请勿上传无权使用、违法或侵害他人权益的材料。"],
  ["5. 使用规范", "不得利用服务生成或传播违法、欺诈、侵权、虚假宣传、恶意营销等内容，不得绕过权限、攻击系统、批量滥用接口或干扰其他用户。发现高风险使用时，运营团队可限制或暂停相关功能。"],
  ["6. 内测与稳定性", "内测期间功能、模型、配额和页面可能调整，也可能发生短时中断。我们会尽力保障服务可用并修复问题，但不承诺所有功能永久不变或完全无错误。"],
  ["7. 费用与交付", "诊断和报告按当前页面说明提供。收费功能、项目服务、退款和交付标准，以具体订单、报价单或双方另行确认的协议为准。"],
  ["8. 条款更新与联系", "服务升级或规则变化时，条款可能更新并在本页面标注日期。对条款有疑问，可联系向你发放邀请码的思潼AI 行业智能体平台服务人员。"]
] as const;

const privacySections = [
  ["1. 我们收集的信息", "为创建和维护企业工作区，我们会处理你主动填写的企业或品牌名称、经营类型、行业、城市、邀请码，以及使用过程中提交的对话、文件、企业资料和反馈。系统还会记录必要的登录、设备、接口与错误日志。"],
  ["2. 信息使用目的", "这些信息用于身份校验、建立企业工作区、生成和保存交付物、提供智能体能力、保障安全、排查故障、统计服务使用情况并改进产品。"],
  ["3. AI 模型与服务提供方", "为完成你发起的任务，必要的提示词、对话或文件内容可能被传输给系统当前配置的 AI 模型或基础设施服务提供方。我们会按照完成任务所需的最小范围调用，并持续完善权限和安全控制。请勿提交国家秘密、支付密码等不应交由本服务处理的高敏感信息。"],
  ["4. 信息共享", "除提供服务所必需、获得你的授权、履行法定义务或保护合法权益外，我们不会向无关第三方出售或披露你的企业资料和个人信息。"],
  ["5. 保存与安全", "我们根据服务需要和适用要求保存信息，并采取访问控制、日志记录、传输保护和备份等措施降低风险。互联网服务无法保证绝对安全，发生安全事件时我们会按实际情况采取处置措施。"],
  ["6. 你的权利", "你可以联系服务人员查询、更正或申请删除相关信息，也可以停止使用服务。部分记录可能因安全、审计、合同履行或法律要求在必要期限内保留。"],
  ["7. 未成年人", "本服务主要面向企业经营者和工作人员。未成年人不应在没有监护人同意和指导的情况下提交个人信息或使用收费服务。"],
  ["8. 政策更新与联系", "产品能力或处理方式变化时，本政策可能更新并在本页面标注日期。如有隐私问题或权利请求，可联系向你发放邀请码的思潼AI 行业智能体平台服务人员。"]
] as const;

export default function LegalPage({ kind }: LegalPageProps) {
  const isTerms = kind === "terms";
  const title = isTerms ? "服务条款" : "隐私政策";
  const sections = isTerms ? termsSections : privacySections;

  useEffect(() => {
    document.title = `${title} - 思潼AI 行业智能体平台`;
  }, [title]);

  return (
    <main className="legalPage">
      <article className="legalCard">
        <header className="legalHeader">
          <a className="legalBackLink" href={getAppPath("/login")}>← 返回企业入驻</a>
          <span className="legalBadge">内测版</span>
          <h1>{title}</h1>
          <p>更新日期：{updatedAt}</p>
        </header>

        <div className="legalIntro">
          欢迎使用思潼AI 行业智能体平台。请在使用服务前阅读本{isTerms ? "条款" : "政策"}；继续使用即表示你理解并接受其中与当前服务有关的内容。
        </div>

        <div className="legalContent">
          {sections.map(([heading, content]) => (
            <section key={heading}>
              <h2>{heading}</h2>
              <p>{content}</p>
            </section>
          ))}
        </div>

        <nav className="legalNav" aria-label="法律文件">
          <a href={getAppPath(isTerms ? "/privacy" : "/terms")}>{isTerms ? "查看隐私政策" : "查看服务条款"}</a>
          <a href={getAppPath("/login")}>返回企业入驻</a>
        </nav>
      </article>
    </main>
  );
}
