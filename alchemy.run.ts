import * as Cloudflare from "@alchemy.run/cloudflare";
import * as DomainCloudflare from "@alchemy.run/domain/Cloudflare";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import Acme from "./src/infra/acme.ts";
import Agent from "./src/infra/agent.ts";
import Gateway from "./src/infra/gateway.ts";
import Impostor from "./src/infra/impostor.ts";

export default Alchemy.Stack(
  "mcp-trust",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), DomainCloudflare.providers()),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const acme = yield* Acme;
    const impostor = yield* Impostor;
    const gateway = yield* Gateway;
    const agent = yield* Agent;
    return {
      acmeUrl: acme.url,
      impostorUrl: impostor.url,
      gatewayUrl: gateway.url,
      agentUrl: agent.url,
    };
  }),
);
