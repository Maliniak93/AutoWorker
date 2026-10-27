import assert from "node:assert/strict";
import { test } from "node:test";
import { branchFor, slugify } from "./branch-name.mjs";

test("slugify strips accents into a kebab slug", () => {
  assert.equal(slugify("Sidebar with groups", 1), "sidebar-with-groups");
  assert.equal(slugify("Zażółć gęślą jaźń: ĄĆĘŁŃÓŚŹŻ", 1), "zazolc-gesla-jazn-acelnoszz");
  assert.equal(slugify("Crème brûlée à la façon", 1), "creme-brulee-a-la-facon");
});

test("slugify collapses special characters and trims", () => {
  assert.equal(slugify("  Web: dashboard -- by group (#508)!  ", 1), "web-dashboard-by-group-508");
});

test("slugify falls back to issue-<n> for an empty result", () => {
  assert.equal(slugify("!!! ???", 466), "issue-466");
  assert.equal(slugify("", 7), "issue-7");
});

test("slugify cuts at a word edge within 50 characters", () => {
  const slug = slugify("A card without the required fields does not stop the flow overnight", 1);
  assert.equal(slug, "a-card-without-the-required-fields-does-not-stop");
  assert.ok(slug.length <= 50);
  assert.equal(slugify("a".repeat(80), 1), "a".repeat(50));
});

test("branchFor prefixes feat/", () => {
  assert.equal(branchFor("x"), "feat/x");
});
