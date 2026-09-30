// JSONC settings are optional at deployment time and validated by the runtime.
// Declaring them as cf required secrets would require every provider credential.
type ProxyBindings = Record<
  Exclude<
    keyof (typeof import("../schemas/config-schema.json"))["properties"],
    "$schema"
  >,
  string
>;

declare namespace Cloudflare {
  // Declaration merging adds application settings to cf's generated Env.
  // oxlint-disable-next-line typescript/no-empty-object-type
  interface Env extends ProxyBindings {}
}
