// Palette aligned with the Aleson customer website (app/index.tsx design tokens):
// navy PRIMARY, bright-blue ACCENT, light blue-gray page, soft blue borders.
const Colors = {
  light: {
    text: "#0D1B2A", // TEXT
    fadedText: "#5B6F85", // MUTED
    background: "#EEF3FB", // BG
    tint: "#0A7BFF", // ACCENT — primary interactive
    primary: "#002D6E", // PRIMARY navy
    primaryDark: "#00204F",
    accent: "#0A7BFF",
    border: "#D8E4F5", // BORDER
    control: "#F5F8FF", // CONTROL — input fill
    muted: "#5B6F85",
    tabIconDefault: "#8CA0BC",
    buttonSelected: "#0A7BFF",
    buttonHover: "#00204F",
    navBarBackground: "#002D6E",
    greyText: "#5B6F85",
    cardBackground: "#FFFFFF",
    shadowColor: "#0D1B2A",
    white: "#FFFFFF",
  },
  dark: {
    text: "#EAF1FB",
    fadedText: "rgba(234,241,251,0.72)",
    background: "#0A1830",
    tint: "#3B93FF",
    primary: "#0A7BFF",
    primaryDark: "#00204F",
    accent: "#3B93FF",
    border: "#24365A",
    control: "#132743",
    muted: "#8CA0BC",
    tabIconDefault: "#5B6F85",
    buttonSelected: "#3B93FF",
    buttonHover: "#1B2A49",
    navBarBackground: "#00204F",
    greyText: "#8CA0BC",
    cardBackground: "#0F2140",
    shadowColor: "#000000",
    white: "#FFFFFF",
  },
};

export type ThemeColors = typeof Colors.light;

// Indexed by useColorScheme(), whose type can include null/'unspecified' on newer
// React Native — expose a string index so `Colors[scheme] ?? Colors.light` type-checks.
export default Colors as Record<string, ThemeColors> & typeof Colors;
