/** @type {import("jest").Config} */
module.exports = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/packages/*/test/**/*.test.js"],
  transform: {},
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^@ai-usage-profile/shared$": "<rootDir>/packages/shared/src/index.js",
    "^@ai-usage-profile/server$": "<rootDir>/packages/server/src/index.js",
  },
  coverageProvider: "v8",
  collectCoverageFrom: [
    "packages/*/src/**/*.js",
    "!packages/*/src/index.js",
    "!packages/server/src/service/postgres-profile-repository.js",
    "!packages/server/src/service/object-store.js",
  ],
  coverageDirectory: "coverage",
  coverageThreshold: {
    global: {
      lines: 90,
      branches: 85,
      functions: 90,
      statements: 90,
    },
  },
  maxWorkers: "50%",
};
