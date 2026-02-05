import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { type InsertMarketplaceSetting } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

export function useMarketplaceSettings() {
  return useQuery({
    queryKey: [api.marketplace.list.path],
    queryFn: async () => {
      const res = await fetch(api.marketplace.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch settings");
      return api.marketplace.list.responses[200].parse(await res.json());
    },
  });
}

export function useSaveMarketplaceSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: InsertMarketplaceSetting) => {
      const res = await fetch(api.marketplace.save.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to save settings");
      return api.marketplace.save.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.marketplace.list.path] });
      toast({ title: "Settings saved", description: "Marketplace configuration updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
}

export function useSyncAllMarketplaces() {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async () => {
      const res = await fetch(api.marketplace.syncAll.path, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error("Failed to sync");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Sync started", description: "Full synchronization in progress" });
    },
    onError: (error: Error) => {
      toast({ title: "Sync failed", description: error.message, variant: "destructive" });
    },
  });
}
