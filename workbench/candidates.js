import {esc, fmt, initRunPage, metricCard, pretty, replaceHtmlPreservingDetails} from "./common.js";

const $ = id => document.getElementById(id);
let current = null;
let query = "";

function render(data) {
  current = data;
  const records = data.result?.records || [];
  const exact = records.filter(record => record.fidelity_level === "F4").length;
  const sources = new Set(records.map(record => record.source_role).filter(Boolean));
  $("candidate-summary").innerHTML = [
    metricCard("已完整评价", records.length, "仅这些候选可进入最终 best"),
    metricCard("F4 证书", exact, "精确 process fidelity / witness"),
    metricCard("候选来源", sources.size, [...sources].join("、") || "—"),
    metricCard("低成本评价", data.result?.b_proxy ?? 0, "F0/F1/F2"),
  ].join("");
  renderCards();
}

function renderCards() {
  if (!current) return;
  const proxyEvents = Object.fromEntries((current.events || [])
    .filter(event => event.event === "candidate_proxy_evaluated")
    .map(event => [event.candidate_id, event.assessment]));
  const records = (current.result?.records || []).filter(record => {
    const text = `${record.candidate_id} ${record.source_role} ${(record.actions || []).join(" ")}`.toLowerCase();
    return !query || text.includes(query.toLowerCase());
  });
  const html = records.map(record => {
    const proxy = record.proxy || proxyEvents[record.candidate_id] || {};
    const detailKey = `candidate:${record.candidate_id || record.i || "unknown"}`;
    const actionKind = record.actions_are_gates === false ? "证明/编译步骤" : "线路门序列";
    return `<article class="candidate-card"><header><div><code>${esc(record.candidate_id || `eval-${record.i}`)}</code>` +
      `<span>${esc(record.source_role || "未知来源")}</span></div><div class="candidate-proof">${esc(record.proof_status || "empirical")}<b>${esc(record.fidelity_level || "F3")}</b></div></header>` +
      `<div class="candidate-action-label">${esc(actionKind)}</div>` +
      `<div class="circuit-strip">${(record.actions || []).map((action, index) => `<span><i>${index + 1}</i>${esc(action)}</span>`).join("<b>→</b>")}</div>` +
      `<div class="candidate-metric-grid">` +
      cell("F1 mean", fmt(proxy.f1_probe_mean)) + cell("F1 minimum", fmt(proxy.f1_probe_min)) +
      cell("Surrogate mean", fmt(proxy.surrogate_mean)) + cell("Uncertainty", fmt(proxy.surrogate_std)) +
      cell("Acquisition", fmt(proxy.acquisition)) + cell("Infidelity", fmt(record.energy_error, 6)) +
      cell("Depth", record.depth ?? "—") + cell("2q gates", record.n2q ?? "—") + cell("Round", record.round ?? "—") + `</div>` +
      `<details data-detail-key="${esc(detailKey)}"><summary>机制、Critic 与证书</summary><div class="candidate-detail">` +
      `<p><b>机制：</b>${esc(record.mechanism || "未记录")}</p><p><b>预期收益：</b>${esc(record.expected_gain || "未记录")}</p>` +
      `<p><b>风险：</b>${esc(record.risk || "未记录")}</p><h4>Critic</h4><pre>${esc(pretty(record.critique || {}))}</pre>` +
      `<h4>Certificate</h4><pre>${esc(pretty(record.certificate || {}))}</pre></div></details></article>`;
  }).join("") || '<div class="empty-state">没有匹配的候选线路。</div>';
  replaceHtmlPreservingDetails($("candidates"), html);
}

function cell(label, value) { return `<div><span>${esc(label)}</span><b>${esc(value)}</b></div>`; }
$("candidate-search").addEventListener("input", event => { query = event.target.value; renderCards(); });
initRunPage(render).catch(error => console.error(error));
