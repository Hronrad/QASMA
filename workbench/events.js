import {esc, eventSummary, eventText, initRunPage, pretty, replaceHtmlPreservingDetails} from "./common.js";

const $ = id => document.getElementById(id);
let current = null;
let filter = "all";
let query = "";

function group(event) {
  if (event.event.startsWith("agent_")) return "agent";
  if (event.event.startsWith("candidate_")) return "candidate";
  if (event.event.includes("solver") || event.event.includes("eval") || event.event.includes("proxy") || event.event.includes("certificate")) return "evaluator";
  return "system";
}

function render(data) { current = data; renderEvents(); }
function renderEvents() {
  if (!current) return;
  const events = (current.events || []).filter(event => {
    if (filter !== "all" && group(event) !== filter) return false;
    if (!query) return true;
    return JSON.stringify(event).toLowerCase().includes(query.toLowerCase());
  });
  const html = events.slice().reverse().map(event =>
    `<article class="event-card"><div class="event-index">#${esc(event.sequence ?? "—")}</div>` +
    `<div class="event-main"><header><b>${esc(eventText[event.event] || event.event)}</b><time>${esc(event.timestamp || "")}</time></header>` +
    `<p>${esc(eventSummary(event))}</p><div class="event-tags">` +
    (event.role ? `<span>Agent: ${esc(event.role)}</span>` : "") +
    (event.node_id ? `<a href="./index.html?node=${encodeURIComponent(event.node_id)}">节点: ${esc(event.node_id)}</a>` : "") +
    (event.candidate_id ? `<span>Candidate: ${esc(event.candidate_id)}</span>` : "") + `</div>` +
    `<details data-detail-key="event:${esc(event.sequence ?? "unknown")}"><summary>查看完整 evidence</summary><pre>${esc(pretty(event))}</pre></details></div></article>`
  ).join("") || '<div class="empty-state">当前筛选条件下没有事件。</div>';
  replaceHtmlPreservingDetails($("timeline"), html);
}

document.addEventListener("click", event => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  document.querySelectorAll("[data-filter]").forEach(item => item.classList.remove("active"));
  button.classList.add("active"); filter = button.dataset.filter; renderEvents();
});
$("event-search").addEventListener("input", event => { query = event.target.value; renderEvents(); });
initRunPage(render).catch(error => console.error(error));
