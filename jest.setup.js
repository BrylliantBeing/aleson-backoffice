/* eslint-env jest */

// Run the suite in the operator's real timezone rather than the machine's.
// Departures and schedule rrules are Asia/Manila wall clocks, and a
// UTC-vs-local mix-up is invisible when the tests themselves run in UTC —
// which is exactly what CI does.
process.env.TZ = 'Asia/Manila';

// AsyncStorage has no JS implementation outside a device — the official mock
// swaps in an in-memory store, which is what AuthContext's session hydration
// and the printer settings both read.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// expo-router's real module needs a mounted navigation container. Tests only
// ever assert on where a screen *tried* to navigate, so a spyable stub is
// enough. Tabs and Redirect are here and absent from aleson-website's copy:
// this app's (tabs)/_layout.tsx and _layout.tsx use both.
jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    navigate: jest.fn(),
    setParams: jest.fn(),
  },
  useLocalSearchParams: jest.fn(() => ({})),
  useRouter: jest.fn(() => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
  })),
  Link: 'Link',
  Stack: { Screen: 'Stack.Screen' },
  Tabs: { Screen: 'Tabs.Screen' },
  Redirect: 'Redirect',
  Slot: 'Slot',
}));

jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

// The real icon set loads its font asynchronously and setState()s when that
// resolves, which lands outside act() and buries real failures in warnings.
// Rendering each icon as a host element keeps it queryable by name instead.
jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const iconSet = (family) =>
    ({ name, ...props }) => React.createElement(family, { ...props, name });
  return new Proxy(
    {},
    {
      get: (_target, family) => iconSet(String(family)),
    }
  );
});

// src/utils/api.ts reads this at module scope, so it has to be set before the
// first import rather than inside a test.
process.env.EXPO_PUBLIC_API_BASE_URL = 'http://test.local/api/v1';

// Every suite that touches the network installs its own fetch mock; this just
// guarantees a test can never reach a real host by forgetting to. The print
// agent lives on localhost, so this also stops a suite firing a real job at a
// printer on the developer's machine.
beforeEach(() => {
  global.fetch = jest.fn(() =>
    Promise.reject(new Error('Unexpected network call — mock fetch in the test'))
  );
});

afterEach(() => {
  jest.clearAllMocks();
});
