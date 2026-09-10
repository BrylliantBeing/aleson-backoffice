// jest-expo wires up the Expo/React Native module registry, the babel
// transform (so `@/` aliases resolve the same way they do in the app) and the
// platform-specific `.web.tsx`/`.native.tsx` resolution.
//
// Pinned to jest-expo 57.0.2 rather than the newest 57.x on purpose: later
// releases peer on @react-native/jest-preset ^0.86.2/^0.86.3, and this app is
// on react-native 0.86.0, which pins that preset to exactly 0.86.0. Bump both
// together or not at all.
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],

  // node_modules ships untranspiled ESM across the Expo/RN ecosystem, so the
  // usual "ignore everything" default has to be inverted for those packages.
  // This list is what THIS app actually ships — it is deliberately not a copy
  // of aleson-website's, which carries rrule/zustand/uuid that nothing here
  // imports.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|react-navigation|@react-navigation/.*|react-native-calendars|react-native-dropdown-select-list|react-native-svg|react-native-web|react-native-gesture-handler|react-native-reanimated|react-native-worklets))',
  ],

  // Mirrors tsconfig.json's paths. The assets rule has to come first: `@/*`
  // would otherwise swallow `@/assets/*` and resolve it under src/.
  moduleNameMapper: {
    '^@/assets/(.*)$': '<rootDir>/assets/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
  },

  collectCoverageFrom: [
    'src/utils/**/*.{ts,tsx}',
    'src/context/**/*.{ts,tsx}',
    'src/hooks/**/*.{ts,tsx}',
    'src/components/**/*.{ts,tsx}',
  ],

  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.{js,jsx,ts,tsx}'],
};
