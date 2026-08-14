import React from "react";
import { Text, View } from "react-native";
import Svg, { Line, Path, Rect, Text as SvgText } from "react-native-svg";

interface Point {
  label: string;
  value: number;
}

const niceMax = (max: number) => {
  if (max <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const n = max / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
};

// Vertical bar chart — e.g. bookings per day.
export const BarChart: React.FC<{
  data: Point[];
  width: number;
  height?: number;
  color: string;
  labelColor: string;
  gridColor: string;
}> = ({ data, width, height = 200, color, labelColor, gridColor }) => {
  const pad = { l: 10, r: 10, t: 12, b: 26 };
  const cw = Math.max(0, width - pad.l - pad.r);
  const ch = height - pad.t - pad.b;
  const max = niceMax(Math.max(1, ...data.map((d) => d.value)));
  const n = Math.max(1, data.length);
  const bw = cw / n;
  const labelEvery = Math.ceil(n / 8);

  return (
    <Svg width={width} height={height}>
      <Line x1={pad.l} y1={pad.t + ch} x2={pad.l + cw} y2={pad.t + ch} stroke={gridColor} strokeWidth={1} />
      {data.map((d, i) => {
        const h = (d.value / max) * ch;
        const x = pad.l + i * bw + bw * 0.15;
        const y = pad.t + (ch - h);
        return <Rect key={i} x={x} y={y} width={bw * 0.7} height={Math.max(0, h)} rx={3} fill={color} />;
      })}
      {data.map((d, i) =>
        i % labelEvery === 0 ? (
          <SvgText key={`l${i}`} x={pad.l + i * bw + bw / 2} y={height - 8} fontSize={10} fill={labelColor} textAnchor="middle">
            {d.label}
          </SvgText>
        ) : null
      )}
    </Svg>
  );
};

// Area/line chart — e.g. revenue trend.
export const LineChart: React.FC<{
  data: Point[];
  width: number;
  height?: number;
  color: string;
  labelColor: string;
  gridColor: string;
}> = ({ data, width, height = 200, color, labelColor, gridColor }) => {
  const pad = { l: 10, r: 10, t: 12, b: 26 };
  const cw = Math.max(0, width - pad.l - pad.r);
  const ch = height - pad.t - pad.b;
  const max = niceMax(Math.max(1, ...data.map((d) => d.value)));
  const n = data.length;
  const labelEvery = Math.ceil(Math.max(1, n) / 8);

  const px = (i: number) => (n <= 1 ? pad.l + cw / 2 : pad.l + (i / (n - 1)) * cw);
  const py = (v: number) => pad.t + (ch - (v / max) * ch);

  const linePath = data.map((d, i) => `${i === 0 ? "M" : "L"} ${px(i)} ${py(d.value)}`).join(" ");
  const areaPath =
    n > 0
      ? `${linePath} L ${px(n - 1)} ${pad.t + ch} L ${px(0)} ${pad.t + ch} Z`
      : "";

  return (
    <Svg width={width} height={height}>
      <Line x1={pad.l} y1={pad.t + ch} x2={pad.l + cw} y2={pad.t + ch} stroke={gridColor} strokeWidth={1} />
      {n > 0 && <Path d={areaPath} fill={color} fillOpacity={0.14} />}
      {n > 0 && <Path d={linePath} stroke={color} strokeWidth={2.5} fill="none" />}
      {data.map((d, i) => (n <= 40 ? <Rect key={`p${i}`} x={px(i) - 2} y={py(d.value) - 2} width={4} height={4} rx={2} fill={color} /> : null))}
      {data.map((d, i) =>
        i % labelEvery === 0 ? (
          <SvgText key={`l${i}`} x={px(i)} y={height - 8} fontSize={10} fill={labelColor} textAnchor="middle">
            {d.label}
          </SvgText>
        ) : null
      )}
    </Svg>
  );
};

// Horizontal bars — e.g. per-agent revenue leaderboard.
export const HBarChart: React.FC<{
  data: { label: string; value: number }[];
  width: number;
  color: string;
  labelColor: string;
  valueFmt: (n: number) => string;
}> = ({ data, width, color, labelColor, valueFmt }) => {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <View style={{ width, gap: 10 }}>
      {data.map((d, i) => (
        <View key={i} style={{ gap: 4 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ color: labelColor, fontSize: 14 }} numberOfLines={1}>
              {d.label}
            </Text>
            <Text style={{ color: labelColor, fontSize: 14, fontWeight: "700" }}>{valueFmt(d.value)}</Text>
          </View>
          <View style={{ height: 10, borderRadius: 5, backgroundColor: color + "22", overflow: "hidden" }}>
            <View style={{ width: `${(d.value / max) * 100}%`, height: 10, borderRadius: 5, backgroundColor: color }} />
          </View>
        </View>
      ))}
    </View>
  );
};
