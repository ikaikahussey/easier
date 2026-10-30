import type { ProductDefinition } from "@/core/product";
import { books } from "./books";
import { form990 } from "./form-990";
import { payroll } from "./payroll";

/** The product registry. Adding a product = writing a module and listing it here. */
export const PRODUCTS: ProductDefinition[] = [form990, books, payroll];

export function getProduct(slug: string): ProductDefinition {
  const p = PRODUCTS.find((x) => x.slug === slug);
  if (!p) throw new Error(`Unknown product: ${slug}`);
  return p;
}
