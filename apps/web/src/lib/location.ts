/**
 * Which location the signed-in user is currently acting at.
 *
 * Kept in a cookie rather than the URL so the choice survives navigation
 * between the till, stock and transfers without every link having to carry it.
 * The cookie is only ever a preference — RLS still decides what the user can
 * actually see, and a pinned cashier's location always wins over it.
 */
export const ACTIVE_LOCATION_COOKIE = "aipos_location";
