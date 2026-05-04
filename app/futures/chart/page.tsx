import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { FuturesKlineChart } from "@/components/futures-kline-chart";

export const dynamic = "force-dynamic";

export default async function FuturesChartFullPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return <FuturesKlineChart />;
}
