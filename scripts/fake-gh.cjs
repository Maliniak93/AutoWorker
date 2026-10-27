const fs = require("node:fs");
if (process.argv[1] && fs.existsSync(process.argv[1])) return;

const args = process.argv.slice(1).map((a, i) => (i === 0 ? require("node:path").basename(a) : a));
const statePath = process.env.FAKE_GH_STATE;
const logPath = process.env.FAKE_GH_LOG;
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));

const out = (text) => {
  fs.writeFileSync(statePath, JSON.stringify(state));
  fs.writeSync(1, text ?? "");
  process.exit(0);
};
const log = (entry) => fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`);
const readInput = () => {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
};

const issues = state.issues;
const itemOf = (n) => `ITEM_${n}`;
const numberOfItem = (id) => Number(String(id).replace("ITEM_", ""));
const statusOf = (i) => (i.status ? { name: i.status } : null);
const childrenOf = (n) => Object.values(issues).filter((i) => i.parent === n);

function fieldNodes(i) {
  return {
    status: statusOf(i),
    tier: i.tier ? { name: i.tier } : null,
    kind: i.kind ? { name: i.kind } : null,
    area: i.area ? { name: i.area } : null,
    priority: i.priority ? { name: i.priority } : null,
    branch: i.branch ? { text: i.branch } : null,
  };
}

function issueNode(n, withParent = true) {
  const i = issues[n];
  if (!i) return null;
  return {
    id: `ISSUE_${n}`,
    number: n,
    title: i.title,
    body: i.body ?? "",
    state: i.state,
    url: `https://github.com/acme/demo/issues/${n}`,
    labels: { nodes: i.labels.map((name) => ({ name })) },
    parent: withParent && i.parent ? issueNode(i.parent, false) : null,
    subIssues: { nodes: childrenOf(n).map((c) => ({ number: c.number, title: c.title, state: c.state, labels: { nodes: c.labels.map((name) => ({ name })) } })) },
    projectItems: { nodes: i.inProject === false ? [] : [{ id: itemOf(n), project: { number: state.projectNumber ?? 1 }, ...fieldNodes(i) }] },
  };
}

function itemsPage(query, variables) {
  const ordered = /POSITION/.test(query + JSON.stringify(variables));
  const numbers = state.order.filter((n) => issues[n]);
  if (!ordered) numbers.sort((a, b) => b - a);
  return {
    pageInfo: { hasNextPage: false, endCursor: null },
    nodes: numbers.map((n) => ({
      id: itemOf(n),
      ...fieldNodes(issues[n]),
      content: {
        __typename: "Issue",
        number: n,
        title: issues[n].title,
        body: issues[n].body ?? "",
        state: issues[n].state,
        labels: { nodes: issues[n].labels.map((name) => ({ name })) },
      },
    })),
  };
}

function applyField(n, fieldName, value) {
  if (fieldName === "Status") issues[n].status = value;
  if (fieldName === "Tier") issues[n].tier = value;
  if (fieldName === "Kind") issues[n].kind = value;
  if (fieldName === "Area") issues[n].area = value;
  if (fieldName === "Priority") issues[n].priority = value;
  if (fieldName === "Branch") issues[n].branch = value;
}

