export class UserService {
  async getProfile() {
    // TODO: fetch from DB
    return { id: 1, username: "john", email: "john@example.com", bio: "hello world" };
  }

  async updateProfile(body: { username: string; email: string; bio: string }) {
    // TODO: update in DB
    return { id: 1, username: body.username, email: body.email, bio: body.bio };
  }

  async deleteAccount(body: { password: string }) {
    // TODO: verify password and delete
    return { message: "account deleted" };
  }
}
