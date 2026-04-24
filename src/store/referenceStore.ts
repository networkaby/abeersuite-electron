import { create } from "zustand";
import axios from "axios";

type Customer = { id: number; name: string; phone: string };
type Technician = { id: number; name: string };

interface ReferenceStore {
    customers: Customer[];
    technicians: Technician[];
    fetchCustomers: () => Promise<void>;
    fetchTechnicians: () => Promise<void>;
}

export const useReferenceStore = create<ReferenceStore>((set, get) => ({
    customers: [],
    technicians: [],
    fetchCustomers: async () => {
        if (get().customers.length > 0) return;
        const { data } = await axios.get<Customer[]>("/api/customers");
        set({ customers: data });
    },
    fetchTechnicians: async () => {
        if (get().technicians.length > 0) return;
        const { data } = await axios.get<Technician[]>("/api/users");
        set({ technicians: data });
    },
}));
