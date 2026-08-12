import {
  esc, eventSummary, eventText, fmt, implementationText, initRunPage,
  kindText, pretty, replaceHtmlPreservingDetails, statusText,
} from "./common.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const NODE_W = 280;
const NODE_H = 112;
const X_STEP = 390;
const Y_STEP = 146;
const X_START = 90;
const CENTER_Y = 470;
const HORIZONTAL_GRAPH_H = 1220;
const PART_PADDING_X = 48;
const SNAKE_PARTS_PER_ROW = 3;
const SNAKE_PART_GAP = 58;
const SNAKE_ROW_GAP = 70;
const SNAKE_HEADER_H = 124;
const state = {
  data: null,
  nodes: [], edges: [], layout: new Map(), partLayout: new Map(), phaseLayout: new Map(), nodePorts: new Map(),
  selected: null, tab: "definition", activeOnly: false, search: "",
  layoutMode: localStorage.getItem("qasma-layout-mode") === "snake" ? "snake" : "horizontal",
  bounds: {minX: 0, minY: 0, maxX: 1000, maxY: HORIZONTAL_GRAPH_H},
  usedRouteSegments: [], labelBoxes: [],
  view: {x: 44, y: 44, scale: .78},
  dragging: false, pointerId: null, lastPoint: null, initialized: false,
};

const $ = id => document.getElementById(id);
const svgEl = (name, attrs = {}) => {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  return element;
};

function runtime(nodeId) { return state.data?.node_runtime?.[nodeId] || {}; }
function graphWidth() {
  return Math.max(1000, state.bounds.maxX + 100);
}
function graphHeight() { return Math.max(700, state.bounds.maxY + 90); }
function isActive(nodeId) {
  return ["completed", "running", "failed"].includes(runtime(nodeId).status);
}

function filteredArchitecture() {
  const architecture = state.data?.architecture || {nodes: [], edges: [], phases: [], parts: []};
  const nodes = architecture.nodes.filter(node => !state.activeOnly || isActive(node.id));
  const ids = new Set(nodes.map(node => node.id));
  return {
    nodes,
    edges: architecture.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target)),
    phases: architecture.phases,
    parts: architecture.parts || [],
  };
}

function computeHorizontalLayout(nodes, parts) {
  const byLayer = new Map();
  for (const node of nodes) {
    if (!byLayer.has(node.layer)) byLayer.set(node.layer, []);
    byLayer.get(node.layer).push(node);
  }
  const layout = new Map();
  for (const [layer, items] of byLayer.entries()) {
    items.sort((a, b) => a.order - b.order);
    const total = (items.length - 1) * Y_STEP;
    const firstY = CENTER_Y - total / 2;
    items.forEach((node, index) => layout.set(node.id, {
      x: X_START + layer * X_STEP,
      y: firstY + index * Y_STEP,
      layer,
    }));
  }
  const partLayout = new Map();
  const visibleLayers = new Set(nodes.map(node => node.layer));
  for (const part of parts) {
    const layers = part.layers.filter(value => visibleLayers.has(value));
    if (!layers.length) continue;
    const minLayer = Math.min(...layers);
    const maxLayer = Math.max(...layers);
    partLayout.set(part.id, {
      x: X_START + minLayer * X_STEP - PART_PADDING_X,
      y: 10,
      width: (maxLayer - minLayer) * X_STEP + NODE_W + PART_PADDING_X * 2,
      height: HORIZONTAL_GRAPH_H - 96,
      direction: 1,
    });
  }
  const phaseLayout = new Map();
  for (const layer of visibleLayers) {
    phaseLayout.set(layer, {
      x: X_START + layer * X_STEP + NODE_W / 2,
      y1: 114,
      y2: HORIZONTAL_GRAPH_H - 135,
      indexY: 80,
      titleY: 99,
    });
  }
  return {
    layout,
    partLayout,
    phaseLayout,
    bounds: {minX: 0, minY: 0, maxX: graphMaxX(layout), maxY: HORIZONTAL_GRAPH_H},
  };
}

function graphMaxX(layout) {
  const positions = [...layout.values()];
  return (positions.length ? Math.max(...positions.map(position => position.x)) : X_START) + NODE_W;
}

