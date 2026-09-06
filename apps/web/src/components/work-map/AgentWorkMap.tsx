import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentWorkMapDefinition, AgentWorkMapEdge, AgentWorkMapNode, AgentWorkMapPoint } from "@baolu/shared";

interface AgentWorkMapProps {
  open: boolean;
  definition: AgentWorkMapDefinition;
  agentName: string;
  selectedCapabilityId?: string;
  knowledgeDocumentCount: number;
  knowledgeHref?: string;
  onClose: () => void;
  onSwitchAgent?: () => void;
  onOpenKnowledge: () => void;
  onActivateCapability: (capabilityId: string) => void;
}

const VIEWBOX_WIDTH = 1000;
const VIEWBOX_HEIGHT = 620;

export function AgentWorkMap({
  open,
  definition,
  agentName,
  selectedCapabilityId,
  knowledgeDocumentCount,
  knowledgeHref,
  onClose,
  onSwitchAgent,
  onOpenKnowledge,
  onActivateCapability
}: AgentWorkMapProps) {
  const [selectedNodeId, setSelectedNodeId] = useState(definition.nodes[0]?.id ?? "");
  const [zoom, setZoom] = useState(1);
  const [stageSize, setStageSize] = useState({ width: VIEWBOX_WIDTH, height: VIEWBOX_HEIGHT });
  const stageRef = useRef<HTMLDivElement>(null);
  const nodesById = useMemo(() => new Map(definition.nodes.map((node) => [node.id, node])), [definition]);
  const selectedNode = nodesById.get(selectedNodeId) ?? definition.nodes[0];

  useEffect(() => {
    if (!open) return;
    const capabilityNode = definition.nodes.find((node) => node.action.type === "capability" && node.action.capabilityId === selectedCapabilityId);
    setSelectedNodeId(capabilityNode?.id ?? definition.nodes[0]?.id ?? "");
    setZoom(1);
  }, [definition, open, selectedCapabilityId]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  useEffect(() => {
    if (!open || !stageRef.current) return;
    const stage = stageRef.current;
    const updateSize = () => setStageSize({ width: Math.max(stage.clientWidth, 1), height: Math.max(stage.clientHeight, 1) });
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [open]);

  if (!open || !selectedNode) return null;

  function enterNode(node: AgentWorkMapNode): void {
    if (node.action.type === "static") return;
    if (node.action.type === "knowledge") {
      if (knowledgeHref) {
        window.location.assign(knowledgeHref);
        return;
      }
      onOpenKnowledge();
      return;
    }
    // Close locally before navigation. The destination may render another
    // full-screen task frame, so keeping the map mounted would visually stack
    // two workspaces and make the destination appear unresponsive.
    onClose();
    onActivateCapability(node.action.capabilityId);
  }

  const selectedState = selectedNode.action.type === "knowledge"
    ? knowledgeDocumentCount > 0 ? `当前任务已选择 ${knowledgeDocumentCount} 条资料` : "当前任务还未选择资料"
    : selectedNode.action.type === "static"
      ? "这是业务总入口，不直接执行任务"
      : selectedNode.action.capabilityId === selectedCapabilityId ? "当前任务正在使用这个模块" : "点击进入后锁定这个专业模块";

  return (
    <section className="agentWorkMapOverlay" role="dialog" aria-modal="true" aria-label={`${agentName}工作地图`}>
      <header className="agentWorkMapHeader">
        <div>
          <button type="button" className="agentWorkMapBack" onClick={onClose}>← 返回工作台</button>
          <span>AGENT WORK MAP · V{definition.version}</span>
          <h2>{definition.title}</h2>
          <p>{definition.subtitle}</p>
        </div>
        <div className="agentWorkMapHeaderActions">
          <span>{agentName}</span>
          {onSwitchAgent && <button type="button" className="agentWorkMapSwitch" onClick={onSwitchAgent}>切换智能体</button>}
          <button type="button" aria-label="关闭工作地图" onClick={onClose}>×</button>
        </div>
      </header>

      <div className="agentWorkMapBody">
        <main className="agentWorkMapMain">
          <div className="agentWorkMapToolbar" aria-label="地图缩放控制">
            <div><strong>业务全景</strong><span>点击节点查看，双击进入模块</span></div>
            <div>
              <button type="button" aria-label="缩小地图" onClick={() => setZoom((value) => Math.max(.8, value - .1))}>−</button>
              <span>{Math.round(zoom * 100)}%</span>
              <button type="button" aria-label="放大地图" onClick={() => setZoom((value) => Math.min(1.4, value + .1))}>＋</button>
              <button type="button" onClick={() => setZoom(1)}>适应窗口</button>
            </div>
          </div>

          <div className="agentWorkMapViewport">
            <div ref={stageRef} className="agentWorkMapStage" style={{ transform: `scale(${zoom})` }}>
              <svg className="agentWorkMapEdges" viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
                <defs>
                  <marker id="agent-work-map-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" />
                  </marker>
                  <marker id="agent-work-map-feedback-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" />
                  </marker>
                </defs>
                {definition.edges.map((edge) => {
                  const source = nodesById.get(edge.from);
                  const target = nodesById.get(edge.to);
                  if (!source || !target) return null;
                  return <g key={edge.id} className={`agentWorkMapEdge edge-${edge.type}`}>
                    <path d={buildEdgePath(edge, source.position, target.position, stageSize)} />
                    {edge.label && <text x={edgeLabelPoint(edge, source.position, target.position).x} y={edgeLabelPoint(edge, source.position, target.position).y}>{edge.label}</text>}
                  </g>;
                })}
              </svg>

              {definition.nodes.map((node) => {
                const active = node.id === selectedNode.id;
                const inUse = node.action.type === "knowledge"
                  ? knowledgeDocumentCount > 0
                  : node.action.type === "capability" && node.action.capabilityId === selectedCapabilityId;
                const content = <>
                  <span>{node.icon}</span>
                  <div><strong>{node.title}</strong><small>{node.subtitle}</small></div>
                  {inUse && <em>{node.action.type === "knowledge" ? "已选资料" : "当前"}</em>}
                </>;
                if (node.action.type === "knowledge" && knowledgeHref) {
                  return <a
                    key={node.id}
                    className={`agentWorkMapNode node-${node.kind} ${active ? "selected" : ""} ${inUse ? "inUse" : ""}`.trim()}
                    style={{ left: `${node.position.x}%`, top: `${node.position.y}%` }}
                    href={knowledgeHref}
                    onClick={onClose}
                  >{content}</a>;
                }
                if (node.action.type === "static") {
                  return <div
                    key={node.id}
                    className={`agentWorkMapNode node-${node.kind} node-static ${active ? "selected" : ""}`.trim()}
                    style={{ left: `${node.position.x}%`, top: `${node.position.y}%` }}
                    aria-label={`${node.title}，业务总入口`}
                  >{content}</div>;
                }
                return <button
                  type="button"
                  key={node.id}
                  className={`agentWorkMapNode node-${node.kind} ${active ? "selected" : ""} ${inUse ? "inUse" : ""}`.trim()}
                  style={{ left: `${node.position.x}%`, top: `${node.position.y}%` }}
                  aria-pressed={active}
                  // A map node is an entry point, not merely a visual filter.
                  // Enter on one click so closing the map can never reveal the
                  // previously active system (for example Content after IP positioning).
                  onClick={() => enterNode(node)}
                >
                  {content}
                </button>;
              })}
            </div>
          </div>

          <footer className="agentWorkMapLegend">
            <span><i className="flow" />主流程</span>
            <span><i className="branch" />业务分支</span>
            <span><i className="feedback" />复盘回流</span>
          </footer>
        </main>

        <aside className="agentWorkMapInspector">
          <span className={`agentWorkMapNodeIcon node-${selectedNode.kind}`}>{selectedNode.icon}</span>
          <small>{selectedNode.action.type === "static" ? "业务总入口" : selectedNode.kind === "knowledge" ? "知识底座" : selectedNode.kind === "review" ? "复盘模块" : "执行模块"}</small>
          <h3>{selectedNode.title}</h3>
          <p>{selectedNode.subtitle}</p>
          <section>
            <span>当前状态</span>
            <strong>{selectedState}</strong>
          </section>
          <section>
            <span>进入后会发生什么</span>
            <strong>{nodeActionDescription(selectedNode)}</strong>
          </section>
          {selectedNode.action.type === "static"
            ? <p className="agentWorkMapStaticTip">请从视频分支、直播分支或问问保禄进入具体任务；选题系统仍是视频分支的第一个模块。</p>
            : selectedNode.action.type === "knowledge" && knowledgeHref
            ? <a className="agentWorkMapEnter" href={knowledgeHref} onClick={onClose}>进入企业知识库 →</a>
            : <button type="button" className="agentWorkMapEnter" onClick={() => enterNode(selectedNode)}>
                {selectedNode.action.type === "knowledge" ? "进入企业知识库" : `放大进入${selectedNode.title}`} →
              </button>}
          <p className="agentWorkMapTip">工作地图只负责组织业务逻辑；任务、对话、资料与交付仍保存在原来的智能体工作空间。</p>
        </aside>
      </div>
    </section>
  );
}

function nodeActionDescription(node: AgentWorkMapNode): string {
  if (node.action.type === "static") return "这是创始人 IP 获客的业务入口，用于组织后续分支，不执行具体任务。";
  if (node.action.type === "knowledge") return "打开品牌获客独立企业知识库页面，管理企业、IP、客户项目、录音和行业资料。";
  if (node.kind === "review") return "进入复盘任务，读取用户提供的真实文件或数据，再沉淀下一轮可执行结论。";
  return "锁定对应专业 Skill，并回到工作台补充要求或直接执行。";
}

function buildEdgePath(
  edge: AgentWorkMapEdge,
  source: AgentWorkMapPoint,
  target: AgentWorkMapPoint,
  stageSize: { width: number; height: number }
): string {
  const rawPoints = [source, ...(edge.waypoints ?? []), target].map(toSvgPoint);
  // Nodes are rendered above the SVG. Start and finish every path at the
  // visible card edge instead of its hidden centre, so business relations are
  // visibly connected (particularly 企业知识库 -> 选题系统).
  const nodeHalfWidth = 83 * VIEWBOX_WIDTH / stageSize.width;
  const nodeHalfHeight = 38 * VIEWBOX_HEIGHT / stageSize.height;
  const points = rawPoints.map((point, index) => {
    if (index !== 0 && index !== rawPoints.length - 1) return point;
    const neighbor = rawPoints[index === 0 ? 1 : rawPoints.length - 2] ?? point;
    const dx = neighbor.x - point.x;
    const dy = neighbor.y - point.y;
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    const offsetX = horizontal ? Math.sign(dx || 1) * nodeHalfWidth : 0;
    const offsetY = horizontal ? 0 : Math.sign(dy || 1) * nodeHalfHeight;
    // Both endpoints move toward their adjacent route point. Moving the target
    // in the opposite direction placed feedback arrows beyond the destination.
    return { x: point.x + offsetX, y: point.y + offsetY };
  });
  if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  return points.slice(1).reduce((path, point, index) => {
    const previous = points[index];
    const next = points[index + 2];
    if (!next) return `${path} L ${point.x} ${point.y}`;
    const middleX = (point.x + next.x) / 2;
    const middleY = (point.y + next.y) / 2;
    return `${path} L ${(previous.x + point.x) / 2} ${(previous.y + point.y) / 2} Q ${point.x} ${point.y} ${middleX} ${middleY}`;
  }, `M ${points[0].x} ${points[0].y}`);
}

function edgeLabelPoint(edge: AgentWorkMapEdge, source: AgentWorkMapPoint, target: AgentWorkMapPoint): { x: number; y: number } {
  const points = [source, ...(edge.waypoints ?? []), target].map(toSvgPoint);
  if (points.length === 2) return { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 - 10 };
  const middle = points[Math.floor(points.length / 2)] ?? points[0];
  return { x: middle.x, y: middle.y - 10 };
}

function toSvgPoint(point: AgentWorkMapPoint): { x: number; y: number } {
  return { x: point.x * 10, y: point.y * 6.2 };
}
