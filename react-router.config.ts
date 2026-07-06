import type { Config } from "@react-router/dev/config";

export default {
  // This is an admin tool that talks to a database on every request, so it is
  // always server-rendered. No prerendering / static export.
  ssr: true,
} satisfies Config;