function computeSnakeLayout(nodes, parts) {
  const visibleLayers = new Set(nodes.map(node => node.layer));
  const byLayer = new Map();
  for (const node of nodes) {
    if (!byLayer.has(node.layer)) byLayer.set(node.layer, []);
    byLayer.get(node.layer).push(node);
  }
  for (const items of byLayer.values()) items.sort((a, b) => a.order - b.order);

  const visibleParts = parts.map(part => ({
    ...part,
    layers: part.layers.filter(layer => visibleLayers.has(layer)),
  })).filter(part => part.layers.length);
  const rows = [];
  for (let index = 0; index < visibleParts.length; index += SNAKE_PARTS_PER_ROW) {
    rows.push(visibleParts.slice(index, index + SNAKE_PARTS_PER_ROW));
  }
  const partWidth = part => (part.layers.length - 1) * X_STEP + NODE_W + PART_PADDING_X * 2;
  const partHeight = part => {
    const maxNodes = Math.max(1, ...part.layers.map(layer => byLayer.get(layer)?.length || 0));
    return SNAKE_HEADER_H + (maxNodes - 1) * Y_STEP + NODE_H + 42;
  };
  const rowWidths = rows.map(row => row.reduce((sum, part) => sum + partWidth(part), 0) + Math.max(0, row.length - 1) * SNAKE_PART_GAP);
  const maxRowWidth = Math.max(900, ...rowWidths);
  const layout = new Map();
  const partLayout = new Map();
  const phaseLayout = new Map();
  let rowY = 30;

  rows.forEach((row, rowIndex) => {
    const forward = rowIndex % 2 === 0;
    const rowHeight = Math.max(...row.map(partHeight));
    let cursor = forward ? X_START : X_START + maxRowWidth;
    const orderedParts = row;

    for (const part of orderedParts) {
      const width = partWidth(part);
      const x = forward ? cursor : cursor - width;
      const direction = forward ? 1 : -1;
      partLayout.set(part.id, {x, y: rowY, width, height: rowHeight, direction});
      const maxNodes = Math.max(1, ...part.layers.map(layer => byLayer.get(layer)?.length || 0));
      part.layers.forEach((layer, layerIndex) => {
        const visualIndex = direction === 1 ? layerIndex : part.layers.length - 1 - layerIndex;
        const nodeX = x + PART_PADDING_X + visualIndex * X_STEP;
        const items = byLayer.get(layer) || [];
        const firstY = rowY + SNAKE_HEADER_H + (maxNodes - items.length) * Y_STEP / 2;
        items.forEach((node, itemIndex) => layout.set(node.id, {
          x: nodeX,
          y: firstY + itemIndex * Y_STEP,
          layer,
          partId: part.id,
          row: rowIndex,
        }));
        phaseLayout.set(layer, {
          x: nodeX + NODE_W / 2,
          y1: rowY + 91,
          y2: rowY + rowHeight - 24,
          indexY: rowY + 76,
          titleY: rowY + 96,
        });
      });
      cursor += forward ? width + SNAKE_PART_GAP : -(width + SNAKE_PART_GAP);
    }
    rowY += rowHeight + SNAKE_ROW_GAP;
  });
  return {
    layout,
    partLayout,
    phaseLayout,
    bounds: {minX: 0, minY: 0, maxX: X_START + maxRowWidth, maxY: rowY - SNAKE_ROW_GAP + 30},
  };
}

function computeLayout(nodes, parts) {
  return state.layoutMode === "snake" ? computeSnakeLayout(nodes, parts) : computeHorizontalLayout(nodes, parts);
}

function setLayoutMode(mode, shouldFit = true) {
  state.layoutMode = mode === "snake" ? "snake" : "horizontal";
  localStorage.setItem("qasma-layout-mode", state.layoutMode);
  $("layout-toggle").textContent = state.layoutMode === "snake" ? "布局：紧凑蛇形" : "布局：横向";
  $("layout-toggle").classList.toggle("active", state.layoutMode === "snake");
  $("layout-toggle").setAttribute("aria-pressed", String(state.layoutMode === "snake"));
  if (state.data) {
    renderWorkflow(state.data);
    if (shouldFit) fitGraph();
  }
}

function renderWorkflow(data) {
  state.data = data;
  const architecture = filteredArchitecture();
  state.nodes = architecture.nodes;
  state.edges = architecture.edges;
  const computed = computeLayout(state.nodes, architecture.parts || []);
  state.layout = computed.layout;
  state.partLayout = computed.partLayout;
  state.phaseLayout = computed.phaseLayout;
  state.bounds = computed.bounds;
  renderParts(architecture.parts || []);
  renderPhases(architecture.phases || []);
  renderEdges();
  renderNodes();
  renderMinimap();
  applyTransform();
  $("canvas-loading")?.classList.add("hidden");
  if (!state.initialized) {
    state.initialized = true;
    const requested = new URLSearchParams(location.search).get("node");
    if (requested && state.layout.has(requested)) {
      selectNode(requested); centerNode(requested, .92);
    }
  } else if (state.selected) {
    updateSelectionStyles(); renderInspector();
  }
}

function renderParts(parts) {
  const layer = $("part-layer");
  layer.innerHTML = "";
  for (const part of parts) {
    const geometry = state.partLayout.get(part.id);
    if (!geometry) continue;
    const {x, y, width, height, direction} = geometry;
    const group = svgEl("g", {class: `workflow-part part-${part.color}`});
    const rect = svgEl("rect", {x, y, width, height, rx: 18, class: "part-background"});
    const title = svgEl("text", {x: x + 16, y: y + 28, class: "part-title"});
    title.textContent = part.name;
    const description = svgEl("text", {x: x + 16, y: y + 51, class: "part-description"});
    description.textContent = part.description;
    group.append(rect, title, description);
    layer.appendChild(group);
  }
}

function renderPhases(phases) {
  const layer = $("phase-layer");
  layer.innerHTML = "";
  for (const phase of phases) {
    const geometry = state.phaseLayout.get(phase.layer);
    if (!geometry) continue;
    const {x, y1, y2, indexY, titleY} = geometry;
    const line = svgEl("line", {x1: x, y1, x2: x, y2, class: "phase-guide"});
    const index = svgEl("text", {x, y: indexY, class: "phase-index", "text-anchor": "middle"});
    index.textContent = String(phase.layer + 1).padStart(2, "0");
    const title = svgEl("text", {x, y: titleY, class: "phase-title", "text-anchor": "middle"});
    title.textContent = phase.name;
    layer.append(line, index, title);
  }
}

