import { useQuery } from "@tanstack/react-query";
import { api } from "@shared/routes";
import type { DashboardKPI } from "@shared/schema";

export function useKPI() {
  return useQuery<DashboardKPI>({
    queryKey: [api.kpi.get.path],
    queryFn: async () => {
      const res = await fetch(api.kpi.get.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch KPI");
      return res.json();
    },
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 300000,
  });
}
