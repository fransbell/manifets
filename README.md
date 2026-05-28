# manifets

> Manifest-driven code generation for [Elysia](https://elysiajs.com/) APIs

`manifets` reads a YAML manifest describing your API routes and generates a fully-typed Elysia project — routes, request/response schemas, and entry point — in seconds.

---

## How it works

```
spec.yaml  ──▶  manifets-cli  ──▶  generated/
                                  ├── index.ts
                                  ├── routes/
                                  │   ├── index.ts
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

1. **Describe** your API in a `spec.yaml` manifest (routes, methods, request/response shapes).
2. **Run** `manifets` to generate the Elysia boilerplate.
3. **Fill in** the handler logic where the `// TODO: implement` markers are.

---

## Manifest format

```yaml
api:
  baseUrl: http://localhost:3000
  routes:
    - path: /api/health
      group: common
      method: GET
      response: { "status": "ok" }

    - path: /api/auth/login
      group: auth
      method: POST
      body: { "username": "example", "password": "123" }
      response: { "token": "jwt-token-here", "expiresIn": 3600 }

    - path: /api/user/profile
      group: user
      method: PUT
      body: { "username": "john_updated", "bio": "updated bio" }
      response: { "id": 1, "username": "john_updated" }
```

| Field      | Description                                                       |
|------------|-------------------------------------------------------------------|
| `path`     | Route path (e.g. `/api/auth/login`)                               |
| `group`    | Logical grouping — becomes a route file and type namespace        |
| `method`   | HTTP method (`GET`, `POST`, `PUT`, `DELETE`, etc.)                |
| `body`     | Example request body — used to derive the Elysia `t.*` schema     |
| `response` | Example response body — used to derive the Elysia `t.*` schema    |

Routes within the same `group` that share a common path prefix are automatically collapsed into an Elysia `.group()`.

---

## Usage

### CLI

```bash
# From the repo root
bun run --filter manifets-cli generate

# Or directly
bun packages/manifets-cli/src/index.ts <spec.yaml> [output-dir]
```

**Arguments:**

| Argument      | Default        | Description                       |
|---------------|----------------|-----------------------------------|
| `spec.yaml`   | *(required)*   | Path to your manifest file        |
| `output-dir`  | `./generated`  | Directory to write generated code |

### In an app workspace

```bash
# apps/app already has a convenience script:
cd apps/app
bun run generate
# → reads src/spec.yaml → outputs to src/generated/
```

---

## Project structure

This is a **Turborepo** monorepo powered by **Bun**.

```
manifets/
├── apps/
│   └── app/                  # Example Elysia app consuming the CLI
│       └── src/
│           ├── spec.yaml     # API manifest
│           └── generated/    # ← auto-generated output
├── packages/
│   └── manifets-cli/         # The code generator
│       └── src/
│           └── index.ts
├── turbo.json
├── package.json
└── README.md
```

---

## Getting started

```bash
# Clone
git clone https://github.com/fransbell/manifets.git
cd manifets

# Install
bun install

# Generate from the example manifest
cd apps/app
bun run generate

# Run the app
bun run dev
```

---

## Generated output example

Running the CLI against the example `spec.yaml` produces:

**`routes/auth.route.ts`** — grouped routes with typed schemas:
```ts
import Elysia from "elysia";
import { POSTAuthRegisterRequest, POSTAuthLoginRequest, POSTAuthRefreshRequest } from "../types/request/auth.request";
import { POSTAuthRegisterResponse, POSTAuthLoginResponse, POSTAuthLogoutResponse, POSTAuthRefreshResponse } from "../types/response/auth.response";

const auth = new Elysia().group("/api/auth", (app) => {
  app.post("/register", async ({ body }) => { /* TODO */ }, { body: POSTAuthRegisterRequest, response: { 200: POSTAuthRegisterResponse } });
  app.post("/login",    async ({ body }) => { /* TODO */ }, { body: POSTAuthLoginRequest,    response: { 200: POSTAuthLoginResponse } });
  // ...
  return app;
});

export { auth };
```

**`types/response/auth.response.ts`** — Elysia type schemas:
```ts
import { t } from "elysia";

export const POSTAuthLoginResponse = t.Object({
  token: t.String(),
  expiresIn: t.Number()
});
```

---

## License

MIT
