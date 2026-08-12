const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (!arg.startsWith("--")) continue;
  const next = process.argv[index + 1];
  args.set(arg, next && !next.startsWith("--") ? next : "true");
  if (next && !next.startsWith("--")) index += 1;
}

const baseUrl = String(args.get("--base") ?? process.env.ACQUISITION_ACCEPTANCE_BASE_URL ?? "http://localhost:3011").replace(/\/$/, "");
let token = String(args.get("--token") ?? process.env.ACQUISITION_ACCEPTANCE_TOKEN ?? "");

const scenarios = [
  {
    id: "takeaway_order_growth",
    name: "外卖订单增长",
    capabilityIds: ["industry_hotspots", "content_plan", "live_script"],
    routingInput: "枕水江南 外卖订单增长 行业热点 7天内容 60分钟直播",
    input: "请为枕水江南制定线上外卖订单增长方案。行业：中式快餐外卖连锁；城市：沈阳；现有7家外卖店，新店外卖销售额较低。抖音短视频和直播负责本地曝光、菜品种草与品牌搜索，成交回到美团、饿了么、淘宝闪购；不做抖音团购或到店核销。请联合交付有来源的行业热点与待验证选题、7天内容计划、60分钟外卖直播话术。菜品、套餐、价格、优惠和经营数据暂未提供。",
    taskCustomerProfile: {
      name: "枕水江南", industry: "中式快餐外卖连锁", city: "沈阳", storeScale: "7家外卖店",
      currentProblem: "新店外卖销售额较低", growthGoal: "提升美团、饿了么、淘宝闪购真实订单",
      platforms: "抖音、美团、饿了么、淘宝闪购"
    },
    required: ["枕水江南", "沈阳", "美团", "饿了么", "淘宝闪购", "第1天", "第7天", "60分钟", "【待补】"],
    forbidden: [
      ["服务方城市串入", /杭州/],
      ["错误使用抖音团购成交", /(?:引导|完成|通过|进入).{0,12}抖音团购(?:下单|核销)/],
      ["错误使用到店核销", /(?:引导|完成|通过|进入).{0,12}到店核销/]
    ]
  },
  {
    id: "local_store_growth",
    name: "到店获客增长",
    capabilityIds: ["topic_inspiration", "content_plan", "private_domain"],
    routingInput: "悦己皮肤管理 到店获客 选题 7天内容 朋友圈",
    input: "请为悦己皮肤管理制定7天到店获客方案，组合选题灵感、短视频文案和朋友圈私域承接。主推服务、价格、案例、账号数据和历史到店数据暂未提供，缺失内容保留【待补】，不得编造效果、价格和案例。",
    taskCustomerProfile: {
      name: "悦己皮肤管理", industry: "美业皮肤管理", city: "沈阳", storeScale: "1家店",
      currentProblem: "有效预约和实际到店不足", growthGoal: "提升附近顾客咨询、预约和实际到店", platforms: "抖音、朋友圈"
    },
    required: ["悦己皮肤管理", "沈阳", "第1天", "第7天", "可直接口播", "朋友圈", "实际到店", "【待补】"],
    forbidden: [
      ["服务方城市串入", /杭州/],
      ["混入美甲模板", /通勤美甲|手型|甲型/],
      ["混入外卖成交链路", /外卖平台下单路径/]
    ]
  },
  {
    id: "franchise_growth",
    name: "招商加盟增长",
    capabilityIds: ["franchise_acquisition", "live_script", "private_domain"],
    routingInput: "三禾糖水铺 招商加盟 60分钟直播 私域 30天",
    input: "请为三禾糖水铺制定招商加盟增长方案，组合招商短视频、60分钟完整招商直播话术包和朋友圈私域承接，输出线索筛选、考察转化与30天行动计划。加盟费、投资、回本、盈利、扶持和案例暂未提供，不得承诺收益，不得编造案例。",
    taskCustomerProfile: {
      name: "三禾糖水铺", industry: "餐饮糖水连锁", storeScale: "约30家店",
      currentProblem: "招商加盟扩张慢", growthGoal: "提升有效加盟咨询、筛选和考察预约", platforms: "抖音、直播、朋友圈"
    },
    required: ["三禾糖水铺", "30家", "60分钟", "主播口播稿", "线索", "考察", "30天", "加盟需谨慎", "【待补】"],
    forbidden: [
      ["服务方城市串入", /杭州/],
      ["收益承诺", /稳赚|保证收益|确保收益|一定回本|必然回本|无风险加盟|零风险赚钱/]
    ]
  },
  {
    id: "beauty_franchise_growth",
    name: "美业招商加盟增长",
    capabilityIds: ["franchise_acquisition", "live_script", "private_domain"],
    routingInput: "美研社连锁 美业招商加盟 60分钟直播 私域 30天",
    input: "请为美研社连锁（内部模拟品牌）制定美业招商加盟增长方案，组合招商短视频、60分钟招商直播话术和朋友圈私域承接，输出加盟线索筛选、到店考察、签约跟进与30天计划。加盟费、投资预算、回本、盈利、扶持政策、门店数据和案例暂未提供，不得承诺收益，不得转成培训招生、招店长合伙人或合伙人培养。",
    taskCustomerProfile: {
      name: "美研社连锁", industry: "美业皮肤管理连锁", storeScale: "门店规模待补",
      currentProblem: "招商加盟有效线索不足", growthGoal: "提升有效加盟咨询、到店考察和签约跟进", platforms: "抖音、直播、朋友圈"
    },
    required: ["美研社连锁", "美业", "60分钟", "加盟", "线索", "考察", "30天", "【待补】"],
    forbidden: [
      ["服务方城市串入", /杭州/],
      ["错误转成培训招生", /(?:改成|(?<!不得)转成|定位为|主要做|目标是).{0,6}培训招生|招收学员|学员获客|(?:招募|培养).{0,6}店长级合伙人/],
      ["收益承诺", /稳赚|保证收益|确保收益|一定回本|必然回本|无风险加盟|零风险赚钱/]
    ]
  }
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
  if (!response.ok) throw new Error(`${options.method ?? "GET"} ${path} -> ${response.status}: ${JSON.stringify(payload).slice(0, 500)}`);
  return payload;
}

