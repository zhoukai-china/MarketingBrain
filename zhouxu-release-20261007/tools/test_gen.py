#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
通用引擎端到端测试（在服务器上执行，Key 不落终端）

用法：venv/bin/python tools/test_gen.py <skill_id> <key_id> [输出文件]
"""
import json
import sys
import time
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:3007"

def exempt_terms(skill_id: str):
    """读取 pack 配置里的专业术语豁免名单（如投放产品「私信留资」）。"""
    import os
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "skill_packs", f"{skill_id}.json")
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f).get("banned_exempt") or []
    except Exception:
        return []


INPUTS = {
    "ip-positioning": {
        "name": "李总",
        "industry": "美业连锁（生美+科美双赛道）",
        "role_type": "连锁品牌",
        "goal": "招商",
        "stage": "起号期",
        "advantage": "16年美业经验，35项不破皮技术，零加盟费9800起，两万+学员",
        "audience": "想开美业店的女性创业者，30-45岁，有开店资金但怕被割韭菜、怕没客流",
        "competitors": "同类皮肤管理连锁、传统美容院加盟品牌",
        "platform": "抖音",
        "budget": "月预算2万，1名编导",
    },
    "acquisition-diagnosis": {
        "biz_type": "连锁品牌招商",
        "industry": "美业（皮肤管理）",
        "scale": "直营3家+加盟12家，总部月营收80万，招商团队4人",
        "channels": "抖音自然流占60%，老客户转介绍30%，美团团购10%；每月总客资约150条，成交2-3家",
        "content": "抖音总部号每周3条，主要是项目展示和门店环境，老板偶尔出镜；加盟商自己基本不发",
        "funnel": "月播放30万，私信咨询约150条，加到微信80人，邀约到访20人，签约2家",
        "pain": "客资量还行但质量差，聊两句就没影了，签约率上不去",
    },
    "store-visit-review": {
        "industry": "美业（皮肤管理）",
        "period": "2026年7月1日-7月20日",
        "scope": "多店，3家",
        "data": "日期,门店,到店组数,成交单数,成交金额,新客数,老客数\n"
                + "\n".join(
                    f"2026-07-{d:02d},{store},{a},{b},{c},{n},{o}"
                    for d, (a1, b1, c1, n1, o1, a2, b2, c2, n2, o2, a3, b3, c3, n3, o3) in [
                        (1, (32, 21, 8400, 14, 7, 18, 9, 3100, 11, 7, 12, 5, 1600, 8, 4)),
                        (2, (28, 18, 7200, 12, 6, 15, 7, 2400, 9, 6, 10, 4, 1300, 7, 3)),
                        (3, (35, 23, 9600, 15, 8, 20, 10, 3500, 12, 8, 14, 6, 1900, 9, 5)),
                        (4, (41, 28, 11800, 18, 10, 24, 13, 4600, 14, 10, 16, 7, 2200, 10, 6)),
                        (5, (45, 31, 13200, 20, 11, 26, 14, 5100, 15, 11, 18, 8, 2500, 11, 7)),
                        (6, (52, 36, 15400, 23, 13, 30, 17, 6200, 17, 13, 21, 10, 3100, 13, 8)),
                        (7, (48, 33, 14100, 21, 12, 28, 15, 5400, 16, 12, 19, 9, 2800, 12, 7)),
                        (8, (30, 20, 8000, 13, 7, 17, 8, 2800, 10, 7, 11, 5, 1500, 7, 4)),
                        (9, (26, 17, 6900, 11, 6, 14, 7, 2300, 8, 6, 10, 4, 1200, 6, 4)),
                        (10, (29, 19, 7700, 12, 7, 16, 8, 2700, 9, 7, 12, 5, 1500, 7, 5)),
                        (11, (38, 26, 10900, 17, 9, 22, 12, 4100, 13, 9, 15, 7, 2100, 9, 6)),
                        (12, (43, 29, 12300, 19, 10, 25, 13, 4700, 14, 11, 17, 8, 2400, 10, 7)),
                        (13, (50, 34, 14600, 22, 12, 29, 16, 5900, 16, 13, 20, 9, 2900, 12, 8)),
                        (14, (46, 31, 13300, 20, 11, 27, 14, 5200, 15, 12, 18, 8, 2600, 11, 7)),
                        (15, (24, 15, 6100, 10, 5, 13, 6, 2000, 7, 6, 9, 4, 1100, 5, 4)),
                        (16, (22, 14, 5700, 9, 5, 12, 5, 1800, 6, 6, 8, 3, 900, 4, 4)),
                        (17, (25, 16, 6500, 10, 6, 14, 7, 2400, 8, 6, 10, 4, 1300, 6, 4)),
                        (18, (33, 22, 9200, 14, 8, 19, 10, 3500, 11, 8, 13, 6, 1800, 8, 5)),
                        (19, (39, 27, 11400, 16, 11, 23, 12, 4300, 13, 10, 15, 7, 2100, 9, 6)),
                        (20, (42, 29, 12400, 18, 11, 25, 13, 4800, 14, 11, 17, 8, 2500, 10, 7)),
                    ]
                    for store, (a, b, c, n, o) in [
                        ("旗舰店", (a1, b1, c1, n1, o1)),
                        ("二店", (a2, b2, c2, n2, o2)),
                        ("三店", (a3, b3, c3, n3, o3)),
                    ]
                ),
        "context": "7月中旬上过一轮抖音团购引流，客单价被拉低；二店7月初换过店长",
        "focus": "客流没少但营业额降了，是不是客单价出问题",
    },
    "ad-delivery-plan": {
        "platform": "巨量本地推",
        "goal": "获取线索（招商加盟）",
        "industry": "美业连锁招商",
        "unit_econ": "加盟单客首年贡献毛利约8万，历史线索成交率5%，即一条线索期望价值4000元；可接受投产比 1:5（花1万带来5万营收）",
        "budget": "日预算500，总预算1.5万，可接受测30天",
        "history": "上月投了8000，来线索42条，线索成本190，成交1家",
        "material": "总部号自有素材30多条，1名编导，每周出3条；门店员工号基本不发",
        "region": "全国，重点华东华南；现有门店15家",
    },
    "moments-planner": {
        "industry": "美业连锁招商",
        "role_type": "连锁品牌",
        "audience": "想开美业店的女性创业者，30-45岁，怕被割韭菜、怕开了店没客流",
        "material": "周二跑了3家门店巡检；一个加盟商问回本周期；拒绝了2个不符合条件的咨询；学员毕业典礼",
        "focus": "推单店盈利模型诊断名额",
        "tone": "保禄口语风（短句、大白话、结尾⚡）",
    },
    "live-script-planner": {
        "scene": "招商加盟",
        "subject": "某美业连锁",
        "industry": "美业",
        "audience": "想开美业店的女性创业者，怕被割韭菜、怕没客流",
        "offer": "16年经验，35项不破皮技术，零加盟费9800起，两万+学员",
        "price": "9800起，整店20700（模型测算，以实际为准）",
        "hook": "送单店盈利模型测算表",
        "duration": "2小时",
        "team": "1主播+1场控",
    },
    "sales-advisor": {
        "biz": "美业连锁加盟，9800起，整店20700",
        "audience": "想开美业店的女性创业者，30-45岁，有5-30万闲钱",
        "case_desc": "加了微信两周，问过两次加盟费和回本周期，说要考虑，最近一周不回消息；朋友圈还在发，能看到她在看同行",
        "price": "9800-20700",
        "blocker": "她老公不同意，同时还在对比另一家品牌",
        "stage": "方案沟通",
    },
    "video-review-engine": {
        "platform": "抖音",
        "industry": "美业连锁招商",
        "goal": "客资",
        "data": "V1 播放1.2w 完播18% 赞320 评45 客资3；V2 播放860 完播41% 赞90 评12 客资5；V3 播放5.6w 完播9% 赞1500 评210 客资1；V4 播放3200 完播27% 赞180 评30 客资6；V5 播放640 完播38% 赞55 评8 客资2；V6 播放2.1w 完播15% 赞640 评88 客资2",
        "context": "起号期第3周，账号粉丝2300，V3 投过 DOU+ 200元",
    },
    "boss-decision": {
        "decision": "要不要在隔壁市开第二家火锅店",
        "background": "第一家店开了14个月，月营收稳定28万，月净利4万左右；我在店里盯得多，店长还没起来，现在我一周有5天在店里",
        "options": "A 现在就开；B 等3个月把店长培养起来再开；C 先在那边做个外卖档口试水3个月",
        "stakes": "开店要投35万，其中20万是借的；最坏能接受亏10万关门，但不能拖垮第一家店",
        "timing": "那个商圈有个铺子空出来，房东给了1个月考虑期",
        "people": "我老婆反对借钱扩张；店里有个小组长可能能顶上来，但没独立带过店",
        "worry": "怕第一家店离了我不行，两边都顾不上",
    },
    "finance-advisor": {
        "industry": "餐饮（中式快餐）",
        "revenue": "280000",
        "store_count": "3",
        "goods_rate": "38",
        "rent": "39200",
        "labor": "61600",
        "marketing": "16800",
        "misc": "11200",
        "invest": "800000",
        "cash": "150000",
        "target_profit": "60000",
        "concern": "流水不低但一年到头剩不下钱，想知道钱漏在哪",
        "context": "三家店，账是兼职会计做，只有流水没有成本拆分；明年想再开两家",
    },
    "hr-director": {
        "scale": "86人，其中3家门店共52人",
        "hr_setup": "1个行政兼HR",
        "industry": "连锁美业（皮肤管理）",
        "issue": "门店店长留不住，一年换了4个；新人入职两周就走；老员工不出活也不出错，开不掉",
        "context": "底薪+提成，提成按业绩阶梯；没有正式考核，全靠老板感觉；店长月薪8000-12000",
        "tried": "涨过一次底薪，留了两个月又走了；做过一次团建，没用",
        "urgency": "下个月就要开新店，急",
        "want": "建议+可直接用的表格",
    },
    "oriental-strategy": {
        "matter": "要不要把经营了6年的老业务砍掉，全力转新项目",
        "background": "老业务年营收800万，利润越来越薄，去年净利只有30万；新项目跑了半年，月营收20万还在涨，但还没盈利",
        "options": "A 直接砍；B 老业务维持不投入，人挪到新项目；C 两条都做再撑一年",
        "timing": "老业务最大的两个客户下个月续约，签就是一年",
        "people": "合伙人想守，团队老人怕动，新项目负责人催着要人",
        "worry": "怕砍早了，也怕守晚了",
    },
    "invest-return-card": {
        "industry": "美业（皮肤管理）",
        "store_type": "标准店",
        "invest": "207000",
        "revenue": "120000",
        "rent": "12000",
        "labor": "21000",
        "misc": "3000",
        "goods_rate": "25",
        "marketing_rate": "5",
        "area": "80平，二线城市",
        "note": "零加盟费，9800起，总部提供选址与培训",
    },
    "franchise-support": {
        "store_count": "直营8家 + 加盟63家",
        "industry": "中式快餐连锁",
        "pain": "新店开出来前三个月还行，半年后普遍掉量，掉完加盟商就开始闹；扶商团队天天救火，没精力做体系",
        "support_now": "总部有4人扶商团队，主要做开业支持和日常答疑；督导巡店每月1次；加盟商满意度没系统统计过；月均闭店2-3家，续约率约65%",
        "sample": "典型问题店：加盟商夫妻店，投资40万，之前没做过餐饮，开业第三个月营业额从18万掉到9万，现在天天在群里要总部给流量",
        "team": "扶商4人（2老2新），没有明确分层，谁有空谁去",
        "goal": "想把扶商从救火改成预防，明年目标闭店率降到月均1家以内",
    },
    "sales-funnel": {
        "scene": "招商加盟",
        "period": "2026年7月",
        "funnel": "曝光12000 → 建联860 → 留资320 → 邀约95 → 到访38 → 签约7",
        "cost": "本月招商投入：抖音投流4万，展会2万，人力成本6万",
        "deal_amount": "单店加盟费8万，首批货款6万",
        "timeline": "从留资到签约平均45天，最长拖过4个月",
        "team": "招商团队5人，平均从业1年半",
        "lost_reasons": "到访后主要说：再考虑考虑、回去跟家里商量、觉得加盟费贵、担心做不起来",
        "context": "品牌是中式快餐，全国60多家店，主要靠抖音获客",
    },
    "store-sop": {
        "module": "日常运营（开店打烊流程）",
        "industry": "中式快餐",
        "scale": "2-50家",
        "role": "店长",
        "pain": "开店时间没标准，早班有时候晚了20分钟才开始备餐；打烊后设备电源经常忘关；新店长上手全靠老人带，带出来的标准都不一样",
        "context": "单店8人，营业10:30-21:00，两个炸锅三台冰箱，无生食，目前没有任何书面标准",
        "extra": "要贴墙版，简洁；同时要一份给督导用的打分表",
    },
    "weixin-dou": {
        "target_type": "直播间",
        "goal": "成交订单量",
        "content": "视频号直播卖中老年女装，每天播4小时，自然场观约800，平均在线15人，一天成交20单左右，客单价189",
        "budget": "先试5000豆，有效果再加",
        "econ": "客单价189，单件毛利大概90",
        "history": "没投过，这是第一次",
        "audience": "45-60岁女性，二三线城市，还没有对标达人",
        "pain": "直播间人太少，自然流上不去，不知道该直投直播间还是先投短视频攒内容",
    },
    "ad-diagnosis": {
        "platform": "巨量本地推",
        "period": "2026年8月1日-8月31日，共31天",
        "spend": "38000",
        "impressions": "1250000",
        "clicks": "9800",
        "leads": "260",
        "deals": "31",
        "aov": "8600",
        "gross_margin": "55",
        "target_roi": "4",
        "account_state": "账户开了两个多月，中间换过三次素材、调过两次定向，上周开始跑不动，日预算500花不出去",
        "material": "在跑6条，都是门店环境+项目展示，两个月没换过新素材",
        "followup": "客服两人轮班，白天5分钟内回，晚上第二天上午才回",
        "pain": "感觉线索质量越来越差，加了微信聊两句就没影了",
    },
    "baodian-boost": {
        "industry": "中式快餐（粉面饭），客单价25元",
        "store_count": "3家直营",
        "product": "招牌酸菜鱼粉，28元一份，鱼片现杀现片，酸菜自己腌",
        "team": "一个店长兼职拍，一个外包剪辑每周交10条，总部没人管，门店自己发自己的",
        "current": "抖音总部号每周3条，主要拍菜品成品和环境，播放量300-800，基本没咨询；员工号没绑过",
        "goal": "主要要客流到店，顺带积累加盟线索",
        "budget": "每月1万",
        "pain": "拍了不少播放量一直上不去，偶尔有一条几万播放但没带来客人，不知道该继续还是换方向",
    },
    "canyin-startup": {
        "stage": "准备选址",
        "category": "中式粉面，40平米，18个座位",
        "invest": "总投入约28万，其中转让费6万、装修9万、设备7万、物料2万、押金2万、备用金2万",
        "rent": "12000",
        "labor": "14000",
        "utilities": "3500",
        "other_fixed": "1500",
        "var_rate": "38",
        "revenue": "95000",
        "target_profit": "20000",
        "location": "二线城市社区底商，临主路，半径500米内有3个小区1个写字楼，隔壁是家兰州拉面和一家沙县，中午人流还行晚上少",
        "pain": "转让费6万值不值得接，测算下来感觉一个月卖不到10万就没意思，但又怕错过这个位置",
    },
    "ip-four-piece": {
        "ip_profile": "人设：像朋友的专家，不像老师的老师。性格：可爱温柔不端着。语言：口语自然不书面。禁用词：包会、秘诀、零基础秒变、保证学会。视觉：暖色调奶白浅粉浅蓝，日常温柔风不正式。差异化：真人感IP非机构号。阶段：0-1起步期，先做同城深耕不求大流量。",
        "brand_name": "",
        "platform": "抖音",
        "dou_plus": "是",
        "extra": "名字里想带上城市'大连'，人设是钢琴老师所以头像想突出'在钢琴前'的氛围",
    },
    "dreamina-video": {
        "subject": "大连一家社区火锅店，红油翻滚的九宫格锅底，毛肚鸭肠黄喉等招牌菜摆了一桌",
        "industry": "餐饮",
        "purpose": "门店宣传",
        "aspect": "9:16",
        "duration": "5",
        "count": "2",
        "style_note": "电影感叙事，暖黄灯光，几桌客人安静用餐，人物面部模糊处理，留白适合叠字幕",
    },
    "yanglan-interview": {
        "interviewee": "李总，做餐饮连锁15年，从1家做到30家",
        "theme": "从一家夫妻店到区域连锁，他踩过最大的坑和翻盘的关键决策",
        "background": "早期做过服装亏了80万，2012年转行餐饮，第一家店开在县城，靠口碑做起来，2020年遇到疫情差点关掉一半店，后来做外卖和私域活下来，现在30家店年营收过亿。性格直爽，不喜欢被捧，最烦 interviewer 念履历。",
        "duration_ver": "5分钟版",
        "goal": "短视频人设访谈，用于视频号涨粉",
    },
    "meiye-live-script": {
        "shop_name": "兰琪美学",
        "anchor_role": "老板娘",
        "sell_type": "团购券 + 居家产品 + 会员卡",
        "main_project": "水光护理，核心成分是XX玻尿酸，做完当天脸润上妆服帖；居家产品是修护精华，晚上薄涂第二天脸软",
        "price_mechanism": "水光体验团购价299元（门店原价680），居家精华直播价199元（门店369），会员季卡2980元含8次护理",
        "platform": "抖音",
        "pain": "主播一开口就急着想卖货，留不住人，想让它更像聊天",
    },
    "delivery-standard": {
        "file_type": "出品标准卡",
        "tier": "T1",
        "industry": "餐饮",
        "subject": "招牌烤鱼",
        "params": "活鱼750g，上下火220度，目前靠师傅手感没有标准",
        "pain": "每家店烤出来的鱼不一样，客人投诉不稳定",
    },
    "live-review": {
        "live_type": "带货",
        "has_ad": "有",
        "role": "连锁品牌",
        "metrics": "场观12000，峰值在线380，平均在线95，平均停留1分40秒，评论560条，点赞3200，涨粉230，成交额8600元，退款率6%，投流花费600元、付费场观7000，商品点击率4%",
        "transcript": "开场讲了3分钟福利没进痛点，中间塑品段语速偏慢，有人问敏感受不了没接，逼单段在线反而涨了",
        "script_plan": "3秒钩子→痛点共鸣→FABE塑品→限时限量逼单→互动答疑",
    },
    "laoLi-chain": {
        "industry": "美业",
        "stage": "已开5家想扩张",
        "pain": "加盟商进来后活不下去，闭店率高",
        "store_count": "5家",
        "question": "怎么把加盟商扶起来而不是只收加盟费",
    },
    "enterprise-diagnosis": {
        "company": "XX商贸",
        "industry": "本地生活服务",
        "scale": "年营收2000万，30人，成立6年",
        "pain": "内容团队3个人每天写文案剪视频，效率低还不稳定",
        "scenes": "内容生成：每天2小时写文案，AI改造潜力高；销售获客：靠转介绍，无数据体系；管理决策：老板凭感觉拍板，不看周报",
        "budget": "能投10万以内",
    },
    "meiye-daily-brief": {
        "materials": "1）美团丽人频道上线「AI智能测肤」工具，到店前可上传照片预估肤质并推项目，8月28日上线。2）抖音生活服务推出美业商家「AI脚本助手」，输入门店项目自动生成探店口播稿，9月1日内测。3）国家卫健委更新医疗美容广告执法指南，明确AI生成的术前术后对比图须标注「模拟效果」且不得承诺疗效，8月30日发文。4）皮肤检测仪品牌「魔镜」发布端侧小模型版，单机可离线面诊并出报告，9月2日。5）某美业连锁总部把「总部内容工厂+门店分发」打法跑通，单店内容产出提升3倍，保禄客户案例。6）某科美连锁用数字人直播做晚场，人力成本降40%但转化率只有真人1/3。7）多模态大模型 Gemini 升级图像理解，面诊照片识别准确率提升。",
        "industry_focus": "生美/科美/丽人连锁",
        "edition": "2026-09-04 期",
    },
    "shangxueyuan": {
        "brand": "某中式快餐连锁",
        "store_count": "直营5家 + 加盟23家，共28家",
        "need": "诊断体系",
        "pain": "签得快死得也快，两家加盟商开了半年不赚钱开始闹退盟；总部就一个督导管不过来",
        "sample": "A店8个月月营收18万勉强持平；B店5个月月营收9万月亏1万已骂过两次；C店2年月营收35万是标杆想开二店",
        "data": "平均客单38，日均120单，租金占比18%，人工占比26%，外卖评分4.2，复购率22%",
    },
    "content-creator": {
        "topic": "一家开了8年的社区火锅店，靠老客复购活下来，想拍条视频讲「为什么不搞低价团购」",
        "role": "本地单店",
        "platform": "抖音+视频号",
        "industry": "餐饮",
        "goal": "获客到店",
        "materials": "复购率62%，大众点评4.8分，老板自己掌勺",
    },
    "digital-twin": {
        "question": "我开的第3家店，前两家都盈利，这家居然连续3个月亏，要不要关掉？",
        "industry": "餐饮",
        "role": "老板",
        "background": "前两家在社区，这家开在商场负一层，租金是前两家总和，外卖占比40%但平台抽成高",
        "output_type": "决策建议",
        "constraint": "手头现金只够撑2个月",
    },
    "yanglan-interview": {
        "interviewee": "李总，做餐饮连锁15年，从1家做到30家",
        "theme": "从一家夫妻店到区域连锁，他踩过的最大的坑和翻盘的关键决策",
        "background": "早期做过服装亏了80万，2012年转行餐饮，第一家店开在县城，靠口碑做起来，2020年遇到疫情差点关掉一半店，后来做外卖和私域活下来，现在30家店年营收过亿。性格直爽，不喜欢被捧。",
        "duration_ver": "5分钟版",
        "goal": "短视频人设访谈，用于视频号涨粉",
    },
}


def main():
    skill_id = sys.argv[1] if len(sys.argv) > 1 else "ip-positioning"
    key_id = int(sys.argv[2]) if len(sys.argv) > 2 else 5
    out = sys.argv[3] if len(sys.argv) > 3 else f"/tmp/gen_{skill_id}.md"

    from db import SessionLocal, ApiKey
    s = SessionLocal()
    k = s.query(ApiKey).filter(ApiKey.id == key_id).first()
    s.close()
    if not k:
        print("Key 不存在")
        return 1
    api_key, before = k.key, k.balance

    def req(method, path, body=None):
        data = json.dumps(body).encode("utf-8") if body else None
        r = urllib.request.Request(BASE + path, data=data, method=method)
        r.add_header("Authorization", f"Bearer {api_key}")
        r.add_header("Content-Type", "application/json")
        with urllib.request.urlopen(r, timeout=90) as resp:
            return json.loads(resp.read().decode("utf-8") or "{}")

    t0 = time.time()
    r = req("POST", "/skills/gen/tasks",
            {"skill_id": skill_id, "inputs": INPUTS.get(skill_id, {})})
    task_id = r["task_id"]
    print(f"[create] task={task_id} points={r.get('points')}")

    while True:
        time.sleep(5)
        st = req("GET", f"/skills/gen/tasks/{task_id}")
        status = st.get("status")
        el = int(time.time() - t0)
        print(f"[poll {el}s] status={status} progress={st.get('progress')}")
        if status == "success":
            md = st["data"]["markdown"]
            open(out, "w", encoding="utf-8").write(md)
            print(f"\n=== RESULT ===")
            print(f"耗时: {el}s | 字数: {len(md)} | 扣点: {st['billing']['total_points']} | 来源: {st['data'].get('gen_source')}")
            print(f"文件: {out}")

            banned = ["私信", "私聊", "私我", "加微", "加微信", "加V", "联系我",
                      "找我聊", "留个", "评论区扣", "评论区打", "扣1", "截图找我", "扫码加"]
            exempt = tuple(exempt_terms(skill_id))
            hits = []
            for line in md.splitlines():
                ls = line.strip()
                if any(m in ls for m in ("合规", "自查", "禁用", "红线", "禁止", "严禁", "避免", "不出现", "不引导", "不诱导")):
                    continue
                if exempt and any(t in ls for t in exempt):
                    continue
                for w in banned:
                    if w in ls and w not in hits:
                        hits.append(w)
            print(f"违规词: {hits if hits else '零命中 ✅'}"
                  + (f"（豁免术语：{list(exempt)}）" if exempt else ""))

            from db import SessionLocal as SL, ApiKey as AK
            s2 = SL()
            after = s2.query(AK).filter(AK.id == key_id).first().balance
            s2.close()
            print(f"余额: {before} -> {after}（差值 {before - after}）")
            return 0
        if status == "failed":
            print(f"[failed] {st.get('failure_code')} {st.get('message')}")
            return 1
        if el > 600:
            print("[timeout]")
            return 1


if __name__ == "__main__":
    sys.exit(main())
