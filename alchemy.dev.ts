import * as Cloudflare from "@alchemy.run/cloudflare";
import * as DomainCloudflare from "@alchemy.run/domain/Cloudflare";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import Gateway from "./src/infra/gateway.ts";

export default Alchemy.Stack(
  "mcp-trust-dev",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), DomainCloudflare.providers()),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const gateway = yield* Gateway;
    return { gatewayUrl: gateway.url };
  }),
);
