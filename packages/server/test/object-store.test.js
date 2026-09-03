import { MinioCardStore } from "../src/service/object-store.js";

describe("object store", () => {
  it("deletes the pre-rendered card objects for a slug", async () => {
    const deletedKeys = [];
    const store = new MinioCardStore({
      endpoint: "http://127.0.0.1:9000",
      accessKey: "access-key",
      secretKey: "secret-key-8",
      bucketCards: "cards",
    });
    store.client.send = async (command) => {
      deletedKeys.push(command.input.Key);
    };
    await store.deleteCards("moquent");
    expect(deletedKeys).toEqual([
      "moquent/dark.svg",
      "moquent/light.svg",
      "moquent/card.svg",
    ]);
  });
});
