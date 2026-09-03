import { createHostedService } from "../src/service/hosted-service.js";
import { ADMIN_KEY } from "../../test-support/helpers.js";

describe("legal routes", () => {
  it("serves privacy and terms pages", async () => {
    const app = await createHostedService({ adminKey: ADMIN_KEY, logger: false });
    try {
      const privacy = await app.inject({ method: "GET", url: "/privacy" });
      const terms = await app.inject({ method: "GET", url: "/terms" });
      expect(privacy.statusCode).toBe(200);
      expect(privacy.headers["content-type"]).toMatch(/text\/html/);
      expect(privacy.body).toMatch(/Privacy Policy|do not store/i);
      expect(terms.statusCode).toBe(200);
      expect(terms.headers["content-type"]).toMatch(/text\/html/);
      expect(terms.body).toMatch(/Terms of Service|Limitation of liability/i);
    } finally {
      await app.close();
    }
  });
});
