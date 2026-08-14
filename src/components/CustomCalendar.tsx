import Colors from "@/constants/Colors";
import { FontAwesome } from "@expo/vector-icons";
import React, { useState } from "react";
import {
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    useColorScheme,
    View,
    ViewStyle,
} from "react-native";
import { Calendar } from "react-native-calendars";

const THIS_YEAR = new Date().getFullYear();
const YEAR_LIST = Array.from(
  { length: THIS_YEAR + 5 - 1900 + 1 },
  (_, i) => THIS_YEAR + 5 - i,
);
const MONTHS = [
  "January", "February", "March", "April",
  "May", "June", "July", "August",
  "September", "October", "November", "December",
];

interface CustomCalendarParams {
  style?: ViewStyle;
  onDateSelect?: (date: string) => void;
  defaultDate?: string;
  label?: string;
  maxDate?: string;
}

const CustomCalendar = ({
  style,
  onDateSelect,
  defaultDate,
  label = "Select Date",
  maxDate,
}: CustomCalendarParams) => {
  const colorScheme = useColorScheme() ?? "light";
  const theme = Colors[colorScheme] ?? Colors.light;

  const [visibility, setVisibility] = useState(false);
  const [selectedDate, setSelectedDate] = useState(defaultDate ?? "");
  const [displayDate, setDisplayDate] = useState(
    defaultDate || new Date().toISOString().split("T")[0],
  );
  const [pickerMode, setPickerMode] = useState<"none" | "year" | "month">("none");

  const displayYear = parseInt(displayDate.split("-")[0]);
  const displayMonthIdx = parseInt(displayDate.split("-")[1]) - 1;

  const jumpToYear = (year: number) => {
    const mm = String(displayMonthIdx + 1).padStart(2, "0");
    setDisplayDate(`${year}-${mm}-01`);
    setPickerMode("none");
  };

  const jumpToMonth = (monthIdx: number) => {
    const mm = String(monthIdx + 1).padStart(2, "0");
    setDisplayDate(`${displayYear}-${mm}-01`);
    setPickerMode("none");
  };

  const handleClose = () => {
    setVisibility(false);
    setPickerMode("none");
  };

  const togglePicker = (mode: "year" | "month") =>
    setPickerMode((prev) => (prev === mode ? "none" : mode));

  return (
    <View style={[style, { zIndex: visibility ? 9999 : 1 }]}>
      <View style={styles.container}>
        {label ? (
          <Text style={[styles.fieldLabel, { color: theme.greyText }]}>{label}</Text>
        ) : null}

        <Pressable
          onPress={() => { setVisibility(!visibility); setPickerMode("none"); }}
          style={{ width: "100%" }}
        >
          <View
            style={[
              styles.labelPressable,
              { borderColor: theme.border, backgroundColor: theme.control },
            ]}
          >
            <Text
              style={[
                { color: selectedDate === "" ? theme.greyText : theme.text },
                styles.placeholderText,
              ]}
            >
              {selectedDate === "" ? "Select Date" : selectedDate}
            </Text>
            <FontAwesome name="calendar" size={16} color={theme.tint} />
          </View>
        </Pressable>
      </View>

      {visibility && (
        <View
          style={[
            styles.calendarWrapper,
            { borderColor: theme.border, backgroundColor: theme.cardBackground },
          ]}
        >
          {/* Toolbar: month badge + year badge + close */}
          <View style={styles.toolbar}>
            <View style={styles.navBadges}>
              <Pressable
                onPress={() => togglePicker("month")}
                style={[styles.navBadge, { borderColor: theme.greyText + "66" }]}
              >
                <Text style={[styles.navBadgeText, { color: theme.text }]}>
                  {MONTHS[displayMonthIdx].slice(0, 3)}
                </Text>
                <FontAwesome
                  name={pickerMode === "month" ? "chevron-up" : "chevron-down"}
                  size={10}
                  color={theme.greyText}
                />
              </Pressable>

              <Pressable
                onPress={() => togglePicker("year")}
                style={[styles.navBadge, { borderColor: theme.greyText + "66" }]}
              >
                <Text style={[styles.navBadgeText, { color: theme.text }]}>
                  {displayYear}
                </Text>
                <FontAwesome
                  name={pickerMode === "year" ? "chevron-up" : "chevron-down"}
                  size={10}
                  color={theme.greyText}
                />
              </Pressable>
            </View>

            <FontAwesome
              name="close"
              size={12}
              onPress={handleClose}
              color={colorScheme === "dark" ? "white" : "black"}
              style={{ padding: 12 }}
            />
          </View>

          {pickerMode === "year" ? (
            <ScrollView
              style={styles.yearScroll}
              contentContainerStyle={styles.yearGrid}
              showsVerticalScrollIndicator={false}
            >
              {YEAR_LIST.map((year) => (
                <Pressable
                  key={year}
                  onPress={() => jumpToYear(year)}
                  style={[
                    styles.chip,
                    { borderColor: theme.greyText + "44" },
                    year === displayYear && {
                      backgroundColor: theme.tint,
                      borderColor: theme.tint,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      { color: theme.text },
                      year === displayYear && { color: "#fff", fontWeight: "700" },
                    ]}
                  >
                    {year}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : pickerMode === "month" ? (
            <View style={styles.monthGrid}>
              {[0, 1, 2, 3].map((row) => (
                <View key={row} style={styles.monthRow}>
                  {[0, 1, 2].map((col) => {
                    const idx = row * 3 + col;
                    const selected = idx === displayMonthIdx;
                    return (
                      <Pressable
                        key={idx}
                        onPress={() => jumpToMonth(idx)}
                        style={[
                          styles.chip,
                          styles.monthChip,
                          { borderColor: theme.greyText + "44" },
                          selected && {
                            backgroundColor: theme.tint,
                            borderColor: theme.tint,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            { color: theme.text },
                            selected && { color: "#fff", fontWeight: "700" },
                          ]}
                        >
                          {MONTHS[idx].slice(0, 3)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </View>
          ) : (
            <Calendar
              current={displayDate}
              maxDate={maxDate}
              onMonthChange={(month) => setDisplayDate(month.dateString)}
              theme={{
                backgroundColor: theme.cardBackground,
                calendarBackground: theme.cardBackground,
                textSectionTitleColor: "#fff",
                selectedDayBackgroundColor: theme.buttonSelected,
                selectedDayTextColor: theme.text,
                todayTextColor: "#00adf5",
                dayTextColor: theme.fadedText,
                textDisabledColor: "#dd99ee",
                monthTextColor: theme.text,
              }}
              onDayPress={(day) => {
                setSelectedDate(day.dateString);
                handleClose();
                onDateSelect?.(day.dateString);
              }}
              markedDates={{
                [selectedDate]: { selected: true, disableTouchEvent: true },
              }}
            />
          )}
        </View>
      )}
    </View>
  );
};

export default CustomCalendar;

const styles = StyleSheet.create({
  container: { gap: 6 },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    fontFamily: "Lato",
  },
  labelPressable: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    justifyContent: "space-between",
    flexDirection: "row",
    width: "100%",
  },
  placeholderText: { fontFamily: "Lato", fontSize: 18 },
  calendarWrapper: {
    height: 420,
    width: "100%",
    borderWidth: 1,
    borderRadius: 16,
    position: "absolute",
    top: "100%",
    marginTop: 10,
    zIndex: 9999,
    elevation: 5,
    overflow: "hidden",
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: 14,
    paddingRight: 4,
    paddingVertical: 4,
  },
  navBadges: { flexDirection: "row", gap: 6 },
  navBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
  },
  navBadgeText: { fontSize: 16, fontWeight: "600" },
  yearScroll: { flex: 1 },
  yearGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    padding: 10,
    justifyContent: "center",
  },
  monthGrid: { padding: 12 },
  monthRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    minWidth: 60,
    alignItems: "center",
  },
  monthChip: { flex: 1, paddingVertical: 10, minWidth: 0 },
  chipText: { fontSize: 15 },
});
