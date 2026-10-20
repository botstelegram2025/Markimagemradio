import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader, Panel, Table, Td, Loading, Empty } from "@/components/common";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";

export default function Logs() {
  const [audit, setAudit] = useState(null);
  const [err, setErr] = useState({ errors: [], stream: [] });
  useEffect(() => {
    api.get("/admin/audit").then((r) => setAudit(r.data));
    api.get("/admin/errors").then((r) => setErr(r.data));
  }, []);
  if (!audit) return <Loading />;
  return (
    <div>
      <PageHeader title="Logs e monitoramento" subtitle="Auditoria de ações, erros do sistema e eventos do streaming." />
      <Tabs defaultValue="audit">
        <TabsList className="mb-4"><TabsTrigger value="audit" data-testid="tab-audit">Auditoria</TabsTrigger><TabsTrigger value="errors" data-testid="tab-errors">Erros ({err.errors.length})</TabsTrigger><TabsTrigger value="stream" data-testid="tab-stream">Streaming ({err.stream.length})</TabsTrigger></TabsList>
        <TabsContent value="audit"><Panel>
          <Table cols={["Data", "Usuário", "Ação", "Entidade", "Detalhes"]} testid="audit-table">
            {audit.map((l) => <tr key={l.id}><Td className="text-xs whitespace-nowrap">{fmtDateTime(l.created_at)}</Td><Td>{l.user_email}</Td><Td className="font-mono text-xs text-accent">{l.action}</Td><Td>{l.entity}</Td><Td className="text-xs text-slate-400 max-w-md break-all">{JSON.stringify(l.details)}</Td></tr>)}
          </Table>
        </Panel></TabsContent>
        <TabsContent value="errors"><Panel>
          {err.errors.length === 0 ? <Empty>Nenhum erro registrado.</Empty> : <Table cols={["Data", "Origem", "Mensagem"]} testid="errors-table">
            {err.errors.map((l) => <tr key={l.id}><Td className="text-xs whitespace-nowrap">{fmtDateTime(l.created_at)}</Td><Td className="font-mono text-xs">{l.source}</Td><Td className="text-xs text-red-300 break-all">{l.message}</Td></tr>)}
          </Table>}
        </Panel></TabsContent>
        <TabsContent value="stream"><Panel>
          {err.stream.length === 0 ? <Empty>Nenhum evento de streaming.</Empty> : <Table cols={["Data", "Tipo", "Mensagem"]} testid="stream-events-table">
            {err.stream.map((l) => <tr key={l.id}><Td className="text-xs whitespace-nowrap">{fmtDateTime(l.created_at)}</Td><Td>{l.type}</Td><Td className="text-xs">{l.message}</Td></tr>)}
          </Table>}
        </Panel></TabsContent>
      </Tabs>
    </div>
  );
}
