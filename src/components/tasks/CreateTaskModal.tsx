"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { X, Loader2 } from "lucide-react";

interface User { id: number; name: string }
interface Priority { id: string; label: string }

interface Props {
    open: boolean;
    onClose: () => void;
    onCreated: () => void;
    prefillTicketId?: number;
}

const ROLES = [
    { id: "R1", label: "Admin" },
    { id: "R2", label: "Technician" },
    { id: "R3", label: "Front Desk" },
    { id: "R4", label: "Despatch" },
];

export default function CreateTaskModal({ open, onClose, onCreated, prefillTicketId }: Props) {
    const [title, setTitle]             = useState("");
    const [description, setDescription] = useState("");
    const [priority, setPriority]       = useState("P2");
    const [assignMode, setAssignMode]   = useState<"user" | "role">("role");
    const [assignedToId, setAssignedToId] = useState<string>("");
    const [assignedRole, setAssignedRole] = useState<string>("");
    const [dueAt, setDueAt]             = useState("");
    const [ticketId, setTicketId]       = useState(prefillTicketId ? String(prefillTicketId) : "");
    const [saving, setSaving]           = useState(false);

    const [users, setUsers]             = useState<User[]>([]);
    const [priorities, setPriorities]   = useState<Priority[]>([]);

    useEffect(() => {
        if (!open) return;
        axios.get("/api/users").then(r => setUsers(r.data));
        axios.get("/api/priorities").then(r => setPriorities(r.data));
        if (prefillTicketId) setTicketId(String(prefillTicketId));
    }, [open, prefillTicketId]);

    const reset = () => {
        setTitle(""); setDescription(""); setPriority("P2");
        setAssignMode("role"); setAssignedToId(""); setAssignedRole("");
        setDueAt(""); setTicketId(prefillTicketId ? String(prefillTicketId) : "");
    };

    const handleClose = () => { reset(); onClose(); };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!title.trim()) { toast.error("Title is required"); return; }

        setSaving(true);
        try {
            await axios.post("/api/tasks", {
                title:        title.trim(),
                description:  description.trim() || null,
                priority,
                assignedToId: assignMode === "user" && assignedToId ? Number(assignedToId) : null,
                assignedRole: assignMode === "role" && assignedRole ? assignedRole : null,
                dueAt:        dueAt || null,
                ticketId:     ticketId ? Number(ticketId) : null,
            });
            toast.success("Task created");
            onCreated();
            handleClose();
        } catch {
            toast.error("Failed to create task");
        } finally {
            setSaving(false);
        }
    };

    if (!open) return null;

    return (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b">
                    <h2 className="font-semibold text-gray-800">Create Task</h2>
                    <button onClick={handleClose} className="text-gray-400 hover:text-gray-600">
                        <X size={18} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    {/* Title */}
                    <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Title *</label>
                        <input
                            type="text"
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            placeholder="What needs to be done?"
                            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            autoFocus
                        />
                    </div>

                    {/* Description */}
                    <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                        <textarea
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            placeholder="Optional details..."
                            rows={2}
                            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                        />
                    </div>

                    {/* Priority + Due date */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Priority</label>
                            <select
                                value={priority}
                                onChange={e => setPriority(e.target.value)}
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                {priorities.map(p => (
                                    <option key={p.id} value={p.id}>{p.label}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Due Date</label>
                            <input
                                type="date"
                                value={dueAt}
                                onChange={e => setDueAt(e.target.value)}
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                    </div>

                    {/* Assign to */}
                    <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Assign To</label>
                        <div className="flex gap-2 mb-2">
                            <button
                                type="button"
                                onClick={() => setAssignMode("role")}
                                className={`flex-1 py-1.5 text-xs rounded-lg border font-medium transition-colors ${
                                    assignMode === "role"
                                        ? "bg-blue-600 text-white border-blue-600"
                                        : "border-gray-300 text-gray-600 hover:bg-gray-50"
                                }`}
                            >
                                Role
                            </button>
                            <button
                                type="button"
                                onClick={() => setAssignMode("user")}
                                className={`flex-1 py-1.5 text-xs rounded-lg border font-medium transition-colors ${
                                    assignMode === "user"
                                        ? "bg-blue-600 text-white border-blue-600"
                                        : "border-gray-300 text-gray-600 hover:bg-gray-50"
                                }`}
                            >
                                Specific User
                            </button>
                        </div>
                        {assignMode === "role" ? (
                            <select
                                value={assignedRole}
                                onChange={e => setAssignedRole(e.target.value)}
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="">Unassigned</option>
                                {ROLES.map(r => (
                                    <option key={r.id} value={r.id}>{r.label} ({r.id})</option>
                                ))}
                            </select>
                        ) : (
                            <select
                                value={assignedToId}
                                onChange={e => setAssignedToId(e.target.value)}
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="">Unassigned</option>
                                {users.map(u => (
                                    <option key={u.id} value={u.id}>{u.name}</option>
                                ))}
                            </select>
                        )}
                    </div>

                    {/* Linked ticket */}
                    <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Linked Ticket # (optional)</label>
                        <input
                            type="number"
                            value={ticketId}
                            onChange={e => setTicketId(e.target.value)}
                            placeholder="e.g. 42"
                            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={handleClose}
                            className="flex-1 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={saving}
                            className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {saving && <Loader2 size={14} className="animate-spin" />}
                            Create Task
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
