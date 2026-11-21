import * as DomainCloudflare from "@alchemy.run/domain/Cloudflare";
import * as Layer from "effect/Layer";
import { McpTrust } from "./domain/model.ts";

export const McpTrustOnDurableObjects = McpTrust.layer(Layer.empty).pipe(
  Layer.provide(DomainCloudflare.layerDurableObjects()),
);
