import Elysia from "elysia";
import { GETHealthResponse } from "../types/response/common.response";

const common = new Elysia();

common.get(
  "/api/health",
  async () => {
    // TODO: implement
    return { status: "ok" };
  },
  {
    response: {
      200: GETHealthResponse,
    },
  },
);

export { common };
