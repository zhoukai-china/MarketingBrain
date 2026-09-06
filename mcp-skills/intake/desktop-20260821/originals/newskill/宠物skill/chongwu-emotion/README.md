# chongwu-emotion · 宠物门店情绪识别智能体

> 从「宠物情绪识别」蒸馏改造为宠物门店经营版：把"识别宠物心情"升级为"帮门店保安全、显专业、抓时机"。

## 这个 skill 是什么

宠物进店的情绪状态，决定门店"该不该动手、怎么安抚、什么时候卖"。本 skill 提供两样东西：

1. **方法论**（`SKILL.md`）：六情绪 → 门店三级安全分级、进店 10 秒观察、情绪 → 服务/销售时机、安抚话术、员工培训。
2. **可执行工具**（`scripts/` + `assets/`）：AI 拍照识别宠物情绪，输出门店经营报告（安全灯号 + 服务建议 + 销售机会 + 安抚话术 + 风险提示）。

## 目录结构

```
chongwu-emotion/
├── SKILL.md                       # 技能定义（方法论核心）
├── README.md                      # 本文件
├── scripts/
│   ├── pet_store_emotion.py       # 主脚本：薄入口 + 调用 Provider
│   ├── config.example.json        # 多源配置文件示例
│   └── providers/                 # 🆕 多源视觉 API 适配层
│       ├── __init__.py            # Provider 工厂
│       ├── base.py                # 抽象基类 + 公共常量 + 解析
│       ├── qwen_dashscope.py      # 旧：DashScope（控制台 2026-09 下线，但保留兼容）
│       ├── qwen_bailian.py        # 新：阿里百炼新版控制台
│       ├── modelscope.py          # 🆓 魔搭社区（推荐免费）
│       └── openai_vision.py       # 通用 OpenAI 兼容（GPT-4o / Claude 转发）
├── assets/
│   └── report_template.html       # 门店版 HTML 报告模板
└── references/
    └── emotion_guide.md           # 宠物情绪解读知识库（犬猫肢体语言）
```

## 多源视觉 API（🆕 2026-08 改造）

### 为什么做多源

旧版脚本依赖 DashScope 单点，2026-09 该控制台显示已下线。改造后：

| 源 | 模型 | 费用 | 适用 |
|---|---|---|---|
| **modelscope** 🆓 | Qwen/Qwen2.5-VL-72B-Instruct | 免费 token 够测 | 个人/测试/中小门店（推荐） |
| **qwen-bailian** | qwen-vl-max | 付费 | 国内生产环境首选 ✅ **当前已配置** |
| **qwen-dashscope** | qwen-vl-max | 付费 | （控制台已下线，仅兼容） |
| **openai** | gpt-4o | 付费 | 跨云备份，或用 Claude/Gemini 转发 |

自动选源策略：按 `免费→付费` 顺序挑第一个有 Key 的源（已配百炼时默认走 **qwen-bailian**）→ 都没有就报错退出。

### 三种使用方式

**① 环境变量（最常用）**
```bash
# 一次性（推荐 ModelScope 免费）
export MODELSCOPE_API_KEY="ms-你的访问令牌"
python scripts/pet_store_emotion.py --image pet.jpg

# 也支持 BAILIAN_API_KEY / DASHSCOPE_API_KEY / OPENAI_API_KEY
```

**② 配置文件**
```bash
# 复制示例
cp scripts/config.example.json ~/.workbuddy/config/pet_store_emotion.json
# 编辑填入 key
```
```json
{
  "bailian_api_key": "sk-xxxx",
  "qwen-bailian_base_url": "https://<你的百炼网关>/compatible-mode/v1",
  "qwen-bailian_model": "qwen-vl-max"
}
```

**③ 命令行强制指定**
```bash
python scripts/pet_store_emotion.py --image pet.jpg --provider modelscope --model Qwen/Qwen2.5-VL-7B-Instruct
```

### 快速开始

1. **Key 已配好（默认走百炼）**：本机 `~/.workbuddy/config/pet_store_emotion.json` 已写入百炼 Key（取自服务器 `/etc/baolu-secrets/baolu-os-v2.env` 的 `DASHSCOPE_API_KEY`），开箱即用，无需再申请。
   - 想换免费源：打开 https://modelscope.cn → 我的中心 → 访问令牌，把 token 写入配置文件的 `modelscope_api_key` 字段即可。

2. **自检**（不调 API，只验证 Key 是否被脚本找到）：
```bash
python scripts/pet_store_emotion.py --check
```

3. **看可用源列表**：
```bash
python scripts/pet_store_emotion.py --list-providers
```

4. **真跑一张照片**：
```bash
python scripts/pet_store_emotion.py --image path/to/pet.jpg --output pet_report.html
```
浏览器打开 `pet_report.html`，看门店经营报告（绿/黄/红灯号 + 服务/销售/安抚/风险）。

## 与同系列 skill 的分工

| skill | 管什么 |
|-------|--------|
| **chongwu-emotion（本）** | 进店瞬间的情绪读取 + 服务/销售时机 + 安抚 + AI识别辅助 |
| chongwu-behavior | 长期行为问题（乱叫/护食/乱尿）诊断与训练转化 |
| chongwu-sales | 成交连带升单的通用话术 |
| chongwu-sop | 洗护寄养服务标准 |
| chongwu-store | 店型/选址/单店模型 |

> 情绪灯号看"当下这一秒"，行为灯号看"长期行为史"——进店先读情绪（本 skill），涉及攻击史/护食再切 behavior。
