// Usage: imported by gh-project.mjs - the one branch naming rule: branchFor(slug) and slugify(title)

const MAX_SLUG = 50;

export const branchFor = (slug) => `feat/${slug}`;

export function slugify(title, number) {
  const slug = String(title ?? "")
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) return `issue-${number}`;
  if (slug.length <= MAX_SLUG) return slug;
  const cut = slug.slice(0, MAX_SLUG + 1);
  const edge = cut.lastIndexOf("-");
  return edge > 0 ? cut.slice(0, edge) : slug.slice(0, MAX_SLUG);
}