function aliasedFieldUpdates(query, variables) {
  const parts = query.split(/\w+\s*:\s*updateProjectV2ItemFieldValue\s*\(/).slice(1);
  const pick = (part, key) => {
    const m = part.match(new RegExp(`${key}\\s*:\\s*(?:"([^"]+)"|\\$(\\w+))`));
    return m ? (m[1] ?? variables[m[2]]) : undefined;
  };
  return parts.map((part) => ({
    item: pick(part, "itemId"),
    field: pick(part, "fieldId"),
    option: pick(part, "singleSelectOptionId"),
  }));
}

function graphql() {
  const { query, variables = {} } = JSON.parse(readInput());
  if (/^\s*mutation[^{]*\{\s*\w+\s*:\s*updateProjectV2ItemFieldValue/.test(query)) {
    const updates = aliasedFieldUpdates(query, variables);
    log({ kind: "fieldBatch", size: updates.length });
    for (const u of updates) {
      const field = Object.entries(state.fields).find(([, f]) => f.id === u.field);
      const option = (field?.[1].options ?? []).find((o) => o.id === u.option);
      const value = option ? option.name : null;
      applyField(numberOfItem(u.item), field?.[0], value);
      log({ kind: "setField", item: u.item, field: field?.[0], value });
    }
    return out(JSON.stringify({ data: {} }));
  }
  const mutation = query.match(/^\s*mutation[^{]*\{\s*(\w+)\s*\(/);
  if (mutation) {
    const name = mutation[1];
    if (name === "updateProjectV2ItemFieldValue") {
      const field = Object.entries(state.fields).find(([, f]) => f.id === variables.field);
      const fieldName = field[0];
      if ((state.failFields ?? []).includes(fieldName)) {
        fs.writeSync(2, `injected failure writing ${fieldName}`);
        process.exit(1);
      }
      if ((state.failFieldsOnce ?? []).includes(fieldName)) {
        state.failFieldsOnce = state.failFieldsOnce.filter((f) => f !== fieldName);
        fs.writeFileSync(statePath, JSON.stringify(state));
        fs.writeSync(2, `injected one-time failure writing ${fieldName}`);
        process.exit(1);
      }
      const option = (field[1].options ?? []).find((o) => o.id === variables.value.singleSelectOptionId);
      const value = option ? option.name : variables.value.text;
      const n = numberOfItem(variables.item);
      applyField(n, fieldName, value);
      log({ kind: "setField", item: variables.item, field: fieldName, value });
    } else if (name === "addProjectV2ItemById") {
      const n = Number(String(variables.content).replace("ISSUE_", ""));
      if (!state.order.includes(n)) state.order.push(n);
      issues[n].inProject = true;
      log({ kind: "addToProject", number: n });
      return out(JSON.stringify({ data: { [name]: { item: { id: itemOf(n) } } } }));
    } else if (/Position/.test(name)) {
      const entries = Object.entries(variables);
      const afterEntry = entries.find(([k]) => /after/i.test(k));
      const itemEntry = entries.find(([k]) => /item/i.test(k) && !/after/i.test(k));
      const afterId = afterEntry ? afterEntry[1] : (query.match(/afterId:\s*"([^"]+)"/) ?? [])[1] ?? null;
      const itemId = itemEntry ? itemEntry[1] : (query.match(/itemId:\s*"([^"]+)"/) ?? [])[1];
      log({ kind: "position", query, variables, itemId, afterId });
      if (itemId) {
        const n = numberOfItem(itemId);
        state.order = state.order.filter((x) => x !== n);
        const at = afterId ? state.order.indexOf(numberOfItem(afterId)) + 1 : 0;
        state.order.splice(at, 0, n);
      }
    } else if (name === "updateProjectV2Field") {
      const field = Object.entries(state.fields).find(([, f]) => f.id === variables.field);
      field[1].options = variables.options.map((o) => ({ id: "O_" + field[0] + "_" + o.name, name: o.name }));
      log({ kind: "statusOptions", field: field[0], options: variables.options.map((o) => o.name) });
    } else {
      log({ kind: "mutation", name, variables });
    }
    return out(JSON.stringify({ data: { [name]: { item: { id: "x" }, projectV2Item: { id: "x" }, items: { nodes: [] } } } }));
  }

  if (/fields\(first: 50\)/.test(query)) {
    const nodes = Object.entries(state.fields).map(([name, f]) => ({
      id: f.id,
      name,
      ...(f.options ? { options: f.options } : {}),
    }));
    return out(JSON.stringify({ data: { repositoryOwner: { projectV2: { id: "PVT_1", fields: { nodes } } } } }));
  }
  if (/items\(first: 100/.test(query)) {
    log({ kind: "items", query, variables });
    return out(JSON.stringify({ data: { repositoryOwner: { projectV2: { items: itemsPage(query, variables) } } } }));
  }
  if (/issue\(number: \$number\)/.test(query)) {
    log({ kind: "issueQuery", number: variables.number });
    return out(JSON.stringify({ data: { repository: { issue: issueNode(Number(variables.number)) } } }));
  }
  log({ kind: "unknownQuery", query });
  return out(JSON.stringify({ data: {} }));
}

const flag = (name) => {
  const at = args.indexOf(name);
  return at < 0 ? null : args[at + 1];
};

if (state.rateLimit) {
  if (args[0] === "api" && args[1] === "rate_limit") {
    const bucket = (remaining) => ({ limit: 5000, remaining, reset: state.rateLimit.reset });
    out(JSON.stringify({ resources: { graphql: bucket(0), core: bucket(5000) } }));
  }
  fs.writeSync(2, "GraphQL: API rate limit already exceeded for user ID 1234.");
  process.exit(1);
}

if (args[0] === "api" && args[1] === "rate_limit") {
  const bucket = { limit: 5000, remaining: 4000, reset: 2_000_000_000 };
  out(JSON.stringify({ resources: { graphql: bucket, core: bucket } }));
}
if (args[0] === "api" && args[1] === "graphql") graphql();
if (args[0] === "api") {
  const sub = args.find((a) => /\/issues\/\d+\/sub_issues$/.test(a));
  if (sub) {
    const n = Number(sub.match(/issues\/(\d+)\/sub_issues/)[1]);
    out(JSON.stringify(childrenOf(n).map((c) => ({ number: c.number, title: c.title, state: c.state.toLowerCase() }))));
  }
  const one = args.find((a) => /\/issues\/\d+$/.test(a));
  if (one) out(String(1000 + Number(one.match(/issues\/(\d+)$/)[1])));
  log({ kind: "rest", args });
  out("{}");
}
if (args[0] === "issue" && args[1] === "create") {
  const input = readInput();
  const n = state.nextNumber++;
  const labels = [];
  args.forEach((a, k) => {
    if (a === "--label") labels.push(args[k + 1]);
  });
  const parent = flag("--parent");
  issues[n] = {
    number: n,
    title: flag("--title"),
    body: input,
    state: "OPEN",
    labels,
    parent: parent ? Number(parent) : null,
    status: null,
    tier: null,
    kind: null,
    priority: null,
    branch: null,
    inProject: false,
  };
  log({ kind: "issueCreate", number: n, parent: parent ? Number(parent) : null, labels });
  out(`https://github.com/acme/demo/issues/${n}\n`);
}
if (args[0] === "issue" && args[1] === "view") {
  const i = issues[Number(args[2])];
  out(JSON.stringify(i ? { number: i.number, title: i.title, state: i.state, labels: i.labels.map((name) => ({ name })), comments: [] } : {}));
}
if (args[0] === "issue" && args[1] === "develop" && args.includes("--list")) {
  const n = Number(args[args.indexOf("--list") + 1]);
  log({ kind: "developList", number: n });
  out(((state.linkedBranches ?? {})[n] ?? []).map((b) => `${b}\thttps://github.com/acme/demo/tree/${b}`).join("\n"));
}
if (args[0] === "issue" && args[1] === "comment") {
  log({ kind: "comment", number: Number(args[2]), body: readInput() });
  out("");
}
if (args[0] === "project" && args[1] === "list") {
  log({ kind: "projectList", args });
  out(JSON.stringify({ projects: state.projects ?? [], totalCount: (state.projects ?? []).length }));
}
if (args[0] === "project" && args[1] === "create") {
  const number = state.nextProject ?? 7;
  state.projects = [...(state.projects ?? []), { number, title: flag("--title") }];
  log({ kind: "projectCreate", title: flag("--title"), owner: flag("--owner") });
  out(JSON.stringify({ number, title: flag("--title"), url: "https://github.com/users/acme/projects/" + number }));
}
if (args[0] === "project" && args[1] === "link") {
  log({ kind: "projectLink", number: Number(args[2]), owner: flag("--owner"), repo: flag("--repo") });
  out("");
}
if (args[0] === "label" && args[1] === "list") {
  out(JSON.stringify((state.labels ?? []).map((name) => ({ name }))));
}
if (args[0] === "label" && args[1] === "create") {
  state.labels = [...(state.labels ?? []), args[2]];
  log({ kind: "labelCreate", name: args[2] });
  out("");
}
if (args[0] === "project" && args[1] === "field-list") {
  out(JSON.stringify({ fields: Object.entries(state.fields).map(([name, f]) => ({ id: f.id, name })) }));
}
if (args[0] === "project" && args[1] === "field-create") {
  const name = flag("--name");
  const options = flag("--single-select-options");
  state.fields[name] = {
    id: `F_${name}`,
    ...(options ? { options: options.split(",").map((o) => ({ id: `O_${name}_${o}`, name: o })) } : {}),
  };
  log({ kind: "fieldCreate", name, options: options ? options.split(",") : null });
  out("");
}
if (args[0] === "pr" && args[1] === "list") {
  log({ kind: "prList", args });
  out(JSON.stringify(state.prs ?? []));
}
if (args[0] === "pr" && args[1] === "view") {
  log({ kind: "prView", args });
  const found = (state.prs ?? []).find((p) => p.headRefName === args[2]);
  if (!found) {
    fs.writeSync(2, "no pull requests found");
    process.exit(1);
  }
  out(JSON.stringify({ number: found.number, state: found.state ?? "OPEN", url: found.url ?? `https://github.com/acme/demo/pull/${found.number}` }));
}
if (args[0] === "pr" && args[1] === "comment") {
  log({ kind: "prComment", number: Number(args[2]), body: flag("--body") });
  out("");
}
if (args[0] === "pr") out("[]");
log({ kind: "other", args });
out("");
