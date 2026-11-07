import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { bearerUser } from "@/lib/local-auth.server";

export const requireStaffAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const user = bearerUser(getRequest());
  if (!user) throw new Error("Unauthorized: sign in required");
  return next({
    context: { userId: user.id, email: user.email, roles: user.roles },
  });
});