async function ensureLogin() {
  if (token) return;
  const login = await request("/auth/dev-login", {
    method: "POST",
    body: {
      planCode: "chain_premium",
      tenantName: "思潼四场景验收",
      industry: "AI企业改造",
      city: "杭州",
      nickname: "自动验收"
    }
  });
  assert(login.token, "dev-login 未返回 token；生产环境请传 --token");
  token = login.token;
}

async function runScenario(scenario) {
  const startedAt = Date.now();
  const result = await request("/agents/acquisition/runs", {
    method: "POST",
    body: {
      requestId: `accept-${scenario.id}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
      input: scenario.input,
      routingInput: scenario.routingInput,
      capabilityIds: scenario.capabilityIds,
      capabilitySelectionMode: "explicit",
      deviceScope: "desktop",
      taskCustomerProfile: scenario.taskCustomerProfile
    }
  });
  assert(result.status === "success", `${scenario.name} status=${result.status}`);
  assert(result.deliveryStatus === "completed", `${scenario.name} deliveryStatus=${result.deliveryStatus}`);
  assert(result.execution?.steps?.length === 3, `${scenario.name} 没有返回3个执行步骤`);
  for (const capabilityId of scenario.capabilityIds) {
    const step = result.execution.steps.find((item) => item.capabilityId === capabilityId);
    assert(step, `${scenario.name} 缺少能力 ${capabilityId}`);
    assert(step.status === "success", `${scenario.name}/${capabilityId} 未完成: ${step.error?.code ?? step.status}`);
  }
  for (const term of scenario.required) assert(result.answerText.includes(term), `${scenario.name} 缺少必需内容：${term}`);
  for (const [label, pattern] of scenario.forbidden) assert(!pattern.test(result.answerText), `${scenario.name} 命中禁用项：${label}`);
  assert(!result.qualityFlags?.includes("partial_skill_delivery"), `${scenario.name} 出现部分交付`);
  return {
    scenario: scenario.name,
    status: "PASS",
    durationSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
    characters: result.answerText.length,
    capabilities: result.execution.steps.map((step) => step.capabilityId).join(" + ")
  };
}

await request("/health");
await ensureLogin();
const results = [];
for (const scenario of scenarios) {
  process.stdout.write(`正在验收：${scenario.name} ... `);
  try {
    const result = await runScenario(scenario);
    results.push(result);
    console.log(`PASS (${result.durationSeconds}s)`);
  } catch (error) {
    console.log("FAIL");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
    break;
  }
}

if (!process.exitCode) {
  console.table(results);
  console.log("品牌获客四大增长场景验收通过。客户资料缺失项均以待补处理，不阻塞第一版交付。");
}
