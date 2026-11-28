import type { MetadataRoute } from "next";

/** Public pages may be indexed; everything behind sign-in may not. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/app", "/engagements", "/review", "/admin", "/p120", "/account", "/auth"] },
  };
}
