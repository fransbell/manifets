import { createContainer, asClass, InjectionMode } from "awilix";
import { AuthService } from "./implems/service";

/**
 * Awilix DI container — register all services here.
 *
 * Usage in routes:
 *   const authService = container.resolve("AuthService");
 *   const result = await authService.getToken(body);
 */
export const container = createContainer({
  injectionMode: InjectionMode.CLASSIC,
});

container.register({
  AuthService: asClass(AuthService).singleton(),
});

export type Container = typeof container;
