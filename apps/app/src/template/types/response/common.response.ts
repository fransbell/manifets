import { t } from "elysia";

export const GETHealthResponse = t.Object({
  status: t.String(),
  uptime: t.Number(),
});

export const GETVersionResponse = t.Object({
  version: t.String(),
  build: t.String(),
});
