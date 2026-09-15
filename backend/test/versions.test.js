// Run: node --test backend/test/versions.test.js
//
// The agent version lives in four places. If they drift, the publish workflow
// skips the already-existing version tag and the installer quietly ships an
// old image -- which is how 0.1.0 went out without redaction.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LATEST_AGENT_VERSION, isAgentOutdated } from "@aika/protocol";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("agent version agrees across package.json, source, installer and protocol", () => {
  const pkg = JSON.parse(read("agent/package.json")).version;
  const source = read("agent/src/index.js").match(/AGENT_VERSION = "([^"]+)"/)?.[1];
  const image = read("install/install.sh").match(/DEFAULT_IMAGE="[^"]*:([^"]+)"/)?.[1];

  assert.equal(source, pkg, "AGENT_VERSION in agent/src/index.js");
  assert.equal(image, pkg, "DEFAULT_IMAGE in install/install.sh");
  assert.equal(LATEST_AGENT_VERSION, pkg, "LATEST_AGENT_VERSION in packages/protocol");
});

test("isAgentOutdated compares numerically and ignores junk", () => {
  assert.equal(isAgentOutdated("0.1.0", "0.2.0"), true);
  assert.equal(isAgentOutdated("0.2.0", "0.2.0"), false);
  assert.equal(isAgentOutdated("0.10.0", "0.9.0"), false);
  assert.equal(isAgentOutdated("1.0.0", "0.9.9"), false);
  assert.equal(isAgentOutdated(null), false);
  assert.equal(isAgentOutdated("dev"), false);
});
