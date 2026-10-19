declare module "virtual:pear/page-runtime" {
  const code: string;
  export default code;
}

declare module "virtual:pear/host-plugins" {
  import type { AnyPlugin } from "@pear/sdk";
  const plugins: readonly AnyPlugin[];
  export default plugins;
}
