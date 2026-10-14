// Konva drawing components for a Scene. All are memoised: a selection change repaints only the
// blocks/edges whose own props changed, not the whole scene.

import { memo } from 'react';
import type { ReactElement } from 'react';
import { Circle, Group, Rect, Shape, Text } from 'react-konva';
import type Konva from 'konva';
import type { SceneEdge, SceneLane, SceneNode, SceneRegion } from '@codeblocks/core';
import { arrowHead, hatBumpPath, hexPath, roundedPolyline } from './draw.ts';
import { shade } from './theme.ts';
import type { BlocksTheme } from './theme.ts';

/** y of a text box's top so its baseline lands on `baseline` (canvas text is positioned by its top). */
const top = (baseline: number, size: number): number => baseline - size * 0.82;

const trunc = (s: string, n: number): string => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s);

// ---------------------------------------------------------------------------------------------
// lanes & regions
// ---------------------------------------------------------------------------------------------

export const LanePanel = memo(function LanePanel({ lane, theme, highlighted }: { lane: SceneLane; theme: BlocksTheme; highlighted: boolean }) {
  const role = theme.lanes[lane.role] ?? theme.lanes.user;
  const chipW = role.label.length * 7.4 + 22;
  return (
    <Group x={lane.x} y={lane.y} listening={false}>
      <Rect width={lane.w} height={lane.h} cornerRadius={30} fill={theme.panel.fill} stroke={highlighted ? role.color : theme.panel.stroke} strokeWidth={highlighted ? 3 : 1.5} />
      <Rect x={34} y={0} width={Math.max(0, lane.w - 68)} height={5} cornerRadius={2.5} fill={role.color} />
      <Text x={28} y={top(44, 19)} text={trunc(lane.name, Math.floor((lane.w - 56) / 11.5))} fontSize={19} fontStyle="900" fontFamily={theme.fonts.mono} fill={theme.text.lane} />
      <Text x={28} y={top(68, 13)} text={trunc(lane.description ?? '', Math.floor((lane.w - 56) / 7.2))} fontSize={13} fontStyle="700" fontFamily={theme.fonts.ui} fill={theme.text.laneSub} />
      <Group x={lane.w - 24 - chipW} y={24}>
        <Rect width={chipW} height={24} cornerRadius={12} fill={role.color} opacity={0.16} />
        <Text width={chipW} height={24} align="center" verticalAlign="middle" text={role.label} fontSize={10.5} fontStyle="900" letterSpacing={0.8} fontFamily={theme.fonts.ui} fill={shade(role.color, 0.25)} />
      </Group>
    </Group>
  );
});

export const RegionShape = memo(function RegionShape({ region, theme }: { region: SceneRegion; theme: BlocksTheme }) {
  return (
    <Rect
      x={region.x} y={region.y} width={region.w} height={region.h} cornerRadius={30} listening={false}
      fill={theme.region.fill} stroke={theme.region.stroke} strokeWidth={2.5} dash={[1, 9]} lineCap="round"
    />
  );
});

// ---------------------------------------------------------------------------------------------
// edges
// ---------------------------------------------------------------------------------------------

function edgeColor(e: SceneEdge, theme: BlocksTheme, running: boolean): string {
  if (running) return '#1FB58F';
  if (e.tone === 'yes') return theme.edge.yes;
  if (e.tone === 'no') return theme.edge.no;
  if (e.kind === 'back') return theme.edge.back;
  return theme.edge.plain;
}

export const EdgeShape = memo(function EdgeShape({ edge, theme, highlighted, running }: { edge: SceneEdge; theme: BlocksTheme; highlighted: boolean; running: boolean }) {
  if (edge.points.length < 2) return null;
  const color = edgeColor(edge, theme, running);
  const width = running ? 4.5 : highlighted ? theme.edge.width + 1.4 : theme.edge.width;
  const pts = edge.points;
  const tip = pts[pts.length - 1];
  const from = pts[pts.length - 2];
  return (
    <>
      <Shape
        listening={false} perfectDrawEnabled={false} stroke={color} strokeWidth={width} lineCap="round" lineJoin="round"
        sceneFunc={(ctx: Konva.Context, shape: Konva.Shape) => { ctx.beginPath(); roundedPolyline(ctx, pts); ctx.strokeShape(shape); }}
      />
      <Shape
        listening={false} perfectDrawEnabled={false} fill={color} stroke={color} strokeWidth={1.4} lineJoin="round"
        sceneFunc={(ctx: Konva.Context, shape: Konva.Shape) => { ctx.beginPath(); arrowHead(ctx, from, tip, 10); ctx.fillStrokeShape(shape); }}
      />
    </>
  );
});

