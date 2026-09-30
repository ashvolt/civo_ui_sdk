import DashboardPage from "./dashboard-page";
import { describeProvider } from "./provider";

/**
 * A server component, so the endpoint label is read from the environment at
 * request time rather than baked in at build time — and so the client bundle
 * never learns anything about how the server reaches the model.
 */
export const dynamic = "force-dynamic";

export default function Page() {
  const provider = describeProvider();
  return <DashboardPage providerLabel={provider.label} isSovereign={provider.isSovereign} />;
}
