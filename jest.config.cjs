/** @type {import("jest").Config} */
module.exports = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/packages/*/test/**/*.test.js"],
  transform: {},
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  coverageProvider: "v8",
  collectCoverageFrom: [
    "packages/*/src/**/*.js",
    "!packages/*/src/index.js",
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
