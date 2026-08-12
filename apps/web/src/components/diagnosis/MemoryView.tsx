import { useState, useEffect } from "react";
import type { MemoryState, BusinessRole } from "../../types";
import { getStoredMemory, saveStoredMemory } from "../../lib/utils";

const ROLE_OPTIONS: { value: BusinessRole; label: string }[] = [
  { value: "local_business", label: "本地生活商家" },
  { value: "personal_ip", label: "个人IP/知识付费" },
  { value: "chain_brand", label: "连锁品牌" },
];

const MEMORY_SECTIONS: Array<{ key: keyof MemoryState; label: string; placeholder: string; hint: string }> = [
  {
    key: "tenantName" as keyof MemoryState,
    label: "品牌/个人名称",
    placeholder: "如：XX火锅、思潼说商业",
    hint: "你的品牌名称或IP名称，思潼会以此称呼你",
  },
  {
    key: "industry" as keyof MemoryState,
    label: "所属行业",
    placeholder: "如：餐饮、教培、美业、零售",
    hint: "帮助思潼理解你的行业特性",
  },
  {
    key: "city" as keyof MemoryState,
    label: "所在城市",
    placeholder: "如：成都、杭州",
    hint: "用于本地化经营建议",
  },
  {
    key: "positioning" as keyof MemoryState,
    label: "经营定位",
    placeholder: "如：中高端社区火锅、职场人个人成长IP",
    hint: "帮助AI理解你的市场定位",
  },
  {
    key: "customer" as keyof MemoryState,
    label: "目标客户",
    placeholder: "如：25-35岁白领女性、社区家庭",
    hint: "思潼将围绕这个客群给获客建议",
  },
  {
    key: "offer" as keyof MemoryState,
    label: "核心产品/服务",
    placeholder: "如：火锅外卖套餐、个人咨询、加盟方案",
    hint: "你的主营业务是什么",
  },
  {
    key: "acquisition" as keyof MemoryState,
    label: "获客方式",
    placeholder: "如：抖音短视频、老客转介绍、美团点评",
    hint: "现在主要通过什么渠道获客",
  },
  {
    key: "currentChallenge" as keyof MemoryState,
    label: "当前最大挑战",
    placeholder: "如：获客成本高、团队管理难、加盟商不好招",
    hint: "思潼将优先围绕这个挑战给你建议",
  },
  {
    key: "goal" as keyof MemoryState,
    label: "3个月目标",
    placeholder: "如：月营收翻倍、新开5家店、抖音粉丝破10万",
    hint: "让AI的每一步建议都有方向",
  },
];

export function MemoryView() {
  const [memory, setMemory] = useState<MemoryState>(getStoredMemory);
  const [saved, setSaved] = useState(false);

  function handleChange(key: keyof MemoryState, value: string) {
    setMemory((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  function handleSave() {
    saveStoredMemory(memory);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "24px 16px" }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--text)", margin: "0 0 6px" }}>
          经营记忆
        </h1>
        <p style={{ fontSize: 14, color: "var(--muted)", margin: 0 }}>
          完善经营信息，思潼会给你更精准的建议
        </p>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--gold)", marginBottom: 6 }}>
          经营角色
        </label>
        <div className="diagnosisRoleTabs" style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          {ROLE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={memory.role === opt.value ? "active" : ""}
              onClick={() => handleChange("role", opt.value)}
              style={{
                flex: 1,
                padding: "10px 12px",
                borderRadius: 8,
                border: memory.role === opt.value ? "2px solid var(--gold)" : "1px solid var(--line)",
                background: memory.role === opt.value ? "rgba(217,184,117,0.1)" : "var(--panel2)",
                color: memory.role === opt.value ? "var(--gold)" : "var(--muted)",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="memoryGrid" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {MEMORY_SECTIONS.map((section) => (
          <div key={section.key} className="memoryField" style={{ background: "var(--panel2)", border: "1px solid var(--line)", borderRadius: 10, padding: "16px 18px" }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>
              {section.label}
            </label>
            <input
              type="text"
              value={String(memory[section.key] ?? "")}
              onChange={(e) => handleChange(section.key, e.target.value)}
              placeholder={section.placeholder}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 6,
                border: "1px solid var(--line)",
                background: "var(--panel)",
                color: "var(--text)",
                fontSize: 14,
                outline: "none",
              }}
            />
            <p style={{ fontSize: 12, color: "var(--soft)", margin: "6px 0 0" }}>{section.hint}</p>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 24, textAlign: "center" }}>
        <button
          className="diagnosisStartBtn"
          onClick={handleSave}
          style={{ minWidth: 200 }}
        >
          {saved ? "✓ 已保存" : "保存经营记忆"}
        </button>
      </div>
    </div>
  );
}
