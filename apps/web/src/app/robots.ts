import type { MetadataRoute } from "next";

/**
 * A shop's till, takings and staff list have no business in a search index.
 * Every route is behind auth anyway, but a crawler hitting them still produces
 * a public record that the shop exists at this address, and a login page in
 * someone's search results is an invitation to try passwords against it.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
