import type { UseQueryResult } from "@tanstack/react-query";
import type { HomeDashboardData } from "@/lib/linkr/home-data";
import { HomeLaunchBoard } from "./HomeLaunchBoard";

export function HomeHero({ query }: { query: UseQueryResult<HomeDashboardData, Error> }) {
  return (
    <section className="sm-hero sm-launch-board-hero" id="demo">
      <HomeLaunchBoard data={query.data?.public} loading={query.isLoading || query.isFetching} />
    </section>
  );
}
