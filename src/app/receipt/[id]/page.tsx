import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import ReceiptButtons from "@/components/ReceiptButtons";

export default async function ReceiptPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;

    const ticket = await prisma.ticket.findUnique({
        where: { id: Number(id) },
        include: {
            device: { include: { customer: true } },
            technician: true,
        },
    });

    if (!ticket) notFound();

    const { device } = ticket;
    const { customer } = device;

    return (
        <html>
            <head>
                <title>Receipt - Ticket #{ticket.id}</title>
                <style>{`
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: 'Courier New', monospace;
            font-size: 12px;
            width: 80mm;
            margin: 0 auto;
            padding: 4mm;
            background: white;
            color: #000;
          }
          .center { text-align: center; }
          .bold { font-weight: bold; }
          .large { font-size: 15px; }
          .small { font-size: 10px; }
          .divider {
            border-top: 1px dashed #000;
            margin: 6px 0;
          }
          .row {
            display: flex;
            justify-content: space-between;
            margin: 3px 0;
          }
          .label { color: #555; }
          .section-title {
            font-weight: bold;
            font-size: 11px;
            text-transform: uppercase;
            margin: 4px 0 2px;
            letter-spacing: 1px;
          }
          .terms {
            font-size: 9px;
            color: #444;
            line-height: 1.5;
            margin-top: 4px;
          }
          .ticket-id {
            font-size: 20px;
            font-weight: bold;
            letter-spacing: 2px;
          }
          .status-badge {
            display: inline-block;
            border: 1px solid #000;
            padding: 1px 6px;
            font-size: 10px;
            font-weight: bold;
            letter-spacing: 1px;
          }
          .signature-line {
            border-top: 1px solid #000;
            margin-top: 20px;
            padding-top: 2px;
            font-size: 9px;
            color: #555;
          }
          @media print {
            .no-print { display: none !important; }
            body { margin: 0; padding: 2mm; }
          }
        `}</style>
            </head>
            <body>
                <ReceiptButtons />

                <div className="center">
                    <div className="bold large">SERVICE MGMT</div>
                    <div className="small">Job Receipt / Service Ticket</div>
                </div>

                <div className="divider" />

                <div className="center">
                    <div className="ticket-id">#{String(ticket.id).padStart(4, "0")}</div>
                    <div className="small" style={{ marginTop: "2px" }}>
                        {new Date(ticket.createdAt).toLocaleString()}
                    </div>
                    <div style={{ marginTop: "4px" }}>
                        <span className="status-badge">{ticket.status.replace("_", " ")}</span>
                    </div>
                </div>

                <div className="divider" />

                <div className="section-title">Customer</div>
                <div className="row">
                    <span className="label">Name:</span>
                    <span className="bold">{customer.name}</span>
                </div>
                <div className="row">
                    <span className="label">Phone:</span>
                    <span>{customer.phone}</span>
                </div>
                {customer.email && (
                    <div className="row">
                        <span className="label">Email:</span>
                        <span>{customer.email}</span>
                    </div>
                )}

                <div className="divider" />

                <div className="section-title">Device</div>
                <div className="row">
                    <span className="label">Type:</span>
                    <span>{device.type}</span>
                </div>
                <div className="row">
                    <span className="label">Brand:</span>
                    <span>{device.brand}</span>
                </div>
                <div className="row">
                    <span className="label">Model:</span>
                    <span>{device.model}</span>
                </div>

                <div className="divider" />

                <div className="section-title">Problem</div>
                <div style={{ lineHeight: "1.5", fontSize: "11px" }}>
                    {device.problem}
                </div>

                {ticket.estimatedCost && (
                    <>
                        <div className="divider" />
                        <div className="row">
                            <span className="section-title">Estimated Cost</span>
                            <span className="bold large">৳ {ticket.estimatedCost}</span>
                        </div>
                    </>
                )}

                <div className="divider" />

                <div className="row">
                    <span className="label">Priority:</span>
                    <span className="bold">{ticket.priority}</span>
                </div>
                {ticket.technician && (
                    <div className="row">
                        <span className="label">Technician:</span>
                        <span>{ticket.technician.name}</span>
                    </div>
                )}

                <div className="divider" />

                <div className="section-title">Terms & Conditions</div>
                <div className="terms">
                    1. Please keep this receipt. It is required for device collection.<br />
                    2. Estimated cost may vary after diagnosis.<br />
                    3. Uncollected devices after 30 days may incur storage charges.<br />
                    4. We are not responsible for data loss during repair.<br />
                    5. Warranty void if device is tampered with externally.
                </div>

                <div className="divider" />

                <div style={{ marginTop: "16px" }}>
                    <div className="signature-line">Customer Signature</div>
                </div>
                <div style={{ marginTop: "12px" }}>
                    <div className="signature-line">Staff Signature</div>
                </div>

                <div className="divider" />

                <div className="center small" style={{ marginTop: "6px" }}>
                    Thank you for your trust!
                </div>
            </body>
        </html>
    );
}