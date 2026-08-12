import {esc, fmt, initRunPage, metricCard, statusText} from "./common.js";

const $ = id => document.getElementById(id);

function render(data) {
  const result = data.result || {};
  const best = result.best || {};
  const runtime = data.node_runtime || {};
  const primary = result.primary_metric || {};
  const primaryName = primary.name || "最优 infidelity";
  const primaryValue = primary.value ?? best.energy_error;
  const completed = Object.values(runtime).filter(item => item.status === "completed").length;
  $("metrics").innerHTML = [
    metricCard("运行状态", statusText[result.status] || result.status || "运行中", result.method || "qasma-v3"),
    metricCard(primaryName, fmt(primaryValue, 6),
      primary.lower_is_better === false ? "数值越高越好" : "数值越低越好"),
    metricCard("B_full", result.b_full ?? 0, `B_proxy ${result.b_proxy ?? 0}`),
    metricCard("LLM 调用", result.b_llm ?? 0, `${Object.keys(result.agent_stats || {}).length} 个角色配置`),
    metricCard("已完成节点", `${completed}/${data.architecture?.nodes?.length || 0}`, "完整架构与实际路径分开统计"),
    metricCard("证据事件", data.events?.length || 0, `${result.rounds ?? 0} 个搜索轮次`),
  ].join("");
  renderSotaComparison(result);
  renderCurve(result.records || []);
  renderEvaluator(result.evaluator || {}, data.events || []);
  renderPath(data);
}

function finite(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return undefined;
}

function baselineFrom(result) {
  const card = result.sota_card || {};
  const baselines = Array.isArray(card.baselines) ? card.baselines : [];
  for (const baseline of baselines) {
    if (!baseline || typeof baseline !== "object") continue;
    const entries = [
      ["infidelity", baseline.infidelity], ["energy error", baseline.energy_error],
      ["T-count", baseline.t_count], ["gap", baseline.gap],
      [baseline.metric || "score", finite(baseline.value, baseline.metric_value, baseline.best_value, baseline.score)],
    ];
    const found = entries.find(([, value]) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)));
    if (found) return {name: baseline.name || baseline.id || "注册 SOTA", metric: found[0], value: Number(found[1])};
  }
  const comparison = result.comparison || {};
  const value = finite(comparison.sota_value, comparison.baseline_value, comparison.previous_best);
  return Number.isFinite(value) ? {name: comparison.baseline_name || "注册 SOTA", metric: comparison.metric || "score", value} : null;
}

function renderSotaComparison(result) {
  const best = result.best || {};
  const audit = result.sota_audit || null;
  const baseline = baselineFrom(result);
  const primary = result.primary_metric || {};
  const comparison = result.comparison || {};
  const currentMetricValue = finite(
    primary.value, comparison.current_value, best.energy_error);
  const currentError = Number(currentMetricValue);
  const currentMetricName = primary.name || comparison.metric || "infidelity";
  const lowerIsBetter = primary.lower_is_better !== false;
  const comparable = comparison.comparable !== false;
  const task = result.task || {};
  const actionCount = Array.isArray(best.actions) ? best.actions.length : null;
  const targetLength = Number.isFinite(Number(task.target_length)) ? Number(task.target_length) : null;
  const claimEligible = Boolean(audit?.claim_eligible);
  let improvement = "尚不可计算";
  let improvementDetail = "没有注册且数值口径一致的此前 SOTA。";
  if (!comparable) {
    improvement = "不计算降幅";
    improvementDetail = comparison.scope_warning ||
      "两项结果不属于相同方法空间或声明作用域。";
  } else if (baseline && Number.isFinite(currentError)) {
    const delta = lowerIsBetter
      ? baseline.value - currentError : currentError - baseline.value;
    const relative = baseline.value !== 0 ? delta / Math.abs(baseline.value) : null;
    improvement = delta > 0 ? `降低 ${fmt(delta, 5)}` : delta === 0 ? "持平" : `退化 ${fmt(-delta, 5)}`;
    improvementDetail = relative == null ? baseline.metric : `${baseline.metric} 相对变化 ${fmt(relative * 100, 5)}%`;
  } else if (targetLength != null && actionCount != null) {
    const delta = targetLength - actionCount;
    improvement = delta > 0 ? `少 ${delta} 个门` : delta === 0 ? "门数与生成目标相同" : `多 ${-delta} 个门`;
    improvementDetail = "这是任务内 ground-truth 参考，不是论文 SOTA。";
  }

  const source = audit?.sources?.[0];
  const baselineValue = baseline ? `${baseline.metric}: ${fmt(baseline.value, 6)}` : "未注册可比较数值";
  const currentValue = Number.isFinite(currentError)
    ? `${currentMetricName}: ${fmt(currentError, 7)}` : "尚无完整评价";
  const exact = Number.isFinite(currentError) && currentError <= Number(result.config?.target_error ?? 1e-10);
  const baselineLabel = comparison.baseline_label || "此前 SOTA";
  const currentLabel = comparison.current_label || "当前 QASMA 新结果";
  const currentDetail = result.current_result_detail ||
    `${actionCount ?? "—"} gates · depth ${best.depth ?? "—"} · 2q ${best.n2q ?? "—"}`;
  $("sota-comparison").innerHTML = `<div class="sota-compare-grid">` +
    comparisonPanel(baselineLabel, baselineValue, baseline?.name || source?.title || "本次运行未配置 SOTA scope/registry", "baseline") +
    comparisonPanel(currentLabel, currentValue, currentDetail, "current") +
    comparisonPanel("数值差异", improvement, improvementDetail, "delta") +
    comparisonPanel("声明状态", claimEligible ? "SOTA 门禁通过" :
      result.status === "certified_upper_bound" ? "最坏上界证书完成" :
      result.status === "certified_known_upper_bound" ? "已知上界复现；不是新 SOTA" :
      exact ? "精确重建，但非 SOTA 声明" : "尚不能声明超越 SOTA",
      claimEligible ? `${audit.scope_id || "已注册 scope"} · ${audit.status || "claim eligible"}` :
        result.status === "certified_upper_bound"
          ? `${result.certificate?.certificate_level || "certificate"}；不等同于最优性下界。`
          : result.status === "certified_known_upper_bound"
            ? `${result.certificate?.certificate_level || "certificate"}；${result.novelty?.reason || "仅复现已知上界。"}`
          : "只有注册来源、复现强基线并使用相同指标/实例后，才能报告超越 SOTA。",
      claimEligible || result.status === "certified_upper_bound" ? "pass" : "blocked") +
    `</div>`;
}

