import Elysia from "elysia";
import { container } from "../container";
import { AuthService } from "../implems";
import { POSTAuthLoginRequest } from "../types/request/auth.request";
import {
  POSTAuthRegisterResponse,
  POSTAuthLoginResponse,
  POSTAuthLogoutResponse,
  POSTAuthRefreshResponse,
} from "../types/response/auth.response";

const auth = new Elysia().group("/api/auth", (app) => {
  app.post(
    "/register",
    async ({ body }) => {
      const authService: AuthService = container.resolve("AuthService");
      return authService.register(body as any);
    },
    {
      body: POSTAuthLoginRequest,
      response: { 200: POSTAuthRegisterResponse },
    },
  );

  app.post(
    "/login",
    async ({ body }) => {
      const authService: AuthService = container.resolve("AuthService");
      return authService.getToken(body as any);
    },
    {
      body: POSTAuthLoginRequest,
      response: { 200: POSTAuthLoginResponse },
    },
  );

  app.post(
    "/logout",
    async () => {
      const authService: AuthService = container.resolve("AuthService");
      return authService.logout();
    },
    {
      response: { 200: POSTAuthLogoutResponse },
    },
  );

  app.post(
    "/refresh",
    async ({ body }) => {
      const authService: AuthService = container.resolve("AuthService");
      return authService.refresh(body as any);
    },
    {
      body: POSTAuthLoginRequest,
      response: { 200: POSTAuthRefreshResponse },
    },
  );

  return app;
});

export { auth };
