import { Elysia } from "elysia";
import { routes } from "./template/routes";

const app = new Elysia().use(routes).listen(3000);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
);
