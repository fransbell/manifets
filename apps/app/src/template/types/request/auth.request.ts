import { t } from "elysia";

export const POSTAuthLoginRequest = t.Object({
  username: t.String(),
  password: t.String(),
});
