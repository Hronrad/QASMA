export const statusText = {
  target_reached: "目标已达到",
  evaluation_budget_exhausted: "完整评价预算已用尽",
  round_limit_or_director_stop: "轮次结束或 Director 停止",
  incomplete_no_valid_candidate: "没有合法候选",
  certified_upper_bound: "最坏上界已认证", registered: "任务已注册",
  certified_known_upper_bound: "已知最坏上界已复现",
  completed: "已完成", running: "运行中", failed: "失败",
  not_triggered: "本次未触发", not_implemented: "尚未完整接入",
};

export const kindText = {
  controller: "控制器", deterministic_agent: "确定性 Agent",
  store_agent: "状态存储 Agent", router_agent: "路由 Agent",
  governance_agent: "治理 Agent", task_plugin: "任务插件 Agent",
  llm_agent: "LLM Agent", memory_agent: "研究记忆 Agent",
  solver_agent: "求解器 Agent", verifier_agent: "验证 Agent",
  compiler_agent: "编译 Agent", evaluator_agent: "评价 Agent",
  archive_agent: "档案 Agent",
};

export const implementationText = {
  public_skeleton: "公开架构骨架", optional: "按任务启用",
};

export const eventText = {
  run_started: "运行开始", run_completed: "运行完成",
  agent_call_started: "LLM 调用开始", agent_call_completed: "LLM 调用完成",
  agent_call_failed: "LLM 调用失败", control_decision: "轮次控制决策",
  theory_grammar: "理论与语法计划", candidate_proposed: "候选已提出",
  candidate_rejected: "候选被拒绝", candidate_proxy_evaluated: "低成本评价完成",
  candidate_routed_out: "候选未晋级", candidate_evaluated: "完整评价完成",
  critique: "独立批判完成", contract_solver_started: "有界求解开始",
  contract_solver_completed: "有界求解完成", certificate_checked: "证书检查完成",
  round_completed: "轮次完成", sota_audit: "SOTA 门禁审计",
  sota_card: "SOTA 调研卡", node_started: "节点开始",
  node_completed: "节点完成", node_failed: "节点失败",
};

export const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));

export const fmt = (value, digits = 4) => value === null || value === undefined
  ? "—" : (typeof value === "number" ? value.toPrecision(digits) : String(value));

export const pretty = value => typeof value === "string"
  ? value : JSON.stringify(value, null, 2);

export function replaceHtmlPreservingDetails(container, html) {
  const previous = new Map();
  container.querySelectorAll("details[data-detail-key]").forEach(detail => {
    previous.set(detail.dataset.detailKey, detail.open);
  });
  const scrollTop = container.scrollTop;
  container.innerHTML = html;
  if (previous.size) {
    container.querySelectorAll("details[data-detail-key]").forEach(detail => {
      if (previous.has(detail.dataset.detailKey)) detail.open = previous.get(detail.dataset.detailKey);
    });
  }
  container.scrollTop = scrollTop;
}

let publicRunIndex = null;
let publicArchitecture = null;

async function loadJson(url) {
  const response = await fetch(url, {cache: "no-store"});
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

export async function api(path) {
  if (!publicRunIndex) {
    publicRunIndex = await loadJson(new URL("./data/runs.json", import.meta.url));
  }
  if (path === "/api/runs") return publicRunIndex;
  const match = path.match(/^\/api\/run\/(.+)$/);
  if (!match) throw new Error(`未知的公开数据路径：${path}`);
  const id = decodeURIComponent(match[1]);
  const entry = publicRunIndex.find(run => run.id === id);
  if (!entry) throw new Error(`找不到演示运行：${id}`);
  if (!publicArchitecture) {
    publicArchitecture = await loadJson(new URL("../architecture/qasma-v3.2.json", import.meta.url));
  }
  const run = await loadJson(new URL(`./data/${entry.file}`, import.meta.url));
  return {...run, architecture: publicArchitecture, live: false};
}

export function eventSummary(event) {
  if (event.event === "agent_call_started") return `${event.role} 开始调用，期望输出 ${event.expected_output}`;
  if (event.event === "agent_call_completed") return `${event.role} 返回合法 JSON`;
  if (event.event === "candidate_evaluated") return `${event.candidate_id}：infidelity=${fmt(event.metrics?.energy_error, 5)}，层级=${event.fidelity_level || "F3"}`;
  if (event.event === "candidate_proxy_evaluated") return `${event.candidate_id}：F1=${fmt(event.assessment?.f1_probe_mean)}，acquisition=${fmt(event.assessment?.acquisition)}`;
  if (event.event === "candidate_proposed") return `${event.proposal?.source_role || "backend"} 提出 ${(event.proposal?.actions || []).join(" → ")}`;
  if (event.event === "contract_solver_completed") return `${event.result?.status}，${event.result?.tokens?.length || 0} gates，${fmt(event.result?.elapsed_seconds)} s`;
  if (event.event === "control_decision") return event.decision?.round_goal || "已生成轮次决策";
  if (event.event === "critique") return `批判 ${event.critique?.critiques?.length || 0} 个候选`;
  return event.reason || event.status || eventText[event.event] || event.event;
}

export async function initRunPage(onRun, options = {}) {
  const select = document.getElementById("run-select");
  const badge = document.getElementById("live-badge");
  let currentId = null;
  let currentLive = false;

  async function load(id) {
    if (!id) return;
    currentId = id;
    localStorage.setItem("qasma.selectedRun", id);
    const data = await api(`/api/run/${encodeURIComponent(id)}`);
    currentLive = Boolean(data.live);
    if (badge) {
      badge.textContent = data.live ? "● 实时刷新" :
        `公开演示 · ${statusText[data.result?.status] || data.result?.status || "已完成"}`;
      badge.classList.toggle("live", data.live);
    }
    await onRun(data);
  }

  async function refreshList() {
    const runs = await api("/api/runs");
    if (!runs.length) {
      if (badge) badge.textContent = "没有运行数据";
      return;
    }
    const saved = localStorage.getItem("qasma.selectedRun");
    const preferred = runs.some(run => run.id === currentId) ? currentId :
      runs.some(run => run.id === saved) ? saved : runs[0].id;
    if (select) {
      select.innerHTML = runs.map(run =>
        `<option value="${esc(run.id)}">${esc(run.task || run.id)} · ${esc(statusText[run.status] || run.status)}</option>`
      ).join("");
      select.value = preferred;
    }
    await load(preferred);
  }

  if (select) select.addEventListener("change", event => load(event.target.value));
  await refreshList();
  const interval = window.setInterval(async () => {
    try { if (currentId && currentLive) await load(currentId); }
    catch (error) { console.error(error); }
  }, options.pollMs || 2000);
  return {load, refreshList, stop: () => clearInterval(interval)};
}

export function metricCard(label, value, sub = "") {
  return `<article class="metric-card"><span>${esc(label)}</span><b>${esc(value)}</b><small>${esc(sub)}</small></article>`;
}
