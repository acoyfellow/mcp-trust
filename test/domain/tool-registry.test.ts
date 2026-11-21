import { expect, test } from "bun:test";
import { Story } from "@alchemy.run/domain/Story";
import { fromHex, verifyPassport } from "../../src/domain/passport.ts";
import {
  CallRouted,
  Misbinding,
  NameCollision,
  RegisterServer,
  RegisterTool,
  RouteCall,
  ServerAlreadyRegistered,
  ServerRegistered,
  ToolRegistered,
  UnverifiedPassport,
} from "../../src/domain/tool-registry.ts";
import {
  ACME_URL,
  acme,
  acmePassport,
  MALLORY_URL,
  mallory,
  malloryPassport,
  registry,
  run,
  SCHEMA,
  s2,
  story,
} from "./fixtures.ts";

const acmeServer = new ServerRegistered({
  serverId: "acme-1",
  provider: "acme",
  publicKey: acme.publicKey,
  url: ACME_URL,
});
const malloryServer = new ServerRegistered({
  serverId: "mallory-1",
  provider: "mallory",
  publicKey: mallory.publicKey,
  url: MALLORY_URL,
});
const acmeExecute = new ToolRegistered({
  name: "execute",
  server: "acme-1",
  provider: "acme",
  schemaHash: SCHEMA,
});

test("a server registers with its provider, pinned key and URL", () =>
  run(
    story(
      Story.when(
        registry(),
        new RegisterServer({
          serverId: "acme-1",
          provider: "acme",
          publicKey: acme.publicKey,
          url: ACME_URL,
        }),
      ),
      Story.then(registry(), acmeServer),
    ),
  ));

test("a server id cannot be registered twice, so its key cannot be swapped", () =>
  run(
    story(
      Story.given(registry(), acmeServer),
      Story.when(
        registry(),
        new RegisterServer({
          serverId: "acme-1",
          provider: "acme",
          publicKey: mallory.publicKey,
          url: ACME_URL,
        }),
      ),
      Story.rejected(new ServerAlreadyRegistered({ serverId: "acme-1" })),
    ),
  ));

test("a tool with a valid passport registers", () =>
  run(
    story(
      Story.given(registry(), acmeServer),
      Story.when(
        registry(),
        new RegisterTool({
          name: "execute",
          server: "acme-1",
          schemaHash: SCHEMA,
          signature: acmePassport("execute"),
        }),
      ),
      Story.then(registry(), acmeExecute),
    ),
  ));

test("a passport signed with the wrong key is refused", () =>
  run(
    story(
      Story.given(registry(), acmeServer),
      Story.when(
        registry(),
        new RegisterTool({
          name: "execute",
          server: "acme-1",
          schemaHash: SCHEMA,
          signature: malloryPassport("execute", "acme"),
        }),
      ),
      Story.rejected(new UnverifiedPassport({ tool: "execute", server: "acme-1" })),
    ),
  ));

test("an impostor server that claims the provider but lacks its key is refused", () =>
  run(
    story(
      Story.given(
        registry(),
        new ServerRegistered({
          serverId: "impostor-1",
          provider: "acme",
          publicKey: acme.publicKey,
          url: MALLORY_URL,
        }),
      ),
      Story.when(
        registry(),
        new RegisterTool({
          name: "execute",
          server: "impostor-1",
          schemaHash: SCHEMA,
          signature: malloryPassport("execute", "acme"),
        }),
      ),
      Story.rejected(new UnverifiedPassport({ tool: "execute", server: "impostor-1" })),
    ),
  ));

test("a passport does not cover a different schema hash", () =>
  run(
    story(
      Story.given(registry(), acmeServer),
      Story.when(
        registry(),
        new RegisterTool({
          name: "execute",
          server: "acme-1",
          schemaHash: "sha256:changed",
          signature: acmePassport("execute", SCHEMA),
        }),
      ),
      Story.rejected(new UnverifiedPassport({ tool: "execute", server: "acme-1" })),
    ),
  ));

test("a passport does not cover a different tool name", () =>
  run(
    story(
      Story.given(registry(), acmeServer),
      Story.when(
        registry(),
        new RegisterTool({
          name: "delete",
          server: "acme-1",
          schemaHash: SCHEMA,
          signature: acmePassport("execute"),
        }),
      ),
      Story.rejected(new UnverifiedPassport({ tool: "delete", server: "acme-1" })),
    ),
  ));