export const EdgeLabel = memo(function EdgeLabel({ edge, theme }: { edge: SceneEdge; theme: BlocksTheme }) {
  if (!edge.labelAt || !edge.label) return null;
  const text = edge.tone === 'yes' ? '✔ yes' : edge.tone === 'no' ? '✖ no' : edge.label === 'again' ? '🔁 again' : edge.label;
  const w = text.length * 7 + 20;
  const style = edge.label === 'again'
    ? ['#F0EBFF', '#6D4AE0']
    : edge.tone === 'yes' ? ['#E4F8EC', '#16914F'] : edge.tone === 'no' ? ['#FFE9E9', '#E04848'] : ['#FFFFFF', '#4B5A73'];
  return (
    <Group x={edge.labelAt[0] - w / 2} y={edge.labelAt[1] - 11} listening={false}>
      <Rect width={w} height={22} cornerRadius={11} fill={style[0]} stroke={style[1]} strokeWidth={1} opacity={1} />
      <Text width={w} height={22} align="center" verticalAlign="middle" text={text} fontSize={11.5} fontStyle="800" fontFamily={`${theme.fonts.ui}, ${theme.fonts.emoji}`} fill={style[1]} />
    </Group>
  );
});

// ---------------------------------------------------------------------------------------------
// blocks
// ---------------------------------------------------------------------------------------------

export interface BlockProps {
  node: SceneNode;
  theme: BlocksTheme;
  selected: boolean;
  running: boolean;
  shadows: boolean;
  onSelect(id: string): void;
}

function EmojiBubble({ x, y, r, emoji, theme }: { x: number; y: number; r: number; emoji: string; theme: BlocksTheme }) {
  return (
    <>
      <Circle x={x} y={y} radius={r} fill="#fff" opacity={0.92} listening={false} />
      <Text x={x - r} y={y - r} width={r * 2} height={r * 2} align="center" verticalAlign="middle" text={emoji} fontSize={r * 1.1} fontFamily={theme.fonts.emoji} listening={false} />
    </>
  );
}

function Badge({ node, theme }: { node: SceneNode; theme: BlocksTheme }) {
  if (!node.warn && !node.error) return null;
  return (
    <Group x={node.w - 6} y={6} listening={false}>
      <Circle radius={11} fill={theme.warn} stroke="#fff" strokeWidth={3} />
      <Text x={-11} y={-11} width={22} height={22} align="center" verticalAlign="middle" text={node.error ? '×' : '!'} fontSize={13} fontStyle="900" fontFamily={theme.fonts.ui} fill="#fff" />
    </Group>
  );
}