function renderNodes() {
  const layer = $("node-layer");
  layer.innerHTML = "";
  const models = state.data.role_models || {};
  for (const node of state.nodes) {
    const position = state.layout.get(node.id);
    const run = runtime(node.id);
    const status = run.status || "not_triggered";
    const group = svgEl("g", {
      class: `workflow-node status-${status}${node.kind === "llm_agent" ? " llm-node" : ""}`,
      transform: `translate(${position.x},${position.y})`,
      "data-node": node.id,
      tabindex: "0",
      role: "button",
    });
    const title = svgEl("title");
    title.textContent = `${node.name}\n${node.description}\n点击查看详细运行信息`;
    const card = svgEl("rect", {width: NODE_W, height: NODE_H, rx: 10, class: "node-card", filter: "url(#node-shadow)"});
    const statusDot = svgEl("circle", {cx: 18, cy: 21, r: 6, class: "node-state"});
    const name = svgEl("text", {x: 31, y: 27, class: "node-name"});
    name.textContent = node.name;
    const kind = svgEl("text", {x: 16, y: 58, class: "node-kind-label"});
    kind.textContent = kindText[node.kind] || node.kind;
    const model = node.model_role ? models[node.model_role] : null;
    const meta = svgEl("text", {x: 16, y: 82, class: "node-meta-label"});
    meta.textContent = model || implementationText[node.implementation] || node.implementation;
    const eventCount = svgEl("text", {x: NODE_W - 16, y: 82, class: "node-event-count", "text-anchor": "end"});
    eventCount.textContent = `${run.event_count || 0} 事件`;
    const statusLabel = svgEl("text", {x: 16, y: 103, class: "node-status-label"});
    statusLabel.textContent = statusText[status] || status;
    group.append(title, card, statusDot, name, kind, meta, eventCount, statusLabel);
    if (node.kind === "llm_agent") {
      const badge = svgEl("rect", {x: NODE_W - 59, y: 11, width: 43, height: 21, rx: 10, class: "llm-badge"});
      const badgeText = svgEl("text", {x: NODE_W - 37.5, y: 26, class: "llm-badge-text", "text-anchor": "middle"});
      badgeText.textContent = "LLM";
      group.append(badge, badgeText);
    }
    for (const portData of state.nodePorts.get(node.id) || []) {
      const port = svgEl("circle", {
        cx: portData.localX,
        cy: portData.localY,
        r: 6,
        class: `node-port ${portData.role}-port`,
        "data-edge-index": portData.edgeIndex,
      });
      const portTitle = svgEl("title");
      portTitle.textContent = `${portData.role === "input" ? "输入" : "输出"}端口 · ${portData.edgeLabel || "普通数据流"}`;
      port.appendChild(portTitle);
      group.appendChild(port);
    }
    group.addEventListener("click", event => { event.stopPropagation(); selectNode(node.id); });
    group.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectNode(node.id); }
    });
    layer.appendChild(group);
  }
  applySearch();
  updateSelectionStyles();
}

function sideFromVectors(vectors, fallback) {
  if (!vectors.length) return fallback;
  const total = vectors.reduce((sum, vector) => {
    const scale = Math.max(Math.abs(vector.dx), Math.abs(vector.dy), 1);
    return {x: sum.x + vector.dx / scale, y: sum.y + vector.dy / scale};
  }, {x: 0, y: 0});
  if (Math.abs(total.x) >= Math.abs(total.y)) return total.x >= 0 ? "right" : "left";
  return total.y >= 0 ? "bottom" : "top";
}

function chooseNodeRoleSides() {
  const sides = new Map();
  for (const node of state.nodes) {
    const position = state.layout.get(node.id);
    const center = {x: position.x + NODE_W / 2, y: position.y + NODE_H / 2};
    const outgoing = state.edges.filter(edge => edge.source === node.id).map(edge => {
      const target = state.layout.get(edge.target);
      return {dx: target.x + NODE_W / 2 - center.x, dy: target.y + NODE_H / 2 - center.y};
    });
    const incoming = state.edges.filter(edge => edge.target === node.id).map(edge => {
      const source = state.layout.get(edge.source);
      return {dx: source.x + NODE_W / 2 - center.x, dy: source.y + NODE_H / 2 - center.y};
    });
    if (outgoing.length) sides.set(`${node.id}:output`, sideFromVectors(outgoing, "right"));
    if (incoming.length) sides.set(`${node.id}:input`, sideFromVectors(incoming, "left"));
  }

  const overrides = {
    "run_control:output": "right",
    "clifford_t_backend:output": "right",
    "scientific_director:input": "left",
    "scientific_director:output": "right",
    "lowcost_surrogate:output": "bottom",
    "independent_critic:input": "top",
    "certificate_archive:output": "top",
    "theory_grammar:input": "bottom",
  };
  for (const [key, side] of Object.entries(overrides)) {
    if (sides.has(key)) sides.set(key, side);
  }
  return sides;
}

function portPoint(nodeId, side, ratio) {
  const node = state.layout.get(nodeId);
  if (side === "top" || side === "bottom") {
    return {
      x: node.x + NODE_W * ratio,
      y: node.y + (side === "bottom" ? NODE_H : 0),
      localX: NODE_W * ratio,
      localY: side === "bottom" ? NODE_H : 0,
      side,
    };
  }
  return {
    x: node.x + (side === "right" ? NODE_W : 0),
    y: node.y + NODE_H * ratio,
    localX: side === "right" ? NODE_W : 0,
    localY: NODE_H * ratio,
    side,
  };
}

