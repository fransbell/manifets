import Elysia from "elysia";
import { container } from "../container";
import { AuthService } from "../implems";
import { GETHealthResponse, GETVersionResponse } from "../types/response/common.response";

const common = new Elysia();

common.get(
  "/api/health",
  async () => {
    const authService: AuthService = container.resolve("AuthService");
    const token = await authService.getToken({ username: "system", password: "" });
    return { status: "ok", uptime: process.uptime() };
  },
  {
    response: { 200: GETHealthResponse },
  },
);

common.get(
  "/api/version",
  async () => {
    return { version: "1.0.0", build: "abc123" };
  },
  {
    response: { 200: GETVersionResponse },
  },
);

export { common };