export const BlockNode = memo(function BlockNode({ node, theme, selected, running, shadows, onSelect }: BlockProps) {
  const { color, ink } = theme.kinds[node.kind] ?? theme.kinds.process;
  const dark = shade(color, 0.22);
  const left = node.x - node.w / 2;
  const lightInk = ink === '#fff';

  const stroke = running ? '#fff' : selected ? theme.selection : node.error ? theme.warn : undefined;
  const strokeWidth = running ? 4 : selected ? 3.5 : node.error ? 3 : 0;
  const lipShadow = shadows ? { shadowColor: '#25324d', shadowBlur: 7, shadowOffsetY: 3, shadowOpacity: 0.18, shadowForStrokeEnabled: false } : {};
  const glow = running ? { shadowColor: theme.runGlow, shadowBlur: 26, shadowOpacity: 1, shadowForStrokeEnabled: false } : {};

  const handlers = {
    onClick: () => onSelect(node.id),
    onTap: () => onSelect(node.id),
    onMouseEnter: (e: Konva.KonvaEventObject<MouseEvent>) => {
      const st = e.target.getStage();
      if (st) st.container().style.cursor = 'pointer';
    },
    onMouseLeave: (e: Konva.KonvaEventObject<MouseEvent>) => {
      const st = e.target.getStage();
      if (st) st.container().style.cursor = '';
    },
  };

  const body = (() => {
    if (node.shape === 'card') {
      const textX = 68;
      const bubbleY = node.h > 78 ? 34 : node.h / 2;
      let y = 22;
      const items: ReactElement[] = [];
      items.push(<Text key="cat" x={textX} y={top(y, 10)} text={node.category} fontSize={10} fontStyle="800" letterSpacing={0.9} fontFamily={theme.fonts.ui} fill={ink} opacity={0.72} />);
      y += 4;
      node.titleLines.forEach((t, i) => { y += 19; items.push(<Text key={`t${i}`} x={textX} y={top(y, 15)} text={t} fontSize={15} fontStyle="800" fontFamily={theme.fonts.ui} fill={ink} />); });
      node.subLines.forEach((t, i) => { y += 17; items.push(<Text key={`s${i}`} x={textX} y={top(y, 12)} text={t} fontSize={12} fontStyle="700" fontFamily={theme.fonts.ui} fill={ink} opacity={0.85} />); });
      if (node.lines.length) {
        y += 4;
        node.lines.forEach((t, i) => { y += 18; items.push(<Text key={`l${i}`} x={textX} y={top(y, 13)} text={`• ${t}`} fontSize={13} fontStyle="700" fontFamily={theme.fonts.ui} fill={ink} opacity={0.95} />); });
      }
      if (node.code) {
        y += 10;
        const w = node.w - 68 - 14;
        items.push(<Rect key="cbg" x={textX} y={y} width={w} height={22} cornerRadius={8} fill={lightInk ? '#000' : '#fff'} opacity={lightInk ? 0.22 : 0.55} />);
        items.push(<Text key="ct" x={textX + 8} y={y + 4} text={node.code} fontSize={11.5} fontStyle="600" fontFamily={theme.fonts.mono} fill={lightInk ? '#fff' : '#3B2A00'} />);
      }
      return (
        <>
          <Rect x={0} y={5} width={node.w} height={node.h} cornerRadius={20} fill={dark} {...lipShadow} />
          <Rect name="blk" width={node.w} height={node.h} cornerRadius={20} fill={color} stroke={stroke} strokeWidth={strokeWidth} dash={node.error && !selected && !running ? [6, 4] : undefined} {...glow} />
          <Rect x={14} y={3} width={node.w - 28} height={3} cornerRadius={1.5} fill="#fff" opacity={0.38} listening={false} />
          <EmojiBubble x={34} y={bubbleY} r={20} emoji={node.emoji} theme={theme} />
          {items}
          <Badge node={node} theme={theme} />
        </>
      );
    }

    if (node.shape === 'hex') {
      const cy = node.h / 2;
      const total = node.titleLines.length * 19 + node.subLines.length * 17;
      let y = cy - total / 2 + 14;
      const items: ReactElement[] = [];
      node.titleLines.forEach((t, i) => { items.push(<Text key={`t${i}`} x={80} y={top(y, 15)} text={t} fontSize={15} fontStyle="800" fontFamily={theme.fonts.ui} fill={ink} />); y += 19; });
      node.subLines.forEach((t, i) => { items.push(<Text key={`s${i}`} x={80} y={top(y - 1, 12)} text={t} fontSize={12} fontStyle="700" fontFamily={theme.fonts.ui} fill={ink} opacity={0.8} />); y += 17; });
      return (
        <>
          <Shape x={0} y={0} fill={dark} stroke={dark} strokeWidth={10} lineJoin="round" {...lipShadow}
            sceneFunc={(ctx: Konva.Context, shape: Konva.Shape) => { ctx.beginPath(); hexPath(ctx, node.w, node.h, 5); ctx.fillStrokeShape(shape); }} />
          <Shape name="blk" x={0} y={0} fill={color} stroke={stroke ?? color} strokeWidth={stroke ? strokeWidth + 6 : 10} lineJoin="round" {...glow}
            sceneFunc={(ctx: Konva.Context, shape: Konva.Shape) => { ctx.beginPath(); hexPath(ctx, node.w, node.h, 0); ctx.fillStrokeShape(shape); }} />
          <EmojiBubble x={52} y={cy} r={19} emoji={node.emoji} theme={theme} />
          {items}
        </>
      );
    }

    if (node.shape === 'hat') {
      const total = node.titleLines.length * 19;
      let y = node.h / 2 - total / 2 + 16;
      const items = node.titleLines.map((t, i) => {
        const el = <Text key={i} x={66} y={top(y, 15)} text={t} fontSize={15} fontStyle="800" fontFamily={theme.fonts.ui} fill={ink} />;
        y += 19;
        return el;
      });
      return (
        <>
          <Shape x={0} y={0} fill={dark} sceneFunc={(ctx: Konva.Context, shape: Konva.Shape) => { ctx.beginPath(); hatBumpPath(ctx, 0); ctx.fillShape(shape); }} />
          <Rect x={0} y={5} width={node.w} height={node.h} cornerRadius={20} fill={dark} {...lipShadow} />
          <Shape name="blk" x={0} y={0} fill={color} sceneFunc={(ctx: Konva.Context, shape: Konva.Shape) => { ctx.beginPath(); hatBumpPath(ctx, 0); ctx.fillShape(shape); }} />
          <Rect width={node.w} height={node.h} cornerRadius={20} fill={color} stroke={stroke} strokeWidth={strokeWidth} {...glow} />
          <EmojiBubble x={32} y={node.h / 2 + 2} r={18} emoji={node.emoji} theme={theme} />
          {items}
        </>
      );
    }

    // pill
    return (
      <>
        <Rect x={0} y={4} width={node.w} height={node.h} cornerRadius={22} fill={dark} {...lipShadow} />
        <Rect name="blk" width={node.w} height={node.h} cornerRadius={22} fill={color} stroke={stroke} strokeWidth={strokeWidth} {...glow} />
        <Text x={14} y={node.h / 2 - 12} width={26} height={24} align="center" verticalAlign="middle" text={node.emoji} fontSize={20} fontFamily={theme.fonts.emoji} listening={false} />
        <Text x={50} y={top(node.h / 2 + 5.5, 15)} text={node.titleLines[0] ?? ''} fontSize={15} fontStyle="800" fontFamily={theme.fonts.ui} fill={ink} listening={false} />
      </>
    );
  })();

  return (
    <Group x={left} y={node.y} name={`node-${node.id}`} {...handlers}>
      {body}
    </Group>
  );
});