function buildPortAssignments() {
  const roleSides = chooseNodeRoleSides();
  const assignments = state.edges.map((edge, edgeIndex) => ({
    edge,
    edgeIndex,
    sourceSide: roleSides.get(`${edge.source}:output`) || "right",
    targetSide: roleSides.get(`${edge.target}:input`) || "left",
  }));
  const roleGroups = new Map();
  for (const assignment of assignments) {
    for (const endpoint of [
      {nodeId: assignment.edge.source, side: assignment.sourceSide, role: "output", assignment},
      {nodeId: assignment.edge.target, side: assignment.targetSide, role: "input", assignment},
    ]) {
      const key = `${endpoint.nodeId}:${endpoint.role}`;
      if (!roleGroups.has(key)) roleGroups.set(key, []);
      roleGroups.get(key).push(endpoint);
    }
  }
  state.nodePorts = new Map();
  for (const entries of roleGroups.values()) {
    const {nodeId, role, side} = entries[0];
    const otherRole = role === "input" ? "output" : "input";
    const sharesSide = roleSides.get(`${nodeId}:${otherRole}`) === side;
    const ratio = sharesSide ? (role === "input" ? .34 : .66) : .5;
    const point = portPoint(nodeId, side, ratio);
    for (const entry of entries) {
      if (role === "output") entry.assignment.sourcePort = point;
      else entry.assignment.targetPort = point;
    }
    if (!state.nodePorts.has(nodeId)) state.nodePorts.set(nodeId, []);
    state.nodePorts.get(nodeId).push({
      ...point,
      role,
      edgeIndex: entries[0].assignment.edgeIndex,
      edgeLabel: `${entries.length} 条${role === "input" ? "输入" : "输出"}连接`,
    });
  }
  return assignments;
}

function outwardStub(port, distance = 25) {
  const delta = {
    left: [-distance, 0], right: [distance, 0],
    top: [0, -distance], bottom: [0, distance],
  }[port.side];
  return {x: port.x + delta[0], y: port.y + delta[1]};
}

function nodeObstacle(nodeId, padding = 13) {
  const node = state.layout.get(nodeId);
  return {left: node.x - padding, right: node.x + NODE_W + padding, top: node.y - padding, bottom: node.y + NODE_H + padding};
}

function segmentHitsRect(a, b, rect) {
  if (a.x === b.x) {
    const minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
    return a.x > rect.left && a.x < rect.right && maxY > rect.top && minY < rect.bottom;
  }
  if (a.y === b.y) {
    const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
    return a.y > rect.top && a.y < rect.bottom && maxX > rect.left && minX < rect.right;
  }
  return true;
}

function simplifyPath(points) {
  const deduped = points.filter((point, index) => !index || point.x !== points[index - 1].x || point.y !== points[index - 1].y);
  const result = [];
  for (const point of deduped) {
    const a = result[result.length - 2], b = result[result.length - 1];
    if (a && b && ((a.x === b.x && b.x === point.x) || (a.y === b.y && b.y === point.y))) result.pop();
    result.push(point);
  }
  return result;
}

function pathIsClear(points, edge) {
  const obstacles = state.nodes.filter(node => ![edge.source, edge.target].includes(node.id)).map(node => nodeObstacle(node.id));
  for (let index = 1; index < points.length; index += 1) {
    if (obstacles.some(rect => segmentHitsRect(points[index - 1], points[index], rect))) return false;
  }
  return true;
}

function routeSegments(points) {
  return points.slice(1).map((point, index) => ({a: points[index], b: point}));
}

function segmentLength(segment) {
  return Math.abs(segment.a.x - segment.b.x) + Math.abs(segment.a.y - segment.b.y);
}

function routeConflictPenalty(points) {
  let penalty = 0;
  for (const segment of routeSegments(points)) {
    for (const used of state.usedRouteSegments) {
      if (segmentLength(segment) <= 30 || segmentLength(used) <= 30) continue;
      const horizontal = segment.a.y === segment.b.y;
      const usedHorizontal = used.a.y === used.b.y;
      if (horizontal && usedHorizontal && segment.a.y === used.a.y) {
        const overlap = Math.min(Math.max(segment.a.x, segment.b.x), Math.max(used.a.x, used.b.x)) -
          Math.max(Math.min(segment.a.x, segment.b.x), Math.min(used.a.x, used.b.x));
        if (overlap > 0) penalty += 220 + overlap;
      } else if (!horizontal && !usedHorizontal && segment.a.x === used.a.x) {
        const overlap = Math.min(Math.max(segment.a.y, segment.b.y), Math.max(used.a.y, used.b.y)) -
          Math.max(Math.min(segment.a.y, segment.b.y), Math.min(used.a.y, used.b.y));
        if (overlap > 0) penalty += 220 + overlap;
      } else if (horizontal !== usedHorizontal) {
        const h = horizontal ? segment : used;
        const v = horizontal ? used : segment;
        if (v.a.x > Math.min(h.a.x, h.b.x) && v.a.x < Math.max(h.a.x, h.b.x) &&
            h.a.y > Math.min(v.a.y, v.b.y) && h.a.y < Math.max(v.a.y, v.b.y)) penalty += 45;
      }
    }
  }
  return penalty;
}

