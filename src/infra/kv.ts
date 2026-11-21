import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";

export const Scratch = Cloudflare.KV.Namespace("Scratch").pipe(Alchemy.remote());
export const Decoy = Cloudflare.KV.Namespace("Decoy").pipe(Alchemy.remote());
