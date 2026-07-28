/**
 * The custom SQLSTATEs the database RPCs raise, and how to talk about them.
 *
 * The messages are what a cashier sees mid-transaction with a customer waiting,
 * so they say what to do rather than what went wrong internally.
 */

export const POS_ERROR = {
  UNAUTHENTICATED: "PS401",
  FORBIDDEN: "PS403",
  NOT_FOUND: "PS404",
  NOT_ALLOWED: "PS405",
  CONFLICT: "PS409",
  UNPROCESSABLE: "PS422",
} as const;

export type PosErrorCode = (typeof POS_ERROR)[keyof typeof POS_ERROR];

export function isPosError(code: unknown): code is PosErrorCode {
  return typeof code === "string" && Object.values(POS_ERROR).includes(code as PosErrorCode);
}

export function friendlyMessage(code: string, fallback: string): string {
  switch (code) {
    case POS_ERROR.UNAUTHENTICATED:
      return "Sign in again to continue.";
    case POS_ERROR.FORBIDDEN:
      return "You don't have permission for that. Ask the shop owner.";
    case POS_ERROR.NOT_FOUND:
      return "That item is no longer in the catalog.";
    case POS_ERROR.NOT_ALLOWED:
      return "Too late to undo this one. The owner can adjust it.";
    case POS_ERROR.CONFLICT:
      return "Already recorded.";
    case POS_ERROR.UNPROCESSABLE:
      // Carries the real detail (which product, how many left) — pass it through.
      return fallback;
    default:
      return fallback;
  }
}

/**
 * A sale the server refused because stock had already gone. It stays on the
 * device, flagged, until the owner reconciles — never dropped. Losing a
 * recorded sale silently is the one failure mode that would cost a shop money
 * without them ever knowing.
 */
export interface OversoldSale {
  clientId: string;
  productId: string | undefined;
  message: string;
  attemptedAt: string;
}