function routeScore(points) {
  return routeSegments(points).reduce((sum, segment) => sum + segmentLength(segment), 0) +
    Math.max(0, points.length - 2) * 38 + routeConflictPenalty(points);
}

function routingLanes() {
  const x = [state.bounds.minX - 58, state.bounds.maxX + 58];
  const y = [state.bounds.minY - 48, state.bounds.maxY + 58];
  for (const node of state.nodes) {
    const position = state.layout.get(node.id);
    x.push(position.x - 28, position.x + NODE_W + 28);
    y.push(position.y - 28, position.y + NODE_H + 28);
  }
  return {
    x: [...new Set(x.map(value => Math.round(value)))],
    y: [...new Set(y.map(value => Math.round(value)))],
  };
}

function routeOrthogonal(assignment) {
  const edge = assignment.edge;
  const start = assignment.sourcePort;
  const end = assignment.targetPort;
  const startStub = outwardStub(start);
  const endStub = outwardStub(end);
  const candidates = [];
  const add = middle => {
    const points = simplifyPath([start, startStub, ...middle, endStub, end]);
    if (pathIsClear(points, edge)) candidates.push(points);
  };

  const forceDirect = (edge.source === "certificate_archive" && edge.target === "theory_grammar") ||
    (edge.source === "lowcost_surrogate" && edge.target === "independent_critic");
  if (forceDirect && (startStub.x === endStub.x || startStub.y === endStub.y)) {
    const direct = simplifyPath([start, startStub, endStub, end]);
    if (pathIsClear(direct, edge)) return direct;
  }

  if (startStub.x === endStub.x || startStub.y === endStub.y) add([]);
  add([{x: endStub.x, y: startStub.y}]);
  add([{x: startStub.x, y: endStub.y}]);
  const lanes = routingLanes();
  for (const x of lanes.x) add([{x, y: startStub.y}, {x, y: endStub.y}]);
  for (const y of lanes.y) add([{x: startStub.x, y}, {x: endStub.x, y}]);

  if (!candidates.length) {
    const xLanes = [...lanes.x].sort((a, b) => Math.abs(a - (startStub.x + endStub.x) / 2) - Math.abs(b - (startStub.x + endStub.x) / 2)).slice(0, 14);
    const yLanes = [...lanes.y].sort((a, b) => Math.abs(a - (startStub.y + endStub.y) / 2) - Math.abs(b - (startStub.y + endStub.y) / 2)).slice(0, 14);
    for (const x of xLanes) {
      for (const y of yLanes) {
        add([{x, y: startStub.y}, {x, y}, {x: endStub.x, y}]);
        add([{x: startStub.x, y}, {x, y}, {x, y: endStub.y}]);
      }
    }
  }

  if (!candidates.length) {
    const outerY = state.bounds.maxY + 62 + assignment.edgeIndex * 3;
    return simplifyPath([start, startStub, {x: startStub.x, y: outerY}, {x: endStub.x, y: outerY}, endStub, end]);
  }
  candidates.sort((a, b) => routeScore(a) - routeScore(b));
  return candidates[0];
}

function boxesOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function labelProtectedBoxes() {
  const boxes = state.nodes.map(node => nodeObstacle(node.id, 5));
  for (const geometry of state.partLayout.values()) {
    boxes.push({left: geometry.x, right: geometry.x + geometry.width, top: geometry.y, bottom: geometry.y + 108});
  }
  return boxes;
}

function placeEdgeLabel(points, text) {
  const width = Math.max(54, [...text].length * 10.5);
  const height = 23;
  const protectedBoxes = labelProtectedBoxes();
  const available = (x, y) => {
    const box = {left: x - width / 2 - 4, right: x + width / 2 + 4, top: y - height + 3, bottom: y + 5};
    if (protectedBoxes.some(other => boxesOverlap(box, other)) || state.labelBoxes.some(other => boxesOverlap(box, other))) return null;
    return box;
  };
  const segments = routeSegments(points).filter(segment => segmentLength(segment) > width + 18)
    .sort((a, b) => segmentLength(b) - segmentLength(a));
  const fractions = [.5, .34, .66, .22, .78];
  for (const segment of segments) {
    const horizontal = segment.a.y === segment.b.y;
    for (const fraction of fractions) {
      const baseX = segment.a.x + (segment.b.x - segment.a.x) * fraction;
      const baseY = segment.a.y + (segment.b.y - segment.a.y) * fraction;
      const offsets = horizontal ? [[0, -13], [0, 29], [0, -34], [0, 50]] : [[width / 2 + 14, -4], [-width / 2 - 14, -4]];
      for (const [offsetX, offsetY] of offsets) {
        const x = baseX + offsetX, y = baseY + offsetY;
        const box = available(x, y);
        if (!box) continue;
        state.labelBoxes.push(box);
        return {x, y};
      }
    }
  }
  const longest = segments[0] || routeSegments(points).sort((a, b) => segmentLength(b) - segmentLength(a))[0];
  const baseX = (longest.a.x + longest.b.x) / 2;
  const baseY = (longest.a.y + longest.b.y) / 2 - 12;
  for (let ring = 0; ring < 24; ring += 1) {
    for (const [dx, dy] of [[0, ring * 25], [0, -ring * 25], [ring * 34, 0], [-ring * 34, 0]]) {
      const x = baseX + dx, y = baseY + dy;
      const box = available(x, y);
      if (!box) continue;
      state.labelBoxes.push(box);
      return {x, y};
    }
  }
  return {x: baseX, y: baseY};
}

