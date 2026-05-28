# Spec Manifest Guide

> How to write and extend your `spec.yaml` — the single source of truth that drives code generation in manifets.

---

## Quick reference

Every spec.yaml follows this top-level structure:

```yaml
api:
  baseUrl: http://localhost:3000
  routes:
    - path: /api/...
      group: <name>
      method: <GET|POST|PUT|DELETE|PATCH>
      body: { ... }         # optional
      response: { ... }
      runs:                  # optional
        - name: <namespace>.<Class>.<method>
          input: '{ jq query }'   # optional — transform body before call
          output: '{ jq query }'  # optional — transform result after call
```

---

## Q&A

### How to add a simple GET request?

```yaml
- path: /api/health
  group: common
  method: GET
  response: { "status": "ok", "uptime": 123 }
```

**What gets generated:**
- `routes/common.route.ts` — an Elysia `.get("/api/health", ...)` handler with a `// TODO: implement` stub
- `types/response/common.response.ts` — `GETHealthResponse` schema using Elysia `t.Object({ status: t.String(), uptime: t.Number() })`

---

### How to add a POST request with a body?

```yaml
- path: /api/auth/login
  group: auth
  method: POST
  body: { "username": "example", "password": "123" }
  response: { "token": "jwt-token-here", "expiresIn": 3600 }
```

**What gets generated:**
- `routes/auth.route.ts` — a `.post("/login", ...)` handler receiving `body`
- `types/request/auth.request.ts` — `POSTAuthLoginRequest` schema derived from `body`
- `types/response/auth.response.ts` — `POSTAuthLoginResponse` schema derived from `response`

The `body` and `response` values are **examples** — manifets infers types from them:
| Example value | Inferred type |
|---|---|
| `"hello"` | `t.String()` |
| `123` | `t.Number()` |
| `true` | `t.Boolean()` |
| `{ "a": 1 }` | `t.Object({ a: t.Number() })` |
| `[1, 2]` | `t.Array(t.Number())` |

---

### How to add a PUT or DELETE request?

Same pattern — just change the `method`:

```yaml
# PUT
- path: /api/user/profile
  group: user
  method: PUT
  body: { "username": "john_updated", "bio": "updated bio" }
  response: { "id": 1, "username": "john_updated" }

# DELETE
- path: /api/user/account
  group: user
  method: DELETE
  body: { "password": "secret" }
  response: { "message": "account deleted" }
```

---

### How to return an array (list endpoint)?

Use a JSON array as the response example:

```yaml
- path: /api/posts
  group: post
  method: GET
  response: [{ "id": 1, "title": "Hello", "content": "World", "authorId": 1 }]
```

**Generated type:**
```ts
export const GETPostsResponse = t.Array(
  t.Object({
    id: t.Number(),
    title: t.String(),
    content: t.String(),
    authorId: t.Number(),
  })
);
```

---

### How does `group` work?

The `group` field controls two things:

1. **File organization** — all routes in the same group end up in one file: `routes/<group>.route.ts`
2. **Route grouping** — if the group name appears as a path segment, manifets collapses them into an Elysia `.group()` prefix

```yaml
# These share group "auth" and the path segment "/api/auth"
- path: /api/auth/login
  group: auth
  method: POST
  ...

- path: /api/auth/register
  group: auth
  method: POST
  ...
```

**Generated:**
```ts
const auth = new Elysia().group("/api/auth", (app) => {
  app.post("/login", ...);
  app.post("/register", ...);
  return app;
});
```

If the group name does **not** appear in the path (e.g. `group: common` with `path: /api/health`), routes are chained directly without `.group()`.

---

### How to add a request without a body?

Omit the `body` field:

```yaml
- path: /api/auth/logout
  group: auth
  method: POST
  response: { "message": "logged out" }
```

The generated handler will be `async () => { ... }` instead of `async ({ body }) => { ... }`.

---

### How to connect a route to a service? (`runs`)

Use the `runs` field to wire a route to a service method. The format is:

```
<namespace>.<ClassName>.<methodName>
```

```yaml
- path: /api/auth/login
  group: auth
  method: POST
  body: { "username": "example", "password": "123" }
  response: { "token": "jwt-token-here", "expiresIn": 3600 }
  runs:
    - name: service.AuthService.getToken
```

**What gets generated in the route handler:**
```ts
const authService: AuthService = container.resolve("AuthService");
return authService.getToken(body as any);
```

**Requirements:**
- The service file must exist in your implems folder: `implems/<namespace>/<name>.service.ts`
  - e.g. `implems/service/auth.service.ts` exporting `class AuthService`
