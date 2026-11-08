import { createFileRoute } from "@tanstack/react-router";
import {
  bearerUser,
  beginEmailChange,
  completeLoginPending,
  completePasswordReset,
  completeSignupConfirm,
  confirmEmailChange,
  requestEmailChangeCode,
  requestLoginCode,
  requestPasswordReset,
  setStaffWorkId,
  signIn,
  signUp,
  verifyEmailChangeCode,
  verifyLoginCode,
  verifyPasswordResetCode,
  verifyToken,
} from "@/lib/local-auth.server";
import { confirmStaffEmail } from "@/lib/firebase-mail.server";
import { mailContinueOrigin } from "@/lib/mail-origin.server";
// Loaded on demand: @simplewebauthn/server drags in tsyringe, which asserts a
// Reflect polyfill at import time — so load the polyfill first, then the lib.
const loadWebauthn = () => import("@/lib/webauthn.server");
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/local/auth")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      GET: async ({ request }) => {
        const user = bearerUser(request);
        if (!user) return Response.json({ session: null }, { headers: cors });
        return Response.json(
          {
            session: {
              access_token: request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || "",
              user: { id: user.id, email: user.email, roles: user.roles || [] },
            },
          },
          { headers: cors },
        );
      },
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as {
            action?: string;
            email?: string;
            password?: string;
            token?: string;
            code?: string;
            pending?: string;
            signup?: string;
            firstName?: string;
            lastName?: string;
            surname?: string;
            phone?: string;
            credential?: RegistrationResponseJSON | AuthenticationResponseJSON;
            friendlyName?: string;
            workId?: string;
            userId?: string;
            ticket?: string;
            newEmail?: string;
          };
          const origin = mailContinueOrigin(request);
          const webauthnOrigin =
            request.headers.get("Origin") ||
            (() => {
              try {
                return new URL(request.url).origin;
              } catch {
                return origin;
              }
            })();

          if (body.action === "signin") {
            const r = await requestLoginCode(body.email || "", body.password || "", origin);
            if (!r.needsCode && "session" in r && r.session) {
              return Response.json(
                {
                  session: { access_token: r.session.access_token, user: r.session.user },
                  needsCode: false,
                  email: r.email,
                },
                { headers: cors },
              );
            }
            return Response.json({ session: null, ...r }, { headers: cors });
          }
          if (body.action === "signin-direct") {
            const s = await signIn(body.email || "", body.password || "");
            return Response.json({ session: { access_token: s.access_token, user: s.user } }, { headers: cors });
          }
          if (body.action === "verify-login-code") {
            const s = await verifyLoginCode(body.email || "", body.code || "");
            return Response.json({ session: { access_token: s.access_token, user: s.user } }, { headers: cors });
          }
          if (body.action === "complete-login-link") {
            const s = await completeLoginPending(body.email || "", body.pending || "");
            return Response.json({ session: { access_token: s.access_token, user: s.user } }, { headers: cors });
          }
          if (body.action === "signup") {
            const profile: { firstName?: string; lastName?: string; surname?: string; phone?: string } = {};
            if (body.firstName) profile.firstName = body.firstName;
            if (body.lastName) profile.lastName = body.lastName;
            if (body.surname) profile.surname = body.surname;
            if (body.phone) profile.phone = body.phone;
            const s = await signUp(body.email || "", body.password || "", origin, profile);
            if (s.access_token) {
              return Response.json(
                { session: { access_token: s.access_token, user: s.user }, needsConfirmation: false },
                { headers: cors },
              );
            }
            return Response.json(
              {
                session: null,
                needsConfirmation: !!s.needsConfirmation,
                awaitingApproval: !!(s as { awaitingApproval?: boolean }).awaitingApproval,
                mailFailed: !!(s as { mailFailed?: boolean }).mailFailed,
                email: s.user.email,
              },
              { headers: cors },
            );
          }
          if (body.action === "confirm-email") {
            const s = await completeSignupConfirm(body.email || "", body.signup);
            if (s.access_token) {
              return Response.json(
                { ok: true, session: { access_token: s.access_token, user: s.user }, awaitingApproval: false },
                { headers: cors },
              );
            }
            return Response.json({ ok: true, session: null, awaitingApproval: true }, { headers: cors });
          }
          if (body.action === "confirm-email-only") {
            await confirmStaffEmail(body.email || "", body.signup);
            return Response.json({ ok: true }, { headers: cors });
          }
          if (body.action === "verify") {
            const user = verifyToken(body.token || null);
            return Response.json({ user }, { headers: cors });
          }
          if (body.action === "reset-request") {
            const r = await requestPasswordReset(body.email || "", origin);
            return Response.json(r, { headers: cors });
          }
          if (body.action === "reset-verify") {
            const r = await verifyPasswordResetCode(body.email || "", body.code || "");
            return Response.json(r, { headers: cors });
          }
          if (body.action === "reset-complete") {
            const r = await completePasswordReset(body.email || "", body.ticket || "", body.password || "");
            return Response.json({ ok: true, ...r }, { headers: cors });
          }
          if (body.action === "change-email-request") {
            const r = await requestEmailChangeCode(body.email || "", origin);
            return Response.json(r, { headers: cors });
          }
          if (body.action === "change-email-verify") {
            const r = await verifyEmailChangeCode(body.email || "", body.code || "");
            return Response.json(r, { headers: cors });
          }
          if (body.action === "change-email-begin") {
            const r = await beginEmailChange(body.email || "", body.ticket || "", body.newEmail || "", origin);
            return Response.json(r, { headers: cors });
          }
          if (body.action === "change-email-confirm") {
            const r = await confirmEmailChange(body.ticket || "");
            return Response.json(r, { headers: cors });
          }
          const wa = String(body.action).startsWith("webauthn") ? await loadWebauthn() : null;
          if (body.action === "webauthn-status") {
            const enrolled = body.email && wa ? await wa.webauthnHasCredentials(body.email) : false;
            return Response.json({ enrolled }, { headers: cors });
          }
          if (body.action === "webauthn-register-options") {
            const user = bearerUser(request);
            if (!user) return Response.json({ error: "Sign in first to enroll biometrics" }, { status: 401, headers: cors });
            if (!wa) return Response.json({ error: "Unknown action" }, { status: 400, headers: cors });
            const options = await wa.webauthnRegisterOptions(user, webauthnOrigin);
            return Response.json({ options }, { headers: cors });
          }
          if (body.action === "webauthn-register-verify") {
            const user = bearerUser(request);
            if (!user) return Response.json({ error: "Sign in first to enroll biometrics" }, { status: 401, headers: cors });
            if (!body.credential) {
              return Response.json({ error: "Missing biometric credential" }, { status: 400, headers: cors });
            }
            if (!wa) return Response.json({ error: "Unknown action" }, { status: 400, headers: cors });
            const result = await wa.webauthnRegisterVerify(
              user,
              webauthnOrigin,
              body.credential as RegistrationResponseJSON,
              body.friendlyName,
            );
            return Response.json(result, { headers: cors });
          }
          if (body.action === "webauthn-login-options") {
            if (!wa) return Response.json({ error: "Unknown action" }, { status: 400, headers: cors });
            const r = await wa.webauthnLoginOptions(body.email || "", webauthnOrigin);
            return Response.json(r, { headers: cors });
          }
          if (body.action === "webauthn-login-verify") {
            if (!body.credential) {
              return Response.json({ error: "Missing biometric assertion" }, { status: 400, headers: cors });
            }
            if (!wa) return Response.json({ error: "Unknown action" }, { status: 400, headers: cors });
            const s = await wa.webauthnLoginVerify(
              body.email || "",
              webauthnOrigin,
              body.credential as AuthenticationResponseJSON,
            );
            return Response.json({ session: { access_token: s.access_token, user: s.user } }, { headers: cors });
          }
          if (body.action === "work-id-set") {
            const user = bearerUser(request);
            if (!user) return Response.json({ error: "Sign in first" }, { status: 401, headers: cors });
            const result = await setStaffWorkId(user, body.userId || "", body.workId || "");
            return Response.json(result, { headers: cors });
          }
          if (body.action === "webauthn-login-options-workid") {
            if (!wa) return Response.json({ error: "Unknown action" }, { status: 400, headers: cors });
            const r = await wa.webauthnLoginOptionsByWorkId(body.workId || "", webauthnOrigin);
            return Response.json(r, { headers: cors });
          }
          if (body.action === "webauthn-login-verify-workid") {
            if (!body.credential) {
              return Response.json({ error: "Missing biometric assertion" }, { status: 400, headers: cors });
            }
            if (!wa) return Response.json({ error: "Unknown action" }, { status: 400, headers: cors });
            const s = await wa.webauthnLoginVerifyByWorkId(
              body.workId || "",
              webauthnOrigin,
              body.credential as AuthenticationResponseJSON,
            );
            return Response.json({ session: { access_token: s.access_token, user: s.user } }, { headers: cors });
          }
          return Response.json({ error: "Unknown action" }, { status: 400, headers: cors });
        } catch (e) {
          return Response.json(
            { error: e instanceof Error ? e.message : "Auth failed" },
            { status: 400, headers: cors },
          );
        }
      },
    },
  },
});
