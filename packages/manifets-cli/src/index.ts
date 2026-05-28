#!/usr/bin/env bun
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  statSync,
} from "fs";
import { resolve, join, extname, relative } from "path";
import yaml from "js-yaml";

// ── Types ────────────────────────────────────────────────────────────────────

interface RunSpec {
  name: string; // e.g. "service.AuthService.getToken"
  input?: string; // jq query to transform body BEFORE calling the method
  output?: string; // jq query to transform result AFTER calling the method
}

interface RouteSpec {
  path: string;
  group: string;
  method: string;
  body?: Record<string, unknown>;
  response: Record<string, unknown>;
  runs?: RunSpec[];
}

interface ApiSpec {
  api: {
    baseUrl: string;
    routes: RouteSpec[];
  };
}

/** Parsed from "service.AuthService.getToken" */
interface ResolvedRun {
  namespace: string; // "service"
  className: string; // "AuthService"
  method: string; // "getToken"
  input?: string; // jq query — transform body before calling
  output?: string; // jq query — transform result after calling
}

/** What exists on disk inside implems/ */
interface ServiceDescriptor {
  fileName: string; // "auth.service" (no ext)
  className: string; // "AuthService"
  methods: string[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function toPascal(s: string): string {
  return s.split(/[-_]/).map(cap).join("");
}

function typeBaseName(route: RouteSpec): string {
  const segments = route.path.split("/").filter(Boolean);
  const meaningful = segments.slice(1).map(toPascal).join("");
  return `${route.method.toUpperCase()}${meaningful}`;
}

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

function parseRunName(runName: string): ResolvedRun {
  const parts = runName.split(".");
  if (parts.length < 3) {
    throw new Error(
      `Invalid run name "${runName}". Expected format: "namespace.ClassName.method"`,
    );
  }
  return {
    namespace: parts[0],
    className: parts[1],
    method: parts[2],
  };
}

/** Compute a POSIX relative import path from `fromDir` to `toFile`. */
function relativeImport(fromDir: string, toFile: string): string {
  let rel = relative(fromDir, toFile).replace(/\\/g, "/");
  if (!rel.startsWith(".")) rel = "./" + rel;
  // Strip .ts extension for clean imports
  return rel.replace(/\.ts$/, "");
}

// ── Scan implems folder ──────────────────────────────────────────────────────

function scanImplemsDir(
  implemsDir: string,
): Map<string, ServiceDescriptor[]> {
  const namespaces = new Map<string, ServiceDescriptor[]>();

  if (!existsSync(implemsDir)) return namespaces;

  const namespacesOnDisk = readdirSync(implemsDir).filter((entry) => {
    const full = join(implemsDir, entry);
    return statSync(full).isDirectory();
  });

  for (const ns of namespacesOnDisk) {
    const services: ServiceDescriptor[] = [];
    const nsDir = join(implemsDir, ns);

    const files = readdirSync(nsDir).filter(
      (f) => extname(f) === ".ts" && f !== "index.ts",
    );

    for (const file of files) {
      const content = readFileSync(join(nsDir, file), "utf-8");

      const classMatch = content.match(/export\s+class\s+(\w+)/);
      if (!classMatch) continue;
      const className = classMatch[1];

      const methodRegex = /(?:async|public\s+async)\s+(\w+)\s*\(/g;
      const methods: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = methodRegex.exec(content)) !== null) {
        methods.push(m[1]);
      }

      services.push({
        fileName: file.replace(/\.ts$/, ""),
        className,
        methods,
      });
    }

    namespaces.set(ns, services);
  }

  return namespaces;
}

// ── Validate runs against implems ────────────────────────────────────────────

function validateRuns(
  routes: RouteSpec[],
  implemsDir: string,
): {
  warnings: string[];
  allRuns: Map<string, ResolvedRun[]>;
  usedClasses: Map<string, Set<string>>;
  fileMap: Map<string, string>; // "namespace:ClassName" → fileName
  hasJq: boolean; // true if any run uses input/output jq
} {
  const warnings: string[] = [];
  const allRuns = new Map<string, ResolvedRun[]>();
  const usedClasses = new Map<string, Set<string>>();
  const fileMap = new Map<string, string>();
  let hasJq = false;

  const namespaces = scanImplemsDir(implemsDir);

  for (const [ns, services] of namespaces) {
    for (const svc of services) {
      fileMap.set(`${ns}:${svc.className}`, svc.fileName);
    }
  }

  for (const route of routes) {
    if (!route.runs || route.runs.length === 0) continue;

    const resolved: ResolvedRun[] = [];
    const routeKey = `${route.method.toUpperCase()} ${route.path}`;

    for (const run of route.runs) {
      const parts = run.name.split(".");
      if (parts.length < 3) {
        warnings.push(
          `⚠️  ${routeKey}: invalid run name "${run.name}". Expected format: "namespace.Class.method"`,
        );
        continue;
      }
      const parsed: ResolvedRun = {
        namespace: parts[0],
        className: parts[1],
        method: parts[2],
        input: run.input,
        output: run.output,
      };
      resolved.push(parsed);

      if (run.input || run.output) hasJq = true;

      if (!usedClasses.has(parsed.namespace)) {
        usedClasses.set(parsed.namespace, new Set());
      }
      usedClasses.get(parsed.namespace)!.add(parsed.className);

      const services = namespaces.get(parsed.namespace);
      if (!services) {
        warnings.push(
          `⚠️  ${routeKey}: namespace "${parsed.namespace}" not found in ${implemsDir}/`,
        );
        continue;
      }

      const svc = services.find((s) => s.className === parsed.className);
      if (!svc) {
        warnings.push(
          `⚠️  ${routeKey}: class "${parsed.className}" not found in ${implemsDir}/${parsed.namespace}/`,
        );
        continue;
      }

      if (!svc.methods.includes(parsed.method)) {
        warnings.push(
          `⚠️  ${routeKey}: method "${parsed.method}" not found on ${parsed.className} (available: ${svc.methods.join(", ") || "none"})`,
        );
      }
    }

    allRuns.set(routeKey, resolved);
  }

  return { warnings, allRuns, usedClasses, fileMap, hasJq };
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

// ── Group routes by `group` field ────────────────────────────────────────────

function groupRoutes(routes: RouteSpec[]): Map<string, RouteSpec[]> {
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
  allRuns: Map<string, ResolvedRun[]>,
  fileMap: Map<string, string>,
  outDir: string,
  implemsDir: string,
  hasJq: boolean,
): string {
  const hasGroupPrefix = routes.every(
    (r) => getGroupPrefixAndSuffix(group, r.path) !== null,
  );
  const prefixInfo = hasGroupPrefix
    ? getGroupPrefixAndSuffix(group, routes[0].path)
    : null;

  // Collect needed type imports
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

  // Collect service imports needed by runs in this group — using actual filenames
  const routesDir = join(outDir, "routes");
  const serviceImports = new Map<string, string>(); // className → import path

  for (const r of routes) {
    const routeKey = `${r.method.toUpperCase()} ${r.path}`;
    const runs = allRuns.get(routeKey);
    if (runs) {
      for (const run of runs) {
        if (!serviceImports.has(run.className)) {
          const fileName = fileMap.get(`${run.namespace}:${run.className}`);
          const absPath = join(implemsDir, run.namespace, `${fileName || run.className}`);
          const relPath = relativeImport(routesDir, absPath);
          serviceImports.set(run.className, relPath);
        }
      }
    }
  }

  const serviceImportStr =
    serviceImports.size > 0
      ? Array.from(serviceImports.entries())
          .map(([cn, path]) => `import { ${cn} } from "${path}";`)
          .join("\n") + "\n"
      : "";

  const jqImport = hasJq
    ? `import { jqRun } from "../jq";\n`
    : "";

  const containerImport =
    serviceImports.size > 0
      ? `import { container } from "../container";\n`
      : "";

  // Build route definitions
  const routeDefs: string[] = [];

  for (const r of routes) {
    const base = typeBaseName(r);
    const hasBody = r.body && Object.keys(r.body).length > 0;
    const method = r.method.toLowerCase();

    let handlerPath: string;
    if (prefixInfo) {
      const info = getGroupPrefixAndSuffix(group, r.path)!;
      handlerPath = info.suffix;
    } else {
      handlerPath = r.path;
    }

    const routeKey = `${r.method.toUpperCase()} ${r.path}`;
    const runs = allRuns.get(routeKey);

    // Build handler body
    let handlerBody: string;
    if (runs && runs.length > 0) {
      const lines: string[] = [];

      // Determine if this route uses body
      // We track the current payload — starts as `body` (or undefined)
      // and gets reassigned by input transforms
      const usesPayload = hasBody || runs.some((r) => r.input);
      const payloadVar = usesPayload ? "payload" : "";

      // Initialize payload from body
      if (usesPayload) {
        lines.push("      let payload = body;");
      }

      // Deduplicate: resolve each unique class only once
      const seenClasses = new Map<string, string>();
      for (const run of runs) {
        if (!seenClasses.has(run.className)) {
          const varName =
            run.className.charAt(0).toLowerCase() + run.className.slice(1);
          seenClasses.set(run.className, varName);
          lines.push(
            `      const ${varName}: ${run.className} = container.resolve("${run.className}");`,
          );
        }
      }

      // Execute runs sequentially
      for (let i = 0; i < runs.length; i++) {
        const run = runs[i];
        const varName = seenClasses.get(run.className)!;
        const isLast = i === runs.length - 1;

        // input transform: modify payload before calling
        if (run.input) {
          lines.push(
            `      payload = await jqRun(${JSON.stringify(run.input)}, payload);`,
          );
        }

        // call service method
        const call = usesPayload
          ? `${varName}.${run.method}(payload as any)`
          : `${varName}.${run.method}()`;

        if (isLast) {
          // Last run — return (possibly with output transform)
          if (run.output) {
            lines.push(`      let result = await ${call};`);
            lines.push(
              `      result = await jqRun(${JSON.stringify(run.output)}, result);`,
            );
            lines.push("      return result;");
          } else {
            lines.push(`      return ${call};`);
          }
        } else {
          // Non-last run — await, optionally capture for chaining
          if (run.output) {
            lines.push(
              `      payload = await jqRun(${JSON.stringify(run.output)}, await ${call});`,
            );
          } else if (usesPayload) {
            lines.push(`      await ${call};`);
          } else {
            lines.push(`      await ${call};`);
          }
        }
      }

      const inner = lines.join("\n");
      handlerBody = hasBody
        ? `({ body }) => {\n${inner}\n    }`
        : usesPayload
          ? `({ body }) => {\n${inner}\n    }`
          : `() => {\n${inner}\n    }`;
    } else {
      const todoReturn = `return ${JSON.stringify(r.response)};`;
      handlerBody = hasBody
        ? `({ body }) => {\n        // TODO: implement\n        ${todoReturn}\n      }`
        : `() => {\n        // TODO: implement\n        ${todoReturn}\n      }`;
    }

    // Build schema options
    const schemaParts: string[] = [];
    if (hasBody) schemaParts.push(`body: ${base}Request`);
    schemaParts.push(`response: { 200: ${base}Response }`);

    const schemaStr = `{
    ${schemaParts.join(",\n    ")}\n  }`;

    if (prefixInfo) {
      const def = `  app.${method}(\n    "${handlerPath}",\n    async ${handlerBody},\n    ${schemaStr}\n  );`;
      routeDefs.push(def);
    } else {
      const def = `.${method}(\n    "${handlerPath}",\n    async ${handlerBody},\n    ${schemaStr}\n  )`;
      routeDefs.push(def);
    }
  }

  if (prefixInfo) {
    const body = routeDefs.join("\n\n");
    return `import Elysia from "elysia";
${jqImport}${containerImport}${serviceImportStr}${reqImportStr}${resImportStr}
const ${group} = new Elysia().group("${prefixInfo.prefix}", (app) => {
${body}\n\n  return app;
});

export { ${group} };
`;
  }

  const chainBody = routeDefs.join("\n");
  return `import Elysia from "elysia";
${jqImport}${containerImport}${serviceImportStr}${reqImportStr}${resImportStr}
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

// ── jq helper generator ─────────────────────────────────────────────────────

function generateJqHelper(): string {
  return `import { run } from "node-jq";

/**
 * Run a jq filter against a JSON value.
 * Returns the transformed result as a parsed JS object.
 */
export async function jqRun(filter: string, input: unknown): Promise<any> {
  return run(filter, input as Record<string, unknown>, {
    input: "json",
    output: "json",
  });
}
`;
}

// ── Container generator ──────────────────────────────────────────────────────

function generateContainer(
  usedClasses: Map<string, Set<string>>,
  fileMap: Map<string, string>,
  outDir: string,
  implemsDir: string,
): string {
  const imports: string[] = [];

  for (const [namespace, classes] of usedClasses) {
    for (const className of classes) {
      const fileName = fileMap.get(`${namespace}:${className}`);
      const absPath = join(implemsDir, namespace, `${fileName || className}`);
      const relPath = relativeImport(outDir, absPath);
      imports.push(`import { ${className} } from "${relPath}";`);
    }
  }

  const registrations = Array.from(usedClasses.entries())
    .flatMap(([, classes]) =>
      Array.from(classes).map(
        (cn) => `  ${cn}: asClass(${cn}).singleton(),`,
      ),
    )
    .join("\n");

  return `import { createContainer, asClass, InjectionMode } from "awilix";
${imports.join("\n")}

export const container = createContainer({
  injectionMode: InjectionMode.CLASSIC,
});

container.register({
${registrations}
});

export type Container = typeof container;
`;
}

// ── CLI arg parser ───────────────────────────────────────────────────────────

interface CliArgs {
  specPath: string;
  outputDir: string;
  implemsDir: string;
}

function parseArgs(args: string[]): CliArgs {
  let specPath = "";
  let outputDir = "./generated";
  let implemsDir = "./implems";

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === "-o" || arg === "--output") {
      outputDir = args[++i];
    } else if (arg === "-i" || arg === "--implems") {
      implemsDir = args[++i];
    } else if (!arg.startsWith("-")) {
      specPath = arg;
    } else {
      console.error(`Unknown flag: ${arg}`);
      process.exit(1);
    }

    i++;
  }

  if (!specPath) {
    console.error("Usage: manifets <spec.yaml> -o <output-dir> -i <implems-dir>");
    console.error("");
    console.error("Options:");
    console.error("  -o, --output   Output directory for generated code   (default: ./generated)");
    console.error("  -i, --implems  Implementation folder with services   (default: ./implems)");
    process.exit(1);
  }

  return { specPath, outputDir, implemsDir };
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const { specPath, outputDir, implemsDir } = parseArgs(process.argv.slice(2));

  const inputPath = resolve(specPath);
  const outDir = resolve(outputDir);
  const impDir = resolve(implemsDir);

  // ── Read spec ──
  const raw = readFileSync(inputPath, "utf-8");
  const spec = yaml.load(raw) as ApiSpec;

  if (!spec.api || !spec.api.routes) {
    console.error("❌ Invalid manifest: missing `api` or `api.routes`");
    process.exit(1);
  }

  const { routes } = spec.api;

  // ── Validate runs against implems ──
  console.log(`🔍 Scanning implems: ${impDir}`);
  const { warnings, allRuns, usedClasses, fileMap, hasJq } = validateRuns(routes, impDir);

  if (warnings.length > 0) {
    console.error("\n⚠️  Implementation warnings:\n");
    for (const w of warnings) {
      console.error(`   ${w}`);
    }
    console.error(
      `\n   ${warnings.length} warning(s) — generated code may be incomplete.\n`,
    );
  }

  // ── Group & generate ──
  const grouped = groupRoutes(routes);
  const groupNames = [...grouped.keys()];

  const dirs = [
    outDir,
    join(outDir, "routes"),
    join(outDir, "types", "request"),
    join(outDir, "types", "response"),
  ];
  for (const d of dirs) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }

  const files: [string, string][] = [];

  // index.ts
  files.push([join(outDir, "index.ts"), generateMainIndex()]);

  // routes/index.ts
  files.push([
    join(outDir, "routes", "index.ts"),
    generateRoutesIndex(groupNames),
  ]);

  // routes/{group}.route.ts
  for (const [group, groupRoutes_] of grouped) {
    files.push([
      join(outDir, "routes", `${group}.route.ts`),
      generateGroupRoute(group, groupRoutes_, allRuns, fileMap, outDir, impDir, hasJq),
    ]);
  }

  // types/request/{group}.request.ts
  for (const [group, groupRoutes_] of grouped) {
    const content = generateRequestTypes(group, groupRoutes_);
    if (content) {
      files.push([
        join(outDir, "types", "request", `${group}.request.ts`),
        content,
      ]);
    }
  }

  // types/response/{group}.response.ts
  for (const [group, groupRoutes_] of grouped) {
    files.push([
      join(outDir, "types", "response", `${group}.response.ts`),
      generateResponseTypes(group, groupRoutes_),
    ]);
  }

  // container.ts (only if there are runs)
  if (usedClasses.size > 0) {
    files.push([
      join(outDir, "container.ts"),
      generateContainer(usedClasses, fileMap, outDir, impDir),
    ]);
  }

  // jq.ts (only if any run uses input/output jq queries)
  if (hasJq) {
    files.push([join(outDir, "jq.ts"), generateJqHelper()]);
  }

  // ── Write ──
  for (const [filePath, content] of files) {
    writeFileSync(filePath, content, "utf-8");
    console.log(`  ✅ ${filePath}`);
  }

  console.log(`\n🎉 Generated ${files.length} files in ${outDir}`);
}

main();
