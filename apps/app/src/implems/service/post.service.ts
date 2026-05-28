export class PostService {
  async list() {
    // TODO: query DB
    return [{ id: 1, title: "Hello", content: "World", authorId: 1 }];
  }

  async create(body: { title: string; content: string; tags: string[] }) {
    // TODO: insert into DB
    return { id: 1, title: body.title, content: body.content, authorId: 1 };
  }

  async getDetail() {
    // TODO: fetch from DB
    return { id: 1, title: "Hello", content: "World", authorId: 1, views: 42 };
  }

  async update(body: { title: string; content: string }) {
    // TODO: update in DB
    return { id: 1, title: body.title, content: body.content, authorId: 1 };
  }
}