function pathData(points) {
  return points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
}

function renderEdges() {
  const layer = $("edge-layer");
  layer.innerHTML = "";
  state.usedRouteSegments = [];
  state.labelBoxes = [];
  const assignments = buildPortAssignments();
  assignments.forEach(assignment => {
    const edge = assignment.edge;
    const type = edge.type || "data";
    const points = routeOrthogonal(assignment);
    const path = svgEl("path", {
      d: pathData(points),
      class: `workflow-edge ${type}${isActive(edge.source) && isActive(edge.target) ? " active" : " inactive"}`,
      "data-source": edge.source,
      "data-target": edge.target,
    });
    layer.appendChild(path);
    state.usedRouteSegments.push(...routeSegments(points));
    if (edge.label && type !== "data") {
      const position = placeEdgeLabel(points, edge.label);
      const label = svgEl("text", {
        x: position.x,
        y: position.y,
        class: `workflow-edge-label ${type}`,
        "text-anchor": "middle",
        "data-source": edge.source,
        "data-target": edge.target,
      });
      label.textContent = edge.label;
      layer.appendChild(label);
    }
  });
}

function applyTransform() {
  $("viewport-group").setAttribute("transform", `translate(${state.view.x} ${state.view.y}) scale(${state.view.scale})`);
  $("zoom-label").textContent = `${Math.round(state.view.scale * 100)}%`;
  renderMinimapViewport();
}

function zoomAt(clientX, clientY, factor) {
  const rect = $("workflow-canvas").getBoundingClientRect();
  const px = clientX - rect.left;
  const py = clientY - rect.top;
  const worldX = (px - state.view.x) / state.view.scale;
  const worldY = (py - state.view.y) / state.view.scale;
  const next = Math.min(1.8, Math.max(.18, state.view.scale * factor));
  state.view.x = px - worldX * next;
  state.view.y = py - worldY * next;
  state.view.scale = next;
  applyTransform();
}

function fitGraph() {
  if (!state.nodes.length) return;
  const canvas = $("workflow-canvas").getBoundingClientRect();
  const minX = state.bounds.minX - 35;
  const maxX = state.bounds.maxX + 35;
  const minY = state.bounds.minY - 25;
  const maxY = state.bounds.maxY + 35;
  const scale = Math.min((canvas.width - 60) / (maxX - minX), (canvas.height - 70) / (maxY - minY));
  state.view.scale = Math.min(1.1, Math.max(.18, scale));
  state.view.x = (canvas.width - (maxX - minX) * state.view.scale) / 2 - minX * state.view.scale;
  state.view.y = (canvas.height - (maxY - minY) * state.view.scale) / 2 - minY * state.view.scale;
  applyTransform();
}

function resetZoom() {
  state.view = {x: 44, y: 44, scale: 1};
  applyTransform();
}

function centerNode(nodeId, scale = null) {
  const position = state.layout.get(nodeId);
  if (!position) return;
  const canvas = $("workflow-canvas").getBoundingClientRect();
  if (scale) state.view.scale = scale;
  state.view.x = canvas.width / 2 - (position.x + NODE_W / 2) * state.view.scale;
  state.view.y = canvas.height / 2 - (position.y + NODE_H / 2) * state.view.scale;
  applyTransform();
}

function renderMinimap() {
  const minimap = $("minimap");
  const graphW = graphWidth();
  const graphH = graphHeight();
  minimap.setAttribute("viewBox", `0 0 ${graphW} ${graphH}`);
  minimap.innerHTML = `<rect width="${graphW}" height="${graphH}" class="minimap-bg"/>` +
    state.nodes.map(node => {
      const p = state.layout.get(node.id);
      const status = runtime(node.id).status || "not_triggered";
      return `<rect x="${p.x}" y="${p.y}" width="${NODE_W}" height="${NODE_H}" rx="8" class="minimap-node status-${status}"/>`;
    }).join("") + `<rect id="minimap-viewport" class="minimap-viewport"/>`;
  renderMinimapViewport();
}

function renderMinimapViewport() {
  const viewport = $("minimap-viewport");
  if (!viewport) return;
  const canvas = $("workflow-canvas").getBoundingClientRect();
  viewport.setAttribute("x", -state.view.x / state.view.scale);
  viewport.setAttribute("y", -state.view.y / state.view.scale);
  viewport.setAttribute("width", canvas.width / state.view.scale);
  viewport.setAttribute("height", canvas.height / state.view.scale);
}

function selectNode(nodeId) {
  state.selected = nodeId;
  state.tab = "definition";
  updateSelectionStyles();
  renderInspector();
  $("node-inspector").classList.add("open");
  $("node-inspector").setAttribute("aria-hidden", "false");
  document.body.classList.add("inspector-visible");
  window.setTimeout(renderMinimapViewport, 240);
  history.replaceState(null, "", `./index.html?node=${encodeURIComponent(nodeId)}`);
}

