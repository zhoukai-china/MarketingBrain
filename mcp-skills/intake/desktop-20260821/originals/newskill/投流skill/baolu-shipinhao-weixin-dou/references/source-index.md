# 微信豆投放数据源索引（全量抓取记录）

> 训练日期：2026-08-18。本 skill 基于以下官方文档 + 实战方法论全量抓取蒸馏。

## 一、官方文档（腾讯微信官方）

### 核心使用手册
1. 《视频号内容加热使用手册》— https://store.weixin.qq.com/chengzhang/article/wiki?docid=8552
2. 《视频号商品加热使用手册》— https://channels-aladin.wxqcloud.qq.com/aladin/html/res/FinderPromoteNotificationMobile/index.html?id=mB3Do3yre7abu7rz&businessType=2
3. 《视频号直播加热帮助中心》— https://findeross.weixin.qq.com/cgi-bin/mmfindernodelivecrmwebbroker-bin/helper-center/pages/VxY7mztw9LM1KnIT
4. 《视频号直播加热FAQ》— https://findeross.weixin.qq.com/cgi-bin/mmfindernodelivecrmwebbroker-bin/helper-center/pages/iovd0kGx2RiSUHoo
5. 《视频号直播创作者流量包FAQ》— https://support.weixin.qq.com/cgi-bin/mmsupportacctnodeweb-bin/pages/TI6OpTIy26jVHC8r

### 规则类
6. 《微信视频号视频加热要求》（9类禁投）— https://support.weixin.qq.com/cgi-bin/mmsupportacctnodeweb-bin/pages/7SuPorSuijS7pKL2
7. 《微信视频号「直播加热成本保障计划」规则》— https://store.weixin.qq.com/chengzhang/webdoc/wiki/437/ef90ec8d3f0b614c/growth_center_rule_for_finder
8. 《微信视频号「直播创作者成本保障计划」规则》— https://store.weixin.qq.com/chengzhang/webdoc/wiki/435/8845ef223d82ac59/growth_center_rule_for_finder
9. 商家经营·流量篇（微信豆开票/加热要求/带货评分/企业账户注销）— https://store.weixin.qq.com/chengzhang/webdoc/wiki/1990/...

### 特殊场景指引
10. 【视频号】原生剧集指引文档（短剧加热）— https://support.weixin.qq.com/cgi-bin/mmsupportacctnodeweb-bin/pages/SeHyNK855zOIR5ep
11. 【视频号】短剧组件发表指引文档 — https://support.weixin.qq.com/cgi-bin/mmsupportacctnodeweb-bin/pages/SIpzHE629sgfRQdD

## 二、官方课程

12. 腾讯营销学堂《三种投流模式的功能及效果 | 视频号直播快闪营》（Harvey讲师，2026-04-24）— https://eschool.qq.com/Training/Detail/9e756362-12b

## 三、腾讯官方 FAQ（三大工具对比）

13. 《微信小店微信豆、腾讯营销(小店版)和ADQ有什么区别》— https://e.qq.com/faq/wechat-store/ad-operation/adq-wechat-coin-ad
14. 《微信小店微信豆、腾讯营销(小店版)和ADQ应该怎么选》— https://e.qq.com/faq/wechat-store/ad-operation/adq-wechat-coin/

## 四、第三方实战方法论

15. 蝴蝶智投《视频号加热工具怎么用》— https://sphnews.uliangtech.com/?p=3383（出价细则/加热方式/受众设定）
16. 蝴蝶智投《视频号起号如何付费加热》— https://sphnews.uliangtech.com?p=3551/（起号策略/出价基准/叠加计划）
17. 运营深度精选《微信豆加热直播的关键策略》— ima.qq.com（三阶段场景/投流策略）
18. 91运营《微信豆、ADQ和小店推广有啥区别》— https://www.91yunying.com/142879.html（类目选择）
19. 书单号投流全攻略 — ima.qq.com（工具选择决策树/充值比例）

## 五、关键数据速记

- 充值比例：安卓 1元=10豆，iOS 1元=7豆，网页充值中心 1:10
- 加热门槛：500 豆起，500 倍数，上限 30万豆（内容加热）
- 商品加热出价建议：40-80 之间，初次预算 1000-2000 豆
- 直播加热时长：0.5-24 小时共 14 档
- 成本保障：超成本 120% 触发，赔付最高 2 倍预期消耗且不超过下单金额
- 审核时长：内容加热约 20 分钟
- 停止加热：约 20 分钟生效，返还剩余微信豆/流量券
- **带货评分门槛：DSR ≥ 4.1 分才能商品加热**（低于 4.1 无法加热）
- 微信豆出价参考：观众 UV 0.3-0.8 元，商品点击 12-18 元

