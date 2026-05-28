#!/usr/bin/env bun
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, join } from "path";
import yaml from "js-yaml";

// ── Types ────────────────────────────────────────────────────────────────────

interface RouteSpec {
  path: string;
  group: string;
  method: string;
  body?: Record<string, unknown>;
  response: Record<string, unknown>;
}

interface ApiSpec {
  api: {
    baseUrl: string;
    routes: RouteSpec[];
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Capitalize first letter */
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** kebab/camel to PascalCase */
function toPascal(s: string): string {
  return s.split(/[-_]/).map(cap).join("");
}

/**
 * Get the type base name for a route.
 * e.g. POST /api/auth/login → "POSTAuthLogin"
 *      GET  /api/health     → "GETHealth"
 */
function typeBaseName(route: RouteSpec): string {
  const segments = route.path.split("/").filter(Boolean);
  // Skip the first segment (e.g. "api")
  const meaningful = segments.slice(1).map(toPascal).join("");
  return `${route.method.toUpperCase()}${meaningful}`;
}

/**
 * Determine the group prefix for a route.
 * If the `group` name appears as a path segment, return everything up to and
 * including it. Otherwise return null (no grouping).
 *
 * e.g. group="auth", path="/api/auth/login" → prefix="/api/auth", suffix="/login"
 *      group="common", path="/api/health"    → null (no grouping)
 */
function getGroupPrefixAndSuffix(
  group: string,
  path: string,
): { prefix: string; suffix: string } | null {
  const segments = path.split("/").filter(Boolean);
  const idx = segments.indexOf(group);
  if (idx === -1) return null;
  const prefix = "/" + segments.slice(0, idx + 1).join("/");
  const suffix = "/" + segments.slice(idx + 1).join("/");
  return { prefix, suffix };
}

// ── JS value → Elysia `t.*` schema string ────────────────────────────────────

function jsValueToElysiaSchema(value: unknown): string {
  if (value === null) return "t.Any()";
  if (typeof value === "string") return "t.String()";
  if (typeof value === "number") return "t.Number()";
  if (typeof value === "boolean") return "t.Boolean()";
  if (Array.isArray(value)) {
    if (value.length === 0) return "t.Array(t.Any())";
    return `t.Array(${jsValueToElysiaSchema(value[0])})`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const entries = Object.entries(obj);
    if (entries.length === 0) return "t.Object({})";
    const inner = entries
      .map(([k, v]) => `  ${k}: ${jsValueToElysiaSchema(v)}`)
     .join(",\n");
    return `t.Object({\n${inner}\n})`;
  }
  return "t.Any()";
}

// ── Group routes by the `group` field ────────────────────────────────────────

function groupRoutes(
  routes: RouteSpec[],
): Map<string, RouteSpec[]> {
  const map = new Map<string, RouteSpec[]>();
  for (const r of routes) {
    const g = r.group || "common";
    if (!map.has(g)) map.set(g, []);
    map.get(g)!.push(r);
  }
  return map;
}

// ── File generators ──────────────────────────────────────────────────────────

function generateMainIndex(): string {
  return `import { Elysia } from "elysia";
import { routes } from "./routes";

const app = new Elysia().use(routes);

app.listen(3000);

console.log(
  \`🦊 Elysia is running at \${app.server?.hostname}:\${app.server?.port}\`,
);
`;
}

function generateRoutesIndex(groups: string[]): string {
  const imports = groups
    .map((g) => `import { ${g} } from "./${g}.route";`)
    .join("\n");
  const uses = groups.join(", ");
  return `import Elysia from "elysia";
${imports}

const routes = new Elysia().use([${uses}]);

export { routes };
`;
}

function generateGroupRoute(
  group: string,
  routes: RouteSpec[],
): string {
  // Decide if this group uses .group() or not
  const hasGroupPrefix = routes.every(
    (r) => getGroupPrefixAndSuffix(group, r.path) !== null,
  );
  const prefixInfo = hasGroupPrefix
    ? getGroupPrefixAndSuffix(group, routes[0].path)
    : null;

  // Collect needed imports
  const requestImports: string[] = [];
  const responseImports: string[] = [];

  for (const r of routes) {
    const base = typeBaseName(r);
    const hasBody = r.body && Object.keys(r.body).length > 0;
    if (hasBody) requestImports.push(`${base}Request`);
    responseImports.push(`${base}Response`);
  }

  const reqImportStr =
    requestImports.length > 0
      ? `import { ${requestImports.join(", ")} } from "../types/request/${group}.request";\n`
      : "";
  const resImportStr =
    `import { ${responseImports.join(", ")} } from "../types/response/${group}.response";\n`;

  // Build the route definitions
  const routeDefs: string[] = [];

  for (const r of routes) {
    const base = typeBaseName(r);
    const hasBody = r.body && Object.keys(r.body).length > 0;
    const method = r.method.toLowerCase();

    // Determine the path used in the handler
    let handlerPath: string;
    if (prefixInfo) {
      const info = getGroupPrefixAndSuffix(group, r.path)!;
      handlerPath = info.suffix;
    } else {
      handlerPath = r.path;
    }

    // Build handler
    const handlerBody = `() => {\n        // TODO: implement\n        return ${JSON.stringify(r.response)};\n      }`;
    const handlerWithoutType = `({ body }) => {\n        // TODO: implement\n        return ${JSON.stringify(r.response)};\n      }`;

    // Build schema options
    const schemaParts: string[] = [];
    if (hasBody) schemaParts.push(`body: ${base}Request`);
    schemaParts.push(`response: { 200: ${base}Response }`);

    const schemaStr = `{
    ${schemaParts.join(",\n    ")}\n  }`;

    // For grouped routes: app.post(...) as separate statements
    // For non-grouped routes: chained .method(...)
    if (prefixInfo) {
      // Inside .group() — use statement style: app.post(...);
      const def = `  app.${method}(\n    "${handlerPath}",\n    async ${hasBody ? handlerWithoutType : handlerBody},\n    ${schemaStr}\n  );`;
      routeDefs.push(def);
    } else {
      // Chained style: new Elysia().get(...).post(...)
      const def = `.${method}(\n    "${handlerPath}",\n    async ${hasBody ? handlerWithoutType : handlerBody},\n    ${schemaStr}\n  )`;
      routeDefs.push(def);
    }
  }

  if (prefixInfo) {
    const body = routeDefs.join("\n\n");
    return `import Elysia from "elysia";
${reqImportStr}${resImportStr}
const ${group} = new Elysia().group("${prefixInfo.prefix}", (app) => {
${body}\n\n  return app;
});

export { ${group} };
`;
  }

  const chainBody = routeDefs.join("\n");
  return `import Elysia from "elysia";
${reqImportStr}${resImportStr}
const ${group} = new Elysia()${chainBody};

export { ${group} };
`;
}

function generateRequestTypes(
  group: string,
  routes: RouteSpec[],
): string | null {
  const routesWithBody = routes.filter(
    (r) => r.body && Object.keys(r.body).length > 0,
  );
  if (routesWithBody.length === 0) return null;

  const exports = routesWithBody.map((r) => {
    const base = typeBaseName(r);
    const schema = jsValueToElysiaSchema(r.body);
    return `export const ${base}Request = ${schema};`;
  });

  return `import { t } from "elysia";

${exports.join("\n\n")}
`;
}

function generateResponseTypes(
  group: string,
  routes: RouteSpec[],
): string {
  const exports = routes.map((r) => {
    const base = typeBaseName(r);
    const schema = jsValueToElysiaSchema(r.response);
    return `export const ${base}Response = ${schema};`;
  });

  return `import { t } from "elysia";

${exports.join("\n\n")}
`;
}

// ── CLI entry ────────────────────────────────────────────────────────────────

function main() {
  const arg = process.argv[2];

  if (!arg) {
    console.error("Usage: manifets <spec.yaml> [output-dir]");
    console.error("  Default output-dir: ./generated");
    process.exit(1);
  }

  const inputPath = resolve(arg);
  const outDir = resolve(process.argv[3] || "./generated");

  const raw = readFileSync(inputPath, "utf-8");
  const spec = yaml.load(raw) as ApiSpec;

  if (!spec.api || !spec.api.routes) {
    console.error("Invalid manifest: missing `api` or `api.routes`");
    process.exit(1);
  }

  const { routes } = spec.api;
  const grouped = groupRoutes(routes);
  const groupNames = [...grouped.keys()];

  // Ensure directories exist
  const dirs = [
    outDir,
    join(outDir, "routes"),
    join(outDir, "types", "request"),
    join(outDir, "types", "response"),
  ];
  for (const d of dirs) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }

  // Generate files
  const files: [string, string][] = [];

  // index.ts
  files.push([join(outDir, "index.ts"), generateMainIndex()]);

  // routes/index.ts
  files.push([join(outDir, "routes", "index.ts"), generateRoutesIndex(groupNames)]);

  // routes/{group}.route.ts
  for (const [group, groupRoutes_] of grouped) {
    files.push([
      join(outDir, "routes", `${group}.route.ts`),
      generateGroupRoute(group, groupRoutes_),
    ]);
  }

  // types/request/{group}.request.ts
  for (const [group, groupRoutes_] of grouped) {
    const content = generateRequestTypes(group, groupRoutes_);
    if (content) {
      files.push([join(outDir, "types", "request", `${group}.request.ts`), content]);
    }
  }

  // types/response/{group}.response.ts
  for (const [group, groupRoutes_] of grouped) {
    files.push([
      join(outDir, "types", "response", `${group}.response.ts`),
      generateResponseTypes(group, groupRoutes_),
    ]);
  }

  // Write all files
  for (const [filePath, content] of files) {
    writeFileSync(filePath, content, "utf-8");
    console.log(`  ✅ ${filePath}`);
  }

  console.log(`\n🎉 Generated ${files.length} files in ${outDir}`);
}

main();