function comparisonPanel(label, value, detail, tone) {
  return `<article class="sota-panel ${tone}"><span>${esc(label)}</span><b>${esc(value)}</b><p>${esc(detail)}</p></article>`;
}

function renderCurve(records) {
  if (!records.length) { $("curve").innerHTML = '<div class="empty-state">暂无 F3/F4 完整评价</div>'; return; }
  const width = 760, height = 260, pad = 42;
  let best = Infinity;
  const values = records.map(record => best = Math.min(best, Number(record.energy_error)));
  const positives = values.filter(value => value > 0);
  const floor = Math.min(...positives, 1e-12);
  const logs = values.map(value => Math.log10(Math.max(value, floor * .1)));
  const lo = Math.min(...logs), hi = Math.max(...logs, lo + 1e-6);
  const x = index => pad + index * (width - 2 * pad) / Math.max(1, records.length - 1);
  const y = value => height - pad - (value - lo) * (height - 2 * pad) / (hi - lo);
  const path = logs.map((value, index) => `${index ? "L" : "M"}${x(index)},${y(value)}`).join(" ");
  $("curve").innerHTML = `<svg viewBox="0 0 ${width} ${height}" aria-label="搜索收敛曲线">` +
    `<line class="chart-axis" x1="${pad}" y1="${height-pad}" x2="${width-pad}" y2="${height-pad}"/>` +
    `<line class="chart-axis" x1="${pad}" y1="${pad}" x2="${pad}" y2="${height-pad}"/>` +
    `<path class="chart-line" d="${path}"/>` +
    logs.map((value, index) => `<circle class="chart-dot" cx="${x(index)}" cy="${y(value)}" r="5"><title>#${index+1}: ${values[index]}</title></circle>`).join("") +
    `<text class="chart-label" x="${pad}" y="20">log10(infidelity) ${hi.toFixed(2)} → ${lo.toFixed(2)}</text>` +
    `<text class="chart-label" x="${width-pad-50}" y="${height-12}">B_full</text></svg>`;
}

function renderEvaluator(evaluator, events) {
  const counts = {F0: 0, F1: 0, F2: 0, F3: 0, F4: 0};
  for (const event of events) {
    if (event.event === "candidate_proxy_evaluated") { counts.F0++; counts.F1++; counts.F2++; }
    if (event.event === "candidate_evaluated") counts[event.fidelity_level || "F3"]++;
  }
  const names = {F0: "Typed legality", F1: "隐藏 probe", F2: "Surrogate", F3: "完整模拟", F4: "精确证书"};
  const surrogate = evaluator.surrogate || {};
  $("evaluator").innerHTML = Object.entries(counts).map(([level, count]) =>
    `<div class="evaluator-row"><b>${level}</b><span>${esc(names[level])}</span><em>${count} 个候选</em></div>`
  ).join("") + `<div class="surrogate-summary"><span>SURROGATE</span><b>${surrogate.ready ? "已进入 learned ranking" : "仍处于 warm-up"}</b>` +
    `<small>${esc(surrogate.kind || "online ridge ensemble")} · training points ${surrogate.training_points ?? 0} · audit ${evaluator.audit_selected ?? 0}</small></div>`;
}

function renderPath(data) {
  const runtime = data.node_runtime || {};
  const active = (data.architecture?.nodes || []).filter(node =>
    ["completed", "running", "failed"].includes(runtime[node.id]?.status))
    .sort((a, b) => (runtime[a.id].first_sequence ?? 1e9) - (runtime[b.id].first_sequence ?? 1e9));
  $("run-path").innerHTML = active.map((node, index) =>
    `<a class="path-card" href="./index.html?node=${encodeURIComponent(node.id)}"><span class="path-number">${String(index + 1).padStart(2, "0")}</span>` +
    `<div><b>${esc(node.name)}</b><small>${esc(node.category)} · ${runtime[node.id].event_count} 事件</small></div>` +
    `<em>#${runtime[node.id].first_sequence ?? "—"}</em></a>`
  ).join("") || '<div class="empty-state">暂无运行路径</div>';
}

initRunPage(render).catch(error => console.error(error));
