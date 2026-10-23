declare module "virtual:pear/page-plugins" {
  import type { AnyPlugin } from "@pear/sdk";
  const plugins: readonly AnyPlugin[];
  export default plugins;
}
