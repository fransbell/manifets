import Elysia from "elysia";
import { common } from "./common.route";
import { auth } from "./auth.route";

const routes = new Elysia().use([common, auth]);

export { routes };
