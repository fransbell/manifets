export class AuthService {
  async getToken(body: { username: string; password: string }) {
    // TODO: validate credentials and return a JWT
    return { token: "jwt-token-here", expiresIn: 3600 };
  }

  async register(body: {
    username: string;
    email: string;
    password: string;
  }) {
    // TODO: create user in DB and return profile
    return { id: 1, username: body.username, email: body.email };
  }

  async logout() {
    // TODO: invalidate session / token
    return { message: "logged out" };
  }

  async refresh(body: { refreshToken: string }) {
    // TODO: verify refresh token and issue new pair
    return { token: "new-jwt", refreshToken: "new-rt" };
  }
}