## 六、补充抓取（2026-08-18 第二轮）

20. 《微信豆充值协议》全文 — https://weixin.qq.com/cgi-bin/readtemplate?t=wxbean&lang=zh_CN ✅
21. 《微信视频号创作者流量包功能服务条款》全文 — https://weixin.qq.com/cgi-bin/readtemplate?t=finder_origin_pkg_agreement&lang=zh_CN ✅
22. 《微信豆自动续费服务规则》— https://support.weixin.qq.com/cgi-bin/mmsupportacctnodeweb-bin/pages/CSC7ELYtuM6P7Izp ✅
23. 《微信小店带货者评分管理规则》— youwant.cn（带货评分构成/门槛）✅
24. 《视频号橱窗评分规则》— xiaokeduo.com（店铺/带货评分构成）✅
25. 《视频号加热商家投放常见问题》（DSR 4.1 门槛）— https://channels-aladin.wxqcloud.qq.com/aladin/html/res/FinderPromoteNotificationMobile/index.html?businessType=2&id=B6LjMhV6DZ4APltL ✅
26. 视频号直播怎么投流（微信豆出价参考）— youwant.cn ✅

## 七、仍待补充（动态更新）

- 官方课程《三种投流模式的功能及效果》正课视频内容（Harvey 主讲，仅拿到课程概览，视频无法文本抓取）
- 部分规则文档为动态更新，建议定期回源核对
- 微信豆具体充值档位金额（安卓 10/180/500/1280/5180/12980 豆对应 1/18/50/128/518/1298 元，iOS 档位略低）

## 八、视频课程学习补足（2026-08-18 第三轮）

视频正文无法直接抓取，改用「官方图文干货 + 一线操盘手对话」等价补全，已新增 `references/practical-advanced.md`：

27. 腾讯营销学堂《视频号掘金必看！千万级GMV直播间投流干货》图文版 — https://eschool.qq.com/Solution/ListDetail/pd-8307 ✅（百准CEO对话夏恒/缪青敏/宋颖川：投流方法论、ADQ长效ROI 1:30、按主播方向投流、差异化AB测试、冷启动）
28. 腾讯新闻《毛利率60%、月利润65万，三人团队电商生意》— https://news.qq.com/rain/a/20250528A05Y1A00 ✅（短视频挂车投流SOP、微信豆/全域通/ADQ三模式、团队配置、投产数据）
29. 腾讯营销学堂《视频号ADQ的答疑&提量攻略》课程概览 — https://edu.tencentads.com/Training/Detail/4bfdd33c-c75 ✅
30. 视频号直播怎么投流（微信豆出价UV 0.3-0.8元/商品点击12-18元）— youwant.cn ✅

**关键术语确认**：课程「MP」= 腾讯营销(小店版)；「全域通」= 视频号对标抖音巨量千川的投放产品（2025年5月上线）。

**结论**：视频课程正文无法文本抓取（需登录回看），但已通过官方图文干货 + 讲师对话等价补全核心方法论。至此官方规则、协议、带货评分门槛、实战方法论、工具对比全部覆盖。

## 九、张SIR课程学习（2026-08-18 第四轮）

张SIR：全网50万粉投流博主，前宝尊最年轻市场投放经理，服务联合利华/惠氏/哈根达斯/迪士尼/蒙牛等40+大牌，经手投流超1.5亿。开创抖音投流培训赛道，DOU+课连续3年全网第一、销量2w+。

31. 张SIR《视频号微信豆投放课》（30节，视频课程，抓取完整目录）— feibaoke.com/blog/15477、waekk.com/shipinhao/9646 ✅
32. 腾讯营销学堂张SIR课程《如何通过付费流量撬动自然流量以及直接成交》— eschool.qq.com/Training/Detail/ef8d6044-dfd ✅
33. 张SIR公开IP资料（数据工程论/有效素材论/从业经历）✅
34. 5A人群理论（O-5A标准定义，A1了解/A2吸引/A3问询/A4首购/A5复购）— hqwc.cn、巨量千川5A解析 ✅

**说明**：张SIR课程正文是视频（.mp4），逐句口播拿不到，但已抓取完整30节目录 + 核心方法论（数据工程、有效素材、5A人群、内容四板斧）。已提炼为 `references/zhangsir-method.md`。

**核心结论**：5A人群理论 + 数据工程论 + 有效素材论，是张SIR区别于官方规则的差异化增量，已完整融入 skill。
