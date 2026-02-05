import { useQuery } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { type AuditLogEntry } from "@shared/schema";

export function useAuditLog() {
  return useQuery<AuditLogEntry[]>({
    queryKey: [api.auditLog.list.path],
    queryFn: async () => {
      const res = await fetch(api.auditLog.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch audit log");
      return res.json();
    },
  });
}
