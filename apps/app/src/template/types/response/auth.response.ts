import { t } from "elysia";

export const POSTAuthRegisterResponse = t.Object({
  id: t.Number(),
  username: t.String(),
  email: t.String(),
});

export const POSTAuthLoginResponse = t.Object({
  token: t.String(),
  expiresIn: t.Number(),
});

export const POSTAuthLogoutResponse = t.Object({
  message: t.String(),
});

export const POSTAuthRefreshResponse = t.Object({
  token: t.String(),
  refreshToken: t.String(),
});
