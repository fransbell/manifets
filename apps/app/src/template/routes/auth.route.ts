import Elysia from "elysia";
import { POSTAuthLoginRequest } from "../types/request/auth.request";
import { POSTAuthLoginResponse } from "../types/response/auth.response";

const auth = new Elysia().group("/api/auth", (app) => {
  app.post(
    "/login",
    async ({ body }) => {
      // TODO: implement
      return {
        token: "example",
      };
    },
    {
      body: POSTAuthLoginRequest,
      response: { 200: POSTAuthLoginResponse },
    },
  );

  return app;
});

export { auth };
