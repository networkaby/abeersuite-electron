/** Shared ticket/device shapes used across customer explorer pages. */

export type Ticket = {
    id: number;
    priority: string;
    createdAt: string;
    ticketStatus: { label: string; color: string };
};

export type CustomerDevice = {
    id: number;
    brand: string;
    model: string;
    type: string;
    tickets: Ticket[];
};
