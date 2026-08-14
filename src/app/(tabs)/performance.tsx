import Background from "@/components/Background";
import CustomCalendar from "@/components/CustomCalendar";
import { BarChart, HBarChart, LineChart } from "@/components/PerfCharts";
import WholeCard from "@/components/WholeCard";
import Colors from "@/constants/Colors";
import { apiFetch } from "@/utils/api";
import { peso } from "@/utils/passengerRules";
import { FontAwesome } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from "react-native";

const fmt = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const now = new Date();
const DEFAULT_START = fmt(new Date(now.getFullYear(), now.getMonth(), 1));
const DEFAULT_END = fmt(now);

interface AgentPerf {
  agent_id: number;
  name: string;
  email: string;
  bookings: number;
  revenue: number;
  passengers: number;
}
interface TrendPoint {
  date: string;
  bookings: number;
  revenue: number;
}

const shortDate = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${parseInt(m)}/${parseInt(d)}`;
};

const SalesPerformance = () => {
  const colorScheme = useColorScheme() ?? "light";
  const theme = Colors[colorScheme] ?? Colors.light;

  const [start, setStart] = useState(DEFAULT_START);
  const [end, setEnd] = useState(DEFAULT_END);
  const [agents, setAgents] = useState<AgentPerf[]>([]);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [chartW, setChartW] = useState(0);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiFetch(`/api/v1/performance/agents?start=${start}&end=${end}`).then((r) => r.json()),
      apiFetch(`/api/v1/performance/trend?start=${start}&end=${end}`).then((r) => r.json()),
    ])
      .then(([a, t]) => {
        setAgents(Array.isArray(a) ? a : []);
        setTrend(Array.isArray(t) ? t : []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [start, end]);

  const totals = agents.reduce(
    (acc, a) => {
      acc.bookings += a.bookings;
      acc.revenue += a.revenue;
      acc.passengers += a.passengers;
      return acc;
    },
    { bookings: 0, revenue: 0, passengers: 0 }
  );

  const revenuePoints = trend.map((t) => ({ label: shortDate(t.date), value: t.revenue }));
  const bookingPoints = trend.map((t) => ({ label: shortDate(t.date), value: t.bookings }));
  const agentBars = agents
    .filter((a) => a.revenue > 0)
    .map((a) => ({ label: a.name, value: a.revenue }));

  const kpis = [
    { label: "Total Revenue", value: peso(totals.revenue), icon: "money", color: "#028cef" },
    { label: "Bookings", value: String(totals.bookings), icon: "ticket", color: "#2e9e5b" },
    { label: "Passengers", value: String(totals.passengers), icon: "users", color: "#8b5cf6" },
  ];

  return (
    <Background>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Filter */}
        <View style={{ zIndex: 30 }}>
          <WholeCard
            header="Sales Performance"
            spacer={{ height: 16 }}
            style={{ flexDirection: "row", gap: 20, flexWrap: "wrap" }}
          >
            <View style={{ flex: 1, minWidth: 220, zIndex: 20 }}>
              <CustomCalendar label="From" defaultDate={start} maxDate={end} onDateSelect={setStart} />
            </View>
            <View style={{ flex: 1, minWidth: 220, zIndex: 20 }}>
              <CustomCalendar label="To" defaultDate={end} onDateSelect={setEnd} />
            </View>
          </WholeCard>
        </View>

        {loading ? (
          <ActivityIndicator size="large" color={theme.tint} style={{ marginTop: 30 }} />
        ) : (
          <>
            {/* KPI tiles */}
            <View style={styles.kpiRow}>
              {kpis.map((k) => (
                <View
                  key={k.label}
                  style={[styles.kpi, { backgroundColor: theme.cardBackground, borderColor: theme.border, shadowColor: theme.shadowColor }]}
                >
                  <View style={[styles.kpiIcon, { backgroundColor: k.color + "1f" }]}>
                    <FontAwesome name={k.icon as any} size={22} color={k.color} />
                  </View>
                  <Text style={[styles.kpiValue, { color: theme.text }]}>{k.value}</Text>
                  <Text style={[styles.kpiLabel, { color: theme.greyText }]}>{k.label}</Text>
                </View>
              ))}
            </View>

            {/* Charts */}
            <WholeCard header="Revenue Trend" spacer={{ height: 12 }}>
              <View onLayout={(e) => setChartW(e.nativeEvent.layout.width)}>
                {chartW > 0 && trend.length > 0 ? (
                  <LineChart
                    data={revenuePoints}
                    width={chartW}
                    color={theme.tint}
                    labelColor={theme.greyText}
                    gridColor={theme.greyText + "44"}
                  />
                ) : (
                  <Text style={{ color: theme.greyText, fontStyle: "italic" }}>
                    No sales in this period.
                  </Text>
                )}
              </View>
            </WholeCard>

            <WholeCard header="Bookings per Day" spacer={{ height: 12 }}>
              <View onLayout={(e) => setChartW(e.nativeEvent.layout.width)}>
                {chartW > 0 && trend.length > 0 ? (
                  <BarChart
                    data={bookingPoints}
                    width={chartW}
                    color="#2e9e5b"
                    labelColor={theme.greyText}
                    gridColor={theme.greyText + "44"}
                  />
                ) : (
                  <Text style={{ color: theme.greyText, fontStyle: "italic" }}>No bookings in this period.</Text>
                )}
              </View>
            </WholeCard>

            {agentBars.length > 0 && (
              <WholeCard header="Revenue by Agent" spacer={{ height: 12 }}>
                <View onLayout={(e) => setChartW(e.nativeEvent.layout.width)}>
                  {chartW > 0 && (
                    <HBarChart data={agentBars} width={chartW} color={theme.tint} labelColor={theme.text} valueFmt={peso} />
                  )}
                </View>
              </WholeCard>
            )}

            {/* Leaderboard */}
            <WholeCard header="Agent Leaderboard" spacer={{ height: 12 }}>
              {agents.length === 0 ? (
                <Text style={{ color: theme.greyText, fontStyle: "italic" }}>No agents found.</Text>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={[styles.table, { borderColor: theme.border }]}>
                    <View style={[styles.trow, { backgroundColor: theme.primary }]}>
                      <Text style={[styles.th, styles.cRank]}>#</Text>
                      <Text style={[styles.th, styles.cName]}>Agent</Text>
                      <Text style={[styles.th, styles.cNum]}>Bookings</Text>
                      <Text style={[styles.th, styles.cNum]}>Pax</Text>
                      <Text style={[styles.th, styles.cRev]}>Revenue</Text>
                    </View>
                    {agents.map((a, i) => (
                      <View
                        key={a.agent_id}
                        style={[
                          styles.trow,
                          {
                            backgroundColor: i % 2 === 0 ? "transparent" : theme.background + "88",
                            borderTopWidth: 1,
                            borderTopColor: theme.greyText + "22",
                          },
                        ]}
                      >
                        <Text style={[styles.cRank, { color: theme.text }]}>{i + 1}</Text>
                        <Text style={[styles.cName, { color: theme.text }]}>{a.name}</Text>
                        <Text style={[styles.cNum, { color: theme.fadedText }]}>{a.bookings}</Text>
                        <Text style={[styles.cNum, { color: theme.fadedText }]}>{a.passengers}</Text>
                        <Text style={[styles.cRev, { color: theme.text, fontWeight: "700" }]}>{peso(a.revenue)}</Text>
                      </View>
                    ))}
                  </View>
                </ScrollView>
              )}
            </WholeCard>
          </>
        )}
        <View style={{ height: 50 }} />
      </ScrollView>
    </Background>
  );
};

export default SalesPerformance;

const styles = StyleSheet.create({
  kpiRow: { flexDirection: "row", gap: 16, marginHorizontal: 20, marginTop: 4, flexWrap: "wrap" },
  kpi: {
    flex: 1,
    minWidth: 180,
    padding: 22,
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 3,
  },
  kpiIcon: { width: 46, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  kpiValue: { fontSize: 28, fontWeight: "800" },
  kpiLabel: { fontSize: 15 },
  table: { borderWidth: 1, borderRadius: 12, overflow: "hidden", minWidth: 560 },
  trow: { flexDirection: "row", paddingVertical: 12 },
  th: { color: "#fff", fontWeight: "700" },
  cRank: { width: 50, paddingHorizontal: 12, fontSize: 15 },
  cName: { width: 220, paddingHorizontal: 12, fontSize: 15 },
  cNum: { width: 100, paddingHorizontal: 12, fontSize: 15, textAlign: "right" },
  cRev: { width: 140, paddingHorizontal: 12, fontSize: 15, textAlign: "right" },
});