- The method must exist on that class as `async`
- If anything is missing, the CLI will warn you at generate time

---

### How to chain multiple runs in one route?

List multiple runs — they execute sequentially, the last one's result is returned:

```yaml
- path: /api/auth/logout
  group: auth
  method: POST
  response: { "message": "logged out" }
  runs:
    - name: service.AuthService.logout
    - name: service.LoggerService.logAction
      input: '{ action: "logout" }'
```

**Generated:**
```ts
const authService: AuthService = container.resolve("AuthService");
const loggerService: LoggerService = container.resolve("LoggerService");
await authService.logout();
payload = await jqRun("{ action: \"logout\" }", payload);
return loggerService.logAction(payload as any);
```

Each unique class is resolved only once — even if multiple runs reference the same service.

---

### How to transform body or result with jq? (`input` / `output`)

Each run supports optional `input` and `output` fields with **jq query syntax** powered by [node-jq](https://github.com/sanack/node-jq):

- **`input`** — transforms the payload **before** calling the service method
- **`output`** — transforms the result **after** calling the service method

#### Input transform (reshape body before calling service)

```yaml
- path: /api/auth/login
  group: auth
  method: POST
  body: { "username": "example", "password": "123" }
  response: { "token": "jwt-token-here", "expiresIn": 3600 }
  runs:
    - name: service.AuthService.getToken
      input: '{ username: .username, pass: .password }'
```

**Generated:**
```ts
let payload = body;
const authService: AuthService = container.resolve("AuthService");
payload = await jqRun("{ username: .username, pass: .password }", payload);
return authService.getToken(payload as any);
```

#### Output transform (reshape result after calling service)

```yaml
- path: /api/auth/login
  group: auth
  method: POST
  body: { "username": "example", "password": "123" }
  response: { "token": "jwt-token-here", "expiresIn": 3600 }
  runs:
    - name: service.AuthService.getToken
      output: '{ token: .token, expires: .expiresIn }'
```

**Generated:**
```ts
let result = await authService.getToken(payload as any);
result = await jqRun("{ token: .token, expires: .expiresIn }", result);
return result;
```

#### Both input and output

```yaml
runs:
  - name: service.AuthService.getToken
    input: '{ username: .username, pass: .password }'
    output: '{ token: .token, expires: .expiresIn }'
```

**Generated:**
```ts
payload = await jqRun("{ username: .username, pass: .password }", payload);
let result = await authService.getToken(payload as any);
result = await jqRun("{ token: .token, expires: .expiresIn }", result);
return result;
```

#### jq on a no-body route

When a route has no `body` but a run uses `input`, the payload starts as `{}`:

```yaml
- path: /api/auth/logout
  group: auth
  method: POST
  response: { "message": "logged out" }
  runs:
    - name: service.LoggerService.logAction
      input: '{ action: "logout" }'
```

**Generated:**
```ts
async () => {
  let payload = {} as any;
  // ...
  payload = await jqRun("{ action: \"logout\" }", payload);
  return loggerService.logAction(payload as any);
}
```

#### Chaining jq across multiple runs

Each run can have its own `input`/`output`. They chain sequentially — an earlier run's `output` can feed into the next run's `input`:

```yaml
runs:
  - name: service.LoggerService.logAction
    input: '{ action: "create_post", meta: { title: .title } }'
  - name: service.PostService.create
    input: '{ title, content, tags }'
```

**Generated:**
```ts
payload = await jqRun("{ action: \"create_post\", meta: { title: .title } }", payload);
await loggerService.logAction(payload as any);
payload = await jqRun("{ title, content, tags }", payload);
return postService.create(payload as any);
```

---

### How to create a new service?

1. Create a file in `implems/<namespace>/<name>.service.ts`:

```ts
// src/implems/service/post.service.ts
export class PostService {
  async list() {
    // TODO: query DB
    return [{ id: 1, title: "Hello" }];
  }

  async create(body: { title: string; content: string }) {
    // TODO: insert into DB
    return { id: 1, title: body.title, content: body.content };
  }
}
```

2. Reference it in spec.yaml:

```yaml
- path: /api/posts
  group: post
  method: GET
  response: [{ "id": 1, "title": "Hello" }]
  runs:
    - name: service.PostService.list
```

3. Re-generate — the CLI will discover the new service and register it in `container.ts`.

---

### How to add a new namespace?

Create a subfolder under `implems/` — the folder name becomes the namespace:

```
src/implems/
  service/           ← namespace: "service"
    auth.service.ts
    post.service.ts
  repository/        ← namespace: "repository"
    user.repository.ts
```

Reference in runs:
```yaml
runs:
  - name: repository.UserRepository.findById
```

---

### How do I run the generator?

```bash
cd apps/app
bun run generate
```

Or directly:
```bash
bun packages/manifets-cli/src/index.ts <spec.yaml> -o <output-dir> -i <implems-dir>
```

| Flag | Default | Description |
|------|---------|-------------|
| `-o, --output` | `./generated` | Where to write generated files |
| `-i, --implems` | `./implems` | Your implementation folder to validate against |

---

### How to handle multiple routes on the same path?

Use different methods — manifets generates separate handlers for each:

```yaml
- path: /api/user/profile
  group: user
  method: GET
  response: { "id": 1, "username": "john" }

- path: /api/user/profile
  group: user
  method: PUT
  body: { "username": "john_updated" }
  response: { "id": 1, "username": "john_updated" }
```

Each gets its own type name: `GETUserProfileResponse`, `PUTUserProfileResponse`.

---

### What happens if my service is missing a method?

The CLI scans your implems folder and validates every `runs` entry before generating. You'll see:

```
⚠️  POST /api/auth/login: method "nonExistentMethod" not found on AuthService
    (available: getToken, register, logout, refresh)
```

The code is still generated, but the handler will call a method that doesn't exist — fix the service and re-generate.

---

### What does the generated file structure look like?

```
generated/
├── index.ts                          # Elysia app entry point
├── container.ts                      # Awilix DI (only if runs are used)
├── jq.ts                             # jq helper (only if input/output used)
├── routes/
│   ├── index.ts                      # Combines all group routes
│   ├── common.route.ts
│   ├── auth.route.ts
│   ├── user.route.ts
│   └── post.route.ts
└── types/
    ├── request/
    │   ├── auth.request.ts
    │   ├── user.request.ts
    │   └── post.request.ts
    └── response/
        ├── common.response.ts
        ├── auth.response.ts
        ├── user.response.ts
        └── post.response.ts
```

---

## Full example

Here's a complete spec.yaml using all features — multiple services, multi-run chains, and jq transforms:

```yaml
api:
  baseUrl: http://localhost:3000
  routes:
    # ── Auth ──────────────────────────────────────────────────────────────
    - path: /api/auth/register
      group: auth
      method: POST
      body: { "username": "john", "email": "john@example.com", "password": "secret" }
      response: { "id": 1, "username": "john", "email": "john@example.com" }
      runs:
        - name: service.LoggerService.logAction
          input: '{ action: "register", meta: { username: .username } }'
        - name: service.AuthService.register

    - path: /api/auth/login
      group: auth
      method: POST
      body: { "username": "example", "password": "123" }
      response: { "token": "jwt-token-here", "expiresIn": 3600 }
      runs:
        - name: service.AuthService.getToken
          input: '{ username: .username, pass: .password }'
          output: '{ token: .token, expires: .expiresIn }'

    - path: /api/auth/logout
      group: auth
      method: POST
      response: { "message": "logged out" }
      runs:
        - name: service.AuthService.logout
        - name: service.LoggerService.logAction
          input: '{ action: "logout" }'

    # ── User ──────────────────────────────────────────────────────────────
    - path: /api/user/profile
      group: user
      method: GET
      response: { "id": 1, "username": "john", "email": "john@example.com", "bio": "hello world" }
      runs:
        - name: service.UserService.getProfile
          output: '{ id, name: .username, email, bio }'

    - path: /api/user/account
      group: user
      method: DELETE
      body: { "password": "secret" }
      response: { "message": "account deleted" }
      runs:
        - name: service.UserService.deleteAccount
        - name: service.LoggerService.logAction
          input: '{ action: "account_deleted" }'

    # ── Post ──────────────────────────────────────────────────────────────
    - path: /api/posts
      group: post
      method: GET
      response: [{ "id": 1, "title": "Hello", "content": "World", "authorId": 1 }]
      runs:
        - name: service.PostService.list

    - path: /api/posts
      group: post
      method: POST
      body: { "title": "New Post", "content": "Some content", "tags": ["news", "tech"] }
      response: { "id": 1, "title": "New Post", "content": "Some content", "authorId": 1 }
      runs:
        - name: service.LoggerService.logAction
          input: '{ action: "create_post", meta: { title: .title } }'
        - name: service.PostService.create
          input: '{ title, content, tags }'
```
