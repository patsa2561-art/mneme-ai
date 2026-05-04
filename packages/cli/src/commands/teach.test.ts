import { describe, it, expect } from "vitest";
import { _classifyLayer } from "./teach.js";

describe("classifyLayer", () => {
  it("tags route/handler folders as 'api'", () => {
    expect(_classifyLayer("src/api/users.ts")).toBe("api");
    expect(_classifyLayer("server/routes/checkout.ts")).toBe("api");
    expect(_classifyLayer("backend/handlers/webhook.ts")).toBe("api");
    expect(_classifyLayer("src/controllers/order.ts")).toBe("api");
  });
  it("tags service/domain/usecase as 'service'", () => {
    expect(_classifyLayer("src/services/payment.ts")).toBe("service");
    expect(_classifyLayer("backend/domain/order.ts")).toBe("service");
    expect(_classifyLayer("src/usecases/charge.ts")).toBe("service");
  });
  it("tags repos/db/models as 'data'", () => {
    expect(_classifyLayer("src/repositories/user.ts")).toBe("data");
    expect(_classifyLayer("backend/db/orders.ts")).toBe("data");
    expect(_classifyLayer("src/models/cart.ts")).toBe("data");
  });
  it("tags components/views/screens as 'ui'", () => {
    expect(_classifyLayer("src/ui/Button.tsx")).toBe("ui");
    expect(_classifyLayer("src/components/Header.tsx")).toBe("ui");
    expect(_classifyLayer("src/screens/Home.tsx")).toBe("ui");
    expect(_classifyLayer("app/login.tsx")).toBe("ui");
  });
  it("tags utils/helpers/lib as 'utility'", () => {
    expect(_classifyLayer("src/utils/format.ts")).toBe("utility");
    expect(_classifyLayer("backend/lib/logger.ts")).toBe("utility");
    expect(_classifyLayer("common/helpers.ts")).toBe("utility");
  });
  it("tags test paths as 'test'", () => {
    expect(_classifyLayer("packages/core/tests/something.ts")).toBe("test");
    expect(_classifyLayer("src/__tests__/foo.ts")).toBe("test");
    expect(_classifyLayer("src/foo.test.ts")).toBe("test");
  });
  it("falls back to 'unknown' for unfamiliar paths", () => {
    expect(_classifyLayer("random/foo.ts")).toBe("unknown");
    expect(_classifyLayer("a/b/c.ts")).toBe("unknown");
  });
  it("is case-insensitive", () => {
    expect(_classifyLayer("SRC/SERVICES/Foo.ts")).toBe("service");
  });
});
