"use client";

import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, ClipboardList, UserCheck, AlertCircle, CheckCircle2, Clock, Filter, ArrowUpDown } from "lucide-react";
import { useSession } from "next-auth/react";
import TaskList, { TaskRow } from "@/components/tasks/TaskList";
import CreateTaskModal from "@/components/tasks/CreateTaskModal";

type AssignmentStatus = "pending" | "in_progress" | "completed" | "overdue";
type AssignmentType = "all" | "assigned_to_me" | "created_by_me" | "unassigned";
type SortBy = "due_date" | "priority" | "created_at" | "status";

const STATUS_FILTERS: { id: AssignmentStatus; label: string; color: string }[] = [
    { id: "pending", label: "Pending", color: "bg-gray-100 text-gray-700" },
    { id: "in_progress", label: "In Progress", color: "bg-blue-100 text-blue-700" },
    { id: "completed", label: "Completed", color: "bg-green-100 text-green-700" },
    { id: "overdue", label: "Overdue", color: "bg-red-100 text-red-700" },
];

const TYPE_FILTERS: { id: AssignmentType; label: string }[] = [
    { id: "all", label: "All Assignments" },
    { id: "assigned_to_me", label: "Assigned to Me" },
    { id: "created_by_me", label: "Created by Me" },
    { id: "unassigned", label: "Unassigned" },
];

const SORT_OPTIONS: { id: SortBy; label: string }[] = [
    { id: "due_date", label: "Due Date" },
    { id: "priority", label: "Priority" },
    { id: "created_at", label: "Created" },
    { id: "status", label: "Status" },
];

