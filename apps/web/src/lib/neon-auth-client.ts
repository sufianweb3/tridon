"use client";

import { createAuthClient } from "@neondatabase/auth/next";

/**
 * Talks to the same-origin proxy at /api/auth, which forwards to Neon Auth.
 * The client takes no arguments and never sees the Auth secret.
 */
export const neonAuthClient = createAuthClient();