test("a tool from an unregistered server is refused", () =>
  run(
    story(
      Story.when(
        registry(),
        new RegisterTool({
          name: "execute",
          server: "ghost",
          schemaHash: SCHEMA,
          signature: acmePassport("execute"),
        }),
      ),
      Story.rejected(new UnverifiedPassport({ tool: "execute", server: "ghost" })),
    ),
  ));

test("a second server with a valid passport cannot take a bound name", () =>
  run(
    story(
      Story.given(registry(), acmeServer, acmeExecute, malloryServer),
      Story.when(
        registry(),
        new RegisterTool({
          name: "execute",
          server: "mallory-1",
          schemaHash: SCHEMA,
          signature: malloryPassport("execute"),
        }),
      ),
      Story.rejected(
        new NameCollision({ tool: "execute", boundTo: "acme-1", attemptedBy: "mallory-1" }),
      ),
    ),
  ));

test("the same server may register its own tool name again", () =>
  run(
    story(
      Story.given(registry(), acmeServer, acmeExecute),
      Story.when(
        registry(),
        new RegisterTool({
          name: "execute",
          server: "acme-1",
          schemaHash: "sha256:bbbb",
          signature: acmePassport("execute", "sha256:bbbb"),
        }),
      ),
      Story.then(
        registry(),
        new ToolRegistered({
          name: "execute",
          server: "acme-1",
          provider: "acme",
          schemaHash: "sha256:bbbb",
        }),
      ),
    ),
  ));

test("a call routes to the server the tool is bound to", () =>
  run(
    story(
      Story.given(registry(), acmeServer, acmeExecute),
      Story.when(registry(), new RouteCall({ tool: "execute", server: "acme-1" })),
      Story.then(
        registry(),
        new CallRouted({ tool: "execute", server: "acme-1", provider: "acme" }),
      ),
    ),
  ));

test("a call to a server the tool is not bound to is a misbinding", () =>
  run(
    story(
      Story.given(registry(), acmeServer, acmeExecute, malloryServer),
      Story.when(registry(), new RouteCall({ tool: "execute", server: "mallory-1" })),
      Story.rejected(
        new Misbinding({ tool: "execute", requestedServer: "mallory-1", boundTo: "acme-1" }),
      ),
    ),
  ));

test("a call to an unregistered tool is a misbinding bound to nothing", () =>
  run(
    story(
      Story.given(registry(), acmeServer),
      Story.when(registry(), new RouteCall({ tool: "execute", server: "acme-1" })),
      Story.rejected(new Misbinding({ tool: "execute", requestedServer: "acme-1", boundTo: null })),
    ),
  ));

test("tool names such as __proto__ cannot reach inherited properties", () =>
  run(
    story(
      Story.given(registry(), acmeServer),
      Story.when(registry(), new RouteCall({ tool: "__proto__", server: "acme-1" })),
      Story.rejected(
        new Misbinding({ tool: "__proto__", requestedServer: "acme-1", boundTo: null }),
      ),
      Story.when(registry(), new RouteCall({ tool: "constructor", server: "acme-1" })),
      Story.rejected(
        new Misbinding({ tool: "constructor", requestedServer: "acme-1", boundTo: null }),
      ),
    ),
  ));

test("sessions do not share registrations", () =>
  run(
    story(
      Story.given(registry(), acmeServer, acmeExecute),
      Story.when(registry(s2), new RouteCall({ tool: "execute", server: "acme-1" })),
      Story.rejected(new Misbinding({ tool: "execute", requestedServer: "acme-1", boundTo: null })),
    ),
  ));

test("verifyPassport returns false for malformed hex and never throws", () => {
  const fields = { provider: "acme", serverUrl: ACME_URL, toolName: "execute", schemaHash: SCHEMA };
  expect(verifyPassport("zz", "00", fields)).toBe(false);
  expect(verifyPassport(acme.publicKey, "abcd", fields)).toBe(false);
  expect(verifyPassport(acme.publicKey, acmePassport("execute"), fields)).toBe(true);
  expect(fromHex("abc")).toBeNull();
});
