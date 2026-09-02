import { createProgram } from "../src/cli.js";

describe("client CLI surface", () => {
  it("exposes only setup and publish commands", () => {
    const program = createProgram();
    expect(program.commands.map((command) => command.name())).toEqual(["setup", "publish"]);
    expect(
      program.commands.filter((command) => !command._hidden).map((command) => command.name()),
    ).toEqual(["setup", "publish"]);
  });
});
