import Colors from "@/constants/Colors";
import { FontAwesome } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, useColorScheme, View } from "react-native";

// Always-on compact month grid for picking a travel date. No dropdown/popover —
// it lives inline. Days with no scheduled voyage (per `hasVoyage`) and days
// before `minDate` are greyed out and non-tappable, so the agent can see the
// route's sailing days at a glance and only pick real ones.

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WD = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

interface Props {
  value?: string; // the endpoint currently being edited (active leg's date)
  onChange: (iso: string) => void;
  minDate?: string; // ISO — days before this are disabled
  hasVoyage?: (iso: string) => boolean; // undefined = don't grey for schedule
  rangeStart?: string; // departure — filled endpoint / start of the tinted range
  rangeEnd?: string; // return — filled endpoint / end of the tinted range
}

const parseISO = (s?: string): { y: number; m: number; d: number } | null => {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
};

const MiniCalendar: React.FC<Props> = ({
  value,
  onChange,
  minDate,
  hasVoyage,
  rangeStart,
  rangeEnd,
}) => {
  const scheme = useColorScheme() ?? "light";
  const theme = Colors[scheme] ?? Colors.light;

  const now = new Date();
  const initial = parseISO(value) ?? { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
  const [view, setView] = useState({ y: initial.y, m: initial.m });

  // Follow the selected value's month (e.g. when typed or stepped ±1) so the
  // grid always shows the current pick.
  useEffect(() => {
    const p = parseISO(value);
    if (p && (p.y !== view.y || p.m !== view.m)) setView({ y: p.y, m: p.m });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const shiftMonth = (delta: number) => {
    setView((v) => {
      const idx = (v.m - 1 + delta + 12 * 400) % 12;
      const yShift = Math.floor((v.m - 1 + delta) / 12);
      return { y: v.y + yShift, m: idx + 1 };
    });
  };

  const firstWeekday = new Date(view.y, view.m - 1, 1).getDay();
  const daysInMonth = new Date(view.y, view.m, 0).getDate();
  const todayISO = iso(now.getFullYear(), now.getMonth() + 1, now.getDate());

  // Build week rows (only as many as the month needs).
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Pressable onPress={() => shiftMonth(-1)} hitSlop={8} style={styles.navBtn}>
          <FontAwesome name="chevron-left" size={11} color={theme.tint} />
        </Pressable>
        <Text style={[styles.title, { color: theme.text }]}>
          {MONTHS[view.m - 1]} {view.y}
        </Text>
        <Pressable onPress={() => shiftMonth(1)} hitSlop={8} style={styles.navBtn}>
          <FontAwesome name="chevron-right" size={11} color={theme.tint} />
        </Pressable>
      </View>

      <View style={styles.weekRow}>
        {WD.map((w) => (
          <Text key={w} style={[styles.wdLabel, { color: theme.greyText }]}>
            {w}
          </Text>
        ))}
      </View>

      {weeks.map((week, wi) => (
        <View key={wi} style={styles.weekRow}>
          {week.map((d, di) => {
            if (d == null) return <View key={di} style={styles.cell} />;
            const cellISO = iso(view.y, view.m, d);
            const past = !!minDate && cellISO < minDate;
            const noTrip = !!hasVoyage && !hasVoyage(cellISO);
            const disabled = past || noTrip;
            const isStart = !!rangeStart && cellISO === rangeStart;
            const isEnd = !!rangeEnd && cellISO === rangeEnd;
            const endpoint = isStart || isEnd;
            const inRange =
              !!rangeStart && !!rangeEnd && cellISO > rangeStart && cellISO < rangeEnd;
            const active = cellISO === value; // endpoint of the leg being edited
            const isToday = cellISO === todayISO;

            const cellStyle = endpoint
              ? { backgroundColor: theme.tint }
              : inRange
              ? { backgroundColor: theme.tint + "22" }
              : !isToday
              ? null
              : { borderColor: theme.tint, borderWidth: 1.5 };
            const textColor = endpoint
              ? "#fff"
              : inRange
              ? theme.tint
              : disabled
              ? theme.greyText + "70"
              : theme.text;
            return (
              <Pressable
                key={di}
                disabled={disabled}
                onPress={() => onChange(cellISO)}
                style={[
                  styles.cell,
                  styles.day,
                  cellStyle,
                  endpoint && active && { borderColor: theme.primary, borderWidth: 2 },
                ]}
              >
                <Text
                  style={{
                    fontSize: 11.5,
                    fontWeight: endpoint || inRange || isToday ? "800" : "500",
                    color: textColor,
                  }}
                >
                  {d}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
};

export default MiniCalendar;

const styles = StyleSheet.create({
  wrap: { marginTop: 8, gap: 2 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  navBtn: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 12.5, fontWeight: "800", fontFamily: "Lato" },
  weekRow: { flexDirection: "row" },
  wdLabel: {
    flex: 1,
    textAlign: "center",
    fontSize: 9.5,
    fontWeight: "700",
    letterSpacing: 0.3,
    paddingVertical: 1,
  },
  cell: { flex: 1, height: 24, alignItems: "center", justifyContent: "center" },
  day: { borderRadius: 6, margin: 1 },
});