function updateSelectionStyles() {
  const connected = new Set();
  if (state.selected) {
    connected.add(state.selected);
    state.edges.forEach(edge => {
      if (edge.source === state.selected) connected.add(edge.target);
      if (edge.target === state.selected) connected.add(edge.source);
    });
  }
  document.querySelectorAll(".workflow-node").forEach(node => {
    const id = node.dataset.node;
    node.classList.toggle("selected", id === state.selected);
    node.classList.toggle("relation-dim", Boolean(state.selected && !connected.has(id)));
  });
  document.querySelectorAll(".workflow-edge,.workflow-edge-label").forEach(edge => {
    const related = !state.selected || edge.dataset.source === state.selected || edge.dataset.target === state.selected;
    edge.classList.toggle("relation-dim", !related);
    edge.classList.toggle("selected-edge", Boolean(state.selected && related));
  });
}

function applySearch() {
  const query = state.search.trim().toLowerCase();
  let firstMatch = null;
  document.querySelectorAll(".workflow-node").forEach(element => {
    const node = state.nodes.find(item => item.id === element.dataset.node);
    const text = `${node.name} ${node.id} ${node.kind} ${node.description}`.toLowerCase();
    const match = !query || text.includes(query);
    element.classList.toggle("search-dim", !match);
    if (query && match && !firstMatch) firstMatch = node.id;
  });
  return firstMatch;
}

function closeInspector() {
  state.selected = null;
  $("node-inspector").classList.remove("open");
  $("node-inspector").setAttribute("aria-hidden", "true");
  document.body.classList.remove("inspector-visible");
  window.setTimeout(renderMinimapViewport, 240);
  history.replaceState(null, "", "./index.html");
  updateSelectionStyles();
}

function selectedNode() {
  return state.nodes.find(node => node.id === state.selected) ||
    state.data?.architecture?.nodes?.find(node => node.id === state.selected);
}

function renderInspector() {
  const node = selectedNode();
  if (!node) return;
  const run = runtime(node.id);
  const model = node.model_role ? state.data.role_models?.[node.model_role] : null;
  $("inspector-kind").textContent = `${kindText[node.kind] || node.kind} · ${node.category}`;
  $("inspector-title").textContent = node.name;
  $("inspector-status").textContent = `${statusText[run.status] || run.status} · ${implementationText[node.implementation] || node.implementation}`;
  document.querySelectorAll("[data-tab]").forEach(button => button.classList.toggle("active", button.dataset.tab === state.tab));
  const views = {
    definition: definitionView(node, model),
    runtime: runtimeView(node, run),
    io: ioView(node, run),
    events: eventsView(run.events || [], node.id),
  };
  replaceHtmlPreservingDetails($("inspector-body"), views[state.tab]);
}

function box(label, value) { return `<div class="detail-box"><span>${esc(label)}</span><b>${esc(value ?? "—")}</b></div>`; }
function list(title, values) { return `<section class="detail-section"><h3>${esc(title)}</h3><ul>${values.map(value => `<li>${esc(value)}</li>`).join("")}</ul></section>`; }
function definitionView(node, model) {
  return `<section class="detail-section"><h3>职能</h3><p>${esc(node.description)}</p></section>` +
    `<section class="detail-section"><h3>节点属性</h3><div class="detail-grid">` +
    box("节点 ID", node.id) + box("类型", kindText[node.kind] || node.kind) +
    box("公开状态", implementationText[node.implementation] || node.implementation) +
    box("能力类型", model || "确定性组件") + box("公开接口", node.interface || "结构化 artifact") + box("激活条件", node.activation) +
    `</div></section>` + list("声明输入", node.inputs) + list("声明输出", node.outputs) +
    `<section class="detail-section"><h3>失败语义与边界</h3><p>${esc(node.failure)}</p></section>`;
}
function runtimeView(node, run) {
  const metrics = Object.entries(run.metrics || {});
  return `<section class="detail-section"><h3>执行状态</h3><div class="detail-grid">` +
    box("状态", statusText[run.status] || run.status) + box("事件数量", run.event_count ?? 0) +
    box("首事件序号", run.first_sequence ?? "—") + box("末事件序号", run.last_sequence ?? "—") +
    box("事件跨度", run.duration_ms == null ? "—" : `${fmt(run.duration_ms, 5)} ms`) +
    box("最后事件", eventText[run.last_event] || run.last_event || "—") + `</div></section>` +
    `<section class="detail-section"><h3>节点指标</h3>` +
    (metrics.length ? `<div class="detail-grid">${metrics.map(([key, value]) => box(key, typeof value === "object" ? pretty(value) : value)).join("")}</div>` : `<p>本次运行没有该节点的专属数值指标。</p>`) + `</section>` +
    `<section class="detail-section"><h3>状态解释</h3><p>${run.status === "not_triggered" ? `本次任务没有触发该节点。激活条件：${esc(node.activation)}` : run.status === "not_implemented" ? `该节点属于目标架构但尚未完整接入。${esc(node.failure)}` : `该节点在本次 run 中留下 ${run.event_count || 0} 条证据事件。`}</p></section>`;
}
function ioView(node, run) {
  const inputs = run.actual_inputs || [], outputs = run.actual_outputs || [];
  return `<section class="detail-section"><h3>声明契约</h3><p><b>输入：</b>${esc(node.inputs.join("；"))}</p><p><b>输出：</b>${esc(node.outputs.join("；"))}</p></section>` +
    `<section class="detail-section"><h3>本次实际输入</h3>${inputs.length ? inputs.map((value, index) => `<details data-detail-key="${esc(`node:${node.id}:input:${index}`)}" ${index === inputs.length - 1 ? "open" : ""}><summary>输入 ${index + 1}</summary><pre>${esc(pretty(value))}</pre></details>`).join("") : "<p>本次未产生实际输入。</p>"}</section>` +
    `<section class="detail-section"><h3>本次实际输出</h3>${outputs.length ? outputs.map((value, index) => `<details data-detail-key="${esc(`node:${node.id}:output:${index}`)}" ${index === outputs.length - 1 ? "open" : ""}><summary>输出 ${index + 1}</summary><pre>${esc(pretty(value))}</pre></details>`).join("") : "<p>本次未产生实际输出。</p>"}</section>`;
}
function eventsView(events, nodeId) {
  if (!events.length) return `<div class="empty-state">本次未触发该节点。</div>`;
  return events.slice().reverse().map(event => `<article class="node-event"><header><span>#${esc(event.sequence ?? "—")} · ${esc(eventText[event.event] || event.event)}</span><time>${esc(event.timestamp || "")}</time></header><p>${esc(eventSummary(event))}</p><details data-detail-key="${esc(`node:${nodeId}:event:${event.sequence ?? "unknown"}`)}"><summary>完整事件 JSON</summary><pre>${esc(JSON.stringify(event, null, 2))}</pre></details></article>`).join("");
}

