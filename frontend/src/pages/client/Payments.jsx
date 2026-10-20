import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader, Panel, StatusBadge, Table, Td, Empty, Loading } from "@/components/common";
import { api } from "@/lib/api";
import { brl, fmtDateTime } from "@/lib/format";
import { useAuth } from "@/context/AuthContext";

export default function ClientPayments() {
  const [d, setD] = useState(null);
  const [rec, setRec] = useState(null);
  const { user } = useAuth();
  useEffect(() => {
    api.get("/client/subscription").then((r) => setD(r.data));
  }, []);
  if (!d) return <Loading />;
  return (
    <div>
      <PageHeader title="Pagamentos" subtitle="Histórico de cobranças confirmadas pelo Mercado Pago." />
      <Panel>
        {d.payments.length === 0 ? <Empty>Nenhum pagamento registrado ainda.</Empty> : (
          <Table cols={["Data", "Plano", "Valor", "Status", "Transação", ""]} testid="client-payments-table">
            {d.payments.map((p) => (
              <tr key={p.id}>
                <Td>{fmtDateTime(p.paid_at || p.created_at)}</Td><Td>{p.plan_name}</Td><Td>{brl(p.amount)}</Td>
                <Td><StatusBadge status={p.status} /></Td><Td className="font-mono text-xs">{p.mp_payment_id || p.mp_authorized_payment_id}</Td>
                <Td>{p.status === "aprovado" && <Button size="sm" variant="secondary" data-testid={`payment-receipt-btn-${p.id}`} onClick={() => setRec(p)}>Recibo</Button>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
      <Dialog open={!!rec} onOpenChange={() => setRec(null)}>
        <DialogContent className="bg-white text-slate-900" data-testid="payment-receipt-dialog">
          <DialogHeader><DialogTitle>Recibo {rec?.receipt_number}</DialogTitle></DialogHeader>
          {rec && (
            <div className="space-y-2 text-sm">
              <p><strong>MarkImagem Rádio Web</strong></p>
              <p>Cliente: {user.business?.name}</p>
              <p>Referente: assinatura {rec.plan_name}</p>
              <p>Valor: {brl(rec.amount)}</p>
              <p>Data: {fmtDateTime(rec.paid_at || rec.created_at)}</p>
              <p>Transação Mercado Pago: {rec.mp_payment_id || rec.mp_authorized_payment_id}</p>
              <Button className="mt-4" onClick={() => window.print()} data-testid="payment-receipt-print-btn">Imprimir</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