export default function AssignmentsPage() {
    const { data: session } = useSession();
    const userId = Number((session?.user as { id?: string })?.id ?? 0);
    
    const [assignments, setAssignments] = useState<TaskRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCreate, setShowCreate] = useState(false);
    const [statusFilter, setStatusFilter] = useState<AssignmentStatus>("pending");
    const [typeFilter, setTypeFilter] = useState<AssignmentType>("assigned_to_me");
    const [sortBy, setSortBy] = useState<SortBy>("due_date");
    const [showFilters, setShowFilters] = useState(false);

    const fetchAssignments = useCallback(async () => {
        setLoading(true);
        try {
            const { data } = await axios.get<TaskRow[]>("/api/tasks", {
                params: { 
                    scope: typeFilter === "all" ? "org" : typeFilter === "assigned_to_me" ? "own" : "team",
                    filter: statusFilter === "completed" ? "done" : statusFilter === "overdue" ? "overdue" : "open",
                    sortBy,
                },
            });
            
            // Filter assignments based on type
            let filteredAssignments = data;
            if (typeFilter === "created_by_me") {
                filteredAssignments = data.filter(task => task.createdBy.id === userId);
            } else if (typeFilter === "unassigned") {
                filteredAssignments = data.filter(task => !task.assignedToId && task.status !== "done");
            }

            setAssignments(filteredAssignments);
        } catch {
            toast.error("Failed to load assignments");
        } finally {
            setLoading(false);
        }
    }, [statusFilter, typeFilter, sortBy, userId]);

    useEffect(() => { fetchAssignments(); }, [fetchAssignments]);

    const getAssignmentStats = () => {
        const pending = assignments.filter(a => a.status === "open").length;
        const inProgress = assignments.filter(a => a.status === "in_progress").length;
        const completed = assignments.filter(a => a.status === "done").length;
        const overdue = assignments.filter(a => {
            if (!a.dueAt || a.status === "done") return false;
            return new Date(a.dueAt) < new Date();
        }).length;

        return { pending, inProgress, completed, overdue };
    };

    const stats = getAssignmentStats();

    return (
        <div>
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <ClipboardList size={24} className="text-blue-600" />
                    <div>
                        <h1 className="text-3xl font-bold">Assignments</h1>
                        <p className="text-gray-400 text-sm">Manage and track your work assignments</p>
                    </div>
                </div>
                <button
                    onClick={() => setShowCreate(true)}
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                >
                    <Plus size={16} />
                    New Assignment
                </button>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-4 gap-4 mb-6">
                <div className="bg-white rounded-xl shadow p-4 flex items-center gap-3">
                    <div className="text-gray-400"><Clock size={20} /></div>
                    <div>
                        <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Pending</p>
                        <p className="text-2xl font-bold text-gray-800">{stats.pending}</p>
                    </div>
                </div>
                <div className="bg-white rounded-xl shadow p-4 flex items-center gap-3">
                    <div className="text-blue-500"><UserCheck size={20} /></div>
                    <div>
                        <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">In Progress</p>
                        <p className="text-2xl font-bold text-blue-600">{stats.inProgress}</p>
                    </div>
                </div>
                <div className="bg-white rounded-xl shadow p-4 flex items-center gap-3">
                    <div className="text-green-500"><CheckCircle2 size={20} /></div>
                    <div>
                        <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Completed</p>
                        <p className="text-2xl font-bold text-green-600">{stats.completed}</p>
                    </div>
                </div>
                <div className="bg-white rounded-xl shadow p-4 flex items-center gap-3">
                    <div className="text-red-500"><AlertCircle size={20} /></div>
                    <div>
                        <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Overdue</p>
                        <p className="text-2xl font-bold text-red-600">{stats.overdue}</p>
                    </div>
                </div>
            </div>

            {/* Filters */}
            <div className="bg-white rounded-xl shadow p-4 mb-4">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <Filter size={16} className="text-gray-500" />
                        <span className="text-sm font-medium text-gray-700">Filters</span>
                    </div>
                    <button
                        onClick={() => setShowFilters(!showFilters)}
                        className="text-xs text-blue-600 hover:text-blue-700"
                    >
                        {showFilters ? "Hide" : "Show"} filters
                    </button>
                </div>

                {showFilters && (
                    <div className="space-y-3">
                        {/* Type Filter */}
                        <div>
                            <label className="text-xs text-gray-500 font-medium uppercase tracking-wide block mb-2">Type</label>
                            <div className="flex gap-2 flex-wrap">
                                {TYPE_FILTERS.map(filter => (
                                    <button
                                        key={filter.id}
                                        onClick={() => setTypeFilter(filter.id)}
                                        className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                                            typeFilter === filter.id
                                                ? "bg-blue-600 text-white"
                                                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                                        }`}
                                    >
                                        {filter.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Status Filter */}
                        <div>
                            <label className="text-xs text-gray-500 font-medium uppercase tracking-wide block mb-2">Status</label>
                            <div className="flex gap-2 flex-wrap">
                                {STATUS_FILTERS.map(filter => (
                                    <button
                                        key={filter.id}
                                        onClick={() => setStatusFilter(filter.id)}
                                        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${filter.color} ${
                                            statusFilter === filter.id
                                                ? "ring-2 ring-offset-2 ring-blue-500"
                                                : ""
                                        }`}
                                    >
                                        {filter.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Sort */}
                        <div>
                            <label className="text-xs text-gray-500 font-medium uppercase tracking-wide block mb-2">Sort by</label>
                            <div className="flex items-center gap-2">
                                <ArrowUpDown size={14} className="text-gray-400" />
                                <select
                                    value={sortBy}
                                    onChange={(e) => setSortBy(e.target.value as SortBy)}
                                    className="text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-blue-300"
                                >
                                    {SORT_OPTIONS.map(option => (
                                        <option key={option.id} value={option.id}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Assignment List */}
            <div className="bg-white rounded-xl shadow overflow-hidden">
                <div className="px-5 py-3 border-b bg-gray-50">
                    <div className="flex items-center justify-between">
                        <h2 className="font-medium text-gray-800">
                            {assignments.length} assignment{assignments.length !== 1 ? "s" : ""}
                        </h2>
                        <div className="text-xs text-gray-500">
                            {TYPE_FILTERS.find(f => f.id === typeFilter)?.label} · {STATUS_FILTERS.find(f => f.id === statusFilter)?.label}
                        </div>
                    </div>
                </div>
                
                {loading ? (
                    <div className="py-16 text-center text-gray-400 text-sm">Loading assignments...</div>
                ) : (
                    <TaskList tasks={assignments} onRefresh={fetchAssignments} />
                )}
            </div>

            {/* Create Modal */}
            <CreateTaskModal
                open={showCreate}
                onClose={() => setShowCreate(false)}
                onCreated={fetchAssignments}
            />
        </div>
    );
}