const canvas = $("workflow-canvas");
canvas.addEventListener("wheel", event => { event.preventDefault(); zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.12 : .89); }, {passive: false});
canvas.addEventListener("pointerdown", event => {
  if (event.target.closest?.(".workflow-node")) return;
  event.preventDefault();
  state.dragging = true; state.pointerId = event.pointerId; state.lastPoint = {x: event.clientX, y: event.clientY};
  canvas.setPointerCapture(event.pointerId); canvas.classList.add("panning");
  document.body.classList.add("canvas-dragging");
});
canvas.addEventListener("pointermove", event => {
  if (!state.dragging || event.pointerId !== state.pointerId) return;
  event.preventDefault();
  state.view.x += event.clientX - state.lastPoint.x;
  state.view.y += event.clientY - state.lastPoint.y;
  state.lastPoint = {x: event.clientX, y: event.clientY}; applyTransform();
});
function endPan(event) {
  if (!state.dragging || event.pointerId !== state.pointerId) return;
  state.dragging = false; canvas.classList.remove("panning");
  document.body.classList.remove("canvas-dragging");
}
canvas.addEventListener("pointerup", endPan); canvas.addEventListener("pointercancel", endPan);
canvas.addEventListener("selectstart", event => event.preventDefault());
canvas.addEventListener("dragstart", event => event.preventDefault());
window.addEventListener("blur", () => {
  state.dragging = false;
  canvas.classList.remove("panning");
  document.body.classList.remove("canvas-dragging");
});
canvas.addEventListener("dblclick", event => zoomAt(event.clientX, event.clientY, 1.25));
canvas.addEventListener("keydown", event => {
  if (event.key === "0") fitGraph();
  if (event.key === "+" || event.key === "=") zoomAt(innerWidth / 2, innerHeight / 2, 1.15);
  if (event.key === "-") zoomAt(innerWidth / 2, innerHeight / 2, .87);
});
$("minimap").addEventListener("click", event => {
  const rect = $("minimap").getBoundingClientRect();
  const graphW = graphWidth();
  const graphH = graphHeight();
  const worldX = (event.clientX - rect.left) / rect.width * graphW;
  const worldY = (event.clientY - rect.top) / rect.height * graphH;
  const main = canvas.getBoundingClientRect();
  state.view.x = main.width / 2 - worldX * state.view.scale;
  state.view.y = main.height / 2 - worldY * state.view.scale;
  applyTransform();
});

$("zoom-in").addEventListener("click", () => zoomAt(innerWidth / 2, innerHeight / 2, 1.18));
$("zoom-out").addEventListener("click", () => zoomAt(innerWidth / 2, innerHeight / 2, .84));
$("zoom-reset").addEventListener("click", resetZoom);
$("fit-graph").addEventListener("click", fitGraph);
$("layout-toggle").addEventListener("click", () => setLayoutMode(state.layoutMode === "horizontal" ? "snake" : "horizontal"));
$("active-only").addEventListener("change", event => { state.activeOnly = event.target.checked; renderWorkflow(state.data); });
$("node-search").addEventListener("input", event => { state.search = event.target.value; applySearch(); });
$("node-search").addEventListener("keydown", event => {
  if (event.key === "Enter") { const match = applySearch(); if (match) { selectNode(match); centerNode(match, .95); } }
});
$("close-inspector").addEventListener("click", closeInspector);
document.addEventListener("click", event => {
  const tab = event.target.closest("[data-tab]");
  if (tab) { state.tab = tab.dataset.tab; renderInspector(); }
});
document.addEventListener("keydown", event => { if (event.key === "Escape") closeInspector(); });
window.addEventListener("resize", applyTransform);

setLayoutMode(state.layoutMode, false);
function showBootError(error) {
  console.error(error);
  $("canvas-loading")?.classList.add("hidden");
  const banner = document.createElement("pre");
  banner.className = "boot-error";
  banner.textContent = `工作流加载失败\n${error?.stack || error}`;
  document.body.appendChild(banner);
}

window.addEventListener("unhandledrejection", event => showBootError(event.reason));
window.addEventListener("error", event => showBootError(event.error || event.message));
initRunPage(renderWorkflow).catch(showBootError);
