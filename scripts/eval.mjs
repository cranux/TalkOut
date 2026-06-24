#!/usr/bin/env node
// 判定准度评测:用一组"剧本台词"打 /api/talk,逐轮打印 delta 和结局,人工对照预期。
// 用法:先 `npm run dev`(需 LLM_API_KEY),再另开终端 `npm run eval`。
// LLM 有随机性,这里不做硬断言,只把每轮判定摊开给你眼检。

const BASE = process.env.EVAL_BASE || "http://localhost:3000";

// 每个用例:角色 + 开场白(用于构造历史)+ 玩家逐句 + 预期方向
const CASES = [
  {
    characterId: "guard-laozhang",
    opener: "哎哎哎，工牌呢？没工牌不让进，规矩。",
    title: "老张·贿赂应触发红线",
    lines: ["给你两百块，通融一下，放我进去。"],
    expect: "redline_hit=true(明示行贿)",
  },
  {
    characterId: "guard-laozhang",
    opener: "哎哎哎，工牌呢？没工牌不让进，规矩。",
    title: "老张·空泛求情应≤0",
    lines: ["大哥我真的很急，求你了让我上去一下。"],
    expect: "delta ≤ 0(空泛求情)",
  },
  {
    characterId: "guard-laozhang",
    opener: "哎哎哎，工牌呢？没工牌不让进，规矩。",
    title: "老张·戳中弱点应正分",
    lines: [
      "张叔您快退休了吧？我懂您怕担责。这样，我手写个字条签字按手印，出任何事我一人担，绝不连累您退休金。",
    ],
    expect: "delta 明显为正(精准戳'担责/退休')",
  },
  {
    characterId: "refund-9527",
    opener: "亲您好呀～根据平台政策本订单已发货暂不支持退款哦～",
    title: "9527·合规威慑应正分",
    lines: [
      "商品描述与实物明显不符，我已保留开箱视频。按平台《七天无理由》及描述不符条款，这属于可退范围，否则我会发起平台介入并如实评价。",
    ],
    expect: "delta 为正(合规/舆情依据)",
  },
];

async function turn(characterId, history) {
  const res = await fetch(`${BASE}/api/talk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ characterId, history }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

async function run() {
  console.log(`\n▶ 判定评测 @ ${BASE}\n`);
  // 探活
  try {
    await fetch(`${BASE}/api/daily`);
  } catch {
    console.error("✗ 连不上服务,请先 `npm run dev`(并确保已设 LLM_API_KEY)。\n");
    process.exit(1);
  }

  for (const c of CASES) {
    console.log(`── ${c.title}`);
    console.log(`   预期:${c.expect}`);
    const history = [{ role: "assistant", content: c.opener }];
    let score = 0;
    try {
      for (const line of c.lines) {
        history.push({ role: "user", content: line });
        const t = await turn(c.characterId, history);
        score = Math.max(0, Math.min(100, score + t.persuasion_delta));
        history.push({ role: "assistant", content: t.reply });
        const flag = t.redline_hit ? " 🚩红线" : "";
        console.log(
          `   玩家:${line}`
        );
        console.log(
          `   AI(${t.emotion}) Δ${t.persuasion_delta >= 0 ? "+" : ""}${t.persuasion_delta} → ${score}${flag}:${t.reply}`
        );
      }
    } catch (e) {
      console.log(`   ✗ ${e.message}`);
    }
    console.log("");
  }
  console.log("评测完成。对照'预期'一栏眼检判定是否合理;偏差大就回去调 lib/characters.ts 或 route.ts 的评分规则。\n");
}

run();
