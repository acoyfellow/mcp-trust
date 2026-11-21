import { expect, test } from "bun:test";
import { Story } from "@alchemy.run/domain/Story";
import { fromHex, verifyPassport } from "../../src/domain/passport.ts";
import {
  AmbiguousTool,
  CallRouted,
  Misbinding,
  NameCollided,
  ProviderNotNamed,
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

const malloryExecute = new ToolRegistered({
  name: "execute",
  server: "mallory-1",
  provider: "mallory",
  schemaHash: SCHEMA,
});
const acmeRegisterExecute = new RegisterTool({
  name: "execute",
  server: "acme-1",
  schemaHash: SCHEMA,
  signature: acmePassport("execute"),
});
const malloryRegisterExecute = new RegisterTool({
  name: "execute",
  server: "mallory-1",
  schemaHash: SCHEMA,
  signature: malloryPassport("execute"),
});
const route = (
  tool: string,
  server: string,
  provider: string | null,
  named: ReadonlyArray<string> | null = null,
) => new RouteCall({ tool, server, provider, named });

test("a same-name tool from a second provider is kept and a collision is recorded", () =>
  run(
    story(
      Story.given(registry(), acmeServer, acmeExecute, malloryServer),
      Story.when(registry(), malloryRegisterExecute),
      Story.then(
        registry(),
        malloryExecute,
        new NameCollided({ tool: "execute", provider: "mallory", otherProviders: ["acme"] }),
      ),
    ),
  ));

test("the same provider registering its own name again records no collision", () =>
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

test("impostor registers first: the trusted tool still registers and still routes to the trusted provider", () =>
  run(
    story(
      Story.given(registry(), malloryServer, malloryExecute, acmeServer),
      Story.when(registry(), acmeRegisterExecute),
      Story.then(
        registry(),
        acmeExecute,
        new NameCollided({ tool: "execute", provider: "acme", otherProviders: ["mallory"] }),
      ),
      Story.when(registry(), route("execute", "acme-1", "acme")),
      Story.then(
        registry(),
        new CallRouted({ tool: "execute", server: "acme-1", provider: "acme", pinned: false }),
      ),
      Story.when(registry(), route("execute", "mallory-1", "mallory")),
      Story.then(
        registry(),
        new CallRouted({
          tool: "execute",
          server: "mallory-1",
          provider: "mallory",
          pinned: false,
        }),
      ),
    ),
  ));

test("a call for the trusted provider cannot be sent to the impostor's server", () =>
  run(
    story(
      Story.given(
        registry(),
        malloryServer,
        malloryExecute,
        acmeServer,
        acmeExecute,
        new NameCollided({ tool: "execute", provider: "acme", otherProviders: ["mallory"] }),
      ),
      Story.when(registry(), route("execute", "mallory-1", "acme")),
      Story.rejected(
        new Misbinding({
          tool: "execute",
          requestedServer: "mallory-1",
          requestedProvider: "acme",
          boundTo: "acme-1",
        }),
      ),
    ),
  ));

test("a bare-name call is rejected when two providers expose the name", () =>
  run(
    story(
      Story.given(
        registry(),
        malloryServer,
        malloryExecute,
        acmeServer,
        acmeExecute,
        new NameCollided({ tool: "execute", provider: "acme", otherProviders: ["mallory"] }),
      ),
      Story.when(registry(), route("execute", "acme-1", null)),
      Story.rejected(new AmbiguousTool({ tool: "execute", providers: ["acme", "mallory"] })),
      Story.when(registry(), route("execute", "mallory-1", null)),
      Story.rejected(new AmbiguousTool({ tool: "execute", providers: ["acme", "mallory"] })),
    ),
  ));

test("a bare-name call routes when only one provider exposes the name", () =>
  run(
    story(
      Story.given(registry(), acmeServer, acmeExecute),
      Story.when(registry(), route("execute", "acme-1", null)),
      Story.then(
        registry(),
        new CallRouted({ tool: "execute", server: "acme-1", provider: "acme", pinned: false }),
      ),
    ),
  ));

test("a bare-name call to the wrong server is a misbinding even when the name is unique", () =>
  run(
    story(
      Story.given(registry(), acmeServer, acmeExecute, malloryServer),
      Story.when(registry(), route("execute", "mallory-1", null)),
      Story.rejected(
        new Misbinding({
          tool: "execute",
          requestedServer: "mallory-1",
          requestedProvider: null,
          boundTo: "acme-1",
        }),
      ),
    ),
  ));

test("registration order does not change what the registry knows", async () => {
  const seen: Array<unknown> = [];
  const capture = Story.state(registry(), (state) => {
    seen.push(state.tools);
  });
  await run(
    story(
      Story.given(registry(), acmeServer, malloryServer),
      Story.when(registry(), acmeRegisterExecute),
      Story.then(registry(), acmeExecute),
      Story.when(registry(), malloryRegisterExecute),
      Story.then(
        registry(),
        malloryExecute,
        new NameCollided({ tool: "execute", provider: "mallory", otherProviders: ["acme"] }),
      ),
      capture,
    ),
  );
  await run(
    story(
      Story.given(registry(), acmeServer, malloryServer),
      Story.when(registry(), malloryRegisterExecute),
      Story.then(registry(), malloryExecute),
      Story.when(registry(), acmeRegisterExecute),
      Story.then(
        registry(),
        acmeExecute,
        new NameCollided({ tool: "execute", provider: "acme", otherProviders: ["mallory"] }),
      ),
      capture,
    ),
  );
  expect(seen).toHaveLength(2);
  expect(seen[0]).toEqual(seen[1]);
});

test("a call to a server the tool is not bound to is a misbinding", () =>
  run(
    story(
      Story.given(registry(), acmeServer, acmeExecute, malloryServer),
      Story.when(registry(), route("execute", "mallory-1", "acme")),
      Story.rejected(
        new Misbinding({
          tool: "execute",
          requestedServer: "mallory-1",
          requestedProvider: "acme",
          boundTo: "acme-1",
        }),
      ),
    ),
  ));

test("a call to an unregistered tool is a misbinding bound to nothing", () =>
  run(
    story(
      Story.given(registry(), acmeServer),
      Story.when(registry(), route("execute", "acme-1", "acme")),
      Story.rejected(
        new Misbinding({
          tool: "execute",
          requestedServer: "acme-1",
          requestedProvider: "acme",
          boundTo: null,
        }),
      ),
      Story.when(registry(), route("execute", "acme-1", null)),
      Story.rejected(
        new Misbinding({
          tool: "execute",
          requestedServer: "acme-1",
          requestedProvider: null,
          boundTo: null,
        }),
      ),
    ),
  ));

test("names such as __proto__ cannot reach inherited properties", () =>
  run(
    story(
      Story.given(registry(), acmeServer),
      Story.when(registry(), route("__proto__", "acme-1", null)),
      Story.rejected(
        new Misbinding({
          tool: "__proto__",
          requestedServer: "acme-1",
          requestedProvider: null,
          boundTo: null,
        }),
      ),
      Story.when(registry(), route("execute", "acme-1", "constructor")),
      Story.rejected(
        new Misbinding({
          tool: "execute",
          requestedServer: "acme-1",
          requestedProvider: "constructor",
          boundTo: null,
        }),
      ),
    ),
  ));

test("sessions do not share registrations", () =>
  run(
    story(
      Story.given(registry(), acmeServer, acmeExecute),
      Story.when(registry(s2), route("execute", "acme-1", "acme")),
      Story.rejected(
        new Misbinding({
          tool: "execute",
          requestedServer: "acme-1",
          requestedProvider: "acme",
          boundTo: null,
        }),
      ),
    ),
  ));

test("verifyPassport returns false for malformed hex and never throws", () => {
  const fields = { provider: "acme", serverUrl: ACME_URL, toolName: "execute", schemaHash: SCHEMA };
  expect(verifyPassport("zz", "00", fields)).toBe(false);
  expect(verifyPassport(acme.publicKey, "abcd", fields)).toBe(false);
  expect(verifyPassport(acme.publicKey, acmePassport("execute"), fields)).toBe(true);
  expect(fromHex("abc")).toBeNull();
});

const bothProviders = [acmeServer, acmeExecute, malloryServer, malloryExecute] as const;

test("a call to a provider the user did not name is refused, even with a valid key", () =>
  run(
    story(
      Story.given(registry(), ...bothProviders),
      Story.when(registry(), route("execute", "mallory-1", "mallory", ["acme"])),
      Story.rejected(
        new ProviderNotNamed({ tool: "execute", provider: "mallory", named: ["acme"] }),
      ),
    ),
  ));

test("a call to the provider the user named is routed", () =>
  run(
    story(
      Story.given(registry(), ...bothProviders),
      Story.when(registry(), route("execute", "acme-1", "acme", ["acme"])),
      Story.then(
        registry(),
        new CallRouted({ tool: "execute", server: "acme-1", provider: "acme", pinned: true }),
      ),
    ),
  ));

test("an impostor that registered first does not change which provider a named call reaches", () =>
  run(
    story(
      Story.given(registry(), malloryServer, malloryExecute, acmeServer, acmeExecute),
      Story.when(registry(), route("execute", "mallory-1", "mallory", ["acme"])),
      Story.rejected(
        new ProviderNotNamed({ tool: "execute", provider: "mallory", named: ["acme"] }),
      ),
      Story.when(registry(), route("execute", "acme-1", "acme", ["acme"])),
      Story.then(
        registry(),
        new CallRouted({ tool: "execute", server: "acme-1", provider: "acme", pinned: true }),
      ),
    ),
  ));

test("a prompt that names no provider refuses every call", () =>
  run(
    story(
      Story.given(registry(), ...bothProviders),
      Story.when(registry(), route("execute", "acme-1", "acme", [])),
      Story.rejected(new ProviderNotNamed({ tool: "execute", provider: "acme", named: [] })),
    ),
  ));

test("the named-provider check also covers a bare-name call to a single provider", () =>
  run(
    story(
      Story.given(registry(), acmeServer, acmeExecute),
      Story.when(registry(), route("execute", "acme-1", null, ["mallory"])),
      Story.rejected(
        new ProviderNotNamed({ tool: "execute", provider: "acme", named: ["mallory"] }),
      ),
    ),
  ));

test("provider names match exactly: a lookalike provider is not the named one", () =>
  run(
    story(
      Story.given(
        registry(),
        new ServerRegistered({
          serverId: "lookalike-1",
          provider: "acme-mcp",
          publicKey: mallory.publicKey,
          url: MALLORY_URL,
        }),
        new ToolRegistered({
          name: "execute",
          server: "lookalike-1",
          provider: "acme-mcp",
          schemaHash: SCHEMA,
        }),
      ),
      Story.when(registry(), route("execute", "lookalike-1", "acme-mcp", ["acme"])),
      Story.rejected(
        new ProviderNotNamed({ tool: "execute", provider: "acme-mcp", named: ["acme"] }),
      ),
    ),
  ));

test("CallRouted says pinned: false when the user prompt named no provider", () =>
  run(
    story(
      Story.given(registry(), acmeServer, acmeExecute),
      Story.when(registry(), route("execute", "acme-1", "acme", null)),
      Story.then(
        registry(),
        new CallRouted({ tool: "execute", server: "acme-1", provider: "acme", pinned: false }),
      ),
    ),
  ));

test("CallRouted says pinned: true when the user prompt named the provider", () =>
  run(
    story(
      Story.given(registry(), acmeServer, acmeExecute),
      Story.when(registry(), route("execute", "acme-1", "acme", ["acme"])),
      Story.then(
        registry(),
        new CallRouted({ tool: "execute", server: "acme-1", provider: "acme", pinned: true }),
      ),
    ),
  ));
