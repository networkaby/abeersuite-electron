"use client";

import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, ListTodo } from "lucide-react";
import TaskList, { TaskRow } from "@/components/tasks/TaskList";
import CreateTaskModal from "@/components/tasks/CreateTaskModal";

type Scope  = "own" | "team" | "org";
type Filter = "open" | "done" | "today" | "overdue";

const SCOPE_TABS: { id: Scope; label: string }[] = [
    { id: "own",  label: "My Tasks" },
    { id: "team", label: "My Team" },
    { id: "org",  label: "All Tasks" },
];

const FILTER_CHIPS: { id: Filter; label: string }[] = [
    { id: "open",    label: "Open" },
    { id: "today",   label: "Due Today" },
    { id: "overdue", label: "Overdue" },
    { id: "done",    label: "Closed" },
];

export default function TasksPage() {
    const [scope,  setScope]  = useState<Scope>("own");
    const [filter, setFilter] = useState<Filter>("open");
    const [tasks,  setTasks]  = useState<TaskRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCreate, setShowCreate] = useState(false);

    const fetchTasks = useCallback(async () => {
        setLoading(true);
        try {
            const { data } = await axios.get<TaskRow[]>("/api/tasks", {
                params: { scope, filter },
            });
            setTasks(data);
        } catch {
            toast.error("Failed to load tasks");
        } finally {
            setLoading(false);
        }
    }, [scope, filter]);

    useEffect(() => { fetchTasks(); }, [fetchTasks]);

    return (
        <div>
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <ListTodo size={24} className="text-blue-600" />
                    <h1 className="text-3xl font-bold">Tasks</h1>
                </div>
                <button
                    onClick={() => setShowCreate(true)}
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                >
                    <Plus size={16} />
                    New Task
                </button>
            </div>

            {/* Scope tabs */}
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1 mb-4 w-fit">
                {SCOPE_TABS.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setScope(tab.id)}
                        className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                            scope === tab.id
                                ? "bg-white text-gray-800 shadow-sm"
                                : "text-gray-500 hover:text-gray-700"
                        }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Filter chips */}
            <div className="flex gap-2 mb-4">
                {FILTER_CHIPS.map(chip => (
                    <button
                        key={chip.id}
                        onClick={() => setFilter(chip.id)}
                        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors border ${
                            filter === chip.id
                                ? "bg-blue-600 text-white border-blue-600"
                                : "bg-white text-gray-600 border-gray-200 hover:border-blue-300"
                        }`}
                    >
                        {chip.label}
                    </button>
                ))}
                <span className="ml-auto text-xs text-gray-400 self-center">
                    {tasks.length} task{tasks.length !== 1 ? "s" : ""}
                </span>
            </div>

            {/* Task list */}
            <div className="bg-white rounded-xl shadow overflow-hidden">
                {loading ? (
                    <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>
                ) : (
                    <TaskList tasks={tasks} onRefresh={fetchTasks} />
                )}
            </div>

            {/* Create modal */}
            <CreateTaskModal
                open={showCreate}
                onClose={() => setShowCreate(false)}
                onCreated={fetchTasks}
            />
        </div>
    );
}
