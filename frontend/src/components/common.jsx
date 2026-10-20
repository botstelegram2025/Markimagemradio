import { tone, LABELS } from "@/lib/format";
import { Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";

export const PageHeader = ({ title, subtitle, children }) => (
  <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8 fade-up">
    <div>
      <h1 className="text-3xl sm:text-4xl font-bold">{title}</h1>
      {subtitle && <p className="text-slate-400 mt-2 text-sm md:text-base max-w-2xl">{subtitle}</p>}
    </div>
    {children && <div className="flex flex-wrap gap-2">{children}</div>}
  </div>
);

export const StatusBadge = ({ status, testid }) => (
  <span data-testid={testid} className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border whitespace-nowrap ${tone(status)}`}>
    {LABELS[status] || status || "—"}
  </span>
);

export const StatCard = ({ label, value, hint, icon: Icon, accent = false, testid }) => (
  <div data-testid={testid} className={`rounded-2xl border p-5 fade-up ${accent ? "border-primary/40 bg-primary/10" : "border-border bg-card"}`}>
    <div className="flex items-center justify-between">
      <p className="text-xs uppercase tracking-wider text-slate-400 font-semibold">{label}</p>
      {Icon && <Icon className={`w-4 h-4 ${accent ? "text-primary" : "text-slate-500"}`} />}
    </div>
    <p className="text-3xl font-bold mt-3 font-display">{value}</p>
    {hint && <p className="text-xs text-slate-500 mt-1">{hint}</p>}
  </div>
);

export const Panel = ({ title, children, action, className = "", testid }) => (
  <section data-testid={testid} className={`rounded-2xl border border-border bg-card p-5 sm:p-6 ${className}`}>
    {(title || action) && (
      <div className="flex items-center justify-between gap-3 mb-4">
        {title && <h3 className="text-lg font-semibold">{title}</h3>}
        {action}
      </div>
    )}
    {children}
  </section>
);

export const Empty = ({ children = "Nada por aqui ainda." }) => (
  <div className="text-center text-slate-500 text-sm py-10 border border-dashed border-border rounded-xl">{children}</div>
);

export const Loading = () => (
  <div className="flex items-center justify-center py-16 text-slate-400" data-testid="loading"><Loader2 className="w-6 h-6 animate-spin" /></div>
);

export const Field = ({ label, children, hint }) => (
  <div className="space-y-1.5">
    <Label className="text-xs uppercase tracking-wider text-slate-400">{label}</Label>
    {children}
    {hint && <p className="text-xs text-slate-500">{hint}</p>}
  </div>
);

export const Table = ({ cols, children, testid }) => (
  <div className="overflow-x-auto -mx-2" data-testid={testid}>
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs uppercase tracking-wider text-slate-500 border-b border-border">
          {cols.map((c) => <th key={c} className="px-2 py-3 font-semibold whitespace-nowrap">{c}</th>)}
        </tr>
      </thead>
      <tbody className="divide-y divide-border">{children}</tbody>
    </table>
  </div>
);

export const Td = ({ children, className = "" }) => <td className={`px-2 py-3 align-middle ${className}`}>{children}</td>;

export const NativeSelect = ({ value, onChange, children, testid, className = "" }) => (
  <select data-testid={testid} value={value ?? ""} onChange={(e) => onChange(e.target.value)}
    className={`h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${className}`}>
    {children}
  </select>
);
