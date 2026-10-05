import DashboardPage from "./dashboard-page";
import { describeActiveProvider } from "./provider";

/**
 * A server component, so the endpoint label is read from the environment at
 * request time rather than baked in at build time — and so the client bundle
 * never learns anything about how the server reaches the model.
 */
export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const provider = describeActiveProvider();
  // `?frames=1` opens the frame inspector on load, so a link (or the recording
  // script) can land on the page with the stream already visible.
  const { frames } = await searchParams;
  return (
    <DashboardPage
      providerLabel={provider.label}
      isSovereign={provider.isSovereign}
      isLocal={provider.isLocal}
      showFramesInitially={frames === "1"}
    />
  );
}
