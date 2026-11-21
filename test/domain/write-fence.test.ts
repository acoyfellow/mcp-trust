import { test } from "bun:test";
import { Story } from "@alchemy.run/domain/Story";
import {
  NameTargets,
  ReadAllowed,
  RequestWrite,
  TargetNotNamed,
  TargetsNamed,
  TargetsNotDeclared,
  WriteAllowed,
} from "../../src/domain/write-fence.ts";
import { fence, run, s2, story } from "./fixtures.ts";

test("targets named in the user prompt are recorded", () =>
  run(
    story(
      Story.when(fence(), new NameTargets({ targets: ["scratch:notes", "scratch:todo"] })),
      Story.then(fence(), new TargetsNamed({ targets: ["scratch:notes", "scratch:todo"] })),
      Story.state(fence(), { _tag: "Declared", targets: ["scratch:notes", "scratch:todo"] }),
    ),
  ));

test("a write to a named target is allowed", () =>
  run(
    story(
      Story.given(fence(), new TargetsNamed({ targets: ["scratch:notes"] })),
      Story.when(fence(), new RequestWrite({ tool: "kv_put", target: "scratch:notes" })),
      Story.then(fence(), new WriteAllowed({ tool: "kv_put", target: "scratch:notes" })),
    ),
  ));

test("a write to a target the user did not name is blocked", () =>
  run(
    story(
      Story.given(fence(), new TargetsNamed({ targets: ["scratch:notes"] })),
      Story.when(fence(), new RequestWrite({ tool: "kv_put", target: "decoy:notes" })),
      Story.rejected(new TargetNotNamed({ tool: "kv_put", target: "decoy:notes" })),
    ),
  ));

test("a near-miss target is blocked: matching is exact", () =>
  run(
    story(
      Story.given(fence(), new TargetsNamed({ targets: ["scratch:notes"] })),
      Story.when(fence(), new RequestWrite({ tool: "kv_put", target: "scratch:notes2" })),
      Story.rejected(new TargetNotNamed({ tool: "kv_put", target: "scratch:notes2" })),
      Story.when(fence(), new RequestWrite({ tool: "kv_put", target: "Scratch:notes" })),
      Story.rejected(new TargetNotNamed({ tool: "kv_put", target: "Scratch:notes" })),
    ),
  ));

test("a write before the user names any targets is blocked as undeclared", () =>
  run(
    story(
      Story.when(fence(), new RequestWrite({ tool: "kv_put", target: "scratch:notes" })),
      Story.rejected(new TargetsNotDeclared({ tool: "kv_put", target: "scratch:notes" })),
    ),
  ));

test("a prompt that names no targets declares an empty set and blocks every write", () =>
  run(
    story(
      Story.when(fence(), new NameTargets({ targets: [] })),
      Story.then(fence(), new TargetsNamed({ targets: [] })),
      Story.when(fence(), new RequestWrite({ tool: "kv_put", target: "scratch:notes" })),
      Story.rejected(new TargetNotNamed({ tool: "kv_put", target: "scratch:notes" })),
    ),
  ));

test("a later user turn adds targets and keeps the earlier ones", () =>
  run(
    story(
      Story.given(fence(), new TargetsNamed({ targets: ["scratch:a"] })),
      Story.when(fence(), new NameTargets({ targets: ["scratch:b"] })),
      Story.then(fence(), new TargetsNamed({ targets: ["scratch:b"] })),
      Story.state(fence(), { _tag: "Declared", targets: ["scratch:a", "scratch:b"] }),
      Story.when(fence(), new RequestWrite({ tool: "kv_put", target: "scratch:a" })),
      Story.then(fence(), new WriteAllowed({ tool: "kv_put", target: "scratch:a" })),
      Story.when(fence(), new RequestWrite({ tool: "kv_put", target: "scratch:b" })),
      Story.then(fence(), new WriteAllowed({ tool: "kv_put", target: "scratch:b" })),
    ),
  ));

test("targets named in one session do not open writes in another", () =>
  run(
    story(
      Story.given(fence(), new TargetsNamed({ targets: ["scratch:notes"] })),
      Story.when(fence(s2), new RequestWrite({ tool: "kv_put", target: "scratch:notes" })),
      Story.rejected(new TargetsNotDeclared({ tool: "kv_put", target: "scratch:notes" })),
    ),
  ));

test("a tool on the known-read list passes, with or without declared targets", () =>
  run(
    story(
      Story.when(fence(), new RequestWrite({ tool: "read_document", target: "" })),
      Story.then(fence(), new ReadAllowed({ tool: "read_document" })),
      Story.given(fence(s2), new TargetsNamed({ targets: [] })),
      Story.when(fence(s2), new RequestWrite({ tool: "read_document", target: "" })),
      Story.then(fence(s2), new ReadAllowed({ tool: "read_document" })),
    ),
  ));

test("a tool that is not on the known-read list counts as a write and is blocked", () =>
  run(
    story(
      Story.given(fence(), new TargetsNamed({ targets: ["scratch:notes"] })),
      Story.when(fence(), new RequestWrite({ tool: "mystery_tool", target: "" })),
      Story.rejected(new TargetNotNamed({ tool: "mystery_tool", target: "" })),
      Story.when(fence(), new RequestWrite({ tool: "execute", target: "decoy:notes" })),
      Story.rejected(new TargetNotNamed({ tool: "execute", target: "decoy:notes" })),
    ),
  ));

test("an unknown tool before any target is named is blocked as undeclared", () =>
  run(
    story(
      Story.when(fence(), new RequestWrite({ tool: "mystery_tool", target: "scratch:notes" })),
      Story.rejected(new TargetsNotDeclared({ tool: "mystery_tool", target: "scratch:notes" })),
    ),
  ));

test("an unknown tool aimed at a named target is allowed as a write", () =>
  run(
    story(
      Story.given(fence(), new TargetsNamed({ targets: ["scratch:notes"] })),
      Story.when(fence(), new RequestWrite({ tool: "mystery_tool", target: "scratch:notes" })),
      Story.then(fence(), new WriteAllowed({ tool: "mystery_tool", target: "scratch:notes" })),
    ),
  ));

test("the known-read list matches tool names exactly", () =>
  run(
    story(
      Story.given(fence(), new TargetsNamed({ targets: [] })),
      Story.when(fence(), new RequestWrite({ tool: "Read_Document", target: "" })),
      Story.rejected(new TargetNotNamed({ tool: "Read_Document", target: "" })),
      Story.when(fence(), new RequestWrite({ tool: "read_document2", target: "" })),
      Story.rejected(new TargetNotNamed({ tool: "read_document2", target: "" })),
    ),
  ));
