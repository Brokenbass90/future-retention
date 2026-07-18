#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  ACTIVE_EMAIL_BASE_BRANDS,
  isActiveEmailBaseBrand,
  isServiceEmailBaseBrand,
  partitionEmailBaseGroups,
  visibleEmailBaseGroups,
} from "../src/active-base-policy.js";

const groups = [
  { brand: "X_IQ", mails: [{ name: "mail-iq" }] },
  { brand: "X_IQBroker", mails: [{ name: "mail-broker" }] },
  { brand: "X_assembled", mails: [{ name: "mail-new" }] },
  { brand: "X_preview", mails: [{ name: "mail-temp" }] },
  { brand: "X_System", mails: [{ name: "mail-system" }] },
  { brand: "X_Exnova", mails: [{ name: "mail-legacy" }] },
];

assert.deepEqual(ACTIVE_EMAIL_BASE_BRANDS, ["X_IQ", "X_IQBroker", "X_assembled"], "1.0 exposes both IQ bases plus durable constructor output");
assert.equal(isActiveEmailBaseBrand("X_IQ"), true);
assert.equal(isActiveEmailBaseBrand("X_System"), false);
assert.equal(isServiceEmailBaseBrand("X_preview"), true);

const partitioned = partitionEmailBaseGroups(groups);
assert.deepEqual(partitioned.active.map((entry) => entry.brand), ["X_IQ", "X_IQBroker", "X_assembled"]);
assert.deepEqual(partitioned.service.map((entry) => entry.brand), ["X_preview"], "temporary preview storage never appears as a user mail base");
assert.deepEqual(partitioned.archived.map((entry) => entry.brand), ["X_System", "X_Exnova"], "legacy/system material is retained as a reversible archive");
assert.deepEqual(visibleEmailBaseGroups(groups, "active").map((entry) => entry.brand), ["X_IQ", "X_IQBroker", "X_assembled"]);
assert.deepEqual(visibleEmailBaseGroups(groups, "all").map((entry) => entry.brand), ["X_IQ", "X_IQBroker", "X_assembled", "X_System", "X_Exnova"]);

console.log("active base policy: ok");
